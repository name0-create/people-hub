// ─── Repository errors ────────────────────────────────────────────────────────
// Every failure the repository layer raises on purpose is a RepositoryError with a
// machine-readable `code`, so callers can react (or just show `describeError`).

export type RepositoryErrorCode =
  | "not_found"    // no file at that path / no note with that id
  | "not_a_note"   // file exists but is not a note of the expected kind
  | "conflict"     // target path already exists
  | "validation"   // patch / data failed schema validation
  | "io";          // Obsidian refused or failed the operation

export class RepositoryError extends Error {
  constructor(
    public readonly code: RepositoryErrorCode,
    message: string,
    public readonly details: string[] = [],
  ) {
    super(details.length ? `${message}: ${details.join("; ")}` : message);
    this.name = "RepositoryError";
  }
}

/** One-line, user-facing text for any thrown value. */
export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
