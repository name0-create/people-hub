// ─── Markdown body helpers ────────────────────────────────────────────────────
// Pure string helpers for the note BODY (never frontmatter — that always goes
// through Obsidian's processFrontMatter).

/** Append `line` at the end of the section under `heading`, creating the section if missing. */
export function appendUnderHeading(data: string, heading: string, line: string): string {
  const lines = data.split("\n");
  const level = heading.match(/^#+/)?.[0].length ?? 2;
  const idx = lines.findIndex(l => l.trim().startsWith(heading.trim()));
  if (idx === -1) return data.replace(/\s*$/, "") + `\n\n${heading}\n\n${line}\n`;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if ((m && m[1].length <= level) || /^---\s*$/.test(lines[i])) { end = i; break; }
  }
  let ins = end;
  while (ins > idx + 1 && lines[ins - 1].trim() === "") ins--;
  lines.splice(ins, 0, line);
  if (ins === idx + 1) lines.splice(ins, 0, "");
  return lines.join("\n");
}

/** "[[Jane Doe|JD]]" / "[[Jane Doe#Heading]]" → "Jane Doe". */
export function linkName(link: string): string {
  return link.replace(/^\s*\[\[|\]\]\s*$/g, "").split("|")[0].split("#")[0].trim();
}

/** Lower-cased linkName, for comparing links. */
export function linkTarget(link: string): string {
  return linkName(link).toLowerCase();
}
