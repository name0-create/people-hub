// ─── PersonActions ────────────────────────────────────────────────────────────
// Every write operation on person notes lives here.
// Nothing else calls app.vault.process or processFrontMatter on person files.

import { App, normalizePath, Notice, TFile } from "obsidian";
import { addDays, today, toISO } from "../core/dates";
import type { FolderService } from "../core/folder-service";
import type { PeopleHubSettings } from "../core/settings";
import { INTERACTION_TYPES, type InteractionType } from "../models/Interaction";
import type { PersonView, Tier } from "../models/person-view";

// ── Talk entry ────────────────────────────────────────────────────────────────
export const LOG_TYPES = INTERACTION_TYPES;   // canonical list lives in models/Interaction.ts
export type LogType = InteractionType;

export interface TalkEntry {
  date:     string;
  type:     LogType | string;
  where:    string;
  note:     string;
  learned:  string;
  next:     string;
  presence: number;   // 1-5
  energy:   number;   // 1-5
  c2_used:  boolean;
  c4_used:  boolean;
  c7_used:  boolean;
}

const TYPE_ICON: Record<string, string> = {
  call: "📞", whatsapp: "💬", coffee: "☕", lunch: "🍽️",
  walk: "🚶", "home-1on1": "🏠", video: "💻", message: "💬", email: "✉️",
};
const IN_PERSON = new Set(["coffee", "lunch", "walk", "home-1on1"]);

// ── logTalk ───────────────────────────────────────────────────────────────────
/** Rotate talk1…talk5 and write fresh values into talk1. Update last_contact. */
export async function logTalk(
  app: App,
  s: PeopleHubSettings,
  p: PersonView,
  e: TalkEntry,
): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, fm => {
    // rotate: shift 1→2→3→4→5 (oldest drops off)
    for (let i = 5; i > 1; i--) {
      for (const k of ["date", "where", "note", "learned", "next", "presence", "energy"]) {
        fm[`talk${i}_${k}`] = fm[`talk${i - 1}_${k}`] ?? null;
      }
    }
    // write talk1
    fm.talk1_date     = e.date;
    fm.talk1_where    = e.where;
    fm.talk1_note     = e.note;
    fm.talk1_learned  = e.learned;
    fm.talk1_next     = e.next;
    fm.talk1_presence = e.presence;
    fm.talk1_energy   = e.energy;

    // tracking
    fm.last_contact = e.date;
    if (IN_PERSON.has(e.type)) fm.times_met = (Number(fm.times_met) || 0) + 1;
  });

  // append readable bullet to body
  const icon = TYPE_ICON[e.type] ?? "•";
  const cUsed = [
    e.c2_used ? "C2" : "",
    e.c4_used ? "C4" : "",
    e.c7_used ? "C7" : "",
  ].filter(Boolean);
  let line = `- ${e.date} ${icon}`;
  if (e.where)   line += ` @ ${e.where}`;
  if (e.note)    line += ` — ${e.note.replace(/\n+/g, " ")}`;
  if (e.learned) line += ` · learned: ${e.learned}`;
  if (cUsed.length) line += ` · Carnegie: ${cUsed.join("+")}`;
  if (e.presence) line += ` · presence ${e.presence}/5`;
  if (e.next)    line += ` → ${e.next}`;

  await app.vault.process(p.file, data =>
    appendUnderHeading(data, s.logHeading, line)
  );
}

// ── Quick log (minimal — used from swipe / one-tap) ───────────────────────────
export async function quickLog(
  app: App,
  s: PeopleHubSettings,
  p: PersonView,
  type: LogType | string = "call",
): Promise<void> {
  const e: TalkEntry = {
    date: toISO(today()), type, where: "", note: "",
    learned: "", next: "", presence: 0, energy: 0,
    c2_used: false, c4_used: false, c7_used: false,
  };
  await logTalk(app, s, p, e);
}

// ── appendUnderHeading ────────────────────────────────────────────────────────
export function appendUnderHeading(data: string, heading: string, line: string): string {
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

// ── snooze ────────────────────────────────────────────────────────────────────
export async function snooze(app: App, p: PersonView, days: number): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, fm => {
    const due = addDays(today(), days);
    fm.next_contact   = toISO(due);
    fm.snoozed_until  = toISO(due);
  });
}

// ── pause ─────────────────────────────────────────────────────────────────────
export async function setPaused(app: App, p: PersonView, paused: boolean): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, fm => {
    fm.status = paused ? "paused" : "active";
  });
}

