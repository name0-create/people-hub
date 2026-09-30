// ─── Person (canonical stored model) ──────────────────────────────────────────
// Exactly what a person note's frontmatter contains. Property names are the
// frontmatter keys, so this interface is the single source of truth for the
// schema. Every key here MUST have a definition in SchemaRegistry.ts — the
// registry is typed against this interface, so the build fails if one is missing.
//
// Not to be confused with PersonView (person-view.ts), the parsed runtime object
// the UI works with (holds the TFile, computed due dates, scores…).
//
// Conventions
//   • Dates are ISO strings: "YYYY-MM-DD" for dates, full ISO 8601 for timestamps.
//   • Links to other notes are wikilinks: "[[Name]]".
//   • Optional means "may be absent from the note", never null.

export const PERSON_ID_PREFIX = "PER" as const;
export const PERSON_NOTE_TYPE = "person" as const;
/** Bump when a property is renamed/removed/retyped, and add a migration. */
export const PERSON_SCHEMA_VERSION = 1;

export interface Person {
  // ── System ────────────────────────────────────────────────────────────────
  id: string;
  id_prefix: typeof PERSON_ID_PREFIX;
  schema_version: number;

  created: string;        // ISO 8601 timestamp
  created_date: string;   // YYYY-MM-DD (for date-only queries)
  updated: string;        // ISO 8601 timestamp

  type: typeof PERSON_NOTE_TYPE;

  // ── Identity ──────────────────────────────────────────────────────────────
  title: string;          // note title
  display_name: string;   // how the name is shown in the UI
  name: string;           // full name

  preferred_name?: string;
  aliases?: string[];

  first_name?: string;
  last_name?: string;
  nickname?: string;

  favorite?: boolean;

  photo?: string;
  gender?: string;

  // ── Contact ───────────────────────────────────────────────────────────────
  phone?: string;
  email?: string;

  instagram?: string;
  linkedin?: string;
  youtube?: string;
  x_twitter?: string;

  place_name?: string;
  address?: string;
  location?: string;

  // ── Work ──────────────────────────────────────────────────────────────────
  company?: string[];
  role?: string;

  // ── Organisation ──────────────────────────────────────────────────────────
  category?: string[];
  groups?: string[];

  prm_tier?: string;
  prm_paused?: boolean;

  // ── Links ─────────────────────────────────────────────────────────────────
  related_projects?: string[];
  related_goals?: string[];
  related_habits?: string[];
  linked_ideas?: string[];
  linked_people?: string[];

  status?: string;

  // ── Relationship ──────────────────────────────────────────────────────────
  relationship_type?: string[];
  relationship_status?: string;
  relationship_direction?: string;
  contactability?: string;
  importance?: string;

  cadence?: string;
  first_encounter_date?: string;
  last_contacted?: string;

  next_encounter?: string;
  next_encounter_place?: string;
  next_encounter_purpose?: string;

  times_met?: number;
  met_through?: string;
  met_location?: string;

  // ── Dates ─────────────────────────────────────────────────────────────────
  birthdate?: string;
  anniversary?: string;

  // ── Context ───────────────────────────────────────────────────────────────
  interests?: string[];
  current_focus?: string[];
  how_i_can_help?: string[];
  things_to_remember?: string;
  conversation_topics?: string[];
  open_loops?: string[];
  promises?: string[];
  wins?: string[];

  tags?: string[];
}

/** Every valid frontmatter key on a person note. */
export type PersonKey = keyof Person;

/** Keys that must be present on every person note. */
export type RequiredPersonKey = {
  [K in PersonKey]-?: undefined extends Person[K] ? never : K;
}[PersonKey];
