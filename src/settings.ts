import { App, PluginSettingTab, Setting } from "obsidian";
import type PeopleHubPlugin from "./main";
import { TIERS } from "./types";

export class PeopleSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PeopleHubPlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async () => { await this.plugin.saveSettings(); };

    containerEl.createEl("h3", { text: "Where people live" });
    new Setting(containerEl).setName("People folder").setDesc("New people are created here. Notes here without a `type` are also treated as people.")
      .addText(t => t.setValue(s.peopleFolder).onChange(async v => { s.peopleFolder = v.trim(); await save(); }));
    new Setting(containerEl).setName("Person `type` value").setDesc("Notes with `type: person` in frontmatter are indexed anywhere in the vault.")
      .addText(t => t.setValue(s.personType).onChange(async v => { s.personType = v.trim() || "person"; await save(); }));
    new Setting(containerEl).setName("Excluded folders").setDesc("Comma-separated. Keep your Templates folder here.")
      .addText(t => t.setValue(s.excludeFolders).onChange(async v => { s.excludeFolders = v; await save(); }));

    containerEl.createEl("h3", { text: "Reach-out cadence (days)" });
    for (const tier of TIERS) {
      new Setting(containerEl).setName(tier).addText(t => t.setValue(String(s.tierDays[tier])).onChange(async v => {
        const n = parseInt(v, 10); if (n > 0) { s.tierDays[tier] = n; await save(); }
      }));
    }

    containerEl.createEl("h3", { text: "Views" });
    new Setting(containerEl).setName("Birthday look-ahead (days)")
      .addText(t => t.setValue(String(s.birthdayLookahead)).onChange(async v => { const n = parseInt(v, 10); if (n > 0) { s.birthdayLookahead = n; await save(); } }));
    new Setting(containerEl).setName("Meeting look-ahead (days)")
      .addText(t => t.setValue(String(s.meetingLookahead)).onChange(async v => { const n = parseInt(v, 10); if (n > 0) { s.meetingLookahead = n; await save(); } }));
    new Setting(containerEl).setName("Week starts on Monday")
      .addToggle(t => t.setValue(s.weekStartsOn === 1).onChange(async v => { s.weekStartsOn = v ? 1 : 0; await save(); }));
    new Setting(containerEl).setName("Status bar summary").addToggle(t => t.setValue(s.showStatusBar).onChange(async v => { s.showStatusBar = v; await save(); }));
    new Setting(containerEl).setName("Startup notice").setDesc("Show today's birthdays and reach-outs when Obsidian opens.")
      .addToggle(t => t.setValue(s.startupNotice).onChange(async v => { s.startupNotice = v; await save(); }));

    containerEl.createEl("h3", { text: "Templates" });
    new Setting(containerEl).setName("Contact-history heading").setDesc("Logged interactions are appended under this heading in the person's note.")
      .addText(t => t.setValue(s.logHeading).onChange(async v => { s.logHeading = v.trim() || "## 🕘 Contact History"; await save(); }));
    new Setting(containerEl).setName("Body template (no Templater needed)").setDesc("Path to a .md file. Its frontmatter is dropped; {{title}} and {{date}} are replaced. Leave empty for the built-in body.")
      .addText(t => t.setPlaceholder("Templates/Person Body.md").setValue(s.bodyTemplate).onChange(async v => { s.bodyTemplate = v.trim(); await save(); }));
    new Setting(containerEl).setName("Use Templater for “New person”").setDesc("Runs your full Templater template instead of the built-in creator. Requires the Templater plugin.")
      .addToggle(t => t.setValue(s.useTemplater).onChange(async v => { s.useTemplater = v; await save(); }));
    new Setting(containerEl).setName("Templater template path")
      .addText(t => t.setPlaceholder("Templates/Person.md").setValue(s.templaterTemplate).onChange(async v => { s.templaterTemplate = v.trim(); await save(); }));
  }
}
