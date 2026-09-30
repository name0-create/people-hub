// ─── PersonActions ────────────────────────────────────────────────────────────
// Use-case layer: what the UI *means* by "log a talk", "snooze", "create person".
// It decides WHAT to write; PersonRepository decides HOW (validation, atomic
// frontmatter writes, cache sync). No vault or file-manager write calls in here.
// (The Templater / QuickAdd bridges hand off to those plugins, which create notes themselves.)

import { App, normalizePath, Notice, TFile } from "obsidian";
import { addDays, today, toISO } from "../core/dates";
import type { FolderService } from "../core/folder-service";
import type { PeopleHubSettings } from "../core/settings";
import { IN_PERSON_INTERACTION_TYPES, INTERACTION_TYPES, type InteractionType } from "../models/Interaction";
import type { PersonView, Tier } from "../models/person-view";
import type { PersonRepository } from "./PersonRepository";

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
const IN_PERSON = new Set<string>(IN_PERSON_INTERACTION_TYPES);

// ── logTalk ───────────────────────────────────────────────────────────────────
/**
 * Record a talk: one atomic frontmatter write (last_contacted, times_met, and the
 * v0.2 talk1…talk5 rotation), then one bullet appended under the log heading.
 */
export async function logTalk(
  people: PersonRepository,
  s: PeopleHubSettings,
  p: PersonView,
  e: TalkEntry,
): Promise<void> {
  const date = e.date || toISO(today());
  await people.updatePerson(
    p.file.path,
    // function patch: times_met is incremented from the value at write time
    cur => ({
      last_contacted: date,
      ...(IN_PERSON.has(e.type) ? { times_met: (cur.times_met ?? 0) + 1 } : {}),
    }),
    {
      // talk1…talk5 are outside the person schema → extension
      extension: fm => {
        // rotate: shift 1→2→3→4→5 (oldest drops off)
        for (let i = 5; i > 1; i--) {
          for (const k of ["date", "where", "note", "learned", "next", "presence", "energy"]) {
            fm[`talk${i}_${k}`] = fm[`talk${i - 1}_${k}`] ?? null;
          }
        }
        fm.talk1_date     = date;
        fm.talk1_where    = e.where;
        fm.talk1_note     = e.note;
        fm.talk1_learned  = e.learned;
        fm.talk1_next     = e.next;
        fm.talk1_presence = e.presence;
        fm.talk1_energy   = e.energy;
      },
    },
  );

  // readable bullet in the body
  const icon = TYPE_ICON[e.type] ?? "•";
  const cUsed = [
    e.c2_used ? "C2" : "",
    e.c4_used ? "C4" : "",
    e.c7_used ? "C7" : "",
  ].filter(Boolean);
  let line = `- ${date} ${icon}`;
  if (e.where)   line += ` @ ${e.where}`;
  if (e.note)    line += ` — ${e.note.replace(/\n+/g, " ")}`;
  if (e.learned) line += ` · learned: ${e.learned}`;
  if (cUsed.length) line += ` · Carnegie: ${cUsed.join("+")}`;
  if (e.presence) line += ` · presence ${e.presence}/5`;
  if (e.next)    line += ` → ${e.next}`;

  await people.appendToSection(p.file.path, s.logHeading, line);
}

// ── Quick log (minimal — used from swipe / one-tap) ───────────────────────────
export async function quickLog(
  people: PersonRepository,
  s: PeopleHubSettings,
  p: PersonView,
  type: LogType | string = "call",
): Promise<void> {
  const e: TalkEntry = {
    date: toISO(today()), type, where: "", note: "",
    learned: "", next: "", presence: 0, energy: 0,
    c2_used: false, c4_used: false, c7_used: false,
  };
  await logTalk(people, s, p, e);
}

// ── snooze ────────────────────────────────────────────────────────────────────
export async function snooze(people: PersonRepository, p: PersonView, days: number): Promise<void> {
  const due = toISO(addDays(today(), days));
  await people.updatePerson(p.file.path, { next_encounter: due }, {
    extension: fm => { fm.snoozed_until = due; },
  });
}

// ── pause ─────────────────────────────────────────────────────────────────────
export async function setPaused(people: PersonRepository, p: PersonView, paused: boolean): Promise<void> {
  await people.updatePerson(p.file.path, { status: paused ? "paused" : "active" });
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
  people: PersonRepository,
  _s: PeopleHubSettings,
  o: NewPersonOpts,
): Promise<TFile> {
  const t = toISO(today());
  const freq = o.frequency || { inner: "daily", close: "weekly", extended: "monthly", professional: "quarterly" }[o.tier];
  const name = o.name.trim();
  const types = o.typePerson.split(/[+,/]/).map(x => x.trim()).filter(Boolean);
  const opt = <V>(v: V | "" | undefined): V | undefined => (v === "" ? undefined : v);

  const body = `# ${name}

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

  const rec = await people.createPerson({
    name,
    relationship_type:    types.length ? types : undefined,
    prm_tier:             o.tier,
    cadence:              opt(freq),
    phone:                opt(o.phone.trim()),
    email:                opt(o.email.trim()),
    instagram:            opt(o.ig.trim()),
    linkedin:             opt(o.linkedin.trim()),
    birthdate:            opt(o.birthday.trim()),
    anniversary:          opt(o.anniversary.trim()),
    first_encounter_date: t,
    last_contacted:       t,
    next_encounter:       t,
    tags: ["type/person", "status/active"],
  }, {
    body,
    // v0.2 scoring fields — outside the person schema, still used by PeopleIndex
    extension: {
      health_score: 3, trust_score: 3, skill_code: "S3",
      c1_score: 0, c2_score: 0, c3_score: 0, c4_score: 0, c5_score: 0,
      c6_score: 0, c7_score: 0, c8_score: 0, c9_score: 0,
      promises_made: 0, promises_kept: 0,
    },
  });
  return rec.file;
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
