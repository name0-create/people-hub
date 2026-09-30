// ─── InteractionRepository ────────────────────────────────────────────────────
// CRUD for stand-alone interaction notes (FolderService "interaction").
// Note: creating an Interaction does not touch the people involved — updating
// last_contacted / times_met is an orchestration step (see person-actions.logTalk).

import { linkName, linkTarget } from "../core/markdown";
import {
  CarnegieKey, Interaction, INTERACTION_ID_PREFIX, INTERACTION_NOTE_TYPE, INTERACTION_SCHEMA_VERSION,
} from "../models/Interaction";
import { Checker } from "./Checker";
import type { MarkdownStore } from "./MarkdownStore";
import { NoteKind, NoteRecord, NoteRepository } from "./NoteRepository";

type Managed = "id" | "id_prefix" | "schema_version" | "created" | "created_date" | "updated" | "type";
export type NewInteractionData = Omit<Interaction, Managed | "title"> & { title?: string };
/** Partial update. A key set to `undefined` removes that property. */
export type InteractionPatch = Partial<Omit<Interaction, Managed>>;

const CARNEGIE: readonly CarnegieKey[] = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"];

const KIND: NoteKind = {
  label: "interaction",
  folder: "interaction",
  idPrefix: INTERACTION_ID_PREFIX,
  noteType: INTERACTION_NOTE_TYPE,
  schemaVersion: INTERACTION_SCHEMA_VERSION,
  managed: ["id", "id_prefix", "schema_version", "created", "created_date", "updated", "type"],
  required: ["title", "date", "interaction_type", "people"],
  validate(rec) {
    const c = new Checker(rec);
    c.text("title").date("date", true).text("interaction_type", true)
      .oneOf("direction", ["outbound", "inbound", "mutual"])
      .number("duration_minutes", 0)
      .list("people", { required: true, nonEmpty: true })
      .text("place_name").text("location").text("summary").text("learned").text("next_step").text("meeting")
      .number("presence", 0, 5).number("energy", 0, 5)
      .list("carnegie_used", { allowed: CARNEGIE })
      .list("related_projects").list("related_goals").list("tags");
    return c.issues;
  },
  defaultTitle(rec) {
    const people = rec.people as string[];
    return `${rec.interaction_type} with ${linkName(people[0])}${people.length > 1 ? ` +${people.length - 1}` : ""}`;
  },
  fileBase: rec => `${rec.date} ${rec.title}`,
};

export class InteractionRepository extends NoteRepository<Interaction> {
  constructor(store: MarkdownStore, onChanged: () => void = () => {}) { super(store, KIND, onChanged); }

  getInteraction(path: string)      { return this.get(path); }
  getInteractionById(id: string)    { return this.getById(id); }
  createInteraction(data: NewInteractionData, body?: string) { return this.create(data, body); }
  updateInteraction(path: string, patch: InteractionPatch)   { return this.update(path, patch); }
  deleteInteraction(path: string)   { return this.delete(path); }

  /** Interactions involving a person, given their name or a wikilink ("Jane Doe" / "[[Jane Doe]]"). */
  listForPerson(person: string): NoteRecord<Interaction>[] {
    const target = linkTarget(person);
    return this.list().filter(r => r.data.people.some(l => linkTarget(l) === target));
  }
}
