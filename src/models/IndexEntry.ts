// ─── IndexEntry ───────────────────────────────────────────────────────────────
// The lean record PeopleIndex keeps per person. It is a CACHE: derived entirely
// from the note's frontmatter (via normalizePerson), never persisted, never the
// place a value is edited. Lose it and it is rebuilt from the vault.

import type { Person } from "./Person";

export interface IndexEntry {
  path: string;
  id: string;
  name: string;
  display_name: string;
  photo?: string;
  favorite: boolean;
  relationship_type: string[];
  company: string[];
  role?: string;
  status: string;            // lower-case; "active" when absent
  birthday?: string;         // as stored: YYYY-MM-DD or --MM-DD
  last_contacted?: string;
  next_encounter?: string;
  cadence?: string;
  importance?: string;
  tags: string[];
}

export function toIndexEntry(path: string, p: Person): IndexEntry {
  return {
    path,
    id: p.id,
    name: p.name,
    display_name: p.display_name,
    photo: p.photo,
    favorite: p.favorite ?? false,
    relationship_type: p.relationship_type ?? [],
    company: p.company ?? [],
    role: p.role,
    status: (p.status ?? "active").toLowerCase(),
    birthday: p.birthdate,
    last_contacted: p.last_contacted,
    next_encounter: p.next_encounter,
    cadence: p.cadence,
    importance: p.importance,
    tags: p.tags ?? [],
  };
}
