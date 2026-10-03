// ─── PeopleIndex ──────────────────────────────────────────────────────────────
// READ side. An in-memory CACHE of the person notes in the vault — never a source
// of truth: it is derived only from Obsidian's metadata cache (frontmatter), is never
// persisted, never written to, and can be thrown away and rebuilt at any time.
// All writes go through PersonRepository → MarkdownStore.
//
// Per person it keeps
//   • an IndexEntry  — the lean canonical record (models/IndexEntry.ts), and
//   • a PersonView   — the richer v0.2 projection the existing views use
// both parsed from the same frontmatter in one pass.
//
// Lifecycle
//   scan          all markdown files → recognise (core/recognition.ts) → parse → index
//   incremental   bind() listens to Obsidian and re-parses ONLY the affected note:
//                   metadataCache "changed"  file created / modified (frontmatter parsed)
//                   vault "rename"           file moved/renamed (folder move → rescan)
//                   vault / cache "delete"   file removed
//   notify        changes are batched; listeners get one PeopleIndexChange per batch,
//                 and only when something a view could show actually changed
//                 (editing a note's body does not re-render anything).
//
// Time-dependent fields (dueIn, birthday countdowns) are recomputed by a rescan when
// the calendar day changes.

import { App, EventRef, TFile, TFolder } from "obsidian";
import { addDays, diffDays, nextBirthday, occurrence, parseBirthdate, parseDate, today, toISO } from "../core/dates";
import { parseSocials } from "../core/socials";
import type { FolderService } from "../core/folder-service";
import { matchesText } from "../core/directory";
import { isPersonNote, RecognitionConfig } from "../core/recognition";
import type { PeopleHubSettings } from "../core/settings";
import { IndexEntry, toIndexEntry } from "../models/IndexEntry";
import { normalizePerson } from "../models/PersonNormalizer";
import type { SchemaRegistry } from "../models/SchemaRegistry";
import { personSchema } from "../models/SchemaRegistry";
import {
  AnniversaryInfo, CARNEGIE_LABELS, CarnegieScores,
  PersonView, Tier, TIERS, TalkLog
} from "../models/person-view";

type FM = Record<string, unknown>;
type TAbstractFileLike = TFile | TFolder | { path: string };

// ── FM helpers ────────────────────────────────────────────────────────────────
function pick(fm: FM, keys: string[]): unknown {
  for (const k of keys) {
    const v = fm[k];
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    return v;
  }
  return undefined;
}
function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return (v as unknown[]).map(str).filter(Boolean).join(", ");
  if (typeof v === "object") return "";
  const s = String(v).trim();
  return s.includes("{{") || s.includes("<%") || s === "null" ? "" : s;
}
function num(v: unknown, def = 0): number {
  const n = Number(v); return isNaN(n) ? def : n;
}

// ── Type → tier derivation ────────────────────────────────────────────────────
const TYPE_TIER: Record<string, Tier> = {
  family: "inner", girlfriend: "inner", partner: "inner", spouse: "inner",
  boyfriend: "inner", husband: "inner", wife: "inner",
  "close-friend": "close", friend: "close", mentor: "close",
  prospect: "close", client: "close", coworker: "close", "co-worker": "close",
  colleague: "close", manager: "close", boss: "close",
  "school-mate": "extended", "high-school-mate": "extended", acquaintance: "extended",
  random: "professional", author: "professional", politician: "professional",
  "podcast-host": "professional", "youtube-creator": "professional",
  "tv-host": "professional", "book-author": "professional", celebrity: "professional",
};
function typeToTier(typePerson: string): Tier {
  const first = typePerson.split(/[+,/]/)[0].trim().toLowerCase().replace(/\s+/g, "-");
  return TYPE_TIER[first] ?? "extended";
}

// ── Carnegie ──────────────────────────────────────────────────────────────────
function carnegieScores(fm: FM): CarnegieScores {
  const scores = [1,2,3,4,5,6,7,8,9].map(i => Math.min(5, Math.max(0, num(fm[`c${i}_score`]))));
  const avg = scores.reduce((a, b) => a + b, 0) / 9;
  let minIdx = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] < scores[minIdx]) minIdx = i;
  const wKey = `c${minIdx + 1}`;
  return {
    c1: scores[0], c2: scores[1], c3: scores[2], c4: scores[3], c5: scores[4],
    c6: scores[5], c7: scores[6], c8: scores[7], c9: scores[8],
    avg: Math.round(avg * 10) / 10,
    weakest: wKey,
    weakestLabel: CARNEGIE_LABELS[wKey],
  };
}

