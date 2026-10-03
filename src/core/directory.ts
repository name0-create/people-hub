// ─── Directory (main-window People page) logic ────────────────────────────────
// Pure: search, filters, sorting and display helpers over IndexEntry records.

import type { IndexEntry } from "../models/IndexEntry";

export type SortKey = "name-asc" | "name-desc" | "last-newest" | "last-oldest" | "next-soonest" | "favorites";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name-asc",     label: "Name (ascending)" },
  { key: "name-desc",    label: "Name (descending)" },
  { key: "last-newest",  label: "Last contact (newest)" },
  { key: "last-oldest",  label: "Last contact (oldest)" },
  { key: "next-soonest", label: "Next encounter (soonest)" },
  { key: "favorites",    label: "Favorites first" },
];

export interface DirectoryQuery {
  text: string;
  company: string;   // "" = all
  tag: string;       // "" = all
  sort: SortKey;
}

export const DEFAULT_QUERY: DirectoryQuery = { text: "", company: "", tag: "", sort: "name-asc" };

/** Statuses the directory hides: people moved to the archive. */
const HIDDEN_STATUSES = new Set(["archived"]);

/** Tags the plugin adds itself — useless as filters. */
const isAutoTag = (t: string) => /^(type|status)\//i.test(t);

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function listable(entries: IndexEntry[]): IndexEntry[] {
  return entries.filter(e => !HIDDEN_STATUSES.has(e.status));
}

/** Case-insensitive match over name, display name, company, role, relationship type and tags. */
export function matchesText(e: IndexEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [e.name, e.display_name, e.role ?? "", ...e.company, ...e.relationship_type, ...e.tags]
    .some(v => v.toLowerCase().includes(q));
}

export function companyOptions(entries: IndexEntry[]): string[] {
  return uniqueSorted(entries.flatMap(e => e.company));
}

export function tagOptions(entries: IndexEntry[]): string[] {
  return uniqueSorted(entries.flatMap(e => e.tags).filter(t => !isAutoTag(t)));
}

function uniqueSorted(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values.map(x => x.trim()).filter(Boolean)) if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()].sort(collator.compare);
}

/** Missing dates sort last in either direction. */
function byDate(get: (e: IndexEntry) => string | undefined, dir: 1 | -1) {
  return (a: IndexEntry, b: IndexEntry) => {
    const x = get(a), y = get(b);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x < y ? -dir : x > y ? dir : 0;
  };
}

export function filterAndSort(entries: IndexEntry[], q: DirectoryQuery): IndexEntry[] {
  const company = q.company.toLowerCase();
  const tag = q.tag.toLowerCase();
  const rows = listable(entries).filter(e =>
    matchesText(e, q.text) &&
    (!company || e.company.some(c => c.toLowerCase() === company)) &&
    (!tag || e.tags.some(t => t.toLowerCase() === tag)));

  const byName = (a: IndexEntry, b: IndexEntry) => collator.compare(a.name, b.name) || a.path.localeCompare(b.path);
  const cmp: Record<SortKey, (a: IndexEntry, b: IndexEntry) => number> = {
    "name-asc":     byName,
    "name-desc":    (a, b) => byName(b, a),
    "last-newest":  (a, b) => byDate(e => e.last_contacted, -1)(a, b) || byName(a, b),
    "last-oldest":  (a, b) => byDate(e => e.last_contacted, 1)(a, b) || byName(a, b),
    "next-soonest": (a, b) => byDate(e => e.next_encounter, 1)(a, b) || byName(a, b),
    "favorites":    (a, b) => Number(b.favorite) - Number(a.favorite) || byName(a, b),
  };
  return rows.sort(cmp[q.sort]);
}

/** "Aurelia Karagai" → "AK"; "Almak" → "AL"; "" → "?". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[1]][0]];
  return letters.join("").toUpperCase();
}
