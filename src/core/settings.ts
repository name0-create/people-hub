// ─── Settings — single source of truth ──────────────────────────────────────
// All folder paths are vault-relative strings. Nothing is hard-coded.

import { App, PluginSettingTab, Setting } from "obsidian";
import type PeopleHubPlugin from "../main";
import { TIERS, type Tier } from "../models/person";

export interface IntegrationSettings {
  enableMetaBind:  boolean;
  enableTemplater: boolean;
  enableDataview:  boolean;
  enableQuickAdd:  boolean;
  enableBases:     boolean;
}

export type TierDays = Record<Tier, number>;
export const DEFAULT_TIER_DAYS: TierDays = {
  inner: 1, close: 7, extended: 30, professional: 90
};

export interface PeopleHubSettings {
  // ── Folders (all configurable, none hard-coded) ──
  peopleFolder:      string;
  archiveFolder:     string;
  interactionFolder: string;
  meetingFolder:     string;

  // ── Schema ──
  personType:    string;
  excludeFolders: string;

  // ── Creation ──
  personTemplateMode: "builtin" | "templater";
  personTemplatePath: string;

  // ── Cadence ──
  tierDays: TierDays;

  // ── Reminders ──
  birthdayLookahead:    number;
  anniversaryLookahead: number;
  meetingLookahead:     number;

  // ── Logging ──
  logHeading:   string;
  weekStartsOn: 0 | 1;

  // ── Mobile (v0.2) ──
  mobileSwipeLog: boolean;

  // ── Integrations ──
  integrations: IntegrationSettings;

  // ── QuickAdd (v0.2) ──
  quickAddMacroName: string;

  // ── UI ──
  showStatusBar:  boolean;
  startupNotice: boolean;

  // ── Meta ──
  debugMode: boolean;
  version:   string;
}

export const DEFAULT_SETTINGS: PeopleHubSettings = {
  peopleFolder:      "20 - PEOPLE",
  archiveFolder:     "20 - PEOPLE/_Archive",
  interactionFolder: "20 - PEOPLE/_Interactions",
  meetingFolder:     "20 - PEOPLE/_Meetings",

  personType:    "person",
  excludeFolders: "Templates,99 - SYSTEM",

  personTemplateMode: "builtin",
  personTemplatePath: "99 - SYSTEM/Templates/Template - Person - Full.md",

  tierDays: { ...DEFAULT_TIER_DAYS },

  birthdayLookahead:    30,
  anniversaryLookahead: 14,
  meetingLookahead:     14,

  logHeading:   "## Talks Log",
  weekStartsOn: 1,

  mobileSwipeLog: true,

  integrations: {
    enableMetaBind:  false,
    enableTemplater: false,
    enableDataview:  false,
    enableQuickAdd:  false,
    enableBases:     false,
  },

  quickAddMacroName: "New Person",

  showStatusBar:  true,
  startupNotice: true,

  debugMode: false,
  version:   "0.2.0",
};

// ── Settings tab ─────────────────────────────────────────────────────────────
export class PeopleSettingTab extends PluginSettingTab {
  private _ph: PeopleHubPlugin;
  constructor(app: App, plugin: PeopleHubPlugin) { super(app, plugin as any); this._ph = plugin; }
  private get ph(): PeopleHubPlugin { return this._ph; }