// ── Create person ─────────────────────────────────────────────────────────────
export interface NewPersonOpts {
  name:       string;
  typePerson: string;
  tier:       Tier;
  phone:      string;
  email:      string;
  ig:         string;
  linkedin:   string;
  frequency:  string;
  birthday:   string;
  anniversary: string;
}

export async function createPerson(
  app: App,
  s: PeopleHubSettings,
  folders: FolderService,
  o: NewPersonOpts,
): Promise<TFile> {
  await folders.ensure("people");
  const folder = folders.resolve("people");
  const base   = o.name.replace(/[\\/:*?"<>|#^\[\]]/g, "").trim() || "Unnamed";
  let path     = normalizePath(`${folder}/${base}.md`);
  let i = 2;
  while (app.vault.getAbstractFileByPath(path))
    path = normalizePath(`${folder}/${base} ${i++}.md`);

  const t = toISO(today());
  const freq = o.frequency || { inner: "daily", close: "weekly", extended: "monthly", professional: "quarterly" }[o.tier];

  const body = `# ${o.name}

> **Carnegie reminder:** Don't criticize · Give genuine appreciation · Become genuinely interested · Remember the name · Talk in their interests · Make them feel important · Avoid arguments · Admit quickly.

## 01 — Who
- **Type:** ${o.typePerson || "—"}
- **Phone:** ${o.phone || "—"} · **Email:** ${o.email || "—"}
- **IG:** ${o.ig || "—"} · **LinkedIn:** ${o.linkedin || "—"}

## 02 — Carnegie Scores
*(Fill after first talk — see frontmatter c1_score … c9_score, each 0–5)*

## 03 — Relationship Health
- **Frequency:** ${freq}
- **Last contact:** ${t}

## 04 — What to Remember
- **Wants:**
- **Fears:**
- **Interests:**
- **Their Story:**

## Talks Log

`;

  const file = await app.vault.create(path, body);
  const [first] = o.name.trim().split(/\s+/);
  void first; // used in template but not needed in FM

  await app.fileManager.processFrontMatter(file, fm => {
    Object.assign(fm, {
      id:           `PERSON-${Date.now().toString().slice(-10)}`,
      type:         s.personType,
      status:       "active",
      created:      t,
      name:         o.name,
      full_name:    o.name,
      type_person:  o.typePerson,
      also_is:      "",
      where_met:    "",
      met_date:     t,
      phone:        o.phone,
      email:        o.email,
      ig:           o.ig,
      linkedin:     o.linkedin,
      youtube:      "",
      x_twitter:    "",
      location:     "",
      birthday:     o.birthday,
      anniversary:  o.anniversary,
      frequency:    freq,
      next_contact: t,
      last_contact: t,
      health_score: 3,
      trust_score:  3,
      skill_code:   "S3",
      c1_score: 0, c2_score: 0, c3_score: 0, c4_score: 0, c5_score: 0,
      c6_score: 0, c7_score: 0, c8_score: 0, c9_score: 0,
      promises_made:  0,
      promises_kept:  0,
      tags: ["type/person", "status/active"],
    });
  });
  return file;
}

// ── Templater bridge ──────────────────────────────────────────────────────────
export async function createWithTemplater(
  app: App,
  s: PeopleHubSettings,
  folders: FolderService,
): Promise<boolean> {
  const tp = (app as any).plugins?.plugins?.["templater-obsidian"];
  const tpl = app.vault.getAbstractFileByPath(normalizePath(s.personTemplatePath));
  if (!tp || !(tpl instanceof TFile)) return false;
  try {
    const folder = folders.get("people") ?? undefined;
    await tp.templater.create_new_note_from_template(tpl, folder, undefined, true);
    return true;
  } catch (e) {
    console.error("People Hub: Templater failed", e);
    return false;
  }
}

// ── QuickAdd bridge (v0.2) ───────────────────────────────────────────────────
/** Trigger a named QuickAdd macro. Returns true if launched successfully. */
export async function createWithQuickAdd(app: App, macroName: string): Promise<boolean> {
  const qa = (app as any).plugins?.plugins?.["quickadd"];
  if (!qa) {
    new Notice("QuickAdd plugin not found. Enable it first.");
    return false;
  }
  try {
    // QuickAdd exposes different APIs depending on version
    const api = qa.api ?? qa.quickAddApi;
    if (!api) { new Notice("QuickAdd API not available."); return false; }
    await api.executeChoice(macroName);
    return true;
  } catch (e) {
    console.error("People Hub: QuickAdd macro failed", e);
    new Notice(`QuickAdd: could not run "${macroName}". Check the macro name in settings.`);
    return false;
  }
}
