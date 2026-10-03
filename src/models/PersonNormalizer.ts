// ─── PersonNormalizer ─────────────────────────────────────────────────────────
// Frontmatter → canonical Person. The ONE place a note is interpreted: used by
// PersonRepository (reads) and PeopleIndex (cache), so they can never disagree.
//
// Canonical keys win over legacy aliases; values are coerced to the registry type;
// fields an old note lacks get in-memory defaults (schema_version 0 = not migrated).
// Pure: never writes.

import type { Person } from "./Person";
import { PERSON_ID_PREFIX, PERSON_NOTE_TYPE } from "./Person";
import { coerceValue } from "./PropertyValidation";
import type { SchemaRegistry } from "./SchemaRegistry";
import { personSchema } from "./SchemaRegistry";

export type FM = Record<string, unknown>;
export interface NoteMeta { basename: string; ctime: number; mtime: number; }

export function normalizePerson(fm: FM, meta: NoteMeta, registry: SchemaRegistry = personSchema): Person {
  const out: FM = {};
  for (const def of registry.all()) {
    for (const k of [def.key, ...(def.legacyKeys ?? [])]) {
      const v = coerceValue(def, fm[k]);
      if (v !== undefined) { out[def.key] = v; break; }
    }
  }
  const created = (out.created as string | undefined) ?? new Date(meta.ctime).toISOString();
  const name = (out.name as string | undefined) ?? (out.display_name as string | undefined) ?? meta.basename;
  return {
    ...out,
    id: (out.id as string | undefined) ?? "",
    id_prefix: PERSON_ID_PREFIX,
    schema_version: (out.schema_version as number | undefined) ?? 0,
    created,
    created_date: (out.created_date as string | undefined) ?? created.slice(0, 10),
    updated: (out.updated as string | undefined) ?? new Date(meta.mtime).toISOString(),
    type: PERSON_NOTE_TYPE,
    title: (out.title as string | undefined) ?? meta.basename,
    display_name: (out.display_name as string | undefined) ?? name,
    name,
  } as Person;
}
