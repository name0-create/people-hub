// ─── PeopleIndex ──────────────────────────────────────────────────────────────
// READ side. An in-memory CACHE of person notes. The Markdown notes stay the only
// source of truth: every record is derived from a note's frontmatter and can be
// thrown away and rebuilt at any time. Never writes — all writes go through
// PersonRepository → MarkdownStore.
//
// Each person is cached twice, under their note path:
//   • entry — the flat PeopleIndexEntry (path, id, name, … tags) for fast lists/filters
//   • view  — the richer PersonView (due dates, Carnegie, talks…) the existing tabs use
//
// Lifecycle
//   • Initial scan   rebuild() / lazily on first read: every markdown file → recognise → parse.
//   • Incremental    upsert / rename / remove touch ONE person; watch() wires them to Obsidian
//                    events. Nothing re-scans the vault for a single edited note.
//   • Full rebuild   invalidate() (settings changed, "Refresh index"), a folder move/rename, or
//                    the calendar day changing (due dates and birthday countdowns are relative to today).
//   • Notifications  onChange() tells views what changed so they refresh only what is affected.
// Uses FolderService for every path decision.

import { App, TFile, type EventRef, type TAbstractFile } from "obsidian";
import { addDays, diffDays, nextBirthday, occurrence, parseBirthdate, parseDate, today, toISO } from "../core/dates";
import { parseSocials } from "../core/socials";
import type { FolderService } from "../core/folder-service";
import type { PeopleHubSettings } from "../core/settings";
import type { IndexChange, PeopleIndexEntry } from "../models/PeopleIndexEntry";
import {
  AnniversaryInfo, CARNEGIE_LABELS, CarnegieScores,
  PersonView, Tier, TIERS, TalkLog
} from "../models/person-view";

type FM = Record<string, unknown>;

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

