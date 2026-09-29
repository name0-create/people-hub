import { App, FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
import type PeopleHubPlugin from "./main";
import { createWithTemplater, LOG_TYPES, logTalk } from "./actions";
import { today, toISO } from "./dates";
import { CARNEGIE_LABELS, Person, Tier, TIERS } from "./types";

export class PersonPicker extends FuzzySuggestModal<Person> {
  constructor(app: App, private people: Person[], private onPick: (p: Person) => void) {
    super(app); this.setPlaceholder("Choose a person…");
  }
  getItems() { return this.people; }
  getItemText(p: Person) { return `${p.name}${p.typePerson ? " · " + p.typePerson : ""}`; }
  onChooseItem(p: Person) { this.onPick(p); }
}

export class LogModal extends Modal {
  constructor(app: App, private plugin: PeopleHubPlugin, private person: Person, private onSaved?: () => void) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Log talk · ${this.person.name}` });
    const e = {
      date: toISO(today()), type: "call", where: "", note: "",
      learned: "", next: "", presence: 4, energy: 4,
      c2_used: false, c4_used: false, c7_used: false
    };
    new Setting(contentEl).setName("Date").addText(t => { t.inputEl.type = "date"; t.setValue(e.date).onChange(v => (e.date = v)); });
    new Setting(contentEl).setName("Type").addDropdown(d => { LOG_TYPES.forEach(x => d.addOption(x, x)); d.onChange(v => (e.type = v)); });
    new Setting(contentEl).setName("Where").addText(t => t.setPlaceholder("Coffee / Call / Home / Video").onChange(v => (e.where = v)));
    new Setting(contentEl).setName("Talked about").addTextArea(t => { t.inputEl.rows = 3; t.onChange(v => (e.note = v)); });
    new Setting(contentEl).setName("You learned").addText(t => t.onChange(v => (e.learned = v)));
    new Setting(contentEl).setName("Next").addText(t => t.setPlaceholder("Agreed next: …").onChange(v => (e.next = v)));
    new Setting(contentEl).setName("Presence /5").addDropdown(d => {
      for (let i = 5; i >= 1; i--) d.addOption(String(i), `${i}/5`);
      d.setValue("4").onChange(v => (e.presence = parseInt(v)));
    });
    new Setting(contentEl).setName("Energy after /5").addDropdown(d => {
      for (let i = 5; i >= 1; i--) d.addOption(String(i), `${i}/5`);
      d.setValue("4").onChange(v => (e.energy = parseInt(v)));
    });
    contentEl.createEl("h4", { text: "Carnegie used?" });
    for (const [k, label] of [["c2", "C2 Appreciation"], ["c4", "C4 Genuine interest"], ["c7", "C7 Made feel important"]] as const) {
      new Setting(contentEl).setName(label).addToggle(t => t.onChange(v => { (e as any)[`${k}_used`] = v; }));
    }
    new Setting(contentEl).addButton(b => b.setButtonText("Save").setCta().onClick(async () => {
      await logTalk(this.app, this.plugin.settings, this.person, e);
      new Notice(`Logged talk with ${this.person.name} · Presence ${e.presence}/5`);
      this.close();
      this.onSaved?.();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

export class CarnegieModal extends Modal {
  constructor(app: App, private plugin: PeopleHubPlugin, private person: Person) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Carnegie scores · ${this.person.name}` });
    contentEl.createEl("p", { text: `Avg: ${this.person.carnegie.avg}/5 · Target 4/5 · Weakest: ${this.person.carnegie.weakestLabel}`, cls: "ph-sub" });
    const table = contentEl.createEl("table", { cls: "ph-carnegie-table" });
    const head = table.createEl("thead").createEl("tr");
    ["#", "Principle", "Score", "Action"].forEach(h => head.createEl("th", { text: h }));
    const body = table.createEl("tbody");
    const scores = this.person.carnegie;
    for (let i = 1; i <= 9; i++) {
      const key = `c${i}` as keyof typeof scores;
      const score = scores[key] as number;
      const tr = body.createEl("tr", { cls: score < 3 ? "ph-clow" : "" });
      tr.createEl("td", { text: `C${i}` });
      tr.createEl("td", { text: CARNEGIE_LABELS[`c${i}`] });
      const colour = score >= 4 ? "#22c55e" : score >= 2.5 ? "#f59e0b" : "#ef4444";
      tr.createEl("td", { text: `${score}/5`, attr: { style: `color:${colour};font-weight:600` } });
      tr.createEl("td", { text: score < 3 ? "Practice this week ⚠️" : score < 4 ? "Improve" : "✓" });
    }
    if (scores.avg < 3) {
      contentEl.createEl("div", { text: `⚠️ Avg below 3 → Re-read Carnegie Ch on ${scores.weakestLabel} — Practice with ${this.person.name} this week`, cls: "ph-alert" });
    }
    new Setting(contentEl).addButton(b => b.setButtonText("Open note").onClick(() => { this.close(); this.plugin.openPerson(this.person, false); }));
  }
  onClose() { this.contentEl.empty(); }
}

export class NewPersonModal extends Modal {
  constructor(app: App, private plugin: PeopleHubPlugin) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "New person" });
    const o = { name: "", typePerson: "friend", tier: "close" as Tier, phone: "", email: "", ig: "", linkedin: "", frequency: "" };
    new Setting(contentEl).setName("Name").addText(t => { t.onChange(v => (o.name = v)); setTimeout(() => t.inputEl.focus(), 50); });
    new Setting(contentEl).setName("Type").setDesc("family / mentor / friend / prospect / girlfriend …").addText(t => t.onChange(v => (o.typePerson = v)));
    new Setting(contentEl).setName("Circle").addDropdown(d => {
      const sd = this.plugin.settings.tierDays;
      TIERS.forEach(x => d.addOption(x, `${x} (${sd[x]}d)`));
      d.setValue("close").onChange(v => (o.tier = v as Tier));
    });
    new Setting(contentEl).setName("Frequency").setDesc("daily / weekly / monthly / quarterly").addText(t => t.onChange(v => (o.frequency = v)));
    new Setting(contentEl).setName("Phone").addText(t => t.onChange(v => (o.phone = v)));
    new Setting(contentEl).setName("Email").addText(t => t.onChange(v => (o.email = v)));
    new Setting(contentEl).setName("Instagram").addText(t => t.onChange(v => (o.ig = v)));
    new Setting(contentEl).setName("LinkedIn").addText(t => t.onChange(v => (o.linkedin = v)));
    new Setting(contentEl).addButton(b => b.setButtonText("Create").setCta().onClick(async () => {
      if (!o.name.trim()) { new Notice("Name is required"); return; }
      const file = await (await import("./actions")).createPerson(this.app, this.plugin.settings, o);
      this.close();
      await this.app.workspace.getLeaf(false).openFile(file);
    }));
  }
  onClose() { this.contentEl.empty(); }
}
