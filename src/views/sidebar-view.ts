// ─── PeopleView (sidebar) ─────────────────────────────────────────────────────

import { ItemView, WorkspaceLeaf } from "obsidian";
import type { PeopleHubPlugin } from "../main";
import { today, diffDays } from "../core/dates";
import { CARNEGIE_LABELS, PersonView, TIERS } from "../models/person-view";
import {
  anniversaryMeta, birthdayMeta, carnegieBar,
  reachOutMeta, relDays, renderPersonRow,
} from "./ui";
import { SwipeHandler } from "./quick-log-sheet";
import { renderBirthdaysPanel } from "./birthdays-panel";

export const VIEW_TYPE = "people-hub-view";
export type Tab = "today" | "people" | "birthdays" | "carnegie";

export class PeopleView extends ItemView {
  tab: Tab;
  private calYear:  number;
  private calMonth: number;
  private search = "";
  private filter = "all";
  private swipe: SwipeHandler | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: PeopleHubPlugin) {
    super(leaf);
    const n = today();
    this.calYear  = n.getFullYear();
    this.calMonth = n.getMonth();
    this.tab = this.plugin.pendingTab ?? "today";
    this.plugin.pendingTab = null;
  }

  getViewType()    { return VIEW_TYPE; }
  getDisplayText() { return "People Hub"; }
  getIcon()        { return "users"; }

  async onOpen()  { this.render(true); }
  async onClose() { this.swipe?.detach(); }
  setTab(t: Tab)  { this.tab = t; this.render(true); }

  // ── Render ────────────────────────────────────────────────────────────────
  render(force = false) {
    const active = document.activeElement;
    if (!force && active instanceof HTMLInputElement && this.contentEl.contains(active)) return;

    // detach old swipe handler
    this.swipe?.detach();
    this.swipe = null;

    const el = this.contentEl;
    el.empty();
    el.addClass("ph-root");

    // ── Tabs + new button ────────────────────────────────────────────────
    const head = el.createDiv({ cls: "ph-head" });
    const nav  = head.createDiv({ cls: "ph-tabs" });
    const tabs: [Tab, string][] = [
      ["today", "Today"], ["people", "People"],
      ["birthdays", "Birthdays"], ["carnegie", "Carnegie"],
    ];
    for (const [id, label] of tabs) {
      const b = nav.createEl("button", { text: label, cls: "ph-tab" });
      if (id === this.tab) b.addClass("is-active");
      b.addEventListener("click", () => this.setTab(id));
    }
    head.createEl("button", { text: "+", cls: ["ph-btn", "ph-add"], attr: { "aria-label": "New person" } })
      .addEventListener("click", () => this.plugin.newPerson());

    // ── Body ─────────────────────────────────────────────────────────────
    const body = el.createDiv({ cls: "ph-body" });
    if      (this.tab === "today")     this.renderToday(body);
    else if (this.tab === "people")    this.renderPeople(body);
    else if (this.tab === "birthdays") this.renderBirthdays(body);
    else                               this.renderCarnegie(body);
  }

  // ── Section helper ────────────────────────────────────────────────────────
  private section(
    parent: HTMLElement, title: string, count: number,
    fill: (l: HTMLElement) => void, empty: string,
  ) {
    const sec = parent.createDiv({ cls: "ph-section" });
    sec.createEl("h4", { text: `${title} (${count})` });
    if (!count) sec.createDiv({ text: empty, cls: "ph-empty" });
    else fill(sec.createDiv({ cls: "ph-list" }));
  }

  // ── Swipe attachment ──────────────────────────────────────────────────────
  private attachSwipe(container: HTMLElement) {
    if (!this.plugin.settings.mobileSwipeLog) return;
    this.swipe = new SwipeHandler(
      container,
      (el) => (el as any).__person ?? null,
      (p)  => this.plugin.quickLogFor(p),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TODAY TAB
  // ─────────────────────────────────────────────────────────────────────────
  private renderToday(body: HTMLElement) {
    const idx = this.plugin.index;
    const s   = this.plugin.settings;

    // Birthday today
    const bToday = idx.upcomingBirthdays(0);
    if (bToday.length) {
      this.section(body, "🎂 Birthday today", bToday.length,
        l => { bToday.forEach(p => renderPersonRow(this.plugin, l, p, birthdayMeta(p), false)); },
        "",
      );
    }

    // Anniversary today
    const aToday = idx.upcomingAnniversaries(0);
    if (aToday.length) {
      this.section(body, "💍 Anniversary today", aToday.length,
        l => { aToday.forEach(p => renderPersonRow(this.plugin, l, p, anniversaryMeta(p), false)); },
        "",
      );
    }

    // Upcoming birthdays
    const bUp = idx.upcomingBirthdays(s.birthdayLookahead).filter(p => p.birthday!.days > 0);
    this.section(body, `🎂 Birthdays · ${s.birthdayLookahead}d`, bUp.length,
      l => { bUp.forEach(p => renderPersonRow(this.plugin, l, p, birthdayMeta(p), false)); },
      "Nothing coming up.",
    );

    // Upcoming anniversaries
    const aUp = idx.upcomingAnniversaries(s.anniversaryLookahead).filter(p => p.anniversary!.days > 0);
    if (aUp.length) {
      this.section(body, `💍 Anniversaries · ${s.anniversaryLookahead}d`, aUp.length,
        l => { aUp.forEach(p => renderPersonRow(this.plugin, l, p, anniversaryMeta(p), false)); },
        "",
      );
    }

    // Reach out — with swipe
    const reach = idx.reachOut();
    this.section(body, "📞 Reach out", reach.length,
      l => {
        reach.forEach(p => renderPersonRow(this.plugin, l, p, reachOutMeta(p), true));
        this.attachSwipe(l);
      },
      "You're all caught up. 🎉",
    );

    // Carnegie alerts
    const cLow = idx.carnegieAlert(3);
    if (cLow.length) {
      this.section(body, "⚠️ Carnegie avg < 3", cLow.length,
        l => { cLow.forEach(p => renderPersonRow(this.plugin, l, p, `Avg ${p.carnegie.avg}/5 · Weakest: ${p.carnegie.weakestLabel}`, true)); },
        "",
      );
    }

    // Promise alerts
    const prLow = idx.promiseAlert(80);
    if (prLow.length) {
      this.section(body, "🤝 Promises < 80%", prLow.length,
        l => { prLow.forEach(p => renderPersonRow(this.plugin, l, p, `${p.promisesKept}/${p.promisesMade} = ${p.promiseRatio}%`, true)); },
        "",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PEOPLE TAB
  // ─────────────────────────────────────────────────────────────────────────
  private renderPeople(body: HTMLElement) {
    const bar   = body.createDiv({ cls: "ph-bar" });
    const input = bar.createEl("input", { type: "text", placeholder: "Search…", cls: "ph-search" });
    input.value = this.search;

    const sel = bar.createEl("select", { cls: "dropdown" });
    for (const [v, l] of [
      ["all", "All"], ["due", "Due now"],
      ...TIERS.map(t => [t, t] as [string, string]),
    ]) sel.createEl("option", { value: v, text: l });
    sel.value = this.filter;

    const list = body.createDiv({ cls: "ph-list" });
    this.attachSwipe(list);

    const draw = () => {
      list.empty();
      const q    = this.search.toLowerCase();
      const rows = this.plugin.index.all().filter(p =>
        (!q || `${p.name} ${p.typePerson} ${p.alsoIs} ${p.company} ${p.interests}`.toLowerCase().includes(q)) &&
        (this.filter === "all" || (this.filter === "due" ? p.needsReachOut : p.tier === this.filter))
      );
      if (!rows.length) { list.createDiv({ text: "No matches.", cls: "ph-empty" }); return; }
      rows.forEach(p => {
        const meta = [
          p.typePerson, p.frequency,
          p.sinceContact !== null ? `last ${p.sinceContact}d ago` : "never contacted",
          p.healthScore > 0 ? `H${p.healthScore}/5` : "",
          p.needsReachOut ? "🔴 due" : "",
          p.paused ? "⏸" : "",
        ].filter(Boolean).join(" · ");
        renderPersonRow(this.plugin, list, p, meta, true);
      });
    };
    input.addEventListener("input", () => { this.search = input.value; draw(); });
    sel.addEventListener("change", () => { this.filter = sel.value; draw(); });
    draw();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BIRTHDAYS TAB  (see birthdays-panel.ts)
  // ─────────────────────────────────────────────────────────────────────────
  private renderBirthdays(body: HTMLElement) {
    const view = this;
    renderBirthdaysPanel(this.plugin, body, {
      year: this.calYear,
      month: this.calMonth,
      shift(d) {
        const dt = new Date(view.calYear, view.calMonth + d, 1);
        view.calYear = dt.getFullYear();
        view.calMonth = dt.getMonth();
        view.render(true);
      },
      reset() {
        const n = today();
        view.calYear = n.getFullYear();
        view.calMonth = n.getMonth();
        view.render(true);
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CARNEGIE TAB
  // ─────────────────────────────────────────────────────────────────────────
  private renderCarnegie(body: HTMLElement) {
    const idx = this.plugin.index;
    const all = idx.all().filter(p => p.active && !p.paused);

    // Aggregate dashboard
    const dash  = body.createDiv({ cls: "ph-c-dash" });
    const byP: Record<string, number[]> = {};
    for (let i = 1; i <= 9; i++) byP[`c${i}`] = [];
    let scoredCount = 0;
    for (const p of all) {
      const c = p.carnegie;
      if (c.avg === 0) continue;
      scoredCount++;
      for (let i = 1; i <= 9; i++) byP[`c${i}`].push((c as any)[`c${i}`]);
    }
    if (scoredCount > 0) {
      dash.createEl("h4", { text: `Avg across ${scoredCount} people` });
      const grid = dash.createDiv({ cls: "ph-c-grid" });
      for (let i = 1; i <= 9; i++) {
        const key  = `c${i}`;
        const vals = byP[key];
        const avg  = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
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
        const row  = l.createDiv({ cls: ["ph-row", `ph-tier-${p.tier}`] });
        const main = row.createDiv({ cls: "ph-row-main" });
        const a    = main.createEl("a", { text: p.name, cls: "ph-name" });
        a.addEventListener("click", e => { e.preventDefault(); this.plugin.openPerson(p, e.ctrlKey || e.metaKey); });
        main.createDiv({ text: `Avg ${p.carnegie.avg}/5 · Weakest: C${p.carnegie.weakest.slice(1)} ${p.carnegie.weakestLabel}`, cls: "ph-meta" });
        carnegieBar(main, p.carnegie.avg, p.carnegie.weakestLabel);
        row.createDiv({ cls: "ph-actions" })
          .createEl("button", { text: "View", cls: "ph-btn" })
          .addEventListener("click", () => this.plugin.carnegieFor(p));
      }),
      "No one below 3. 🎉",
    );

    // All scored, worst first
    const scored = all.filter(p => p.carnegie.avg > 0).sort((a, b) => a.carnegie.avg - b.carnegie.avg);
    this.section(body, "All scores", scored.length,
      l => scored.forEach(p => {
        const row  = l.createDiv({ cls: ["ph-row", `ph-tier-${p.tier}`] });
        const main = row.createDiv({ cls: "ph-row-main" });
        const a    = main.createEl("a", { text: p.name, cls: "ph-name" });
        a.addEventListener("click", e => { e.preventDefault(); this.plugin.openPerson(p, e.ctrlKey || e.metaKey); });
        if (p.typePerson) main.createSpan({ text: " · " + p.typePerson, cls: "ph-type" });
        carnegieBar(main, p.carnegie.avg, p.carnegie.weakestLabel);
        row.createDiv({ cls: "ph-actions" })
          .createEl("button", { text: "View", cls: "ph-btn" })
          .addEventListener("click", () => this.plugin.carnegieFor(p));
      }),
      "No Carnegie scores yet. Add c1_score … c9_score (0–5) to each person's frontmatter.",
    );
  }
}