// ── Entry helpers ─────────────────────────────────────────────────────────────
/** [[Target]] / [[Target|Alias]] → display text; anything else unchanged. */
function stripLink(s: string): string {
  const m = s.match(/^!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  return m ? (m[2] ?? m[1]).trim() : s;
}
/** Array → its items; scalar → one item. De-duplicated, empties and template placeholders dropped. */
function asList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const out: string[] = [];
  for (const x of raw) { const t = str(x); if (t && !out.includes(t)) out.push(t); }
  return out;
}
/** `tags` may be a YAML list or a "a, b c" string; a leading # is dropped. */
function tagList(v: unknown): string[] {
  const raw = typeof v === "string" ? v.split(/[,\s]+/) : Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const x of raw) { const t = str(x).replace(/^#/, ""); if (t && !out.includes(t)) out.push(t); }
  return out;
}
const truthy = (v: unknown) => v === true || /^(true|yes|y|1)$/i.test(str(v));
const isoOrNull = (d: Date | null) => (d ? toISO(d) : null);
/** Stable fingerprint of a note's frontmatter: lets upsert() skip notes whose properties didn't change. */
const signature = (fm: FM) => JSON.stringify(fm, (k, v) => (k === "position" ? undefined : v));
const byName = (a: PersonView, b: PersonView) => a.name.localeCompare(b.name);
const byEntryName = (a: PeopleIndexEntry, b: PeopleIndexEntry) => a.name.localeCompare(b.name);

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

// ─── Index ────────────────────────────────────────────────────────────────────
interface IndexRecord { entry: PeopleIndexEntry; view: PersonView; sig: string; }

export class PeopleIndex {
  /** path → record. null = not built yet / invalidated (rebuilt lazily on the next read). */
  private records: Map<string, IndexRecord> | null = null;
  private builtOn = "";                                   // ISO day the records were computed for
  private viewList: PersonView[] | null = null;           // sorted snapshots, dropped on any change
  private entryList: PeopleIndexEntry[] | null = null;
  private listeners = new Set<(change: IndexChange) => void>();

  constructor(
    private app: App,
    private folders: FolderService,
    private getSettings: () => PeopleHubSettings,
  ) {}

  log(msg: string) { if (this.getSettings().debugMode) console.debug(`[People Hub] ${msg}`); }

  // ─── Lifecycle ────────────────────────────────────────────────────────────
  /** Drop everything; the next read rescans. Use when settings change or the cache can't be trusted. */
  invalidate() { this.records = null; this.touch(); }

  /** Initial scan (also usable as a forced full rescan): rebuilds now and notifies listeners. */
  rebuild() { this.scan(); this.emit({ kind: "rebuild" }); }

  /** Subscribe to changes. Returns the unsubscribe function. */
  onChange(cb: (change: IndexChange) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /**
   * Keep the index current from Obsidian events. Pass `plugin.registerEvent` so the listeners
   * are removed when the plugin unloads.
   *
   *   metadata "changed"  → upsert   (a note was created, edited, or finished indexing — the
   *                                   frontmatter isn't readable at vault "create"/"modify" time,
   *                                   so this one event covers created + modified)
   *   vault "rename"      → rename   (move/rename of a note; a folder triggers a rebuild)
   *   vault "delete"      → remove   (a deleted folder removes everyone under it)
   */
  watch(register: (ref: EventRef) => void): void {
    const { vault, metadataCache } = this.app;
    register(metadataCache.on("changed", (file: TFile) => { this.upsert(file); }));
    register(vault.on("rename", (file: TAbstractFile, oldPath?: string) => {
      if (file instanceof TFile) this.rename(file, oldPath ?? file.path);
      else if (this.records) this.rebuild();
    }));
    register(vault.on("delete", (file: TAbstractFile) => {
      if (file instanceof TFile) this.remove(file.path);
      else this.removeUnder(file.path);
    }));
  }

  // ─── Reads ────────────────────────────────────────────────────────────────
  /** Every person as a PersonView, sorted by name. */
  all(): PersonView[] {
    const recs = this.ensure();
    return this.viewList ??= [...recs.values()].map(r => r.view).sort(byName);
  }

  /** Every person as a flat index entry, sorted by name. */
  entries(): PeopleIndexEntry[] {
    const recs = this.ensure();
    return this.entryList ??= [...recs.values()].map(r => r.entry).sort(byEntryName);
  }

  get size(): number { return this.ensure().size; }
  has(path: string): boolean { return this.ensure().has(path); }
  get(path: string): PersonView | null { return this.ensure().get(path)?.view ?? null; }
  getEntry(path: string): PeopleIndexEntry | null { return this.ensure().get(path)?.entry ?? null; }

  findById(id: string): PeopleIndexEntry | null {
    if (!id) return null;
    for (const r of this.ensure().values()) if (r.entry.id === id) return r.entry;
    return null;
  }

  /** Distinct company names / tags across the index (for filter dropdowns). */
  companies(): string[] { return this.distinct(e => e.company); }
  tags(): string[]      { return this.distinct(e => e.tags); }

  private distinct(pick: (e: PeopleIndexEntry) => string[]): string[] {
    const set = new Set<string>();
    for (const e of this.entries()) for (const v of pick(e)) set.add(v);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // ─── Incremental updates ──────────────────────────────────────────────────
  /** Create, refresh or drop the entry for one note. Returns true if the index changed. */
  upsert(file: TFile): boolean {
    if (!this.records) return false;                      // not built yet — the scan will see it
    if (!this.sync(file)) return false;
    this.touch();
    const now = this.records.has(file.path);
    this.emit(now ? { kind: "upsert", path: file.path } : { kind: "remove", path: file.path });
    return true;
  }

  /** A note moved or was renamed. The person is re-evaluated at the new path (folder rules may differ). */
  rename(file: TFile, oldPath: string): boolean {
    const recs = this.records;
    if (!recs) return false;
    const hadOld = oldPath !== file.path && recs.delete(oldPath);
    const changed = this.sync(file);
    if (!hadOld && !changed) return false;
    this.touch();
    if (!hadOld) this.emit({ kind: "upsert", path: file.path });
    else if (recs.has(file.path)) this.emit({ kind: "rename", path: file.path, oldPath });
    else this.emit({ kind: "remove", path: oldPath });
    return true;
  }

  /** A note was deleted (or trashed). */
  remove(path: string): boolean {
    if (!this.records?.delete(path)) return false;
    this.touch();
    this.emit({ kind: "remove", path });
    return true;
  }

  /** A folder was deleted: forget everyone who lived in it. */
  removeUnder(folderPath: string): number {
    const recs = this.records;
    if (!recs) return 0;
    const prefix = folderPath.replace(/\/$/, "") + "/";
    const gone = [...recs.keys()].filter(k => k.startsWith(prefix));
    for (const k of gone) recs.delete(k);
    if (gone.length) { this.touch(); for (const path of gone) this.emit({ kind: "remove", path }); }
    return gone.length;
  }

  // ─── Internals ────────────────────────────────────────────────────────────
  isPersonFile(file: TFile): boolean {
    return this.isPerson(file, this.fmOf(file));
  }

  private fmOf(file: TFile): FM | undefined {
    return this.app.metadataCache.getFileCache(file)?.frontmatter as FM | undefined;
  }

  /** Records for today, scanning first if there are none yet or the day has rolled over. */
  private ensure(): Map<string, IndexRecord> {
    if (!this.records || this.builtOn !== toISO(today())) return this.scan();
    return this.records;
  }

  private touch() { this.viewList = null; this.entryList = null; }

  private emit(change: IndexChange) {
    for (const cb of [...this.listeners]) {
      try { cb(change); } catch (e) { console.error("[People Hub] index listener failed", e); }
    }
  }

  /** Full scan: every markdown file → recognise → parse. */
  private scan(): Map<string, IndexRecord> {
    const started = Date.now();
    const t = today();
    const files = this.app.vault.getMarkdownFiles();
    const recs = new Map<string, IndexRecord>();
    for (const file of files) {
      const fm = this.fmOf(file);
      if (this.isPerson(file, fm)) recs.set(file.path, this.makeRecord(file, fm as FM, t));
    }
    this.records = recs;
    this.builtOn = toISO(t);
    this.touch();
    this.log(`Index scan: ${recs.size} people in ${files.length} notes (${Date.now() - started} ms)`);
    return recs;
  }

  /** Bring one path in line with its note. True if the record map changed. */
  private sync(file: TFile): boolean {
    const recs = this.records as Map<string, IndexRecord>;
    const fm = this.fmOf(file);
    const prev = recs.get(file.path);
    if (!this.isPerson(file, fm)) return prev ? recs.delete(file.path) : false;
    const sig = signature(fm as FM);
    if (prev && prev.sig === sig) return false;           // frontmatter unchanged (e.g. body-only edit)
    recs.set(file.path, this.makeRecord(file, fm as FM, today()));
    this.log(`Index ${prev ? "updated" : "added"}: ${file.path}`);
    return true;
  }

  /**
   * Recognition, in order:
   *   1. not in an excluded folder, and the note has frontmatter
   *   2. `type: <personType>`                       → person
   *   3. `tags` contains `type/<personType>`        → person   (type/person by default)
   *   4. some other `type:` value                   → not a person
   *   5. no `type` at all → person iff it lives in the people folder (folder-based detection)
   */
  private isPerson(file: TFile, fm: FM | undefined): boolean {
    const s = this.getSettings();
    if (!fm) return false;
    const excluded = s.excludeFolders.split(",").map(x => x.trim()).filter(Boolean);
    if (excluded.some(f => file.path.startsWith(f + "/"))) return false;
    const want = s.personType.toLowerCase();
    const type = str(fm.type).toLowerCase();
    if (type && type === want) return true;
    const tag = `type/${want}`;
    if (tagList(fm.tags ?? fm.tag).some(t => { const l = t.toLowerCase(); return l === tag || l.startsWith(tag + "/"); })) return true;
    if (type) return false;
    const folder = this.folders.resolve("people");
    return !!folder && file.path.startsWith(folder + "/");
  }

  private makeRecord(file: TFile, fm: FM, t: Date): IndexRecord {
    const view = this.parse(file, fm, t);
    return { view, entry: this.toEntry(file, fm, view), sig: signature(fm) };
  }

  private toEntry(file: TFile, fm: FM, v: PersonView): PeopleIndexEntry {
    const bd = v.birthdate;
    const pad = (n: number) => String(n).padStart(2, "0");
    const rel = pick(fm, ["type_person", "type_person_primary", "relationship_type", "category"]);
    return {
      path: file.path,
      id: str(fm.id),
      name: v.name,
      display_name: str(fm.display_name) || v.name,
      photo: v.photo,
      favorite: truthy(fm.favorite),
      relationship_type: Array.isArray(rel) ? asList(rel) : str(rel).split(/\s*[+,/]\s*/).filter(Boolean),
      company: asList(pick(fm, ["company", "biz"])).map(stripLink),
      role: v.role,
      status: v.status,
      birthday: bd ? `${bd.year ? String(bd.year).padStart(4, "0") : "-"}-${pad(bd.month)}-${pad(bd.day)}` : null,
      last_contacted: isoOrNull(v.lastContact),
      next_encounter: isoOrNull(parseDate(pick(fm, ["next_encounter", "next_contact"]))),
      cadence: v.frequency,
      importance: str(fm.importance),
      tags: tagList(fm.tags ?? fm.tag),
    };
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
