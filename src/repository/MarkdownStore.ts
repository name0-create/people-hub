// ─── MarkdownStore ────────────────────────────────────────────────────────────
// The ONLY module in the plugin that calls Obsidian's vault / file-manager write
// APIs. Repositories sit on top of it; nothing else touches files.
//
// Safety rules baked in here:
//   • Frontmatter changes go through fileManager.processFrontMatter (atomic
//     read-modify-write on the parsed object). No YAML is ever parsed or built by hand,
//     and the note body is not touched.
//   • The only body edit is appendToSection, via vault.process (atomic; never
//     read-then-modify, so it cannot clobber a concurrent edit).
//   • Renames use fileManager.renameFile (updates wikilinks), never vault.rename.
//   • Deletes use fileManager.trashFile (honours the user's trash setting, recoverable).
//   • Nothing is overwritten: creates fail on an existing path, moves de-duplicate names.
//   • After a write, we wait (bounded) for Obsidian's metadata cache to catch up so
//     callers that re-read straight away don't see stale data.

import { App, normalizePath, TFile } from "obsidian";
import type { FolderKey, FolderService } from "../core/folder-service";
import { appendUnderHeading } from "../core/markdown";
import { RepositoryError } from "./errors";

export type FM = Record<string, unknown>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as FM).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val);
}

const isScalar = (v: unknown) => ["string", "number", "boolean"].includes(typeof v);

