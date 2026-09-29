import { App, FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
import type PeopleHubPlugin from "./main";
import { createPerson, LOG_TYPES, logInteraction } from "./actions";
import { today, toISO } from "./dates";
import { Person, Tier, TIERS } from "./types";

export class PersonPicker extends FuzzySuggestModal<Person> {
  constructor(app: App, private people: Person[], private onPick: (p: Person) => void) {
    super(app);
    this.setPlaceholder("Choose a person…");
  }
  getItems() { return this.people; }
  getItemText(p: Person) { return p.name; }
  onChooseItem(p: Person) { this.onPick(p); }
}

export class LogModal extends Modal {
  constructor(app: App, private plugin: PeopleHubPlugin, private person: Person) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: `Log interaction · ${this.person.name}` });
    const e = { date: toISO(today()), type: "call", place: "", summary: "", nextDate: "", nextPurpose: "" };

    new Setting(contentEl).setName("Date").addText(t => { t.inputEl.type = "date"; t.setValue(e.date).onChange(v => (e.date = v)); });
    new Setting(contentEl).setName("Type").addDropdown(d => {
      LOG_TYPES.forEach(x => d.addOption(x, x));
      d.setValue(e.type).onChange(v => (e.type = v));
    });
    new Setting(contentEl).setName("Place").addText(t => t.onChange(v => (e.place = v)));
    new Setting(contentEl).setName("Summary").addTextArea(t => { t.inputEl.rows = 3; t.onChange(v => (e.summary = v)); });
    new Setting(contentEl).setName("Next meeting").setDesc("Optional").addText(t => { t.inputEl.type = "date"; t.onChange(v => (e.nextDate = v)); });
    new Setting(contentEl).setName("Next purpose").addText(t => t.onChange(v => (e.nextPurpose = v)));
    new Setting(contentEl).addButton(b => b.setButtonText("Save").setCta().onClick(async () => {
      await logInteraction(this.app, this.plugin.settings, this.person, e);
      new Notice(`Logged with ${this.person.name}`);
      this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

export class NewPersonModal extends Modal {
  constructor(app: App, private plugin: PeopleHubPlugin) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "New person" });
    const o = { name: "", tier: "close" as Tier, birthdate: "", phone: "", email: "", company: "" };

    new Setting(contentEl).setName("Name").addText(t => { t.onChange(v => (o.name = v)); setTimeout(() => t.inputEl.focus(), 50); });
    new Setting(contentEl).setName("Circle").setDesc("Sets the reach-out cadence").addDropdown(d => {
      TIERS.forEach(x => d.addOption(x, `${x} (${this.plugin.settings.tierDays[x]}d)`));
      d.setValue(o.tier).onChange(v => (o.tier = v as Tier));
    });
    new Setting(contentEl).setName("Birthday").setDesc("YYYY-MM-DD, or --MM-DD if year unknown").addText(t => t.onChange(v => (o.birthdate = v)));
    new Setting(contentEl).setName("Phone").addText(t => t.onChange(v => (o.phone = v)));
    new Setting(contentEl).setName("Email").addText(t => t.onChange(v => (o.email = v)));
    new Setting(contentEl).setName("Company").addText(t => t.onChange(v => (o.company = v)));
    new Setting(contentEl).addButton(b => b.setButtonText("Create").setCta().onClick(async () => {
      if (!o.name.trim()) { new Notice("Name is required"); return; }
      const file = await createPerson(this.app, this.plugin.settings, o);
      this.close();
      await this.app.workspace.getLeaf(false).openFile(file);
    }));
  }
  onClose() { this.contentEl.empty(); }
}
