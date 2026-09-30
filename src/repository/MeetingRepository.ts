// ─── MeetingRepository ────────────────────────────────────────────────────────
// CRUD for stand-alone meeting notes (FolderService "meeting").

import { addDays, parseDate, toISO } from "../core/dates";
import { linkName, linkTarget } from "../core/markdown";
import {
  Meeting, MEETING_ID_PREFIX, MEETING_NOTE_TYPE, MEETING_SCHEMA_VERSION, MEETING_STATUSES,
} from "../models/Meeting";
import { Checker } from "./Checker";
import type { MarkdownStore } from "./MarkdownStore";
import { NoteKind, NoteRecord, NoteRepository } from "./NoteRepository";

type Managed = "id" | "id_prefix" | "schema_version" | "created" | "created_date" | "updated" | "type";
export type NewMeetingData = Omit<Meeting, Managed | "title" | "status"> & { title?: string; status?: Meeting["status"] };
/** Partial update. A key set to `undefined` removes that property. */
export type MeetingPatch = Partial<Omit<Meeting, Managed>>;

const KIND: NoteKind = {
  label: "meeting",
  folder: "meeting",
  idPrefix: MEETING_ID_PREFIX,
  noteType: MEETING_NOTE_TYPE,
  schemaVersion: MEETING_SCHEMA_VERSION,
  managed: ["id", "id_prefix", "schema_version", "created", "created_date", "updated", "type"],
  required: ["title", "date", "status", "people"],
  validate(rec) {
    const c = new Checker(rec);
    c.text("title").date("date", true).time("start_time").time("end_time")
      .oneOf("status", MEETING_STATUSES, true)
      .list("people", { required: true, nonEmpty: true })
      .text("place_name").text("address").text("location").text("purpose").text("outcome").text("interaction")
      .list("agenda").list("action_items").list("related_projects").list("related_goals").list("tags");
    const s = rec.start_time, e = rec.end_time;
    if (typeof s === "string" && typeof e === "string" && !c.issues.some(i => i.key === "start_time" || i.key === "end_time") && e < s) {
      c.issues.push({ key: "end_time", message: `"end_time" must not be before "start_time"` });
    }
    return c.issues;
  },
  defaultTitle(rec) {
    const people = rec.people as string[];
    return `Meeting with ${linkName(people[0])}${people.length > 1 ? ` +${people.length - 1}` : ""}`;
  },
  fileBase: rec => `${rec.date} ${rec.title}`,
};

export class MeetingRepository extends NoteRepository<Meeting> {
  constructor(store: MarkdownStore, onChanged: () => void = () => {}) { super(store, KIND, onChanged); }

  getMeeting(path: string)       { return this.get(path); }
  getMeetingById(id: string)     { return this.getById(id); }
  /** `status` defaults to "planned". */
  createMeeting(data: NewMeetingData, body?: string) { return this.create({ status: "planned", ...data }, body); }
  updateMeeting(path: string, patch: MeetingPatch)   { return this.update(path, patch); }
  deleteMeeting(path: string)    { return this.delete(path); }

  /** Planned meetings from `from` (YYYY-MM-DD) through `days` days ahead, soonest first. */
  listUpcoming(from: string, days: number): NoteRecord<Meeting>[] {
    const start = parseDate(from);
    if (!start) return [];
    const end = toISO(addDays(start, days));
    return this.list()
      .filter(r => r.data.status === "planned" && r.data.date >= from && r.data.date <= end)
      .sort((a, b) => a.data.date.localeCompare(b.data.date) || (a.data.start_time ?? "").localeCompare(b.data.start_time ?? ""));
  }

  listForPerson(person: string): NoteRecord<Meeting>[] {
    const target = linkTarget(person);
    return this.list().filter(r => r.data.people.some(l => linkTarget(l) === target));
  }
}
