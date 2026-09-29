import { App, PluginSettingTab, Setting } from "obsidian";
import type PeopleHubPlugin from "./main";
import { exportIcs } from "./ics";
import { TIERS } from "./types";

export class PeopleSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PeopleHubPlugin) { super(app, plugin); }
  display() {
    const { containerEl: el } = this;
    el.empty();
    const s = this.plugin.settings;
    const save = async () => { await this.plugin.saveSettings(); };

    el.createEl("h3", { text: "Where people live" });
    new Setting(el).setName("People folder").setDesc("New people created here. Also scanned for `type: person` notes.")
      .addText(t => t.setValue(s.peopleFolder).onChange(async v => { s.peopleFolder = v.trim(); await save(); }));
    new Setting(el).setName("Person `type` value")
      .addText(t => t.setValue(s.personType).onChange(async v => { s.personType = v.trim() || "person"; await save(); }));
    new Setting(el).setName("Excluded folders").setDesc("Comma-separated. Always exclude your Templates folder.")
      .addText(t => t.setValue(s.excludeFolders).onChange(async v => { s.excludeFolders = v; await save(); }));

    el.createEl("h3", { text: "Reach-out cadence (days per tier)" });
    for (const tier of TIERS) {
      new Setting(el).setName(tier).addText(t => t.setValue(String(s.tierDays[tier])).onChange(async v => {
        const n = parseInt(v, 10); if (n > 0) { s.tierDays[tier] = n; await save(); }
      }));
    }

    el.createEl("h3", { text: "Views" });
    new Setting(el).setName("Birthday look-ahead (days)")
      .addText(t => t.setValue(String(s.birthdayLookahead)).onChange(async v => { const n = parseInt(v, 10); if (n > 0) { s.birthdayLookahead = n; await save(); } }));
    new Setting(el).setName("Week starts on Monday")
      .addToggle(t => t.setValue(s.weekStartsOn === 1).onChange(async v => { s.weekStartsOn = v ? 1 : 0; await save(); }));
    new Setting(el).setName("Status bar").addToggle(t => t.setValue(s.showStatusBar).onChange(async v => { s.showStatusBar = v; await save(); }));
    new Setting(el).setName("Startup notice").setDesc("Birthday + reach-out + Carnegie alerts on open.")
      .addToggle(t => t.setValue(s.startupNotice).onChange(async v => { s.startupNotice = v; await save(); }));

    el.createEl("h3", { text: "Daily-note birthdays" });
    new Setting(el).setName("Auto-inject when today's daily note opens").setDesc("Adds/updates a birthday block between HTML comment markers. Never touches other text. You can also run the command manually.")
      .addToggle(t => t.setValue(s.autoInjectBirthdays).onChange(async v => { s.autoInjectBirthdays = v; await save(); }));
    new Setting(el).setName("Heading").addText(t => t.setValue(s.injectHeading).onChange(async v => { s.injectHeading = v.trim() || "## 🎂 Birthdays"; await save(); }));
    new Setting(el).setName("Look-ahead (days)").setDesc("0 = only birthdays on the note's own date.")
      .addText(t => t.setValue(String(s.injectLookahead)).onChange(async v => { const n = parseInt(v, 10); if (n >= 0) { s.injectLookahead = n; await save(); } }));
    new Setting(el).setName("Position").addDropdown(d => d.addOption("top", "Top (after frontmatter)").addOption("bottom", "Bottom")
      .setValue(s.injectPosition).onChange(async v => { s.injectPosition = v as "top" | "bottom"; await save(); }));
    new Setting(el).setName("Daily note folder").setDesc("Leave blank to use Obsidian's Daily Notes settings.")
      .addText(t => t.setValue(s.dailyNoteFolder).onChange(async v => { s.dailyNoteFolder = v.trim(); await save(); }));
    new Setting(el).setName("Daily note date format").setDesc("Moment format. Blank = Daily Notes setting, else YYYY-MM-DD.")
      .addText(t => t.setPlaceholder("YYYY-MM-DD").setValue(s.dailyNoteFormat).onChange(async v => { s.dailyNoteFormat = v.trim(); await save(); }));

    el.createEl("h3", { text: "Calendar export (.ics)" });
    new Setting(el).setName("Export path").setDesc("Written inside the vault. Point Google/Apple/Outlook at the synced file, or import it once.")
      .addText(t => t.setValue(s.icsPath).onChange(async v => { s.icsPath = v.trim() || "People Hub/people.ics"; await save(); }));
    new Setting(el).setName("Include next meetings")
      .addToggle(t => t.setValue(s.icsIncludeMeetings).onChange(async v => { s.icsIncludeMeetings = v; await save(); }));
    new Setting(el).addButton(b => b.setButtonText("Export now").onClick(() => { void exportIcs(this.plugin); }));

    el.createEl("h3", { text: "Templater" });
    new Setting(el).setName("Use Templater for New person").setDesc("Runs your Templater template. Requires the Templater plugin.")
      .addToggle(t => t.setValue(s.useTemplater).onChange(async v => { s.useTemplater = v; await save(); }));
    new Setting(el).setName("Templater template path")
      .addText(t => t.setPlaceholder("99 - SYSTEM/Templates/Template - Person - Full.md").setValue(s.templaterTemplate).onChange(async v => { s.templaterTemplate = v.trim(); await save(); }));
  }
}