/** True once every scalar we wrote is visible in the cached frontmatter. */
function scalarsMatch(cached: FM | undefined, written: FM): boolean {
  if (!cached) return false;
  return Object.entries(written).every(([k, v]) => !isScalar(v) || cached[k] === v);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface UpdateOptions {
  /** Runs inside the same atomic write, only if the mutation actually changed something. */
  onChange?: (fm: FM) => void;
  /** Wait for the metadata cache to re-index the file before resolving (default true). */
  waitForIndex?: boolean;
}

export interface UpdateResult {
  changed: boolean;
  /** Frontmatter as it was before the write. */
  before: FM;
  /** Frontmatter as written (authoritative — don't re-read the cache for this). */
  after: FM;
}

export class MarkdownStore {
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private app: App,
    private folders: FolderService,
    private indexTimeoutMs = 2000,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────
  getFile(path: string): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return f instanceof TFile ? f : null;
  }

  exists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
  }

  markdownFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  /** First markdown file whose cached frontmatter satisfies `pred`. Reads the cache directly (no cloning). */
  findFile(pred: (fm: FM, file: TFile) => boolean): TFile | null {
    for (const f of this.markdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as FM | undefined;
      if (fm && pred(fm, f)) return f;
    }
    return null;
  }

  /** Copy of the cached frontmatter (Obsidian's internal `position` removed). Cheap: no disk read. */
  frontmatter(file: TFile): FM | undefined {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as FM | undefined;
    if (!fm) return undefined;
    const { position: _position, ...rest } = fm;
    return clone(rest);
  }

  // ── Naming ───────────────────────────────────────────────────────────────
  sanitizeName(name: string): string {
    return name.replace(/[\\/:*?"<>|#^\[\]]/g, "").replace(/\s+/g, " ").trim() || "Unnamed";
  }

  pathIn(folder: string, baseName: string): string {
    return normalizePath(`${folder}/${baseName}.md`);
  }

  /** `base`, or `base 2`, `base 3`… — whichever is free in the folder. `ignore` is treated as free. */
  uniqueBaseName(folderKey: FolderKey, base: string, ignore?: TFile): string {
    const folder = this.folders.resolve(folderKey);
    let name = base, i = 2;
    for (;;) {
      const hit = this.app.vault.getAbstractFileByPath(this.pathIn(folder, name));
      if (!hit || hit === ignore) return name;
      name = `${base} ${i++}`;
    }
  }

  // ── Writes ───────────────────────────────────────────────────────────────
  /**
   * Create a note: body first, then frontmatter via processFrontMatter.
   * `baseName` must be free (callers de-duplicate with uniqueBaseName).
   * If writing the frontmatter fails, the half-made file is trashed.
   */
  async create(folderKey: FolderKey, baseName: string, body: string, fm: FM): Promise<TFile> {
    await this.folders.ensure(folderKey);
    const path = this.pathIn(this.folders.resolve(folderKey), baseName);
    if (this.exists(path)) throw new RepositoryError("conflict", `"${path}" already exists`);

    const written = clone(fm);
    let file: TFile;
    try {
      file = await this.app.vault.create(path, body);
    } catch (e) {
      throw new RepositoryError("io", `Could not create "${path}"`, [errText(e)]);
    }

    const watch = this.watchIndexed(path, written);
    try {
      await this.app.fileManager.processFrontMatter(file, target => { Object.assign(target, clone(written)); });
    } catch (e) {
      watch.cancel();
      try { await this.app.fileManager.trashFile(file); } catch { /* best effort */ }
      throw new RepositoryError("io", `Could not write frontmatter for "${path}"`, [errText(e)]);
    }
    await watch.done;
    return file;
  }

  /** Atomically mutate a note's frontmatter. No-op mutations are reported as `changed: false`. */
  async update(file: TFile, mutate: (fm: FM) => void, opts: UpdateOptions = {}): Promise<UpdateResult> {
    let before: FM = {}, after: FM = {}, changed = false;
    let watch: { done: Promise<void>; cancel(): void } | null = null;
    try {
      await this.app.fileManager.processFrontMatter(file, raw => {
        const fm = raw as FM;
        before = clone(fm);
        mutate(fm);
        if (stable(before) !== stable(fm)) { changed = true; opts.onChange?.(fm); }
        after = clone(fm);
        // Register the cache watcher before the write lands (this callback runs first).
        if (changed && opts.waitForIndex !== false) watch = this.watchIndexed(file.path, after);
      });
    } catch (e) {
      (watch as { cancel(): void } | null)?.cancel();
      if (e instanceof RepositoryError) throw e;
      throw new RepositoryError("io", `Could not update "${file.path}"`, [errText(e)]);
    }
    if (watch) await (watch as { done: Promise<void> }).done;
    return { changed, before, after };
  }

  /** Rename or move, updating links to the file. */
  async rename(file: TFile, newPath: string): Promise<void> {
    const target = normalizePath(newPath);
    if (target === file.path) return;
    if (this.exists(target)) throw new RepositoryError("conflict", `"${target}" already exists`);
    try {
      await this.app.fileManager.renameFile(file, target);
    } catch (e) {
      throw new RepositoryError("io", `Could not rename "${file.path}" to "${target}"`, [errText(e)]);
    }
  }

  /** Move into a configured folder, keeping (or setting) the base name; de-duplicates on clash. */
  async move(file: TFile, folderKey: FolderKey, baseName?: string): Promise<string> {
    await this.folders.ensure(folderKey);
    const base = this.uniqueBaseName(folderKey, baseName ?? file.basename, file);
    const target = this.pathIn(this.folders.resolve(folderKey), base);
    await this.rename(file, target);
    return target;
  }

  /** Move to trash per the user's Obsidian setting (recoverable). */
  async trash(file: TFile): Promise<void> {
    try {
      await this.app.fileManager.trashFile(file);
    } catch (e) {
      throw new RepositoryError("io", `Could not delete "${file.path}"`, [errText(e)]);
    }
  }

  /** Append a line under a heading in the note body (atomic vault.process). */
  async appendToSection(file: TFile, heading: string, line: string): Promise<void> {
    try {
      await this.app.vault.process(file, data => appendUnderHeading(data, heading, line));
    } catch (e) {
      throw new RepositoryError("io", `Could not append to "${file.path}"`, [errText(e)]);
    }
  }

  // ── Concurrency ──────────────────────────────────────────────────────────
  /** Run multi-step operations on one note one at a time (e.g. update → rename). */
  async exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try { return await run; }
    finally { if (this.locks.get(key) === tail) this.locks.delete(key); }
  }

  // ── Cache sync ───────────────────────────────────────────────────────────
  /** Resolves when the metadata cache shows what we wrote, or after a bounded timeout. */
  private watchIndexed(path: string, written: FM): { done: Promise<void>; cancel(): void } {
    const cache = this.app.metadataCache;
    let finish: () => void = () => {};
    const done = new Promise<void>(resolve => {
      const cb = (f: TFile) => {
        if (f.path === path && scalarsMatch(this.frontmatter(f), written)) finish();
      };
      const timer = setTimeout(() => finish(), this.indexTimeoutMs);
      finish = () => { clearTimeout(timer); cache.off("changed", cb); resolve(); };
      cache.on("changed", cb);
    });
    return { done, cancel: () => finish() };
  }
}
