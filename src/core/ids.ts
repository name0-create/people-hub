// ─── IDs ──────────────────────────────────────────────────────────────────────
// Format: <PREFIX>-<time base36><3 random base36>, e.g. "PER-MG5K2X1A9F".
// Sortable by creation time, short, and safe to type in a wikilink or query.

export function generateId(
  prefix: string,
  taken: (id: string) => boolean = () => false,
  now: () => number = Date.now,
  rand: () => number = Math.random,
): string {
  for (let i = 0; i < 25; i++) {
    const suffix = Math.floor(rand() * 36 ** 3).toString(36).toUpperCase().padStart(3, "0");
    const id = `${prefix}-${now().toString(36).toUpperCase()}${suffix}`;
    if (!taken(id)) return id;
  }
  throw new Error(`Could not generate a unique ${prefix} id`);
}
