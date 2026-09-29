import { ItemView, WorkspaceLeaf } from "obsidian";
import type PeopleHubPlugin from "./main";
import { diffDays, today } from "./dates";
import { CARNEGIE_LABELS, Person, TIERS } from "./types";
import { birthdayMeta, carnegieBar, reachOutMeta, relDays, renderPersonRow, renderSocials } from "./ui";

export const VIEW_TYPE = "people-hub-view";
export type Tab = "today" | "people" | "birthdays" | "carnegie";

export class PeopleView extends ItemView {
  tab: Tab;
  private calYear: number; private calMonth: number;
  private search = ""; private filter = "all";

  constructor(leaf: WorkspaceLeaf, private plugin: PeopleHubPlugin) {
    super(leaf);
    const n = today();
    this.calYear = n.getFullYear(); this.calMonth = n.getMonth();
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
    const el = this.contentEl; el.empty(); el.addClass("ph-root");

    const head = el.createDiv({ cls: "ph-head" });
    const nav = head.createDiv({ cls: "ph-tabs" });
    const tabs: [Tab, string][] = [["today", "Today"], ["people", "People"], ["birthdays", "Birthdays"], ["carnegie", "Carnegie"]];
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
    else this.renderCarnegie(body);
  }

  private section(parent: HTMLElement, title: string, count: number, fill: (l: HTMLElement) => void, empty: string) {
    const sec = parent.createDiv({ cls: "ph-section" });
    sec.createEl("h4", { text: `${title} (${count})` });
    if (!count) sec.createDiv({ text: empty, cls: "ph-empty" });
    else fill(sec.createDiv({ cls: "ph-list" }));
  }

  // ─── TODAY ──────────────────────────────────────────────────────────────────
  private renderToday(body: HTMLElement) {
    const idx = this.plugin.index, s = this.plugin.settings;

    // Birthdays today
    const bToday = idx.upcomingBirthdays(0);
    if (bToday.length) this.section(body, "🎂 Birthdays today", bToday.length,
      l => bToday.forEach(p => renderPersonRow(this.plugin, l, p, birthdayMeta(p), false)), "");

    // Upcoming birthdays
    const b = idx.upcomingBirthdays(s.birthdayLookahead).filter(p => p.birthday!.days > 0);
    this.section(body, `🎂 Upcoming · ${s.birthdayLookahead}d`, b.length,
      l => b.forEach(p => renderPersonRow(this.plugin, l, p, birthdayMeta(p), false)), "Nothing coming up.");

    // Reach out
    const r = idx.reachOut();
    this.section(body, "📞 Reach out", r.length,
      l => r.forEach(p => renderPersonRow(this.plugin, l, p, reachOutMeta(p), true)), "You're all caught up. 🎉");

    // Carnegie alerts
    const c = idx.carnegieAlert(3);
    if (c.length) this.section(body, "⚠️ Carnegie avg < 3", c.length,
      l => c.forEach(p => {
        renderPersonRow(this.plugin, l, p, `Avg ${p.carnegie.avg}/5 · Weakest: ${p.carnegie.weakestLabel}`, true);
      }), "");

    // Promise alerts
    const pr = idx.promiseAlert(80);
    if (pr.length) this.section(body, "🤝 Promises < 80%", pr.length,
      l => pr.forEach(p => renderPersonRow(this.plugin, l, p,
        `${p.promisesKept}/${p.promisesMade} · ${p.promiseRatio}%`, true)), "");
  }

  // ─── PEOPLE ─────────────────────────────────────────────────────────────────
  private renderPeople(body: HTMLElement) {
    const bar = body.createDiv({ cls: "ph-bar" });
    const input = bar.createEl("input", { type: "text", placeholder: "Search…", cls: "ph-search" });
    input.value = this.search;
    const sel = bar.createEl("select", { cls: "dropdown" });
    for (const [v, l] of [["all", "All"], ["due", "Due now"], ...TIERS.map(t => [t, t])]) sel.createEl("option", { value: v, text: l });
    sel.value = this.filter;
    const list = body.createDiv({ cls: "ph-list" });
    const draw = () => {
      list.empty();
      const q = this.search.toLowerCase();
      const rows = this.plugin.index.all().filter(p =>
        (!q || `${p.name} ${p.typePerson} ${p.alsoIs} ${p.company} ${p.interests}`.toLowerCase().includes(q)) &&
        (this.filter === "all" || (this.filter === "due" ? p.needsReachOut : p.tier === this.filter)));
      if (!rows.length) { list.createDiv({ text: "No matches.", cls: "ph-empty" }); return; }
      rows.forEach(p => {
        const meta = [
          p.typePerson, p.frequency,
          p.sinceContact !== null ? `last ${p.sinceContact}d ago` : "never contacted",
          p.healthScore > 0 ? `H${p.healthScore}/5` : "",
          p.needsReachOut ? "🔴 due" : "",
          p.paused ? "⏸" : ""
        ].filter(Boolean).join(" · ");
        renderPersonRow(this.plugin, list, p, meta, true);
      });
    };
    input.addEventListener("input", () => { this.search = input.value; draw(); });
    sel.addEventListener("change", () => { this.filter = sel.value; draw(); });
    draw();
  }

