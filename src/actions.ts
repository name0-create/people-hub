import { App, normalizePath, TFile } from "obsidian";
import { addDays, parseDate, today, toISO } from "./dates";
import { Person, PluginSettings, Tier } from "./types";

export const LOG_TYPES = ["call", "whatsapp", "coffee", "lunch", "walk", "home-1on1", "video", "message", "email"];

export interface TalkEntry {
  date: string; type: string; where: string; note: string;
  learned: string; next: string; presence: number; energy: number;
  c2_used: boolean; c4_used: boolean; c7_used: boolean;
}

const TYPE_ICON: Record<string, string> = {
  call: "📞", whatsapp: "💬", coffee: "☕", lunch: "🍽️",
  walk: "🚶", "home-1on1": "🏠", video: "💻", message: "💬", email: "✉️"
};
const IN_PERSON = new Set(["coffee", "lunch", "walk", "home-1on1"]);

/** Rotate talk1…talk5 fields: shift 1→2→3→4→5, write fresh into talk1. */
export async function logTalk(app: App, s: PluginSettings, p: Person, e: TalkEntry): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, fm => {
    // rotate
    for (let i = 5; i > 1; i--) {
      for (const k of ["date", "where", "note", "learned", "next", "presence", "energy"]) {
        fm[`talk${i}_${k}`] = fm[`talk${i - 1}_${k}`] ?? null;
      }
    }
    // write talk1
    fm.talk1_date = e.date;
    fm.talk1_where = e.where;
    fm.talk1_note = e.note;
    fm.talk1_learned = e.learned;
    fm.talk1_next = e.next;
    fm.talk1_presence = e.presence;
    fm.talk1_energy = e.energy;

    // update tracking fields
    fm.last_contact = e.date;
    if (IN_PERSON.has(e.type)) fm.times_met = (Number(fm.times_met) || 0) + 1;
  });

  // also append a brief bullet under the log heading so it's readable
  const icon = TYPE_ICON[e.type] ?? "•";
  const cUsed = [e.c2_used ? "C2" : "", e.c4_used ? "C4" : "", e.c7_used ? "C7" : ""].filter(Boolean);
  let line = `- ${e.date} ${icon}`;
  if (e.where) line += ` @ ${e.where}`;
  if (e.note) line += ` — ${e.note.replace(/\n+/g, " ")}`;
  if (e.learned) line += ` · learned: ${e.learned}`;
  if (cUsed.length) line += ` · Carnegie: ${cUsed.join("+")}`;
  if (e.presence) line += ` · presence ${e.presence}/5`;
  if (e.next) line += ` → ${e.next}`;

  await app.vault.process(p.file, data => appendUnderHeading(data, "## Talks Log", line));
}

function appendUnderHeading(data: string, heading: string, line: string): string {
  const lines = data.split("\n");
  const level = heading.match(/^#+/)?.[0].length ?? 2;
  const idx = lines.findIndex(l => l.trim().startsWith(heading.trim()));
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

export async function snooze(app: App, p: Person, days: number): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, fm => {
    const due = addDays(today(), days);
    fm.next_contact = toISO(due);
    fm.snoozed_until = toISO(due);
  });
}
/** Quick "we spoke": last_contact = today, clears any planned/snoozed next_contact. */
export async function markContacted(app: App, p: Person): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, fm => {
    fm.last_contact = toISO(today());
    delete fm.next_contact; delete fm.snoozed_until;
  });
}
export async function setPaused(app: App, p: Person, paused: boolean): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, fm => { fm.status = paused ? "paused" : "active"; });
}

// ─── create person ────────────────────────────────────────────────────────────
export interface NewPersonOpts {
  name: string; typePerson: string; tier: Tier;
  phone: string; email: string; ig: string; linkedin: string; frequency: string;
}

async function ensureFolder(app: App, folder: string) {
  if (!folder || folder === "/") return;
  let cur = "";
  for (const seg of normalizePath(folder).split("/")) {
    cur = cur ? `${cur}/${seg}` : seg;
    if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
  }
}

export async function createPerson(app: App, s: PluginSettings, o: NewPersonOpts): Promise<TFile> {
  const folder = s.peopleFolder.replace(/\/$/, "");
  await ensureFolder(app, folder);
  const base = o.name.replace(/[\\/:*?"<>|#^\[\]]/g, "").trim() || "Unnamed";
  const prefix = folder ? folder + "/" : "";
  let path = normalizePath(`${prefix}${base}.md`);
  let i = 2;
  while (app.vault.getAbstractFileByPath(path)) path = normalizePath(`${prefix}${base} ${i++}.md`);
  const now = today();
  const t = toISO(now);

  const body = `# ${o.name}

> Carnegie: Don't criticize, give honest appreciation, become genuinely interested, remember name, listen 80%, talk in their interests, make feel important, avoid arguments, admit quickly.

## 01 - Who - Quick ID
- **Type:** ${o.typePerson}
- **Phone:** ${o.phone || "—"} · **Email:** ${o.email || "—"}
- **IG:** ${o.ig || "—"} · **LinkedIn:** ${o.linkedin || "—"}

## 02 - Carnegie Scores
*(Fill after first talk — see frontmatter c1_score … c9_score)*

## 03 - Relationship Health
- **Frequency:** ${o.frequency || "weekly"}
- **Last contact:** ${t}
- **Next contact:** ${t}

## 04 - What to Remember
- **Wants:**
- **Fears:**
- **Interests:**
- **Their Story:**

## Talks Log

`;

  const file = await app.vault.create(path, body);
  const [first, ...rest] = o.name.trim().split(/\s+/);
  await app.fileManager.processFrontMatter(file, fm => {
    Object.assign(fm, {
      id: `PERSON-${Date.now().toString().slice(-10)}`,
      type: s.personType,
      status: "active",
      created: t,
      name: o.name,
      full_name: o.name,
      type_person: o.typePerson,
      also_is: "",
      where_met: "",
      met_date: t,
      met_context: "",
      phone: o.phone, email: o.email,
      ig: o.ig, linkedin: o.linkedin, youtube: "", x_twitter: "",
      location: "",
      birthday: "", anniversary: "",
      frequency: o.frequency || (o.tier === "inner" ? "daily" : o.tier === "close" ? "weekly" : o.tier === "extended" ? "monthly" : "quarterly"),
      next_contact: t, last_contact: t,
      health_score: 3, trust_score: 3, carnegie_avg: 3,
      skill_code: "S3",
      c1_score: 0, c2_score: 0, c3_score: 0, c4_score: 0, c5_score: 0,
      c6_score: 0, c7_score: 0, c8_score: 0, c9_score: 0,
      promises_made: 0, promises_kept: 0,
      tags: ["type/person", "status/active"]
    });
  });
  return file;
}

export async function createWithTemplater(app: App, s: PluginSettings): Promise<boolean> {
  const tp = (app as any).plugins?.plugins?.["templater-obsidian"];
  const tpl = app.vault.getAbstractFileByPath(normalizePath(s.templaterTemplate));
  if (!tp || !(tpl instanceof TFile)) return false;
  try {
    const folder = app.vault.getAbstractFileByPath(normalizePath(s.peopleFolder));
    await tp.templater.create_new_note_from_template(tpl, folder ?? undefined, undefined, true);
    return true;
  } catch (e) { console.error("People Hub: Templater failed", e); return false; }
}
