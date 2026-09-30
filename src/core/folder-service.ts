// ─── FolderService ────────────────────────────────────────────────────────────
// Single gatekeeper for all vault path operations.
// No feature reads settings.peopleFolder directly — it calls FolderService.

import { App, normalizePath, TFolder } from "obsidian";
import type { PeopleHubSettings } from "./settings";

export type FolderKey = "people" | "archive" | "interaction" | "meeting";

export class FolderService {
  constructor(private app: App, private getSettings: () => PeopleHubSettings) {}

  /** Normalized vault-relative path for a given folder key. */
  resolve(key: FolderKey): string {
    const s = this.getSettings();
    const raw =
      key === "people"      ? s.peopleFolder :
      key === "archive"     ? s.archiveFolder :
      key === "interaction" ? s.interactionFolder :
                              s.meetingFolder;
    return normalizePath(raw.trim().replace(/\/$/, ""));
  }

  /** Returns the TFolder if it exists, or null. */
  get(key: FolderKey): TFolder | null {
    const path = this.resolve(key);
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFolder ? f : null;
  }

  /** Returns true if the folder exists in the vault. */
  exists(key: FolderKey): boolean {
    return this.get(key) !== null;
  }

  /** Creates the folder (and any missing parents) if it does not exist. */
  async ensure(key: FolderKey): Promise<void> {
    const path = this.resolve(key);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    let cur = "";
    for (const seg of path.split("/")) {
      cur = cur ? `${cur}/${seg}` : seg;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur);
      }
    }
  }

  /** Returns all markdown files directly in a folder (non-recursive). */
  listFiles(key: FolderKey): string[] {
    const folder = this.get(key);
    if (!folder) return [];
    return folder.children
      .filter(c => c.name.endsWith(".md"))
      .map(c => c.path);
  }

  /** Returns whether a file path lives inside a given folder. */
  contains(key: FolderKey, filePath: string): boolean {
    const base = this.resolve(key);
    return filePath.startsWith(base + "/");
  }

  /** Validates all four folders; returns a list of problems (empty = ok). */
  validate(): string[] {
    const errs: string[] = [];
    const s = this.getSettings();
    for (const [label, val] of [
      ["People folder", s.peopleFolder],
      ["Archive folder", s.archiveFolder],
      ["Interaction folder", s.interactionFolder],
      ["Meeting folder", s.meetingFolder],
    ] as [string, string][]) {
      if (!val.trim()) errs.push(`${label} is empty.`);
    }
    return errs;
  }
}
