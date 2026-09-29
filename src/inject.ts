import { App, moment, Notice, TFile } from "obsidian";
import type PeopleHubPlugin from "./main";
import { nextBirthday, today } from "./dates";
import type { PluginSettings } from "./types";
import { fmtShort, relDays } from "./ui";

const START = "<!-- people-hub:birthdays -->";
const END = "<!-- /people-hub:birthdays -->";

/** Daily-note folder/format: plugin settings first, then Obsidian's core Daily Notes plugin, then defaults. */
export function dailyConfig(app: App, s: PluginSettings): { folder: string; format: string } {
  const core = (app as any).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options ?? {};
  return {
    folder: String(s.dailyNoteFolder || core.folder || "").replace(/^\/+|\/+$/g, ""),
    format: String(s.dailyNoteFormat || core.format || "YYYY-MM-DD")
  };
}

/** The date a daily note represents, or null if the file isn't a daily note. */
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

export function buildBlock(plugin: PeopleHubPlugin, noteDate: Date): string {
  const s = plugin.settings;
  const rows = plugin.index.all()
    .filter(p => p.birthdate && p.active)
    .map(p => ({ p, b: nextBirthday(p.birthdate!, noteDate) }))
    .filter(x => x.b.days <= s.injectLookahead)
    .sort((a, b) => a.b.days - b.b.days);
  if (!rows.length) return "";
  const lines = rows.map(({ p, b }) => {
    const age = b.age !== null ? ` · turns ${b.age}` : "";
    return b.days === 0
      ? `- 🎂 [[${p.file.basename}]] — **today** 🎉${age}`
      : `- 🎂 [[${p.file.basename}]] — ${relDays(b.days)} · ${fmtShort(b.date)}${age}`;
  });
  return `${START}\n${s.injectHeading.trim()}\n\n${lines.join("\n")}\n${END}`;
}

export function applyBlock(data: string, block: string, position: "top" | "bottom"): string {
  const re = new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`);
  if (re.test(data)) {
    if (!block) return data.replace(re, "\n");
    return data.replace(re, m => `${m.startsWith("\n") ? "\n" : ""}${block}${m.endsWith("\n") ? "\n" : ""}`);
  }
  if (!block) return data;
  if (position === "bottom") return `${data.replace(/\s*$/, "")}\n\n${block}\n`;
  const fm = data.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const head = fm ? fm[0] : "";
  const rest = data.slice(head.length).replace(/^\n+/, "");
  return `${head}${block}\n\n${rest}`;
}

/** Idempotently write today's/upcoming birthdays into a daily note. */
export async function injectBirthdays(plugin: PeopleHubPlugin, file: TFile, opts: { announce?: boolean } = {}): Promise<boolean> {
  const date = dailyNoteDate(plugin.app, plugin.settings, file);
  if (!date) { if (opts.announce) new Notice("People Hub: this doesn't look like a daily note (check folder/format in settings)"); return false; }
  const block = buildBlock(plugin, date);
  let changed = false;
  await plugin.app.vault.process(file, data => {
    const next = applyBlock(data, block, plugin.settings.injectPosition);
    changed = next !== data;
    return next;
  });
  if (opts.announce) new Notice(changed ? "People Hub: birthdays updated" : block ? "People Hub: already up to date" : "People Hub: no birthdays to show");
  return changed;
}

/** Auto-inject when today's daily note is opened. */
export function isTodayNote(plugin: PeopleHubPlugin, file: TFile): boolean {
  const d = dailyNoteDate(plugin.app, plugin.settings, file);
  return !!d && d.getTime() === today().getTime();
}
