// ─── PersonProperty ───────────────────────────────────────────────────────────
// What a single frontmatter property *is*: its type, whether the UI may edit it,
// which Meta Bind control renders it, and whether it is searchable/filterable.
//
// Definitions live in SchemaRegistry.ts — never define a property anywhere else.
// Pure types, no Obsidian API dependency.

/** Logical property types. These drive validation, UI and (via metaBindControl) Meta Bind. */
export type PropertyType =
  | "text"         // single-line string
  | "longtext"     // multi-line string
  | "number"
  | "boolean"
  | "date"         // YYYY-MM-DD
  | "datetime"     // ISO 8601 timestamp
  | "select"       // one value from `options`
  | "multiselect"  // several values from `options`
  | "list"         // free-form list of strings
  | "links";       // list of wikilinks, e.g. "[[Acme]]"

/**
 * Meta Bind input-field identifiers (the part before the colon in `INPUT[text:name]`).
 * Mirrors Meta Bind's InputFieldType enum. Verify against the version you target.
 */
export type MetaBindControl =
  | "text" | "textArea" | "number" | "toggle"
  | "date" | "datePicker" | "dateTime" | "time"
  | "select" | "inlineSelect" | "multiSelect" | "suggester"
  | "list" | "inlineList" | "listSuggester" | "inlineListSuggester"
  | "slider" | "progressBar" | "editor" | "imageSuggester" | "imageListSuggester";

/** UI grouping — one entry per section of the person editor. */
export type PropertyGroup =
  | "system"
  | "identity"
  | "contact"
  | "social"
  | "place"
  | "work"
  | "organisation"
  | "links"
  | "relationship"
  | "encounters"
  | "dates"
  | "context"
  | "meta";

export interface PropertyDefinition {
  /** Frontmatter key, exactly as stored in the note. */
  key: string;
  /** Human label for forms and column headers. */
  label: string;
  type: PropertyType;
  group: PropertyGroup;

  /** May the user edit it in the UI? `false` = plugin-managed (id, timestamps…). */
  editable: boolean;
  /** Must be present on every valid person note. */
  required?: boolean;

  /** Meta Bind control used when generating editable fields. Omit for non-editable properties. */
  metaBindControl?: MetaBindControl;

  /** Included in free-text search. */
  searchable: boolean;
  /** Offered as a filter / usable in views. */
  filterable: boolean;

  /** Allowed values for `select` / `multiselect`. */
  options?: readonly string[];
  /** If true, values outside `options` are accepted (options become suggestions). */
  allowCustom?: boolean;

  /** `date` only: also accept a year-less "--MM-DD" (e.g. birthdays without a known year). */
  partialDate?: boolean;

  /** Value written when a new person is created. */
  default?: string | number | boolean;

  /**
   * Older frontmatter keys that mean the same thing. Used when reading existing
   * notes and by migrations (legacy key → canonical key). Ordered by priority.
   */
  legacyKeys?: readonly string[];

  /** True for user-defined properties added at runtime (not part of the Person interface). */
  custom?: boolean;

  description?: string;
}
