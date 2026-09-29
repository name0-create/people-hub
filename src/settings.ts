import { App, PluginSettingTab, Setting } from "obsidian";
import type PeopleHubPlugin from "./main";
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

    el.createEl("h3", { text: "Templater" });
    new Setting(el).setName("Use Templater for New person").setDesc("Runs your Templater template. Requires the Templater plugin.")
      .addToggle(t => t.setValue(s.useTemplater).onChange(async v => { s.useTemplater = v; await save(); }));
    new Setting(el).setName("Templater template path")
      .addText(t => t.setPlaceholder("99 - SYSTEM/Templates/Template - Person - Full.md").setValue(s.templaterTemplate).onChange(async v => { s.templaterTemplate = v.trim(); await save(); }));
  }
}
