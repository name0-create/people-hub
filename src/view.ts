import { ItemView, WorkspaceLeaf } from "obsidian";
import type PeopleHubPlugin from "./main";
import { diffDays, today } from "./dates";
import { Person, TIERS } from "./types";
import { birthdayMeta, meetingMeta, reachOutMeta, relDays, renderPersonRow } from "./ui";

export const VIEW_TYPE = "people-hub-view";
export type Tab = "today" | "people" | "birthdays" | "meetings";

export class PeopleView extends ItemView {
  tab: Tab;
  private calYear: number;
  private calMonth: number;
  private search = "";
  private filter = "all";

  constructor(leaf: WorkspaceLeaf, private plugin: PeopleHubPlugin) {
    super(leaf);
    const n = today();
    this.calYear = n.getFullYear();
    this.calMonth = n.getMonth();
    this.tab = plugin.pendingTab ?? "today";
    plugin.pendingTab = null;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "People Hub"; }
  getIcon() { return "users"; }
  async onOpen() { this.render(true); }

  setTab(t: Tab) { this.tab = t; this.render(true); }

  render(force = false) {
    const active = document.activeElement;
    if (!force && active instanceof HTMLInputElement && this.contentEl.contains(active)) return;
    const el = this.contentEl;
    el.empty();
    el.addClass("ph-root");

    const head = el.createDiv({ cls: "ph-head" });
    const nav = head.createDiv({ cls: "ph-tabs" });
    const tabs: [Tab, string][] = [["today", "Today"], ["people", "People"], ["birthdays", "Birthdays"], ["meetings", "Meetings"]];
    for (const [id, label] of tabs) {
      const b = nav.createEl("button", { text: label, cls: ["ph-tab"] });
      if (id === this.tab) b.addClass("is-active");
      b.addEventListener("click", () => this.setTab(id));
    }
    head.createEl("button", { text: "+", cls: ["ph-btn", "ph-add"], attr: { "aria-label": "New person" } })
      .addEventListener("click", () => this.plugin.newPerson());

    const body = el.createDiv({ cls: "ph-body" });
    if (this.tab === "today") this.renderToday(body);
    else if (this.tab === "people") this.renderPeople(body);
    else if (this.tab === "birthdays") this.renderBirthdays(body);
    else this.renderMeetings(body);
  }

  private section(parent: HTMLElement, title: string, count: number, fill: (list: HTMLElement) => void, empty: string) {
    const sec = parent.createDiv({ cls: "ph-section" });
    sec.createEl("h4", { text: `${title} (${count})` });
    if (!count) sec.createDiv({ text: empty, cls: "ph-empty" });
    else fill(sec.createDiv({ cls: "ph-list" }));
  }

  private renderToday(body: HTMLElement) {
    const idx = this.plugin.index, s = this.plugin.settings;
    const b = idx.upcomingBirthdays(s.birthdayLookahead);
    this.section(body, `🎂 Birthdays · ${s.birthdayLookahead}d`, b.length,
      l => b.forEach(p => renderPersonRow(this.plugin, l, p, birthdayMeta(p), false)), "Nothing coming up.");
    const r = idx.reachOut();
    this.section(body, "📞 Reach out", r.length,
      l => r.forEach(p => renderPersonRow(this.plugin, l, p, reachOutMeta(p), true)), "You're all caught up. 🎉");
    const m = idx.meetings(s.meetingLookahead);
    this.section(body, `📅 Meetings · ${s.meetingLookahead}d`, m.length,
      l => m.forEach(p => renderPersonRow(this.plugin, l, p, meetingMeta(p), true)), "No meetings scheduled.");
  }

