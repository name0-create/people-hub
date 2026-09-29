import { App, TFile } from "obsidian";
import { addDays, diffDays, nextBirthday, occurrence, parseBirthdate, parseDate, today } from "./dates";
import { parseSocials } from "./socials";
import { Person, PluginSettings, Tier, TIERS } from "./types";

type FM = Record<string, any>;

/** First non-empty value among alias keys. This is what makes messy templates work. */
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
  return s.includes("{{") || s.includes("<%") ? "" : s;   // ignore unresolved placeholders
}
const truthy = (v: unknown) => v === true || String(v).toLowerCase() === "true";

function parseCadence(v: unknown): number | null {
  if (typeof v === "number" && v > 0) return v;
  const s = str(v).toLowerCase();
  if (!s) return null;
  const words: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14, fortnightly: 14, monthly: 30, quarterly: 90, yearly: 365 };
  if (words[s]) return words[s];
  const m = s.match(/^(\d+)\s*(d|w|m)?/);
  if (!m) return null;
  const n = +m[1];
  return n > 0 ? n * (m[2] === "w" ? 7 : m[2] === "m" ? 30 : 1) : null;
}

const INACTIVE = new Set(["archived", "inactive", "lost", "deceased", "done"]);

export class PersonIndex {
  private cache: Person[] | null = null;
  constructor(private app: App, private getSettings: () => PluginSettings) {}

  invalidate() { this.cache = null; }

  all(): Person[] {
    if (!this.cache) this.cache = this.build();
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
    const name = str(pick(fm, ["display_name", "full-name", "full_name", "name", "title"])) || file.basename;

    let tier = str(pick(fm, ["prm-tier", "circle", "tier"])).toLowerCase() as Tier;
    if (!TIERS.includes(tier)) tier = "extended";

    const status = str(fm.status).toLowerCase() || "active";
    const paused = truthy(fm["prm-paused"]);
    const active = !paused && !INACTIVE.has(status);

    const cadenceDays = parseCadence(pick(fm, ["frequency", "cadence"])) ?? s.tierDays[tier];
    const lastContacted = parseDate(pick(fm, ["last_contacted", "last_contact"]));
    const first = parseDate(pick(fm, ["first_encounter_date", "first_encounter"]));
    const base = lastContacted ?? first;
    let dueDate = base ? addDays(base, cadenceDays) : t;
    const snooze = parseDate(fm.snoozed_until);
    if (snooze && snooze.getTime() > dueDate.getTime()) dueDate = snooze;
    const dueIn = diffDays(t, dueDate);

    const nextEncounter = parseDate(pick(fm, ["next_encounter", "next_meeting"]));
    const hasFutureMeeting = !!nextEncounter && diffDays(t, nextEncounter) >= 0;

    const phone = str(fm.phone);
    const bd = parseBirthdate(pick(fm, ["birthdate", "birthday", "birth_date", "dob"]));

    return {
      file, name, tier, active, paused, status,
      category: str(fm.category),
      importance: str(fm.importance),
      company: str(fm.company),
      role: str(pick(fm, ["role", "job_title"])),
      phone,
      email: str(fm.email),
      photo: str(fm.photo),
      socials: parseSocials(fm, phone),
      birthdate: bd,
      birthday: bd ? nextBirthday(bd, t) : null,
      lastContacted,
      sinceContact: lastContacted ? diffDays(lastContacted, t) : null,
      cadenceDays, dueDate, dueIn,
      needsReachOut: active && dueIn <= 0 && !hasFutureMeeting,
      nextEncounter,
      nextPlace: str(fm.next_encounter_place),
      nextPurpose: str(fm.next_encounter_purpose)
    };
  }

  // ---- queries ----
  upcomingBirthdays(days: number): Person[] {
    return this.all()
      .filter(p => p.birthday && !INACTIVE.has(p.status) && p.birthday.days <= days)
      .sort((a, b) => a.birthday!.days - b.birthday!.days);
  }
  birthdaysInMonth(year: number, month0: number): Map<number, Person[]> {
    const map = new Map<number, Person[]>();
    for (const p of this.all()) {
      if (!p.birthdate || INACTIVE.has(p.status) || p.birthdate.month !== month0 + 1) continue;
      const day = occurrence(p.birthdate, year).getDate();
      map.set(day, [...(map.get(day) ?? []), p]);
    }
    return map;
  }
  missingBirthdays(): Person[] {
    return this.all().filter(p => !p.birthdate && !INACTIVE.has(p.status));
  }
  reachOut(): Person[] {
    const rank: Record<Tier, number> = { inner: 0, close: 1, extended: 2, professional: 3 };
    return this.all().filter(p => p.needsReachOut)
      .sort((a, b) => a.dueIn - b.dueIn || rank[a.tier] - rank[b.tier]);
  }
  meetings(days: number): Person[] {
    const t = today();
    return this.all()
      .filter(p => p.nextEncounter && diffDays(t, p.nextEncounter) >= 0 && diffDays(t, p.nextEncounter) <= days)
      .sort((a, b) => a.nextEncounter!.getTime() - b.nextEncounter!.getTime());
  }
  /** next_encounter is in the past and last_contacted hasn't caught up: probably needs logging */
  unloggedMeetings(): Person[] {
    const t = today();
    return this.all().filter(p => p.nextEncounter && diffDays(t, p.nextEncounter) < 0 &&
      (!p.lastContacted || p.lastContacted.getTime() < p.nextEncounter.getTime()));
  }
}
