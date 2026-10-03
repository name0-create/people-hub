// ─── Photo reference parsing ──────────────────────────────────────────────────
// The `photo` property may hold: a URL, a data URI, a wikilink ("[[a.jpg]]"), an embed
// ("![[a.jpg|200]]"), a markdown image ("![](folder/a.jpg)") or a plain vault path.
// Pure: turns it into either a URL to use as-is or a link target to resolve in the vault.

export type PhotoRef = { kind: "url"; value: string } | { kind: "link"; value: string };

export function parsePhotoRef(raw: string | undefined | null): PhotoRef | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^(https?:|data:image\/)/i.test(v)) return { kind: "url", value: v };

  const wiki = v.match(/^!?\[\[([^\]]+)\]\]$/);
  if (wiki) {
    const target = wiki[1].split("|")[0].split("#")[0].trim();
    return target ? { kind: "link", value: target } : null;
  }
  const md = v.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
  if (md) {
    const href = md[1].trim().replace(/^<|>$/g, "");
    if (/^https?:/i.test(href)) return { kind: "url", value: href };
    try { return { kind: "link", value: decodeURIComponent(href) }; } catch { return { kind: "link", value: href }; }
  }
  return { kind: "link", value: v };
}
