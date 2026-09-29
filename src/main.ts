import { debounce, Editor, Notice, Plugin, TFile } from "obsidian";
import { createWithTemplater } from "./actions";
import { PersonIndex } from "./index";
import { LogModal, NewPersonModal, PersonPicker } from "./modals";
import { PeopleSettingTab } from "./settings";
import { DEFAULT_SETTINGS, Person, PluginSettings } from "./types";
import { birthdayMeta, meetingMeta, reachOutMeta, renderPersonRow } from "./ui";
import { PeopleView, Tab, VIEW_TYPE } from "./view";

export default class PeopleHubPlugin extends Plugin {
  settings!: PluginSettings;
  index!: PersonIndex;
  pendingTab: Tab | null = null;
  private statusEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();
    this.index = new PersonIndex(this.app, () => this.settings);

    this.registerView(VIEW_TYPE, leaf => new PeopleView(leaf, this));
    this.addRibbonIcon("users", "Open People Hub", () => this.activateView());
    this.addSettingTab(new PeopleSettingTab(this.app, this));

    this.addCommand({ id: "open-hub", name: "Open People Hub", callback: () => this.activateView() });
    this.addCommand({ id: "open-birthdays", name: "Open birthday calendar", callback: () => this.activateView("birthdays") });
    this.addCommand({ id: "open-reachout", name: "Show who to reach out to", callback: () => this.activateView("today") });
    this.addCommand({ id: "new-person", name: "New person", callback: () => this.newPerson() });
    this.addCommand({
      id: "log-interaction", name: "Log interaction",
      callback: () => {
        const f = this.app.workspace.getActiveFile();
        const p = f && this.index.all().find(x => x.file.path === f.path);
        if (p) this.logFor(p);
        else new PersonPicker(this.app, this.index.all(), x => this.logFor(x)).open();
      }
    });
    this.addCommand({
      id: "insert-birthdays", name: "Insert upcoming birthdays here",
      editorCallback: (editor: Editor) => {
        const list = this.index.upcomingBirthdays(this.settings.birthdayLookahead);
        editor.replaceSelection(list.length
          ? list.map(p => `- 🎂 [[${p.file.basename}]] — ${birthdayMeta(p)}`).join("\n") + "\n"
          : "No upcoming birthdays.\n");
      }
    });
    this.addCommand({ id: "refresh", name: "Refresh people index", callback: () => this.refresh(true) });

    // ```people  view: birthdays | reachout | meetings   days: 14 ```
    this.registerMarkdownCodeBlockProcessor("people", (src, el) => {
      const cfg: Record<string, string> = {};
      for (const line of src.split("\n")) { const m = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/); if (m) cfg[m[1].toLowerCase()] = m[2]; }
      const view = (cfg.view ?? "reachout").toLowerCase();
      const days = parseInt(cfg.days ?? "", 10);
      const box = el.createDiv({ cls: "ph-root ph-embed" });
      const list = box.createDiv({ cls: "ph-list" });
      let rows: Person[]; let metaFn: (p: Person) => string;
      if (view === "birthdays") { rows = this.index.upcomingBirthdays(days || this.settings.birthdayLookahead); metaFn = birthdayMeta; }
      else if (view === "meetings") { rows = this.index.meetings(days || this.settings.meetingLookahead); metaFn = meetingMeta; }
      else { rows = this.index.reachOut(); metaFn = reachOutMeta; }
      if (!rows.length) list.createDiv({ text: "Nothing to show.", cls: "ph-empty" });
      rows.forEach(p => renderPersonRow(this, list, p, metaFn(p), false));
    });

    const onChange = debounce(() => this.refresh(), 500, true);
    this.registerEvent(this.app.metadataCache.on("changed", (f: TFile) => { if (this.index.isPersonFile(f)) onChange(); }));
    this.registerEvent(this.app.metadataCache.on("deleted", () => onChange()));
    this.registerEvent(this.app.vault.on("rename", () => onChange()));
    this.registerInterval(window.setInterval(() => this.refresh(), 60 * 60 * 1000));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable");
    this.statusEl.addEventListener("click", () => this.activateView());

    this.app.workspace.onLayoutReady(() => {
      this.refresh();
      if (this.settings.startupNotice) this.startupNotice();
    });
  }

  onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }

  async loadSettings() {
    const d = (await this.loadData()) ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...d, tierDays: { ...DEFAULT_SETTINGS.tierDays, ...(d.tierDays ?? {}) } };
  }
  async saveSettings() { await this.saveData(this.settings); this.refresh(); }

  refresh(notify = false) {
    this.index.invalidate();
    const all = this.index.all();
    if (this.statusEl) {
      if (!this.settings.showStatusBar) this.statusEl.setText("");
      else {
        const b = all.filter(p => p.birthday?.days === 0).length;
        const r = this.index.reachOut().length;
        this.statusEl.setText(`${b ? `🎂 ${b} · ` : ""}📞 ${r}`);
        this.statusEl.setAttribute("aria-label", "People Hub: birthdays today · people to reach out to");
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const v = leaf.view;
      if (v instanceof PeopleView) v.render();
    }
    if (notify) new Notice(`People Hub: ${all.length} people indexed`);
  }

  private startupNotice() {
    const today = this.index.all().filter(p => p.birthday?.days === 0);
    const due = this.index.reachOut().length;
    const parts: string[] = [];
    if (today.length) parts.push(`🎂 Birthday: ${today.map(p => p.name).join(", ")}`);
    if (due) parts.push(`📞 ${due} to reach out to`);
    if (parts.length) new Notice(parts.join("\n"), 8000);
  }

  async activateView(tab?: Tab) {
    this.pendingTab = tab ?? null;
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const l = this.app.workspace.getRightLeaf(false);
      if (!l) return;
      await l.setViewState({ type: VIEW_TYPE, active: true });
      leaf = l;
    }
    this.app.workspace.revealLeaf(leaf);
    if (tab && leaf.view instanceof PeopleView) leaf.view.setTab(tab);
  }

  async newPerson() {
    if (this.settings.useTemplater && await createWithTemplater(this.app, this.settings)) return;
    new NewPersonModal(this.app, this).open();
  }
  logFor(p: Person) { new LogModal(this.app, this, p).open(); }
  openPerson(p: Person, newTab: boolean) { this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(p.file); }
}
