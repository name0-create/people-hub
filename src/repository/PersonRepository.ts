// ─── PersonRepository ─────────────────────────────────────────────────────────
// WRITE side for person notes (reads of the whole set live in PeopleIndex).
//
//   getPerson / getPersonById      → canonical Person (legacy v0.2 keys normalised)
//   createPerson / updatePerson    → validated against SchemaRegistry, written with
//   renamePerson / archive / …       processFrontMatter (no YAML string handling)
//
// Update flow:
//   validate patch → processFrontMatter (patch, title/name sync, `updated`) →
//   [rename file via fileManager.renameFile] → wait for metadata cache →
//   refresh ONLY the affected PeopleIndex entry (the index then notifies views).
//
// Callers never see a TFile mutation API: everything goes through MarkdownStore.

import type { TFile } from "obsidian";
import { toISO } from "../core/dates";
import type { FolderService } from "../core/folder-service";
import { generateId } from "../core/ids";
import type { PeopleHubSettings } from "../core/settings";
import type { Person } from "../models/Person";
import { PERSON_ID_PREFIX, PERSON_NOTE_TYPE, PERSON_SCHEMA_VERSION } from "../models/Person";
import { normalizePerson } from "../models/PersonNormalizer";
import { validateValue } from "../models/PropertyValidation";
import type { SchemaRegistry } from "../models/SchemaRegistry";
import { personSchema } from "../models/SchemaRegistry";
import { RepositoryError } from "./errors";
import type { FM, MarkdownStore } from "./MarkdownStore";
import type { PeopleIndex } from "./PeopleIndex";

// ── Public types ──────────────────────────────────────────────────────────────

/** Keys the repository owns. They can't appear in a patch. */
export type ManagedPersonKey =
  | "id" | "id_prefix" | "schema_version"
  | "created" | "created_date" | "updated"
  | "type" | "title";

/** Partial update. A key set to `undefined` removes that property from the note. */
export type PersonPatch = Partial<Omit<Person, ManagedPersonKey>>;
/** Static patch, or a function of the person as it is *at write time* (for read-modify-write, e.g. counters). */
export type PersonPatchInput = PersonPatch | ((current: Person) => PersonPatch);

export type NewPersonData = PersonPatch & { name: string };

export interface PersonRecord {
  file: TFile;
  path: string;
  /** Canonical shape. Legacy keys are mapped, values coerced; the note itself is not modified. */
  person: Person;
  /** True if the note predates the current schema_version (not yet migrated). */
  needsMigration: boolean;
}

export interface CreatePersonOptions {
  /** Note body. Default: "# <name>". */
  body?: string;
  /** Extra frontmatter outside the person schema (v0.2 fields such as c1_score). Must not use schema keys. */
  extension?: FM;
  /** Where to create the note. Default "people". */
  folder?: "people" | "archive";
}

