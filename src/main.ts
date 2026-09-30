// ─── People Hub — main plugin entry ──────────────────────────────────────────

import { debounce, Editor, Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, PeopleHubSettings, PeopleSettingTab } from "./core/settings";
import { FolderService } from "./core/folder-service";
import { PeopleIndex } from "./repository/PeopleIndex";
import { MarkdownStore } from "./repository/MarkdownStore";
import { PersonRepository } from "./repository/PersonRepository";
import { InteractionRepository } from "./repository/InteractionRepository";
import { MeetingRepository } from "./repository/MeetingRepository";
import { createWithTemplater } from "./repository/person-actions";
import { runQuickAddMacro } from "./integrations/quickadd";
import { CarnegieModal, LogModal, NewPersonModal, PersonPicker } from "./views/modals";
import { QuickLogSheet } from "./views/quick-log-sheet";
import { PeopleView, Tab, VIEW_TYPE } from "./views/sidebar-view";
import { anniversaryMeta, birthdayMeta, reachOutMeta } from "./views/ui";
import type { PersonView } from "./models/person-view";

export type { PeopleHubPlugin };

class PeopleHubPlugin extends Plugin {
  settings!: PeopleHubSettings;
  folders!:  FolderService;
  index!:    PeopleIndex;            // read side: queries over person notes
  people!:   PersonRepository;       // write side: person notes
  interactions!: InteractionRepository;
  meetings!: MeetingRepository;
  pendingTab: Tab | null = null;
  private statusEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();
    this.folders = new FolderService(this.app, () => this.settings);
    this.index    = new PeopleIndex(this.app, this.folders, () => this.settings);
    const store   = new MarkdownStore(this.app, this.folders);
    const changed = () => this.refresh();   // invalidates the index, updates status bar + open views
    this.people       = new PersonRepository(this.folders, store, this.index, () => this.settings, changed);
    this.interactions = new InteractionRepository(store, changed);
    this.meetings     = new MeetingRepository(store, changed);

    this.registerView(VIEW_TYPE, leaf => new PeopleView(leaf, this));
    this.addRibbonIcon("users", "Open People Hub", () => this.activateView());
    this.addSettingTab(new PeopleSettingTab(this.app, this) as any);

    this.registerCommands();
    this.registerCodeBlock();
    this.registerChangeEvents();

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable");
    this.statusEl.addEventListener("click", () => this.activateView("today"));