  private renderPeople(body: HTMLElement) {
    const bar = body.createDiv({ cls: "ph-bar" });
    const input = bar.createEl("input", { type: "text", placeholder: "Search…", cls: "ph-search" });
    input.value = this.search;
    const sel = bar.createEl("select", { cls: "dropdown" });
    for (const [v, l] of [["all", "All"], ["due", "Due"], ...TIERS.map(t => [t, t])]) sel.createEl("option", { value: v, text: l });
    sel.value = this.filter;
    const list = body.createDiv({ cls: "ph-list" });
    const draw = () => {
      list.empty();
      const q = this.search.toLowerCase();
      const rows = this.plugin.index.all().filter(p =>
        (!q || `${p.name} ${p.company} ${p.role}`.toLowerCase().includes(q)) &&
        (this.filter === "all" || (this.filter === "due" ? p.needsReachOut : p.tier === this.filter)));
      if (!rows.length) list.createDiv({ text: "No matches.", cls: "ph-empty" });
      rows.forEach(p => renderPersonRow(this.plugin, list, p,
        [p.tier, p.company, p.sinceContact === null ? "never contacted" : `last ${p.sinceContact}d ago`, p.paused ? "⏸ paused" : ""].filter(Boolean).join(" · "), true));
    };
    input.addEventListener("input", () => { this.search = input.value; draw(); });
    sel.addEventListener("change", () => { this.filter = sel.value; draw(); });
    draw();
  }

  private renderBirthdays(body: HTMLElement) {
    const s = this.plugin.settings, idx = this.plugin.index;
    const nav = body.createDiv({ cls: "ph-calnav" });
    const shift = (d: number) => {
      const dt = new Date(this.calYear, this.calMonth + d, 1);
      this.calYear = dt.getFullYear(); this.calMonth = dt.getMonth(); this.render(true);
    };
    nav.createEl("button", { text: "‹", cls: "ph-btn" }).addEventListener("click", () => shift(-1));
    nav.createSpan({ text: new Date(this.calYear, this.calMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }), cls: "ph-calttl" });
    nav.createEl("button", { text: "›", cls: "ph-btn" }).addEventListener("click", () => shift(1));
    nav.createEl("button", { text: "Today", cls: "ph-btn" }).addEventListener("click", () => {
      const n = today(); this.calYear = n.getFullYear(); this.calMonth = n.getMonth(); this.render(true);
    });

    const grid = body.createDiv({ cls: "ph-cal" });
    const names = ["S", "M", "T", "W", "T", "F", "S"];
    for (let i = 0; i < 7; i++) grid.createDiv({ text: names[(i + s.weekStartsOn) % 7], cls: "ph-calhd" });
    const first = new Date(this.calYear, this.calMonth, 1);
    const offset = (first.getDay() - s.weekStartsOn + 7) % 7;
    const dim = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    const total = Math.ceil((offset + dim) / 7) * 7;
    const map = idx.birthdaysInMonth(this.calYear, this.calMonth);
    const t = today();
    for (let i = 0; i < total; i++) {
      const day = i - offset + 1;
      const cell = grid.createDiv({ cls: "ph-cell" });
      if (day < 1 || day > dim) { cell.addClass("is-out"); continue; }
      if (t.getFullYear() === this.calYear && t.getMonth() === this.calMonth && t.getDate() === day) cell.addClass("is-today");
      cell.createDiv({ text: String(day), cls: "ph-daynum" });
      for (const p of map.get(day) ?? []) {
        const chip = cell.createEl("a", { text: p.name.split(" ")[0], cls: ["ph-chip"], attr: { "aria-label": p.name } });
        chip.addEventListener("click", e => { e.preventDefault(); this.plugin.openPerson(p, e.ctrlKey || e.metaKey); });
      }
    }

    const up = idx.upcomingBirthdays(60);
    this.section(body, "Next 60 days", up.length,
      l => up.forEach(p => renderPersonRow(this.plugin, l, p, birthdayMeta(p), false)), "None.");
    const miss = idx.missingBirthdays();
    this.section(body, "No birthday on file", miss.length,
      l => miss.forEach(p => renderPersonRow(this.plugin, l, p, "", false)), "Everyone has one. 👏");
  }

  private renderMeetings(body: HTMLElement) {
    const idx = this.plugin.index;
    const un = idx.unloggedMeetings();
    if (un.length) this.section(body, "⚠️ Past, not logged", un.length,
      l => un.forEach(p => renderPersonRow(this.plugin, l, p, `${meetingMeta(p)} · ${relDays(diffDays(today(), p.nextEncounter!))}`, true)), "");
    const m = idx.meetings(365);
    this.section(body, "Upcoming", m.length,
      l => m.forEach(p => renderPersonRow(this.plugin, l, p, meetingMeta(p), true)), "No meetings scheduled. Set next_encounter on a person.");
  }
}
