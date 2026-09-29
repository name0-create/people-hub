import { App, TFile } from "obsidian";
import { addDays, diffDays, nextBirthday, parseBirthdate, parseDate, today } from "./dates";
import { parseSocials } from "./socials";
import { CarnegieScores, CARNEGIE_LABELS, Person, PluginSettings, TalkLog, Tier, TIERS } from "./types";

type FM = Record<string, any>;

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
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ");
  if (typeof v === "object") return "";
  const s = String(v).trim();
  return s.includes("{{") || s.includes("<%") || s === "null" ? "" : s;
}
function num(v: unknown, def = 0): number {
  const n = Number(v); return isNaN(n) ? def : n;
}

const INACTIVE = new Set(["archived", "inactive", "lost", "deceased", "done"]);
const TYPE_TIER: Record<string, Tier> = {
  family: "inner", girlfriend: "inner", partner: "inner",
  "close-friend": "close", friend: "close", mentor: "close",
  prospect: "close", client: "close", coworker: "close", "co-worker": "close",
  "school-mate": "extended", "high-school-mate": "extended",
  random: "professional", author: "professional", politician: "professional",
  "podcast-host": "professional", "youtube-creator": "professional",
  "tv-host": "professional", "book-author": "professional",
};

function typeToTier(typePerson: string): Tier {
  const first = typePerson.split(/[+,/]/)[0].trim().toLowerCase().replace(/\s+/g, "-");
  return TYPE_TIER[first] ?? "extended";
}

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
    weakestLabel: CARNEGIE_LABELS[wKey]
  };
}

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
      presence: num(fm[`talk${i}_presence`], 0),
      energy: num(fm[`talk${i}_energy`], 0)
    });
  }
  return out;
}

export class PersonIndex {
  private cache: Person[] | null = null;
  constructor(private app: App, private getSettings: () => PluginSettings) {}

  invalidate() { this.cache = null; }
  all(): Person[] { if (!this.cache) this.cache = this.build(); return this.cache; }

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
    const folder = s.peopleFolder.replace(/\/$/, "");
    return !!folder && file.path.startsWith(folder + "/");
  }

  private build(): Person[] {
    const out: Person[] = [];
    const t = today();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as FM | undefined;
      if (this.isPerson(file, fm)) out.push(this.parse(file, fm as FM, t));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private parse(file: TFile, fm: FM, t: Date): Person {
    const s = this.getSettings();
    const name = str(pick(fm, ["name", "display_name", "full_name", "title"])) || file.basename;
    const typePerson = str(pick(fm, ["type_person", "type_person_primary", "category"]));
    const status = str(fm.status).toLowerCase() || "active";
    const paused = status === "paused" || status === "archived";
    const active = !INACTIVE.has(status);

    // Derive tier from type_person if no explicit tier
    let tier = str(pick(fm, ["prm-tier", "circle", "tier"])).toLowerCase() as Tier;
    if (!TIERS.includes(tier)) tier = typePerson ? typeToTier(typePerson) : "extended";

    // Reach-out due date: uses next_contact if set, else last_contact + tier cadence
    const lastContact = parseDate(pick(fm, ["last_contact", "last_contacted"]));
    const nextContact = parseDate(pick(fm, ["next_contact", "next_encounter", "next_action_date"]));
    const cadence = s.tierDays[tier];
    const dueDate = nextContact ?? (lastContact ? addDays(lastContact, cadence) : t);
    const dueIn = diffDays(t, dueDate);

    const bd = parseBirthdate(pick(fm, ["birthday", "birthdate", "birth_date", "dob"]));
    const phone = str(fm.phone);
    const made = num(fm.promises_made); const kept = num(fm.promises_kept);

    const carnegie = carnegieScores(fm);

    return {
      file, name,
      fullName: str(fm.full_name),
      typePerson, alsoIs: str(fm.also_is),
      tier, active, paused, status,
      company: str(pick(fm, ["company", "biz"])),
      role: str(pick(fm, ["role", "job_title"])),
      phone, email: str(fm.email),
      socials: parseSocials(fm, phone),
      location: str(fm.location),
      birthdate: bd,
      birthday: bd ? nextBirthday(bd, t) : null,
      anniversary: parseDate(fm.anniversary),
      lastContact,
      nextContact: nextContact ?? (lastContact ? addDays(lastContact, cadence) : null),
      frequency: str(fm.frequency),
      sinceContact: lastContact ? diffDays(lastContact, t) : null,
      dueIn,
      needsReachOut: active && !paused && dueIn <= 0,
      healthScore: num(fm.health_score),
      trustScore: num(fm.trust_score),
      carnegie,
      promisesMade: made, promisesKept: kept,
      promiseRatio: made > 0 ? Math.round((kept / made) * 100) : null,
      wants: str(fm.wants), fears: str(fm.fears), interests: str(fm.interests),
      theirStory: str(pick(fm, ["their_story", "story"])),
      skillCode: str(fm.skill_code),
      talks: parseTalks(fm),
      nextAction: str(pick(fm, ["next_action", "next_encounter_purpose"])),
      photo: str(fm.photo)
    };
  }

  // ─── queries ───────────────────────────────────────────────────────────
  upcomingBirthdays(days: number): Person[] {
    return this.all()
      .filter(p => p.birthday && !INACTIVE.has(p.status) && p.birthday.days <= days)
      .sort((a, b) => a.birthday!.days - b.birthday!.days);
  }
  birthdaysInMonth(year: number, month0: number): Map<number, Person[]> {
    const map = new Map<number, Person[]>();
    for (const p of this.all()) {
      if (!p.birthdate || INACTIVE.has(p.status) || p.birthdate.month !== month0 + 1) continue;
      map.set(p.birthdate.day, [...(map.get(p.birthdate.day) ?? []), p]);
    }
    return map;
  }
  missingBirthdays(): Person[] {
    return this.all().filter(p => !p.birthdate && !INACTIVE.has(p.status));
  }
  reachOut(): Person[] {
    const rank: Record<Tier, number> = { inner: 0, close: 1, extended: 2, professional: 3 };
    return this.all()
      .filter(p => p.needsReachOut)
      .sort((a, b) => a.dueIn - b.dueIn || rank[a.tier] - rank[b.tier]);
  }
  carnegieAlert(threshold = 3): Person[] {
    return this.all()
      .filter(p => p.active && !p.paused && p.carnegie.avg > 0 && p.carnegie.avg < threshold)
      .sort((a, b) => a.carnegie.avg - b.carnegie.avg);
  }
  promiseAlert(threshold = 70): Person[] {
    return this.all()
      .filter(p => p.active && p.promiseRatio !== null && p.promiseRatio < threshold)
      .sort((a, b) => (a.promiseRatio ?? 0) - (b.promiseRatio ?? 0));
  }
}