// ── Talk log ──────────────────────────────────────────────────────────────────
function parseTalks(fm: FM): TalkLog[] {
  const out: TalkLog[] = [];
  for (let i = 1; i <= 5; i++) {
    const d = parseDate(fm[`talk${i}_date`]);
    const note = str(fm[`talk${i}_note`]);
    if (!d && !note) continue;
    out.push({
      date: d, where: str(fm[`talk${i}_where`]),
      note, learned: str(fm[`talk${i}_learned`]),
      next: str(fm[`talk${i}_next`]),
      presence: num(fm[`talk${i}_presence`]),
      energy: num(fm[`talk${i}_energy`]),
    });
  }
  return out;
}

// ── Anniversary ───────────────────────────────────────────────────────────────
function parseAnniversary(raw: unknown, t: Date): AnniversaryInfo | null {
  if (!raw) return null;
  const bd = parseBirthdate(raw);
  if (!bd) return null;
  const info = nextBirthday(bd, t);
  const years = bd.year ? info.date.getFullYear() - bd.year : null;
  // infer label from frontmatter key name — caller can pass a label separately
  return { date: info.date, years, days: info.days, label: "anniversary" };
}

const INACTIVE = new Set(["archived", "inactive", "lost", "deceased", "done"]);

// ─── PeopleIndex ──────────────────────────────────────────────────────────────
export interface PeopleIndexChange {
  /** Paths added, updated, moved or removed in this batch. */
  paths: string[];
  /** True when the whole index was rebuilt (paths may then be empty). */
  full: boolean;
}
export type PeopleIndexListener = (change: PeopleIndexChange) => void;

interface Slot { entry: IndexEntry; view: PersonView; fp: string; }

/** Fingerprint of everything derived from a note, so no-op re-parses are detected. */
const fingerprint = (entry: IndexEntry, view: PersonView) =>
  JSON.stringify([entry, view], (k, v) => (k === "file" ? undefined : v));

export class PeopleIndex {
  private slots = new Map<string, Slot>();
  private byId = new Map<string, string[]>();
  private sorted: Slot[] | null = null;
  private viewList: PersonView[] | null = null;

  private dirty = true;          // true → next read rescans
  private day = "";              // calendar day the derived fields were computed for

  private listeners = new Set<PeopleIndexListener>();
  private pending = new Set<string>();
  private pendingFull = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Diagnostics: how much work the index has done. */
  readonly stats = { scans: 0, parses: 0 };

  constructor(
    private app: App,
    private folders: FolderService,
    private getSettings: () => PeopleHubSettings,
    private notifyDelayMs = 100,
    private registry: SchemaRegistry = personSchema,
  ) {}

  log(msg: string) { if (this.getSettings().debugMode) console.debug(`[People Hub] ${msg}`); }

  // ── Subscriptions ────────────────────────────────────────────────────────
  /** Be told (batched) when the index changes. Returns an unsubscribe function. */
  onChange(fn: PeopleIndexListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Deliver any pending notification immediately. */
  flush() {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending.size && !this.pendingFull) return;
    const change: PeopleIndexChange = { paths: [...this.pending], full: this.pendingFull };
    this.pending.clear();
    this.pendingFull = false;
    for (const l of [...this.listeners]) {
      try { l(change); } catch (e) { console.error("[People Hub] index listener failed", e); }
    }
  }

