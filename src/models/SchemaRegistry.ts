// ─── SchemaRegistry ───────────────────────────────────────────────────────────
// The ONE place property definitions live. Validation, UI rendering, Meta Bind
// generation, search, filtering and migrations all read from here — nothing else
// may hard-code a property list.
//
// The definitions are typed against the Person interface, so the compiler enforces:
//   • every key of Person has a definition (add a field → build fails until registered)
//   • no definition exists for a key Person doesn't have
//   • a definition's `type` is compatible with the field's TypeScript type
//     (e.g. `wins: string[]` can only be list | links | multiselect)
//   • REQUIRED_PERSON_KEYS matches exactly the non-optional fields of Person
//
// Pure module — no Obsidian API dependency.

import type { Person, RequiredPersonKey } from "./Person";
import { PERSON_ID_PREFIX, PERSON_NOTE_TYPE, PERSON_SCHEMA_VERSION } from "./Person";
import type {
  MetaBindControl, PropertyDefinition, PropertyGroup, PropertyType,
} from "./PersonProperty";
import { TIERS } from "./person-view";

// ── Type-level guards ─────────────────────────────────────────────────────────
type AllowedTypes<V> =
  [NonNullable<V>] extends [string[]] ? "list" | "links" | "multiselect" :
  [NonNullable<V>] extends [boolean]  ? "boolean" :
  [NonNullable<V>] extends [number]   ? "number" :
  "text" | "longtext" | "date" | "datetime" | "select";

type Base  = Omit<PropertyDefinition, "key" | "type" | "required">;
type Entry<T extends PropertyType> = Base & { type: T };
type Extra = Partial<Omit<Base, "label" | "group">>;

type PersonSchema = { [K in keyof Person]-?: Base & { type: AllowedTypes<Person[K]> } };

/** Fields that must exist on every person note. Checked against the interface below. */
export const REQUIRED_PERSON_KEYS = [
  "id", "id_prefix", "schema_version",
  "created", "created_date", "updated",
  "type", "title", "display_name", "name",
] as const satisfies readonly (keyof Person)[];

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _requiredKeysMatchInterface: Equal<RequiredPersonKey, typeof REQUIRED_PERSON_KEYS[number]> = true;
void _requiredKeysMatchInterface;

// ── Definition helpers (keep the table below readable) ────────────────────────
const text = (label: string, group: PropertyGroup, o: Extra = {}): Entry<"text"> => ({
  type: "text", label, group,
  editable: true, metaBindControl: "text", searchable: true, filterable: false, ...o,
});
const longtext = (label: string, group: PropertyGroup, o: Extra = {}): Entry<"longtext"> => ({
  type: "longtext", label, group,
  editable: true, metaBindControl: "textArea", searchable: true, filterable: false, ...o,
});
const bool = (label: string, group: PropertyGroup, o: Extra = {}): Entry<"boolean"> => ({
  type: "boolean", label, group,
  editable: true, metaBindControl: "toggle", searchable: false, filterable: true, ...o,
});
const num = (label: string, group: PropertyGroup, o: Extra = {}): Entry<"number"> => ({
  type: "number", label, group,
  editable: true, metaBindControl: "number", searchable: false, filterable: true, ...o,
});
const date = (label: string, group: PropertyGroup, o: Extra = {}): Entry<"date"> => ({
  type: "date", label, group,
  editable: true, metaBindControl: "date", searchable: false, filterable: true, ...o,
});
const select = (
  label: string, group: PropertyGroup, options: readonly string[], o: Extra = {},
): Entry<"select"> => ({
  type: "select", label, group, options,
  editable: true, metaBindControl: "select", searchable: false, filterable: true, ...o,
});
const multiselect = (
  label: string, group: PropertyGroup, options: readonly string[], o: Extra = {},
): Entry<"multiselect"> => ({
  type: "multiselect", label, group, options,
  editable: true, metaBindControl: "inlineListSuggester", searchable: true, filterable: true, ...o,
});
const list = (label: string, group: PropertyGroup, o: Extra = {}): Entry<"list"> => ({
  type: "list", label, group,
  editable: true, metaBindControl: "inlineList", searchable: true, filterable: true, ...o,
});
const links = (label: string, group: PropertyGroup, o: Extra = {}): Entry<"links"> => ({
  type: "links", label, group,
  editable: true, metaBindControl: "inlineListSuggester", searchable: true, filterable: true, ...o,
});
/** Plugin-managed property: never editable in the UI, no Meta Bind control. */
const system = <T extends PropertyType>(
  type: T, label: string, o: Extra = {},
): Entry<T> => ({
  type, label, group: "system",
  editable: false, searchable: false, filterable: false, ...o,
});

