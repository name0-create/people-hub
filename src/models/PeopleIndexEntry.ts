// ─── PeopleIndexEntry ─────────────────────────────────────────────────────────
// The flat, list-friendly record the People index caches for each person note.
// It is a CACHE: every value is derived from the note's frontmatter and is rebuilt
// from it at any time. Nothing here is ever written back; the Markdown note stays
// the only source of truth.
//
// Conventions
//   • Absent text → "", absent list → [], absent date → null (never undefined).
//   • Dates are ISO "YYYY-MM-DD"; `birthday` may be year-less ("--MM-DD").
//   • Wikilinks in `company` are reduced to their display text.

export interface PeopleIndexEntry {
  path: string;                    // vault path of the note (the index key)
  id: string;                      // frontmatter `id` ("" for notes that predate ids)
  name: string;
  display_name: string;            // falls back to `name`
  photo: string;                   // raw frontmatter value; the UI resolves it
  favorite: boolean;
  relationship_type: string[];     // v0.2 `type_person` "friend+mentor" → ["friend", "mentor"]
  company: string[];
  role: string;
  status: string;                  // lower-cased; "active" when absent
  birthday: string | null;         // "YYYY-MM-DD" or "--MM-DD"
  last_contacted: string | null;
  next_encounter: string | null;   // as written in the note (no computed fallback)
  cadence: string;
  importance: string;
  tags: string[];                  // without leading "#"
}

/** What changed in the index. Listeners use it to refresh only what is affected. */
export type IndexChange =
  | { kind: "rebuild" }                              // everything may have changed
  | { kind: "upsert"; path: string }                 // person added or updated
  | { kind: "remove"; path: string }                 // person deleted / no longer a person
  | { kind: "rename"; path: string; oldPath: string };
