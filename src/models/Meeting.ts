// ─── Meeting (canonical stored model) ─────────────────────────────────────────
// A planned or held get-together with one or more people. Stored as a stand-alone
// note in the meeting folder (FolderService "meeting").
//
// A Meeting is the *plan* (when, where, why, agenda). Once it happens it can
// produce an Interaction (the *record*), linked through `interaction`.
// Person.next_encounter* holds the single next planned meeting on the person
// note itself; Meeting is the richer form of the same idea.

export const MEETING_ID_PREFIX = "MTG" as const;
export const MEETING_NOTE_TYPE = "meeting" as const;
export const MEETING_SCHEMA_VERSION = 1;

export const MEETING_STATUSES = ["planned", "held", "cancelled", "rescheduled"] as const;
export type MeetingStatus = typeof MEETING_STATUSES[number];

export interface Meeting {
  // ── System ────────────────────────────────────────────────────────────────
  id: string;
  id_prefix: typeof MEETING_ID_PREFIX;
  schema_version: number;

  created: string;        // ISO 8601 timestamp
  created_date: string;   // YYYY-MM-DD
  updated: string;        // ISO 8601 timestamp

  type: typeof MEETING_NOTE_TYPE;

  title: string;

  // ── When / where ──────────────────────────────────────────────────────────
  date: string;           // YYYY-MM-DD
  start_time?: string;    // HH:mm (24h)
  end_time?: string;      // HH:mm (24h)

  place_name?: string;
  address?: string;
  location?: string;

  status: MeetingStatus;

  /** Wikilinks to the people attending, e.g. "[[Jane Doe]]". At least one. */
  people: string[];

  // ── Content ───────────────────────────────────────────────────────────────
  purpose?: string;
  agenda?: string[];
  outcome?: string;
  action_items?: string[];

  // ── Links ─────────────────────────────────────────────────────────────────
  /** Wikilink to the Interaction logged after this meeting happened. */
  interaction?: string;
  related_projects?: string[];
  related_goals?: string[];

  tags?: string[];
}