  // ─── BIRTHDAYS ──────────────────────────────────────────────────────────────
  private renderBirthdays(body: HTMLElement) {
    const idx = this.plugin.index, s = this.plugin.settings;
    const nav = body.createDiv({ cls: "ph-calnav" });
    const shift = (d: number) => { const dt = new Date(this.calYear, this.calMonth + d, 1); this.calYear = dt.getFullYear(); this.calMonth = dt.getMonth(); this.render(true); };
    nav.createEl("button", { text: "‹", cls: "ph-btn" }).addEventListener("click", () => shift(-1));
    nav.createSpan({ text: new Date(this.calYear, this.calMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }), cls: "ph-calttl" });
    nav.createEl("button", { text: "›", cls: "ph-btn" }).addEventListener("click", () => shift(1));
    nav.createEl("button", { text: "Today", cls: "ph-btn" }).addEventListener("click", () => { const n = today(); this.calYear = n.getFullYear(); this.calMonth = n.getMonth(); this.render(true); });

    const grid = body.createDiv({ cls: "ph-cal" });
    const dayNames = ["S","M","T","W","T","F","S"];
    for (let i = 0; i < 7; i++) grid.createDiv({ text: dayNames[(i + s.weekStartsOn) % 7], cls: "ph-calhd" });
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
        const chip = cell.createEl("a", { text: p.name.split(" ")[0], cls: "ph-chip", attr: { "aria-label": p.name } });
        chip.addEventListener("click", e => { e.preventDefault(); this.plugin.openPerson(p, e.ctrlKey || e.metaKey); });
      }
    }
    const up = idx.upcomingBirthdays(60);
    this.section(body, "Next 60 days", up.length, l => up.forEach(p => renderPersonRow(this.plugin, l, p, birthdayMeta(p), false)), "None.");
    const miss = idx.missingBirthdays();
    this.section(body, "No birthday on file", miss.length, l => miss.forEach(p => renderPersonRow(this.plugin, l, p, p.typePerson, false)), "Everyone has one. 👏");
  }

  // ─── CARNEGIE ───────────────────────────────────────────────────────────────
  private renderCarnegie(body: HTMLElement) {
    const idx = this.plugin.index;
    const all = idx.all().filter(p => p.active && !p.paused);

    // Summary dashboard
    const dash = body.createDiv({ cls: "ph-c-dash" });
    const byPrinciple: Record<string, number[]> = {};
    for (let i = 1; i <= 9; i++) byPrinciple[`c${i}`] = [];
    let peopleWithScores = 0;
    for (const p of all) {
      const c = p.carnegie;
      if (c.avg === 0) continue;
      peopleWithScores++;
      for (let i = 1; i <= 9; i++) (byPrinciple[`c${i}`]).push((c as any)[`c${i}`]);
    }
    if (peopleWithScores > 0) {
      dash.createEl("h4", { text: `Carnegie avg across ${peopleWithScores} people` });
      const grid = dash.createDiv({ cls: "ph-c-grid" });
      for (let i = 1; i <= 9; i++) {
        const key = `c${i}`;
        const scores = byPrinciple[key];
        const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        const cell = grid.createDiv({ cls: "ph-c-cell" });
        cell.createSpan({ text: `C${i}`, cls: "ph-c-num" });
        carnegieBar(cell, Math.round(avg * 10) / 10, CARNEGIE_LABELS[key]);
        cell.createDiv({ text: CARNEGIE_LABELS[key], cls: "ph-c-label" });
      }
    }

    // Low scorers
    const low = idx.carnegieAlert(3);
    this.section(body, "⚠️ Needs work (avg < 3)", low.length,
      l => low.forEach(p => {
        const row = l.createDiv({ cls: ["ph-row", `ph-tier-${p.tier}`] });
        const main = row.createDiv({ cls: "ph-row-main" });
        const a = main.createEl("a", { text: p.name, cls: "ph-name" });
        a.addEventListener("click", e => { e.preventDefault(); this.plugin.openPerson(p, e.ctrlKey || e.metaKey); });
        main.createDiv({ text: `Avg ${p.carnegie.avg}/5 · Weakest: C${p.carnegie.weakest.slice(1)} ${p.carnegie.weakestLabel}`, cls: "ph-meta" });
        carnegieBar(main, p.carnegie.avg, p.carnegie.weakestLabel);
        const btn = row.createDiv({ cls: "ph-actions" });
        btn.createEl("button", { text: "View", cls: "ph-btn" }).addEventListener("click", () => this.plugin.carnegieFor(p));
      }), "No one below 3. 🎉");

    // All with scores, sorted by avg ascending (most needing work first)
    const scored = all.filter(p => p.carnegie.avg > 0).sort((a, b) => a.carnegie.avg - b.carnegie.avg);
    this.section(body, "All scores", scored.length, l => {
      scored.forEach(p => {
        const row = l.createDiv({ cls: ["ph-row", `ph-tier-${p.tier}`] });
        const main = row.createDiv({ cls: "ph-row-main" });
        const a = main.createEl("a", { text: p.name, cls: "ph-name" });
        a.addEventListener("click", e => { e.preventDefault(); this.plugin.openPerson(p, e.ctrlKey || e.metaKey); });
        if (p.typePerson) main.createSpan({ text: " · " + p.typePerson, cls: "ph-type" });
        carnegieBar(main, p.carnegie.avg, p.carnegie.weakestLabel);
        row.createDiv({ cls: "ph-actions" }).createEl("button", { text: "View", cls: "ph-btn" })
          .addEventListener("click", () => this.plugin.carnegieFor(p));
      });
    }, "No Carnegie scores yet. Fill c1_score … c9_score in each person's frontmatter.");
  }
}