export interface UpdatePersonOptions {
  /** When `name` changes, rename the file to match and set `title` (default true). */
  renameFile?: boolean;
  /**
   * Mutate properties OUTSIDE the person schema (talk log, Carnegie scores…) in the same
   * atomic write. Touching a schema property here throws — use the patch for those.
   */
  extension?: (fm: FM) => void;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const touch = (fm: FM) => { fm.updated = new Date().toISOString(); };

// ── Repository ────────────────────────────────────────────────────────────────
export class PersonRepository {
  constructor(
    private folders: FolderService,
    private store: MarkdownStore,
    private index: PeopleIndex,
    private getSettings: () => PeopleHubSettings,
    private onChanged: () => void = () => {},
    private registry: SchemaRegistry = personSchema,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────
  /** The person at `path`, or null if there is no such file / it isn't a person note. */
  getPerson(path: string): PersonRecord | null {
    const file = this.store.getFile(path);
    if (!file) return null;
    const fm = this.store.frontmatter(file);
    if (!fm || !this.index.isPersonFile(file)) return null;
    return this.record(file, fm);
  }

  /** The person whose `id` is `id`, or null. */
  getPersonById(id: string): PersonRecord | null {
    const file = this.store.findFile((fm, f) => String(fm.id ?? "") === id && this.index.isPersonFile(f));
    return file ? this.getPerson(file.path) : null;
  }

  // ── Create ───────────────────────────────────────────────────────────────
  async createPerson(data: NewPersonData, opts: CreatePersonOptions = {}): Promise<PersonRecord> {
    const name = str(data.name);
    const issues = name ? this.validatePatch({ ...data, name }) : ['"name" is required'];
    if (opts.extension) issues.push(...this.extensionClashes(opts.extension));
    if (issues.length) throw new RepositoryError("validation", "Invalid person data", issues);

    const folderKey = opts.folder ?? "people";
    const now = new Date();
    const iso = now.toISOString();
    const base = this.store.uniqueBaseName(folderKey, this.store.sanitizeName(name));
    const supplied = { ...data, name } as FM;

    const fm: FM = {
      id: generateId(PERSON_ID_PREFIX, id => this.store.findFile(f => String(f.id ?? "") === id) !== null),
      id_prefix: PERSON_ID_PREFIX,
      schema_version: PERSON_SCHEMA_VERSION,
      created: iso,
      created_date: toISO(now),
      updated: iso,
      // Written as configured so the index (which matches on settings.personType) finds it.
      type: this.getSettings().personType || PERSON_NOTE_TYPE,
      title: base,
      display_name: str(supplied.display_name) || name,
      name,
    };
    for (const def of this.registry.all()) {
      if (!def.editable || def.key in fm) continue;
      const v = supplied[def.key] ?? def.default;
      if (v !== undefined) fm[def.key] = clone(v);
    }
    if (opts.extension) Object.assign(fm, clone(opts.extension));

    const file = await this.store.create(folderKey, base, opts.body ?? `# ${name}\n`, fm);
    this.touched(file);
    return this.record(file, fm);
  }

  // ── Update ───────────────────────────────────────────────────────────────
  async updatePerson(path: string, patch: PersonPatchInput, opts: UpdatePersonOptions = {}): Promise<PersonRecord> {
    const file = this.requirePerson(path);
    return this.store.exclusive(file.path, async () => {
      const staticPatch = typeof patch === "function" ? null : patch;
      if (staticPatch) this.assertValid(staticPatch);

      // Plan a rename (and check it can succeed) BEFORE writing anything.
      const currentName = this.record(file, this.store.frontmatter(file) ?? {}).person.name;
      const newName = staticPatch && typeof staticPatch.name === "string" ? staticPatch.name.trim() : undefined;
      const nameChanged = newName !== undefined && newName !== currentName;
      let renameTo: string | null = null;
      let newBase: string | undefined;
      if (nameChanged && opts.renameFile !== false) {
        newBase = this.store.sanitizeName(newName as string);
        if (newBase !== file.basename) {
          const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
          const target = this.store.pathIn(dir, newBase);
          if (this.store.exists(target) && this.store.getFile(target) !== file) {
            throw new RepositoryError("conflict", `Cannot rename: "${target}" already exists`);
          }
          renameTo = target;
        }
      }

      const result = await this.store.update(file, fm => {
        const effective = staticPatch ?? this.resolveFunctionalPatch(patch as (c: Person) => PersonPatch, file, fm);
        this.applyPatch(fm, effective, nameChanged ? newName : undefined, newBase);
        if (opts.extension) this.runExtension(fm, opts.extension);
      }, { onChange: touch });

      const oldPath = file.path;
      if (renameTo) await this.store.rename(file, renameTo);
      if (result.changed || renameTo) this.touched(file, renameTo ? oldPath : undefined);
      return this.record(file, result.after);
    });
  }

  /** Change a person's name: updates `name`, `display_name` (if it followed the name) and `title`, and renames the file. */
  renamePerson(path: string, newName: string): Promise<PersonRecord> {
    return this.updatePerson(path, { name: newName }, { renameFile: true });
  }

  // ── Archive / restore / delete ───────────────────────────────────────────
  /** status → "archived" and move into the archive folder. Idempotent. */
  async archivePerson(path: string): Promise<PersonRecord> {
    const file = this.requirePerson(path);
    return this.store.exclusive(file.path, async () => {
      const result = await this.store.update(file, fm => { fm.status = "archived"; }, { onChange: touch });
      const oldPath = file.path;
      let moved = false;
      if (!this.folders.contains("archive", file.path)) { await this.store.move(file, "archive"); moved = true; }
      if (result.changed || moved) this.touched(file, moved ? oldPath : undefined);
      return this.record(file, result.after);
    });
  }

  /** Move back to the people folder; status "archived" → "active" (other statuses are left alone). */
  async restorePerson(path: string): Promise<PersonRecord> {
    const file = this.requirePerson(path);
    return this.store.exclusive(file.path, async () => {
      const result = await this.store.update(file, fm => {
        if (str(fm.status).toLowerCase() === "archived") fm.status = "active";
      }, { onChange: touch });
      const oldPath = file.path;
      let moved = false;
      if (this.folders.contains("archive", file.path)) { await this.store.move(file, "people"); moved = true; }
      if (result.changed || moved) this.touched(file, moved ? oldPath : undefined);
      return this.record(file, result.after);
    });
  }

  /** Send the note to Obsidian's trash (recoverable; honours the user's trash setting). */
  async deletePerson(path: string): Promise<void> {
    const file = this.requirePerson(path);
    await this.store.exclusive(file.path, async () => {
      const oldPath = file.path;
      await this.store.trash(file);
      this.index.removePath(oldPath);
      this.onChanged();
    });
  }

  // ── Body ─────────────────────────────────────────────────────────────────
  /** Append a line under `heading` in the note body (e.g. the Talks Log). */
  async appendToSection(path: string, heading: string, line: string): Promise<void> {
    const file = this.requirePerson(path);
    await this.store.exclusive(file.path, () => this.store.appendToSection(file, heading, line));
  }

  // ── Internals ────────────────────────────────────────────────────────────
  /**
   * A note was created / changed / moved: re-parse just that note in the index. The store has
   * already waited for Obsidian's cache, so this sees the new state. If the cache lags (e.g. right
   * after a rename), the index self-heals from Obsidian's own events.
   */
  private touched(file: TFile, oldPath?: string) {
    if (oldPath && oldPath !== file.path) this.index.removePath(oldPath);
    this.index.refreshFile(file);
    this.onChanged();
  }

  private requirePerson(path: string): TFile {
    const file = this.store.getFile(path);
    if (!file) throw new RepositoryError("not_found", `No note at "${path}"`);
    if (!this.index.isPersonFile(file)) throw new RepositoryError("not_a_note", `"${path}" is not a person note`);
    return file;
  }

  /** Issues with a patch; empty array = valid. */
  private validatePatch(patch: object): string[] {
    const issues: string[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const def = this.registry.get(key);
      if (!def) { issues.push(`unknown property "${key}"`); continue; }
      if (!def.editable) { issues.push(`"${key}" is managed by the plugin and cannot be set`); continue; }
      if (value === undefined) {
        if (def.required) issues.push(`"${key}" is required and cannot be removed`);
        continue;
      }
      const err = validateValue(def, value);
      if (err) issues.push(err);
    }
    return issues;
  }

  private assertValid(patch: object) {
    const issues = this.validatePatch(patch);
    if (issues.length) throw new RepositoryError("validation", "Invalid person update", issues);
  }

  private resolveFunctionalPatch(fn: (c: Person) => PersonPatch, file: TFile, fm: FM): PersonPatch {
    const patch = fn(this.record(file, fm).person);
    this.assertValid(patch);
    if ("name" in patch) throw new RepositoryError("validation", "Invalid person update", ['"name" cannot be changed by a function patch; use renamePerson']);
    return patch;
  }

  /** Apply a validated patch to the live frontmatter object. */
  private applyPatch(fm: FM, patch: PersonPatch, newName?: string, titleTo?: string) {
    const prevName = str(fm.name) || str(fm.full_name);
    const prevDisplay = str(fm.display_name);
    const p = patch as FM;

    for (const def of this.registry.all()) {          // registry order → stable key order for new keys
      if (!(def.key in p)) continue;
      for (const legacy of def.legacyKeys ?? []) delete fm[legacy];   // canonical key replaces its v0.2 alias
      const v = p[def.key];
      if (v === undefined) delete fm[def.key];
      else fm[def.key] = clone(v);
    }
    // display_name follows the name unless the user customised it
    if (newName !== undefined && !("display_name" in p) && (!prevDisplay || prevDisplay === prevName)) {
      fm.display_name = newName;
    }
    if (titleTo !== undefined) fm.title = titleTo;
  }

  private protectedKeys(): Set<string> {
    return new Set([...this.registry.keys(), ...this.registry.legacyMap().keys()]);
  }

  private extensionClashes(ext: FM): string[] {
    const protectedKeys = this.protectedKeys();
    return Object.keys(ext)
      .filter(k => protectedKeys.has(k))
      .map(k => `extension may not set schema property "${k}"`);
  }

  private runExtension(fm: FM, fn: (fm: FM) => void) {
    const keys = this.protectedKeys();
    const snap = () => Object.fromEntries(Object.entries(fm).filter(([k]) => keys.has(k)));
    const before = JSON.stringify(snap());
    fn(fm);
    if (JSON.stringify(snap()) !== before) {
      throw new RepositoryError("validation", "extension callback modified schema properties; use the patch instead");
    }
  }

  // ── Canonical view of a note ─────────────────────────────────────────────
  private record(file: TFile, fm: FM): PersonRecord {
    return {
      file,
      path: file.path,
      person: this.normalize(file, fm),
      needsMigration: (Number(fm.schema_version) || 0) < PERSON_SCHEMA_VERSION,
    };
  }

  private normalize(file: TFile, fm: FM): Person {
    return normalizePerson(fm, { basename: file.basename, ctime: file.stat.ctime, mtime: file.stat.mtime }, this.registry);
  }
}
