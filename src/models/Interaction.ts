// ─── Interaction (canonical stored model) ─────────────────────────────────────
// One contact event with one or more people: a call, a coffee, a message.
// Stored as a stand-alone note in the interaction folder (FolderService "interaction").
//
// Fields are derived from what the plugin already records today in TalkEntry
// (repository/person-actions.ts), so existing quick-log data maps straight across.

export const INTERACTION_ID_PREFIX = "INT" as const;
export const INTERACTION_NOTE_TYPE = "interaction" as const;
export const INTERACTION_SCHEMA_VERSION = 1;

/** Channels. Same list the quick-log sheet offers as chips. */
export const INTERACTION_TYPES = [
  "call", "whatsapp", "coffee", "lunch", "walk",
  "home-1on1", "video", "message", "email",
] as const;
export type InteractionType = typeof INTERACTION_TYPES[number];

/** Interaction types that count as meeting in person (increments Person.times_met). */
export const IN_PERSON_INTERACTION_TYPES: readonly InteractionType[] = [
  "coffee", "lunch", "walk", "home-1on1",
];

export type InteractionDirection = "outbound" | "inbound" | "mutual";

/** Carnegie principles practised during the interaction (c1…c9). */
export type CarnegieKey = "c1" | "c2" | "c3" | "c4" | "c5" | "c6" | "c7" | "c8" | "c9";

export interface Interaction {
  // ── System ────────────────────────────────────────────────────────────────
  id: string;
  id_prefix: typeof INTERACTION_ID_PREFIX;
  schema_version: number;

  created: string;        // ISO 8601 timestamp
  created_date: string;   // YYYY-MM-DD
  updated: string;        // ISO 8601 timestamp

  type: typeof INTERACTION_NOTE_TYPE;

  title: string;

  // ── What happened ─────────────────────────────────────────────────────────
  date: string;                          // YYYY-MM-DD
  interaction_type: InteractionType | string;   // string allowed for user-defined channels
  direction?: InteractionDirection;
  duration_minutes?: number;

  /** Wikilinks to the people involved, e.g. "[[Jane Doe]]". At least one. */
  people: string[];

  place_name?: string;
  location?: string;

  // ── Content ───────────────────────────────────────────────────────────────
  summary?: string;
  learned?: string;
  next_step?: string;    // what was agreed next ("Call in 2 weeks")

  // ── Quality (1–5, 0/absent = not rated) ───────────────────────────────────
  presence?: number;
  energy?: number;
  carnegie_used?: CarnegieKey[];

  // ── Links ─────────────────────────────────────────────────────────────────
  /** Wikilink to the Meeting this interaction came from, if any. */
  meeting?: string;
  related_projects?: string[];
  related_goals?: string[];

  tags?: string[];
}
