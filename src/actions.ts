import { App, normalizePath, TFile } from "obsidian";
import { addDays, parseDate, today, toISO } from "./dates";
import { Person, PluginSettings, Tier } from "./types";

export const LOG_TYPES = ["call", "whatsapp", "message", "email", "coffee", "lunch", "walk", "physical", "virtual"];
const IN_PERSON = new Set(["coffee", "lunch", "walk", "physical"]);
const ICON: Record<string, string> = { call: "📞", whatsapp: "💬", message: "💬", email: "✉️", coffee: "☕", lunch: "🍽️", walk: "🚶", physical: "🤝", virtual: "💻" };

export interface LogEntry { date: string; type: string; place: string; summary: string; nextDate: string; nextPurpose: string; }

/** Append `line` to the end of the section under `heading`, creating the section if missing. */
export function appendUnderHeading(data: string, heading: string, line: string): string {
  const lines = data.split("\n");
  const level = heading.match(/^#+/)?.[0].length ?? 2;
  const idx = lines.findIndex(l => l.trim() === heading.trim());
  if (idx === -1) return data.replace(/\s*$/, "") + `\n\n${heading}\n\n${line}\n`;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if ((m && m[1].length <= level) || /^---\s*$/.test(lines[i])) { end = i; break; }
  }
  let ins = end;
  while (ins > idx + 1 && lines[ins - 1].trim() === "") ins--;
  lines.splice(ins, 0, line);
  if (ins === idx + 1) lines.splice(ins, 0, "");
  return lines.join("\n");
}

export async function logInteraction(app: App, s: PluginSettings, p: Person, e: LogEntry): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, fm => {
    const prev = parseDate(fm.last_contacted);
    const d = parseDate(e.date);
    if (!prev || (d && d.getTime() >= prev.getTime())) fm.last_contacted = e.date;
    if (IN_PERSON.has(e.type)) fm.times_met = (Number(fm.times_met) || 0) + 1;
    delete fm.snoozed_until;
    if (e.nextDate) {
      fm.next_encounter = e.nextDate;
      if (e.nextPurpose) fm.next_encounter_purpose = e.nextPurpose;
    } else {
      const ne = parseDate(fm.next_encounter);
      if (ne && d && ne.getTime() <= d.getTime()) fm.next_encounter = null;  // meeting happened
    }
  });
  let line = `- ${e.date} · ${ICON[e.type] ?? "•"} ${e.type}`;
  if (e.place) line += ` @ ${e.place}`;
  if (e.summary) line += ` — ${e.summary.replace(/\n+/g, " ")}`;
  if (e.nextDate) line += ` → next: ${e.nextDate}${e.nextPurpose ? " (" + e.nextPurpose + ")" : ""}`;
  await app.vault.process(p.file, data => appendUnderHeading(data, s.logHeading, line));
}

export async function snooze(app: App, p: Person, days: number): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, fm => { fm.snoozed_until = toISO(addDays(today(), days)); });
}
export async function setPaused(app: App, p: Person, paused: boolean): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, fm => { fm["prm-paused"] = paused; });
}

// ---------- create person ----------
export interface NewPersonOpts { name: string; tier: Tier; birthdate: string; phone: string; email: string; company: string; }

async function ensureFolder(app: App, folder: string) {
  if (!folder || folder === "/") return;
  let cur = "";
  for (const seg of normalizePath(folder).split("/")) {
    cur = cur ? `${cur}/${seg}` : seg;
    if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
  }
}

async function buildBody(app: App, s: PluginSettings, name: string): Promise<string> {
  if (s.bodyTemplate) {
    const f = app.vault.getAbstractFileByPath(normalizePath(s.bodyTemplate));
    if (f instanceof TFile) {
      const raw = await app.vault.read(f);
      return raw.replace(/^---\n[\s\S]*?\n---\n?/, "")
        .replace(/\{\{\s*(title|name)\s*\}\}/g, name)
        .replace(/\{\{\s*date\s*\}\}/g, toISO(today()));
    }
  }
  return `# ${name}

## 🤝 Relationship
**Why I value this relationship**
- 

**How I can help**
- 

**Things to ask next time**
- 

**Open loops**
- 

## 🔍 Homework (before we meet)
- Background:
- Working on now:
- Struggles / goals:
- Topics to avoid:

## 🧾 Promises
- I promised:
- They promised:

${s.logHeading}

`;
}

export async function createPerson(app: App, s: PluginSettings, o: NewPersonOpts): Promise<TFile> {
  const folder = s.peopleFolder.replace(/\/$/, "");
  await ensureFolder(app, folder);
  const base = o.name.replace(/[\\/:*?"<>|#^\[\]]/g, "").trim() || "Unnamed";
  const prefix = folder ? folder + "/" : "";
  let path = normalizePath(`${prefix}${base}.md`);
  let i = 2;
  while (app.vault.getAbstractFileByPath(path)) path = normalizePath(`${prefix}${base} ${i++}.md`);

  const file = await app.vault.create(path, await buildBody(app, s, o.name));
  const [first, ...rest] = o.name.trim().split(/\s+/);
  const now = new Date();
  await app.fileManager.processFrontMatter(file, fm => {
    Object.assign(fm, {
      id: `PER-${Date.now().toString(36).toUpperCase()}`,
      id_prefix: "PER",
      created: `${toISO(now)} ${now.toTimeString().slice(0, 8)}`,
      type: s.personType,
      title: o.name,
      display_name: o.name,
      aliases: [],
      first_name: first ?? "",
      last_name: rest.join(" "),
      nickname: "",
      photo: "",
      phone: o.phone,
      email: o.email,
      instagram: "", linkedin: "", x_twitter: "", youtube: "",
      company: o.company,
      role: "",
      category: [],
      "prm-tier": o.tier,
      "prm-paused": false,
      status: "active",
      frequency: null,
      birthdate: o.birthdate,
      first_encounter_date: toISO(now),
      last_contacted: toISO(now),
      next_encounter: null,
      next_encounter_place: "",
      next_encounter_purpose: "",
      times_met: 1,
      relationship_status: "new",
      importance: "medium",
      tags: ["type/person", "area/people"]
    });
  });
  return file;
}

/** Optional: run the user's Templater template instead of the built-in generator. */
export async function createWithTemplater(app: App, s: PluginSettings): Promise<boolean> {
  const tp = (app as any).plugins?.plugins?.["templater-obsidian"];
  const tpl = app.vault.getAbstractFileByPath(normalizePath(s.templaterTemplate));
  if (!tp || !(tpl instanceof TFile)) return false;
  try {
    const folder = app.vault.getAbstractFileByPath(normalizePath(s.peopleFolder));
    await tp.templater.create_new_note_from_template(tpl, folder ?? undefined, undefined, true);
    return true;
  } catch (e) {
    console.error("People Hub: Templater failed", e);
    return false;
  }
}
