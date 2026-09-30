// ─── PersonRepository ─────────────────────────────────────────────────────────
// Owns the in-memory index and all query methods.
// Uses FolderService for every path decision.

import { App, TFile } from "obsidian";
import { addDays, diffDays, nextBirthday, occurrence, parseBirthdate, parseDate, today } from "../core/dates";
import { parseSocials } from "../core/socials";
import type { FolderService } from "../core/folder-service";
import type { PeopleHubSettings } from "../core/settings";
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

// ─── Repository ───────────────────────────────────────────────────────────────
export class PersonRepository {
  private cache: PersonView[] | null = null;

  constructor(
    private app: App,
    private folders: FolderService,
    private getSettings: () => PeopleHubSettings,
  ) {}

  log(msg: string) { if (this.getSettings().debugMode) console.debug(`[People Hub] ${msg}`); }

  invalidate() { this.cache = null; }

  all(): PersonView[] {
    if (!this.cache) {
      this.cache = this.build();
      this.log(`Index built: ${this.cache.length} people`);
    }
    return this.cache;
  }

  isPersonFile(file: TFile): boolean {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as FM | undefined;
    return this.isPerson(file, fm);
  }

  private isPerson(file: TFile, fm: FM | undefined): boolean {
    const s = this.getSettings();
    if (!fm) return false;
    const excluded = s.excludeFolders.split(",").map(x => x.trim()).filter(Boolean);
    if (excluded.some(f => file.path.startsWith(f + "/"))) return false;
    const type = str(fm.type).toLowerCase();
    if (type) return type === s.personType.toLowerCase();
    const folder = this.folders.resolve("people");
    return !!folder && file.path.startsWith(folder + "/");
  }

  private build(): PersonView[] {
    const out: PersonView[] = [];
    const t = today();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as FM | undefined;
      if (this.isPerson(file, fm)) out.push(this.parse(file, fm as FM, t));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private parse(file: TFile, fm: FM, t: Date): PersonView {
    const s = this.getSettings();
    const name = str(pick(fm, ["name", "display_name", "full_name", "title"])) || file.basename;
    const typePerson = str(pick(fm, ["type_person", "type_person_primary", "category"]));
    const status = str(fm.status).toLowerCase() || "active";
    const paused = status === "paused" || status === "archived";
    const active = !INACTIVE.has(status);

    let tier = str(pick(fm, ["prm-tier", "circle", "tier"])).toLowerCase() as Tier;
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
      frequency:    str(fm.frequency),
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