  display() {
    const { containerEl: el } = this;
    el.empty();
    const s = this.ph.settings;
    const save = () => this.ph.saveSettings();

    // ── Folders ──────────────────────────────────────────────────────────
    el.createEl("h3", { text: "📁 Folders" });
    el.createEl("p", {
      text: "All paths are vault-relative. The plugin never writes to hard-coded locations.",
      cls: "setting-item-description",
    });
    const folder = (
      name: string, desc: string,
      key: "peopleFolder" | "archiveFolder" | "interactionFolder" | "meetingFolder"
    ) => new Setting(el).setName(name).setDesc(desc)
        .addText(t => { t.setValue(s[key]).onChange(async v => { (s as any)[key] = v.trim(); await save(); }); t.inputEl.style.width = "240px"; });

    folder("People folder",       "Main folder for all person notes.",              "peopleFolder");
    folder("Archive folder",      "Moved here when status = archived.",             "archiveFolder");
    folder("Interaction folder",  "Stand-alone interaction notes (optional).",     "interactionFolder");
    folder("Meeting folder",      "Stand-alone meeting notes (optional).",         "meetingFolder");
    new Setting(el).setName("Excluded folders").setDesc("Comma-separated; never indexed.")
      .addText(t => t.setValue(s.excludeFolders).onChange(async v => { s.excludeFolders = v; await save(); }));

    // ── Schema ───────────────────────────────────────────────────────────
    el.createEl("h3", { text: "🗂 Schema" });
    new Setting(el).setName("Person type value")
      .setDesc("Notes with `type: <this>` anywhere in vault are indexed as people.")
      .addText(t => t.setValue(s.personType).onChange(async v => { s.personType = v.trim() || "person"; await save(); }));

    // ── Cadence ──────────────────────────────────────────────────────────
    el.createEl("h3", { text: "⏱ Reach-out cadence (days per tier)" });
    for (const tier of TIERS) {
      new Setting(el).setName(tier).addText(t =>
        t.setValue(String(s.tierDays[tier])).onChange(async v => {
          const n = parseInt(v, 10);
          if (n > 0) { s.tierDays[tier] = n; await save(); }
        })
      );
    }

    // ── Reminders ────────────────────────────────────────────────────────
    el.createEl("h3", { text: "🔔 Reminders" });
    new Setting(el).setName("Birthday look-ahead (days)")
      .addText(t => t.setValue(String(s.birthdayLookahead)).onChange(async v => { const n = parseInt(v, 10); if (n > 0) { s.birthdayLookahead = n; await save(); } }));
    new Setting(el).setName("Anniversary look-ahead (days)")
      .addText(t => t.setValue(String(s.anniversaryLookahead)).onChange(async v => { const n = parseInt(v, 10); if (n > 0) { s.anniversaryLookahead = n; await save(); } }));

    // ── Logging ──────────────────────────────────────────────────────────
    el.createEl("h3", { text: "📝 Logging" });
    new Setting(el).setName("Talk log heading")
      .setDesc("Talks are appended under this heading in each person note.")
      .addText(t => t.setValue(s.logHeading).onChange(async v => { s.logHeading = v.trim() || "## Talks Log"; await save(); }));
    new Setting(el).setName("Week starts on Monday")
      .addToggle(t => t.setValue(s.weekStartsOn === 1).onChange(async v => { s.weekStartsOn = v ? 1 : 0; await save(); }));

    // ── Mobile ───────────────────────────────────────────────────────────
    el.createEl("h3", { text: "📱 Mobile" });
    new Setting(el)
      .setName("One-tap log (swipe action)")
      .setDesc("Swipe right on any person row in the Today tab to open the quick-log sheet instantly. Also shows a 📝 tap button on every row.")
      .addToggle(t => t.setValue(s.mobileSwipeLog).onChange(async v => { s.mobileSwipeLog = v; await save(); }));

    // ── Integrations ─────────────────────────────────────────────────────
    el.createEl("h3", { text: "🔌 Integrations" });
    const tog = (name: string, desc: string, key: keyof IntegrationSettings) =>
      new Setting(el).setName(name).setDesc(desc)
        .addToggle(t => t.setValue(s.integrations[key]).onChange(async v => { s.integrations[key] = v; await save(); }));

    tog("Templater",  "Use Templater for 'New person' instead of the built-in creator.", "enableTemplater");
    tog("QuickAdd",   "Register a QuickAdd macro choice for person creation.",            "enableQuickAdd");
    tog("Meta Bind",  "Body-level Input fields bind to the same frontmatter keys.",       "enableMetaBind");
    tog("Dataview",   "Enable `people` fenced code blocks.",                              "enableDataview");
    tog("Bases",      "Expose people as a Bases collection (future).",                   "enableBases");

    new Setting(el).setName("Templater template path")
      .addText(t => t.setValue(s.personTemplatePath).onChange(async v => { s.personTemplatePath = v.trim(); await save(); }));
    new Setting(el).setName("QuickAdd macro name")
      .setDesc("Exact name of the macro registered in QuickAdd settings.")
      .addText(t => t.setValue(s.quickAddMacroName).onChange(async v => { s.quickAddMacroName = v.trim(); await save(); }));

    // ── UI ───────────────────────────────────────────────────────────────
    el.createEl("h3", { text: "🖥 UI" });
    new Setting(el).setName("Status bar").addToggle(t => t.setValue(s.showStatusBar).onChange(async v => { s.showStatusBar = v; await save(); }));
    new Setting(el).setName("Startup notice").setDesc("Birthdays + reach-outs + Carnegie alerts when Obsidian opens.")
      .addToggle(t => t.setValue(s.startupNotice).onChange(async v => { s.startupNotice = v; await save(); }));

    // ── Debug ────────────────────────────────────────────────────────────
    el.createEl("h3", { text: "🐛 Debug" });
    new Setting(el).setName("Debug mode").setDesc("Logs index operations to the console.")
      .addToggle(t => t.setValue(s.debugMode).onChange(async v => { s.debugMode = v; await save(); }));
    el.createEl("p", { text: `People Hub v${s.version}`, cls: "setting-item-description" });
  }
}
