// ─── Photo resolution (Obsidian side) ─────────────────────────────────────────
import { App, TFile } from "obsidian";
import { parsePhotoRef } from "../core/photo";

/** URL for an <img> showing the person's photo, or null if there is none / it can't be found. */
export function resolvePhotoSrc(app: App, raw: string | undefined, sourcePath: string): string | null {
  const ref = parsePhotoRef(raw);
  if (!ref) return null;
  if (ref.kind === "url") return ref.value;
  const file = app.metadataCache.getFirstLinkpathDest(ref.value, sourcePath)
    ?? app.vault.getAbstractFileByPath(ref.value);
  return file instanceof TFile ? app.vault.getResourcePath(file) : null;
}
