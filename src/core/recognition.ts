// ─── Person recognition ───────────────────────────────────────────────────────
// Pure: decides whether a note is a person. One definition, used by PeopleIndex
// (and through it by the repositories).
//
// A note is a person if it has frontmatter and is not in an excluded folder, and:
//   1. `type:` equals the configured person type (default "person"), OR
//   2. `tags:` contains `type/<person type>` (list or comma/space separated string), OR
//   3. it has NO `type` and lives in the People folder (when folder detection is on).
// A note with some other explicit `type` is not a person (unless a type/person tag says so).

export interface RecognitionConfig {
  personType: string;
  excludeFolders: string;   // comma-separated
  peopleFolder: string;     // normalised, no trailing slash
  detectByFolder: boolean;
}

type FM = Record<string, unknown>;

function lower(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/** Frontmatter tags as clean lower-case strings without a leading '#'. */
export function frontmatterTags(fm: FM): string[] {
  const raw = fm.tags ?? fm.tag;
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  return items
    .filter((t): t is string => typeof t === "string")
    .map(t => t.trim().replace(/^#/, "").toLowerCase())
    .filter(Boolean);
}

export function isPersonNote(path: string, fm: FM | undefined, cfg: RecognitionConfig): boolean {
  if (!fm) return false;
  const excluded = cfg.excludeFolders.split(",").map(x => x.trim()).filter(Boolean);
  if (excluded.some(f => path.startsWith(f + "/"))) return false;

  const wanted = cfg.personType.trim().toLowerCase() || "person";
  const type = lower(fm.type);
  if (type === wanted) return true;
  if (frontmatterTags(fm).includes(`type/${wanted}`)) return true;
  if (type) return false;
  return cfg.detectByFolder && !!cfg.peopleFolder && path.startsWith(cfg.peopleFolder + "/");
}