  private queue(path?: string, full = false) {
    if (path) this.pending.add(path);
    if (full) this.pendingFull = true;
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), this.notifyDelayMs);
  }

  // ── Obsidian events ──────────────────────────────────────────────────────
  /**
   * Subscribe to vault events. Pass the plugin's registerEvent so they are removed on unload.
   * "created" and "modified" are both served by metadataCache "changed", which fires once the
   * file's frontmatter has been parsed (vault "create"/"modify" fire before that).
   */
  bind(register: (ref: EventRef) => void) {
    const { vault, metadataCache } = this.app;
    register(metadataCache.on("changed", f => this.refreshFile(f)));
    register(metadataCache.on("deleted", f => this.removePath(f.path)));
    register(vault.on("rename", (f, oldPath) => this.onRename(f, oldPath ?? "")));
    register(vault.on("delete", f => this.onDelete(f)));
  }

  private onRename(file: TAbstractFileLike, oldPath: string) {
    if (file instanceof TFile) {
      if (oldPath) this.removePath(oldPath);
      this.refreshFile(file);
    } else if (file instanceof TFolder) {
      this.rebuild();          // every child path changed
    }
  }

  private onDelete(file: TAbstractFileLike) {
    if (file instanceof TFile) this.removePath(file.path);
    else if (file instanceof TFolder) this.removeUnder(file.path);
  }

  // ── Incremental updates (also called directly by PersonRepository after a write) ──
  /** Re-parse ONE note from the metadata cache and update the index. */
  refreshFile(file: TFile) {
    if (file.extension !== "md") return;
    if (!this.ready()) { this.queue(file.path); return; }   // the pending rescan will pick it up
    if (this.upsert(file, today())) this.queue(file.path);
  }

  /** Drop one note from the index. */
  removePath(path: string) {
    if (!this.ready()) { this.queue(path); return; }
    if (this.drop(path)) this.queue(path);
  }

  private removeUnder(folderPath: string) {
    if (!this.ready()) { this.queue(undefined, true); return; }
    for (const path of [...this.slots.keys()]) {
      if (path.startsWith(folderPath + "/") && this.drop(path)) this.queue(path);
    }
  }

  // ── Whole-index operations ───────────────────────────────────────────────
  /** Mark everything stale; the next read rescans (silent). */
  invalidate() { this.dirty = true; this.sorted = null; this.viewList = null; }

  /** Rescan now and tell listeners. Used at startup, after settings changes, on the refresh command. */
  rebuild() {
    this.scan();
    this.queue(undefined, true);
  }

  /** If the calendar day changed since the last scan, rescan and tell listeners. Returns whether it did. */
  rolloverIfNeeded(): boolean {
    if (this.day && this.day === toISO(today()) && !this.dirty) return false;
    this.rebuild();
    return true;
  }

  private ready(): boolean { return !this.dirty && this.day === toISO(today()); }

  private ensure() {
    if (!this.ready()) this.scan();
  }

  private scan() {
    this.stats.scans++;
    const t = today();
    this.slots.clear();
    this.byId.clear();
    this.sorted = null;
    this.viewList = null;
    for (const file of this.app.vault.getMarkdownFiles()) this.upsert(file, t);
    this.dirty = false;
    this.day = toISO(t);
    this.log(`Index scanned: ${this.slots.size} people`);
  }

  // ── Recognition ──────────────────────────────────────────────────────────
  private recognitionConfig(): RecognitionConfig {
    const s = this.getSettings();
    return {
      personType: s.personType,
      excludeFolders: s.excludeFolders,
      peopleFolder: this.folders.resolve("people"),
      detectByFolder: s.detectByFolder,
    };
  }

  isPersonFile(file: TFile): boolean {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as FM | undefined;
    return isPersonNote(file.path, fm, this.recognitionConfig());
  }

  // ── Slot maintenance ─────────────────────────────────────────────────────
  /** Parse one file into the index (or drop it if it is not a person). Returns true if the index changed. */
  private upsert(file: TFile, t: Date): boolean {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as FM | undefined;
    if (!isPersonNote(file.path, fm, this.recognitionConfig())) return this.drop(file.path);

    this.stats.parses++;
    const view = this.parse(file, fm as FM, t);
    const person = normalizePerson(fm as FM, { basename: file.basename, ctime: file.stat.ctime, mtime: file.stat.mtime }, this.registry);
    const entry = toIndexEntry(file.path, person);
    const fp = fingerprint(entry, view);

    const prev = this.slots.get(file.path);
    if (prev && prev.fp === fp) return false;
    if (prev) this.unlink(prev.entry);
    const slot: Slot = { entry, view, fp };
    this.slots.set(file.path, slot);
    this.link(entry);
    this.sorted = null;
    this.viewList = null;
    return true;
  }

  private drop(path: string): boolean {
    const prev = this.slots.get(path);
    if (!prev) return false;
    this.slots.delete(path);
    this.unlink(prev.entry);
    this.sorted = null;
    this.viewList = null;
    return true;
  }

  private link(e: IndexEntry) {
    if (!e.id) return;
    const list = this.byId.get(e.id) ?? [];
    list.push(e.path);
    this.byId.set(e.id, list);
  }

  private unlink(e: IndexEntry) {
    if (!e.id) return;
    const list = (this.byId.get(e.id) ?? []).filter(p => p !== e.path);
    if (list.length) this.byId.set(e.id, list); else this.byId.delete(e.id);
  }

  private sortedSlots(): Slot[] {
    this.ensure();
    if (!this.sorted) {
      this.sorted = [...this.slots.values()].sort((a, b) =>
        a.view.name.localeCompare(b.view.name) || a.entry.path.localeCompare(b.entry.path));
    }
    return this.sorted;
  }

  // ── Reads ────────────────────────────────────────────────────────────────
  /** Number of people in the index. */
  get size(): number { this.ensure(); return this.slots.size; }

  /** Every person as a PersonView (v0.2 projection), sorted by name. */
  all(): PersonView[] {
    const slots = this.sortedSlots();
    return (this.viewList ??= slots.map(s => s.view));
  }

  /** Every person as a lean IndexEntry, sorted by name. */
  entries(): IndexEntry[] { return this.sortedSlots().map(s => s.entry); }

  entry(path: string): IndexEntry | undefined { this.ensure(); return this.slots.get(path)?.entry; }
  view(path: string): PersonView | undefined { this.ensure(); return this.slots.get(path)?.view; }

  /** Look up by `id`. If several notes share an id, the first is returned (see duplicateIds). */
  entryById(id: string): IndexEntry | undefined {
    this.ensure();
    const path = this.byId.get(id)?.[0];
    return path ? this.slots.get(path)?.entry : undefined;
  }

  /** Ids used by more than one note — a data problem worth surfacing. */
  duplicateIds(): string[] {
    this.ensure();
    return [...this.byId.entries()].filter(([, paths]) => paths.length > 1).map(([id]) => id);
  }

  /** Case-insensitive substring search over name, display name, company, role, relationship type and tags. */
  search(query: string): IndexEntry[] {
    return this.entries().filter(e => matchesText(e, query));
  }

  private parse(file: TFile, fm: FM, t: Date): PersonView {
    const s = this.getSettings();
    const name = str(pick(fm, ["name", "display_name", "full_name", "title"])) || file.basename;
    const typePerson = str(pick(fm, ["type_person", "type_person_primary", "relationship_type", "category"]));
    const status = str(fm.status).toLowerCase() || "active";
    const paused = status === "paused" || status === "archived";
    const active = !INACTIVE.has(status);

    let tier = str(pick(fm, ["prm-tier", "prm_tier", "circle", "tier"])).toLowerCase() as Tier;
    if (!TIERS.includes(tier)) tier = typePerson ? typeToTier(typePerson) : "extended";

    const lastContact = parseDate(pick(fm, ["last_contact", "last_contacted"]));
    const nextContact = parseDate(pick(fm, ["next_contact", "next_encounter", "next_action_date"]));
    const cadence = s.tierDays[tier];
    const dueDate = nextContact ?? (lastContact ? addDays(lastContact, cadence) : t);
    const dueIn = diffDays(t, dueDate);

    const bd = parseBirthdate(pick(fm, ["birthday", "birthdate", "birth_date", "dob"]));
    const phone = str(fm.phone);
    const made = num(fm.promises_made);
    const kept = num(fm.promises_kept);

    // Anniversary — supports multiple keys: anniversary, friendiversary, wed_date …
    const anniversaryRaw = str(pick(fm, ["anniversary", "friendiversary", "wed_date", "anniversary_date"]));
    const anniversary = parseAnniversary(anniversaryRaw || null, t);
    if (anniversary) {
      // try to improve the label
      const lbl = str(pick(fm, ["anniversary_label", "anniversary_type"]));
      if (lbl) anniversary.label = lbl;
      else if (fm.anniversary) anniversary.label = "anniversary";
      else if (fm.friendiversary) anniversary.label = "friendiversary";
      else if (fm.wed_date) anniversary.label = "wedding anniversary";
    }

    return {
      file, name,
      fullName:   str(fm.full_name),
      typePerson, alsoIs: str(fm.also_is),
      tier, active, paused, status,
      company:  str(pick(fm, ["company", "biz"])),
      role:     str(pick(fm, ["role", "job_title"])),
      phone,    email: str(fm.email),
      socials:  parseSocials(fm, phone),
      location: str(fm.location),
      birthdate: bd,
      birthday:  bd ? nextBirthday(bd, t) : null,
      anniversaryRaw,
      anniversary,
      lastContact,
      nextContact: nextContact ?? (lastContact ? addDays(lastContact, cadence) : null),
      frequency:    str(pick(fm, ["frequency", "cadence"])),
      sinceContact: lastContact ? diffDays(lastContact, t) : null,
      dueIn,
      needsReachOut: active && !paused && dueIn <= 0,
      healthScore: num(fm.health_score),
      trustScore:  num(fm.trust_score),
      carnegie: carnegieScores(fm),
      promisesMade: made, promisesKept: kept,
      promiseRatio: made > 0 ? Math.round((kept / made) * 100) : null,
      wants:     str(fm.wants),
      fears:     str(fm.fears),
      interests: str(fm.interests),
      theirStory: str(pick(fm, ["their_story", "story"])),
      skillCode:  str(fm.skill_code),
      talks:      parseTalks(fm),
      nextAction: str(pick(fm, ["next_action", "next_encounter_purpose"])),
      photo:      str(fm.photo),
    };
  }

  // ─── Queries ──────────────────────────────────────────────────────────────
  upcomingBirthdays(days: number): PersonView[] {
    return this.all()
      .filter(p => p.birthday && !INACTIVE.has(p.status) && p.birthday.days <= days)
      .sort((a, b) => a.birthday!.days - b.birthday!.days);
  }

  birthdaysInMonth(year: number, month0: number): Map<number, PersonView[]> {
    const map = new Map<number, PersonView[]>();
    for (const p of this.all()) {
      if (!p.birthdate || INACTIVE.has(p.status) || p.birthdate.month !== month0 + 1) continue;
      map.set(p.birthdate.day, [...(map.get(p.birthdate.day) ?? []), p]);
    }
    return map;
  }

  missingBirthdays(): PersonView[] {
    return this.all().filter(p => !p.birthdate && !INACTIVE.has(p.status));
  }

  // ─── Anniversaries (v0.2) ─────────────────────────────────────────────────
  upcomingAnniversaries(days: number): PersonView[] {
    return this.all()
      .filter(p => p.anniversary && !INACTIVE.has(p.status) && p.anniversary.days <= days)
      .sort((a, b) => a.anniversary!.days - b.anniversary!.days);
  }

  anniversariesInMonth(year: number, month0: number): Map<number, PersonView[]> {
    const map = new Map<number, PersonView[]>();
    for (const p of this.all()) {
      if (!p.anniversary || INACTIVE.has(p.status)) continue;
      const occ = occurrence({ month: p.anniversary.date.getMonth() + 1, day: p.anniversary.date.getDate(), year: null }, year);
      if (occ.getMonth() !== month0) continue;
      const day = occ.getDate();
      map.set(day, [...(map.get(day) ?? []), p]);
    }
    return map;
  }

  missingAnniversaries(): PersonView[] {
    // only people whose type_person implies a relational anniversary
    const relevant = new Set(["girlfriend", "boyfriend", "partner", "spouse", "husband", "wife",
      "close-friend", "friend", "family"]);
    return this.all().filter(p => {
      if (INACTIVE.has(p.status)) return false;
      if (p.anniversary) return false;
      const t = p.typePerson.toLowerCase().replace(/\s+/g, "-");
      return relevant.has(t);
    });
  }

  reachOut(): PersonView[] {
    const rank: Record<Tier, number> = { inner: 0, close: 1, extended: 2, professional: 3 };
    return this.all()
      .filter(p => p.needsReachOut)
      .sort((a, b) => a.dueIn - b.dueIn || rank[a.tier] - rank[b.tier]);
  }

  carnegieAlert(threshold = 3): PersonView[] {
    return this.all()
      .filter(p => p.active && !p.paused && p.carnegie.avg > 0 && p.carnegie.avg < threshold)
      .sort((a, b) => a.carnegie.avg - b.carnegie.avg);
  }

  promiseAlert(threshold = 70): PersonView[] {
    return this.all()
      .filter(p => p.active && p.promiseRatio !== null && p.promiseRatio < threshold)
      .sort((a, b) => (a.promiseRatio ?? 0) - (b.promiseRatio ?? 0));
  }
}