    this.app.workspace.onLayoutReady(() => {
      this.refresh();
      if (this.settings.startupNotice) this.startupNotice();
    });
  }

  onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }

  async loadSettings() {
    const saved = ((await this.loadData()) ?? {}) as Partial<PeopleHubSettings>;
    this.settings = {
      ...DEFAULT_SETTINGS, ...saved,
      tierDays:     { ...DEFAULT_SETTINGS.tierDays,     ...((saved as any).tierDays     ?? {}) },
      integrations: { ...DEFAULT_SETTINGS.integrations, ...((saved as any).integrations ?? {}) },
    };
  }
  async saveSettings() { await this.saveData(this.settings); this.refresh(); }

  refresh(notify = false) {
    this.index.invalidate();
    this.updateStatusBar();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE))
      if (leaf.view instanceof PeopleView) leaf.view.render();
    if (notify) new Notice(`People Hub: ${this.index.all().length} people indexed`);
  }

  private updateStatusBar() {
    if (!this.statusEl) return;
    if (!this.settings.showStatusBar) { this.statusEl.setText(""); return; }
    const bToday = this.index.all().filter(p => p.birthday?.days === 0).length;
    const aToday = this.index.upcomingAnniversaries(0).length;
    const due    = this.index.reachOut().length;
    const lowC   = this.index.carnegieAlert(3).length;
    const parts  = [];
    if (bToday) parts.push(`🎂${bToday}`);
    if (aToday) parts.push(`💍${aToday}`);
    parts.push(`📞${due}`);
    if (lowC) parts.push(`⚠️C${lowC}`);
    this.statusEl.setText(parts.join(" "));
  }

  private startupNotice() {
    const parts: string[] = [];
    const bToday = this.index.all().filter(p => p.birthday?.days === 0);
    const aToday = this.index.upcomingAnniversaries(0);
    const due    = this.index.reachOut().length;
    const lowC   = this.index.carnegieAlert(3);
    if (bToday.length) parts.push(`🎂 Birthday: ${bToday.map(p => p.name).join(", ")}`);
    if (aToday.length) parts.push(`💍 Anniversary: ${aToday.map(p => `${p.name} (${p.anniversary!.label})`).join(", ")}`);
    if (due)           parts.push(`📞 ${due} to reach out to`);
    if (lowC.length)   parts.push(`⚠️ Carnegie < 3: ${lowC.slice(0, 3).map(p => p.name).join(", ")}`);
    if (parts.length)  new Notice(parts.join("\n"), 10000);
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
    if (this.settings.integrations.enableQuickAdd) {
      const ok = await runQuickAddMacro(this.app, this.settings.quickAddMacroName);
      if (ok) return;
    }
    if (this.settings.integrations.enableTemplater) {
      const ok = await createWithTemplater(this.app, this.settings, this.folders);
      if (ok) return;
    }
    new NewPersonModal(this.app, this).open();
  }

  logFor(p: PersonView)       { new LogModal(this.app, this, p).open(); }
  carnegieFor(p: PersonView)  { new CarnegieModal(this.app, this, p).open(); }
  quickLogFor(p: PersonView)  { new QuickLogSheet(this.app, this, p, () => this.refresh()).open(); }
  openPerson(p: PersonView, newTab: boolean) {
    this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(p.file);
  }

  private registerCommands() {
    this.addCommand({ id: "open-hub",      name: "Open People Hub",               callback: () => this.activateView() });
    this.addCommand({ id: "open-today",    name: "People Hub: Today",             callback: () => this.activateView("today") });
    this.addCommand({ id: "open-birthday", name: "People Hub: Birthday calendar", callback: () => this.activateView("birthdays") });
    this.addCommand({ id: "open-carnegie", name: "People Hub: Carnegie scores",   callback: () => this.activateView("carnegie") });
    this.addCommand({ id: "new-person",    name: "People Hub: New person",        callback: () => this.newPerson() });
    this.addCommand({
      id: "log-talk", name: "People Hub: Log talk",
      callback: () => {
        const f = this.app.workspace.getActiveFile();
        const p = f && this.index.all().find(x => x.file.path === f.path);
        p ? this.logFor(p) : new PersonPicker(this.app, this.index.all(), x => this.logFor(x)).open();
      },
    });
    this.addCommand({
      id: "quick-log", name: "People Hub: Quick-log (one-tap sheet)",
      callback: () => {
        const f = this.app.workspace.getActiveFile();
        const p = f && this.index.all().find(x => x.file.path === f.path);
        p ? this.quickLogFor(p) : new PersonPicker(this.app, this.index.all(), x => this.quickLogFor(x)).open();
      },
    });
    this.addCommand({
      id: "carnegie-active", name: "People Hub: Carnegie for active note",
      callback: () => {
        const f = this.app.workspace.getActiveFile();
        const p = f && this.index.all().find(x => x.file.path === f.path);
        p ? this.carnegieFor(p) : new PersonPicker(this.app, this.index.all(), x => this.carnegieFor(x)).open();
      },
    });
    this.addCommand({
      id: "insert-reachout", name: "People Hub: Insert reach-out list",
      editorCallback: (e: Editor) => {
        const rows = this.index.reachOut();
        e.replaceSelection(rows.length ? rows.map(p => `- 📞 [[${p.file.basename}]] — ${reachOutMeta(p)}`).join("\n") + "\n" : "Everyone reached. 🎉\n");
      },
    });
    this.addCommand({
      id: "insert-birthdays", name: "People Hub: Insert upcoming birthdays",
      editorCallback: (e: Editor) => {
        const rows = this.index.upcomingBirthdays(this.settings.birthdayLookahead);
        e.replaceSelection(rows.length ? rows.map(p => `- 🎂 [[${p.file.basename}]] — ${birthdayMeta(p)}`).join("\n") + "\n" : "No upcoming birthdays.\n");
      },
    });
    this.addCommand({
      id: "insert-anniversaries", name: "People Hub: Insert upcoming anniversaries",
      editorCallback: (e: Editor) => {
        const rows = this.index.upcomingAnniversaries(this.settings.anniversaryLookahead);
        e.replaceSelection(rows.length ? rows.map(p => `- 💍 [[${p.file.basename}]] — ${anniversaryMeta(p)}`).join("\n") + "\n" : "No upcoming anniversaries.\n");
      },
    });
    this.addCommand({ id: "quickadd-person", name: "People Hub: New person via QuickAdd",
      callback: async () => { const ok = await runQuickAddMacro(this.app, this.settings.quickAddMacroName); if (!ok) new NewPersonModal(this.app, this).open(); },
    });
    this.addCommand({ id: "refresh", name: "People Hub: Refresh index", callback: () => this.refresh(true) });
  }

  private registerCodeBlock() {
    this.registerMarkdownCodeBlockProcessor("people", (src: string, el: HTMLElement) => {
      const cfg: Record<string, string> = {};
      for (const line of src.split("\n")) { const m = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/); if (m) cfg[m[1].toLowerCase()] = m[2]; }
      const view = (cfg.view ?? "reachout").toLowerCase();
      const days = parseInt(cfg.days ?? "", 10);
      const box  = el.createDiv({ cls: "ph-root ph-embed" });
      const list = box.createDiv({ cls: "ph-list" });
      type M = (p: PersonView) => string;
      let rows: PersonView[]; let meta: M;
      if (view === "birthdays")     { rows = this.index.upcomingBirthdays(days || this.settings.birthdayLookahead); meta = birthdayMeta; }
      else if (view === "anniversaries") { rows = this.index.upcomingAnniversaries(days || this.settings.anniversaryLookahead); meta = anniversaryMeta; }
      else if (view === "carnegie") { rows = this.index.carnegieAlert(3); meta = p => `Carnegie avg ${p.carnegie.avg}/5`; }
      else                          { rows = this.index.reachOut(); meta = reachOutMeta; }
      if (!rows.length) { list.createDiv({ text: "Nothing to show.", cls: "ph-empty" }); return; }
      rows.forEach(p => {
        const row = list.createDiv({ cls: ["ph-row", `ph-tier-${p.tier}`] });
        const a = row.createEl("a", { text: p.name, cls: "ph-name" });
        a.addEventListener("click", ev => { ev.preventDefault(); this.openPerson(p, ev.ctrlKey || ev.metaKey); });
        row.createDiv({ text: meta(p), cls: "ph-meta" });
      });
    });
  }

  private registerChangeEvents() {
    const onChange = debounce(() => this.refresh(), 500, true);
    this.registerEvent(this.app.metadataCache.on("changed", (f: TFile) => { if (this.index.isPersonFile(f)) onChange(); }));
    this.registerEvent(this.app.metadataCache.on("deleted", () => onChange()));
    this.registerEvent(this.app.vault.on("rename", () => onChange()));
    this.registerInterval(window.setInterval(() => this.refresh(), 60 * 60 * 1000));
  }
}

export default PeopleHubPlugin;
