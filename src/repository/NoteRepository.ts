// ─── NoteRepository<T> ────────────────────────────────────────────────────────
// Generic CRUD for the simpler stand-alone note kinds (Interaction, Meeting).
// Same guarantees as PersonRepository: frontmatter via processFrontMatter, atomic
// updates, nothing overwritten, deletes to trash, `updated` maintained.
//
// A kind is described by a NoteKind (folder, id prefix, validation, naming).

import type { TFile } from "obsidian";
import { toISO } from "../core/dates";
import type { FolderKey } from "../core/folder-service";
import { generateId } from "../core/ids";
import type { Issue } from "./Checker";
import { RepositoryError } from "./errors";
import type { FM, MarkdownStore } from "./MarkdownStore";

export interface NoteKind {
  label: string;                 // "interaction" — used in messages
  folder: FolderKey;
  idPrefix: string;
  noteType: string;              // frontmatter `type`
  schemaVersion: number;
  /** Set by the repository; rejected in input/patches. */
  managed: readonly string[];
  /** May not be removed. */
  required: readonly string[];
  /** Validate a full record; only issues for keys being written are reported on update. */
  validate(rec: FM): Issue[];
  defaultTitle(rec: FM): string;
  /** File base name for a new note (de-duplicated by the repository). */
  fileBase(rec: FM): string;
}

export interface NoteRecord<T> { file: TFile; path: string; data: T; }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const touch = (fm: FM) => { fm.updated = new Date().toISOString(); };
const defined = (o: FM): FM => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export class NoteRepository<T extends { id: string }> {
  constructor(
    protected store: MarkdownStore,
    protected kind: NoteKind,
    protected onChanged: () => void = () => {},
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────
  get(path: string): NoteRecord<T> | null {
    const file = this.store.getFile(path);
    const fm = file && this.store.frontmatter(file);
    return file && fm && this.isKind(fm) ? this.record(file, fm) : null;
  }

  getById(id: string): NoteRecord<T> | null {
    const file = this.store.findFile(fm => this.isKind(fm) && String(fm.id ?? "") === id);
    return file ? this.get(file.path) : null;
  }

  /** Every note of this kind in the vault, newest first by `date` when present. */
  list(): NoteRecord<T>[] {
    const out: NoteRecord<T>[] = [];
    for (const file of this.store.markdownFiles()) {
      const fm = this.store.frontmatter(file);
      if (fm && this.isKind(fm)) out.push(this.record(file, fm));
    }
    const d = (r: NoteRecord<T>) => String((r.data as unknown as FM).date ?? "");
    return out.sort((a, b) => d(b).localeCompare(d(a)));
  }

  // ── Writes ───────────────────────────────────────────────────────────────
  async create(input: object, body?: string): Promise<NoteRecord<T>> {
    const rec = defined(clone(input) as FM);
    const managed = this.kind.managed.filter(k => k in rec);
    const issues: string[] = managed.map(k => `"${k}" is managed by the plugin and cannot be set`);
    issues.push(...this.kind.validate(rec).map(i => i.message));
    if (issues.length) throw new RepositoryError("validation", `Invalid ${this.kind.label}`, issues);

    const now = new Date();
    const iso = now.toISOString();
    const title = typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : this.kind.defaultTitle(rec);
    const { title: _t, ...rest } = rec;
    const base = this.store.uniqueBaseName(this.kind.folder, this.store.sanitizeName(this.kind.fileBase({ ...rec, title })));

    const fm: FM = {
      id: generateId(this.kind.idPrefix, id => this.store.findFile(f => String(f.id ?? "") === id) !== null),
      id_prefix: this.kind.idPrefix,
      schema_version: this.kind.schemaVersion,
      created: iso, created_date: toISO(now), updated: iso,
      type: this.kind.noteType,
      title,
      ...rest,
    };
    const file = await this.store.create(this.kind.folder, base, body ?? `# ${title}\n`, fm);
    this.onChanged();
    return this.record(file, fm);
  }

  async update(path: string, patch: object): Promise<NoteRecord<T>> {
    const file = this.require(path);
    const p = patch as FM;
    const issues: string[] = [];
    for (const [k, v] of Object.entries(p)) {
      if (this.kind.managed.includes(k)) issues.push(`"${k}" is managed by the plugin and cannot be set`);
      else if (v === undefined && this.kind.required.includes(k)) issues.push(`"${k}" is required and cannot be removed`);
    }
    if (issues.length) throw new RepositoryError("validation", `Invalid ${this.kind.label} update`, issues);

    return this.store.exclusive(file.path, async () => {
      const result = await this.store.update(file, fm => {
        // Validate against the note as it is at write time; abort the write on failure.
        const merged: FM = { ...fm };
        for (const [k, v] of Object.entries(p)) { if (v === undefined) delete merged[k]; else merged[k] = v; }
        const bad = this.kind.validate(merged).filter(i => i.key in p).map(i => i.message);
        if (bad.length) throw new RepositoryError("validation", `Invalid ${this.kind.label} update`, bad);
        for (const [k, v] of Object.entries(p)) { if (v === undefined) delete fm[k]; else fm[k] = clone(v); }
      }, { onChange: touch });
      if (result.changed) this.onChanged();
      return this.record(file, result.after);
    });
  }

  /** Send to Obsidian's trash (recoverable). */
  async delete(path: string): Promise<void> {
    const file = this.require(path);
    await this.store.exclusive(file.path, async () => {
      await this.store.trash(file);
      this.onChanged();
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────
  private isKind(fm: FM): boolean { return fm.type === this.kind.noteType; }

  private require(path: string): TFile {
    const file = this.store.getFile(path);
    if (!file) throw new RepositoryError("not_found", `No note at "${path}"`);
    const fm = this.store.frontmatter(file);
    if (!fm || !this.isKind(fm)) throw new RepositoryError("not_a_note", `"${path}" is not ${this.kind.label === "interaction" ? "an" : "a"} ${this.kind.label} note`);
    return file;
  }

  private record(file: TFile, fm: FM): NoteRecord<T> {
    return { file, path: file.path, data: fm as unknown as T };
  }
}
