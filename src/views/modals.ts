// ─── Modals ───────────────────────────────────────────────────────────────────

import { App, FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
import type { PeopleHubPlugin } from "../main";
import {
  createPerson, createWithQuickAdd, createWithTemplater,
  LOG_TYPES, logTalk, TalkEntry,
} from "../repository/person-actions";
import { today, toISO } from "../core/dates";
import { CARNEGIE_LABELS, Person, Tier, TIERS } from "../models/person";

// ── Person picker ─────────────────────────────────────────────────────────────
export class PersonPicker extends FuzzySuggestModal<Person> {
  constructor(app: App, private people: Person[], private onPick: (p: Person) => void) {
    super(app);
    this.setPlaceholder("Choose a person…");
  }
  getItems()             { return this.people; }
  getItemText(p: Person) { return `${p.name}${p.typePerson ? " · " + p.typePerson : ""}`; }
  onChooseItem(p: Person){ this.onPick(p); }
}

// ── Full log modal ────────────────────────────────────────────────────────────
export class LogModal extends Modal {
  constructor(app: App, private plugin: PeopleHubPlugin, private person: Person) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Log talk · ${this.person.name}` });
    const e: TalkEntry = {
      date: toISO(today()), type: "call", where: "", note: "",
      learned: "", next: "", presence: 4, energy: 4,
      c2_used: false, c4_used: false, c7_used: false,
    };
    new Setting(contentEl).setName("Date").addText(t => { t.inputEl.type = "date"; t.setValue(e.date).onChange(v => (e.date = v)); });
    new Setting(contentEl).setName("Type").addDropdown(d => { LOG_TYPES.forEach(x => d.addOption(x, x)); d.onChange(v => (e.type = v)); });
    new Setting(contentEl).setName("Where").addText(t => t.setPlaceholder("Coffee shop / Home / Video").onChange(v => (e.where = v)));
    new Setting(contentEl).setName("Talked about").addTextArea(t => { t.inputEl.rows = 3; t.onChange(v => (e.note = v)); });
    new Setting(contentEl).setName("Learned").addText(t => t.onChange(v => (e.learned = v)));
    new Setting(contentEl).setName("Agreed next").addText(t => t.setPlaceholder("Follow-up in 2 weeks…").onChange(v => (e.next = v)));
    new Setting(contentEl).setName("Presence /5").addDropdown(d => {
      for (let i = 5; i >= 1; i--) d.addOption(String(i), `${i}/5`);
      d.setValue("4").onChange(v => (e.presence = parseInt(v)));
    });
    new Setting(contentEl).setName("Energy after /5").addDropdown(d => {
      for (let i = 5; i >= 1; i--) d.addOption(String(i), `${i}/5`);
      d.setValue("4").onChange(v => (e.energy = parseInt(v)));
    });
    contentEl.createEl("h4", { text: "Carnegie used this talk?" });
    for (const [k, label] of [
      ["c2_used", "C2 Genuine appreciation"],
      ["c4_used", "C4 Become genuinely interested"],
      ["c7_used", "C7 Make them feel important"],
    ] as const) {
      new Setting(contentEl).setName(label).addToggle(t => t.onChange(v => { (e as any)[k] = v; }));
    }
    new Setting(contentEl).addButton(b =>
      b.setButtonText("Save").setCta().onClick(async () => {
        await logTalk(this.app, this.plugin.settings, this.person, e);
        new Notice(`✓ Logged talk with ${this.person.name} · Presence ${e.presence}/5`);
        this.close();
      })
    );
  }
  onClose() { this.contentEl.empty(); }
}

// ── Carnegie modal ────────────────────────────────────────────────────────────
export class CarnegieModal extends Modal {
  constructor(app: App, private plugin: PeopleHubPlugin, private person: Person) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const c = this.person.carnegie;
    contentEl.createEl("h3", { text: `Carnegie · ${this.person.name}` });
    contentEl.createEl("p", {
      text: `Avg ${c.avg}/5 · Target 4/5 · Weakest: ${c.weakestLabel}`,
      cls: "ph-sub",
    });
    const table = contentEl.createEl("table", { cls: "ph-carnegie-table" });
    const head  = table.createEl("thead").createEl("tr");
    ["#", "Principle", "Score", "Action"].forEach(h => head.createEl("th", { text: h }));
    const body  = table.createEl("tbody");
    for (let i = 1; i <= 9; i++) {
      const key   = `c${i}` as keyof typeof c;
      const score = c[key] as number;
      const colour= score >= 4 ? "#22c55e" : score >= 2.5 ? "#f59e0b" : "#ef4444";
      const tr    = body.createEl("tr", { cls: score < 3 ? "ph-clow" : "" });
      tr.createEl("td", { text: `C${i}` });
      tr.createEl("td", { text: CARNEGIE_LABELS[`c${i}`] });
      tr.createEl("td", { text: `${score}/5`, attr: { style: `color:${colour};font-weight:600` } });
      tr.createEl("td", { text: score < 3 ? "⚠️ Practice this week" : score < 4 ? "Improve" : "✓" });
    }
    if (c.avg > 0 && c.avg < 3) {
      contentEl.createEl("div", {
        text: `⚠️ Avg below 3 — re-read the chapter on "${c.weakestLabel}" and practise with ${this.person.name} this week.`,
        cls: "ph-alert",
      });
    }
    new Setting(contentEl).addButton(b =>
      b.setButtonText("Open note").onClick(() => {
        this.close();
        this.plugin.openPerson(this.person, false);
      })
    );
  }
  onClose() { this.contentEl.empty(); }
}

// ── New person modal ──────────────────────────────────────────────────────────
export class NewPersonModal extends Modal {
  constructor(app: App, private plugin: PeopleHubPlugin) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "New person" });
    const o = {
      name: "", typePerson: "friend", tier: "close" as Tier,
      phone: "", email: "", ig: "", linkedin: "",
      frequency: "", birthday: "", anniversary: "",
    };
    new Setting(contentEl).setName("Name")
      .addText(t => { t.onChange(v => (o.name = v)); setTimeout(() => t.inputEl.focus(), 50); });
    new Setting(contentEl).setName("Type").setDesc("family / mentor / friend / prospect / girlfriend …")
      .addText(t => t.onChange(v => (o.typePerson = v)));
    new Setting(contentEl).setName("Circle").addDropdown(d => {
      TIERS.forEach(x => d.addOption(x, `${x} (${this.plugin.settings.tierDays[x]}d)`));
      d.setValue("close").onChange(v => (o.tier = v as Tier));
    });
    new Setting(contentEl).setName("Frequency").setDesc("daily / weekly / monthly / quarterly")
      .addText(t => t.onChange(v => (o.frequency = v)));
    new Setting(contentEl).setName("Phone").addText(t => t.onChange(v => (o.phone = v)));
    new Setting(contentEl).setName("Email").addText(t => t.onChange(v => (o.email = v)));
    new Setting(contentEl).setName("Instagram").addText(t => t.onChange(v => (o.ig = v)));
    new Setting(contentEl).setName("LinkedIn").addText(t => t.onChange(v => (o.linkedin = v)));
    new Setting(contentEl).setName("Birthday").setDesc("YYYY-MM-DD or --MM-DD")
      .addText(t => { t.inputEl.type = "date"; t.onChange(v => (o.birthday = v)); });
    new Setting(contentEl).setName("Anniversary").setDesc("Friendiversary / wedding / etc. YYYY-MM-DD or --MM-DD")
      .addText(t => { t.inputEl.type = "date"; t.onChange(v => (o.anniversary = v)); });
    new Setting(contentEl).addButton(b =>
      b.setButtonText("Create").setCta().onClick(async () => {
        if (!o.name.trim()) { new Notice("Name is required"); return; }
        const file = await createPerson(
          this.app, this.plugin.settings, this.plugin.folders, o
        );
        this.close();
        await this.app.workspace.getLeaf(false).openFile(file);
      })
    );
  }
  onClose() { this.contentEl.empty(); }
}