// ── Vocabularies ──────────────────────────────────────────────────────────────
// Sourced from what the plugin already uses (settings tiers, repository status
// handling, createPerson cadences, TYPE_TIER keys). The vocabularies marked
// PLACEHOLDER are proposals — allowCustom is on so nothing is rejected.
const STATUS_OPTIONS = ["active", "paused", "archived", "inactive", "lost", "deceased"] as const;
const CADENCE_OPTIONS = ["daily", "weekly", "monthly", "quarterly"] as const;
const RELATIONSHIP_TYPE_OPTIONS = [
  "family", "partner", "spouse", "friend", "close-friend", "mentor", "client", "prospect",
  "colleague", "manager", "school-mate", "acquaintance", "author", "celebrity",
] as const;
const RELATIONSHIP_STATUS_OPTIONS = ["new", "growing", "stable", "drifting", "dormant", "strained"] as const; // PLACEHOLDER
const RELATIONSHIP_DIRECTION_OPTIONS = ["mutual", "i_reach_out", "they_reach_out"] as const;                  // PLACEHOLDER
const CONTACTABILITY_OPTIONS = ["easy", "moderate", "hard"] as const;                                          // PLACEHOLDER
const IMPORTANCE_OPTIONS = ["low", "medium", "high", "critical"] as const;                                     // PLACEHOLDER

// ── The person schema ─────────────────────────────────────────────────────────
// Order = display order (within each group) and the order in generated forms.
// `legacyKeys` = keys used by the v0.2 plugin / older vault notes, for migrations.
const PERSON_SCHEMA: PersonSchema = {
  // System
  id:             system("text", "ID", { searchable: true }),
  id_prefix:      system("text", "ID prefix", { default: PERSON_ID_PREFIX }),
  schema_version: system("number", "Schema version", { filterable: true, default: PERSON_SCHEMA_VERSION }),
  created:        system("datetime", "Created"),
  created_date:   system("date", "Created (date)", { filterable: true }),
  updated:        system("datetime", "Updated"),
  type:           system("text", "Note type", { filterable: true, default: PERSON_NOTE_TYPE }),

  // Identity
  title:          text("Title", "identity", {
    editable: false, metaBindControl: undefined,
    description: "Kept in sync with the note file name by the plugin.",
  }),
  display_name:   text("Display name", "identity"),
  name:           text("Name", "identity", { legacyKeys: ["full_name"], description: "Full name." }),
  preferred_name: text("Preferred name", "identity"),
  aliases:        list("Aliases", "identity", { filterable: false }),
  first_name:     text("First name", "identity"),
  last_name:      text("Last name", "identity"),
  nickname:       text("Nickname", "identity"),
  favorite:       bool("Favorite", "identity", { default: false }),
  photo:          text("Photo", "identity", { searchable: false, description: "Vault path or URL of an image." }),
  gender:         text("Gender", "identity", { filterable: true }),

  // Contact
  phone:          text("Phone", "contact"),
  email:          text("Email", "contact"),

  // Social
  instagram:      text("Instagram", "social", { legacyKeys: ["ig"] }),
  linkedin:       text("LinkedIn", "social"),
  youtube:        text("YouTube", "social"),
  x_twitter:      text("X / Twitter", "social"),

  // Place
  place_name:     text("Place name", "place"),
  address:        text("Address", "place"),
  location:       text("Location", "place", { filterable: true, description: "City / region." }),

  // Work
  company:        list("Company", "work"),
  role:           text("Role", "work", { legacyKeys: ["job_title"], filterable: true }),

  // Organisation
  category:       list("Category", "organisation"),
  groups:         list("Groups", "organisation"),
  prm_tier:       select("PRM tier", "organisation", TIERS, { legacyKeys: ["prm-tier", "circle", "tier"] }),
  prm_paused:     bool("PRM paused", "organisation", { default: false }),

  // Links
  related_projects: links("Related projects", "links"),
  related_goals:    links("Related goals", "links"),
  related_habits:   links("Related habits", "links"),
  linked_ideas:     links("Linked ideas", "links"),
  linked_people:    links("Linked people", "links"),

  status:         select("Status", "organisation", STATUS_OPTIONS, { allowCustom: true, default: "active" }),

  // Relationship
  relationship_type:      multiselect("Relationship type", "relationship", RELATIONSHIP_TYPE_OPTIONS, {
    allowCustom: true, legacyKeys: ["type_person", "type_person_primary"],
    description: "Legacy type_person held values like \"friend+mentor\"; a migration must split them.",
  }),
  relationship_status:    select("Relationship status", "relationship", RELATIONSHIP_STATUS_OPTIONS, { allowCustom: true }),
  relationship_direction: select("Relationship direction", "relationship", RELATIONSHIP_DIRECTION_OPTIONS, { allowCustom: true }),
  contactability:         select("Contactability", "relationship", CONTACTABILITY_OPTIONS, { allowCustom: true }),
  importance:             select("Importance", "relationship", IMPORTANCE_OPTIONS, { allowCustom: true }),

  cadence:                select("Cadence", "relationship", CADENCE_OPTIONS, { allowCustom: true, legacyKeys: ["frequency"] }),
  first_encounter_date:   date("First encounter", "encounters", { legacyKeys: ["met_date"] }),
  last_contacted:         date("Last contacted", "encounters", { legacyKeys: ["last_contact"] }),

  next_encounter:         date("Next encounter", "encounters", {
    legacyKeys: ["next_contact", "next_action_date"],
    description: "v0.2 wrote a computed reach-out due date to next_contact; decide during migration whether that is an encounter.",
  }),
  next_encounter_place:   text("Next encounter place", "encounters"),
  next_encounter_purpose: text("Next encounter purpose", "encounters", { legacyKeys: ["next_action"] }),

  times_met:      num("Times met", "relationship", { default: 0 }),
  met_through:    text("Met through", "relationship"),
  met_location:   text("Met at", "relationship", { legacyKeys: ["where_met"] }),

  // Dates
  birthdate:      date("Birthdate", "dates", { partialDate: true, legacyKeys: ["birthday", "birth_date", "dob"] }),
  anniversary:    date("Anniversary", "dates", { partialDate: true, legacyKeys: ["friendiversary", "wed_date", "anniversary_date"] }),

  // Context
  interests:           list("Interests", "context", { description: "v0.2 stored this as a single string." }),
  current_focus:       list("Current focus", "context"),
  how_i_can_help:      list("How I can help", "context"),
  things_to_remember:  longtext("Things to remember", "context"),
  conversation_topics: list("Conversation topics", "context"),
  open_loops:          list("Open loops", "context"),
  promises:            list("Promises", "context"),
  wins:                list("Wins", "context"),

  // Meta
  tags:           list("Tags", "meta"),
};

