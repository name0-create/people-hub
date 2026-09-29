import { App, getLinkpath, moment, TFile } from "obsidian";
import type { CachedMetadata } from "obsidian";
import { parseDate, today } from "./dates";
import type { ContactRef, PluginSettings } from "./types";

/** Daily-note folder/format: plugin settings first, then Obsidian's core Daily Notes plugin, then defaults. */
export function dailyConfig(app: App, s: PluginSettings): { folder: string; format: string } {
  const core = (app as any).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options ?? {};
  return {
    folder: String(s.dailyNoteFolder || core.folder || "").replace(/^\/+|\/+$/g, ""),
    format: String(s.dailyNoteFormat || core.format || "YYYY-MM-DD")
  };
}

/** The date a daily note represents (from its path), or null if the file isn't a daily note. */
export function dailyNoteDate(app: App, s: PluginSettings, file: TFile): Date | null {
  if (file.extension !== "md") return null;
  const { folder, format } = dailyConfig(app, s);
  let rel = file.path.replace(/\.md$/i, "");
  if (folder) {
    if (!rel.startsWith(folder + "/")) return null;
    rel = rel.slice(folder.length + 1);
  }
  const m = moment(rel, format, true);
  if (!m.isValid()) return null;
  const d = m.toDate();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Filename date first; otherwise a frontmatter date field (note-per-meeting workflows). */
export function journalDate(app: App, s: PluginSettings, file: TFile, cache?: CachedMetadata | null): Date | null {
  const d = dailyNoteDate(app, s, file);
  if (d) return d;
  const key = s.journalDateField.trim();
  const fm = (cache ?? app.metadataCache.getFileCache(file))?.frontmatter;
  return key && fm ? parseDate(fm[key]) : null;
}

/** Lines whose links must NOT count as contact: unchecked/cancelled to-dos and quotes. */
function excludedLines(cache: CachedMetadata): Set<number> {
  const skip = new Set<number>();
  for (const li of cache.listItems ?? []) {
    if (li.task === " " || li.task === "-") for (let l = li.position.start.line; l <= li.position.end.line; l++) skip.add(l);
  }
  for (const sec of cache.sections ?? []) {
    if (sec.type === "blockquote") for (let l = sec.position.start.line; l <= sec.position.end.line; l++) skip.add(l);
  }
  return skip;
}

export interface JournalEntry { recent: ContactRef[]; total: number; }

/**
 * Reads [[links]] in dated notes as interactions. Embeds, code blocks, quotes and unchecked
 * to-dos don't count. Uses only Obsidian's metadata cache (no disk reads).
 */
export function buildJournal(app: App, s: PluginSettings, isPersonFile: (f: TFile) => boolean): Map<string, JournalEntry> {
  const out = new Map<string, JournalEntry>();
  const t = today().getTime();
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache?.links?.length) continue;
    const date = journalDate(app, s, file, cache);
    if (!date || date.getTime() > t) continue;
    if (isPersonFile(file)) continue;
    const skip = excludedLines(cache);
    const seen = new Set<string>();
    for (const l of cache.links) {
      if (skip.has(l.position.start.line)) continue;
      const dest = app.metadataCache.getFirstLinkpathDest(getLinkpath(l.link), file.path);
      if (!dest || dest.path === file.path || seen.has(dest.path)) continue;
      seen.add(dest.path);
      let e = out.get(dest.path);
      if (!e) { e = { recent: [], total: 0 }; out.set(dest.path, e); }
      e.total++;
      e.recent.push({ date, path: file.path });
    }
  }
  for (const e of out.values()) {
    e.recent.sort((a, b) => b.date.getTime() - a.date.getTime());
    e.recent = e.recent.slice(0, 5);
  }
  return out;
}