/** Flat, ordered list of definitions with `key` and `required` filled in. */
export const PERSON_PROPERTIES: readonly PropertyDefinition[] = (
  Object.entries(PERSON_SCHEMA) as [keyof Person & string, Base & { type: PropertyType }][]
).map(([key, def]) => ({
  ...def,
  key,
  required: (REQUIRED_PERSON_KEYS as readonly string[]).includes(key),
}));

// ── Registry ──────────────────────────────────────────────────────────────────
export class SchemaRegistry {
  private byKey = new Map<string, PropertyDefinition>();
  /** legacy key → canonical key */
  private legacy = new Map<string, string>();

  constructor(definitions: readonly PropertyDefinition[] = []) {
    for (const d of definitions) this.add(d);
  }

  private add(def: PropertyDefinition): void {
    if (this.byKey.has(def.key)) throw new Error(`SchemaRegistry: duplicate property "${def.key}"`);
    if (this.legacy.has(def.key)) {
      throw new Error(`SchemaRegistry: "${def.key}" is already a legacy key of "${this.legacy.get(def.key)}"`);
    }
    for (const lk of def.legacyKeys ?? []) {
      if (this.byKey.has(lk) || lk === def.key) throw new Error(`SchemaRegistry: legacy key "${lk}" of "${def.key}" collides with a property`);
      if (this.legacy.has(lk)) throw new Error(`SchemaRegistry: legacy key "${lk}" is claimed by both "${this.legacy.get(lk)}" and "${def.key}"`);
    }
    this.byKey.set(def.key, def);
    for (const lk of def.legacyKeys ?? []) this.legacy.set(lk, def.key);
  }

  /** Register a user-defined property (future custom properties). */
  registerCustom(def: Omit<PropertyDefinition, "custom" | "required">): PropertyDefinition {
    const full: PropertyDefinition = { ...def, custom: true };
    this.add(full);
    return full;
  }

  // ── Lookup ──────────────────────────────────────────────────────────────
  get(key: string): PropertyDefinition | undefined { return this.byKey.get(key); }
  has(key: string): boolean { return this.byKey.has(key); }
  all(): PropertyDefinition[] { return [...this.byKey.values()]; }
  keys(): string[] { return [...this.byKey.keys()]; }

  /** Map a canonical OR legacy key to its canonical key. Undefined if unknown. */
  resolveKey(key: string): string | undefined {
    return this.byKey.has(key) ? key : this.legacy.get(key);
  }
  /** Legacy key → canonical key pairs, for migrations. */
  legacyMap(): ReadonlyMap<string, string> { return this.legacy; }

  // ── Views used by the rest of the plugin ────────────────────────────────
  editable():   PropertyDefinition[] { return this.all().filter(d => d.editable); }
  required():   PropertyDefinition[] { return this.all().filter(d => d.required); }
  searchable(): PropertyDefinition[] { return this.all().filter(d => d.searchable); }
  filterable(): PropertyDefinition[] { return this.all().filter(d => d.filterable); }
  byGroup(group: PropertyGroup): PropertyDefinition[] { return this.all().filter(d => d.group === group); }
  byType(type: PropertyType): PropertyDefinition[] { return this.all().filter(d => d.type === type); }
  custom():     PropertyDefinition[] { return this.all().filter(d => d.custom); }
}

/** The person schema. Import this; don't build new registries for persons. */
export const personSchema = new SchemaRegistry(PERSON_PROPERTIES);

// Re-export for convenience so consumers need one import.
export type { MetaBindControl };
