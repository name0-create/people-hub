// ─── DirectoryView (main window) ──────────────────────────────────────────────
// A full-page People directory: header, search, sort, company/tag filters and a
// responsive card grid. Reads IndexEntry records from PeopleIndex (never the vault),
// so it stays fast and always matches the index. Selecting a card opens the note.

import { ItemView, Menu, setIcon, WorkspaceLeaf } from "obsidian";
import type { PeopleHubPlugin } from "../main";
import {
  companyOptions, DEFAULT_QUERY, DirectoryQuery, filterAndSort, initials,
  listable, SORT_OPTIONS, SortKey, tagOptions,
} from "../core/directory";
import type { IndexEntry } from "../models/IndexEntry";
import { resolvePhotoSrc } from "./photo";

export const DIRECTORY_VIEW_TYPE = "people-hub-directory";

export class DirectoryView extends ItemView {
  private query: DirectoryQuery = { ...DEFAULT_QUERY };

  private subtitleEl!: HTMLElement;
  private companySel!: HTMLSelectElement;
  private tagSel!: HTMLSelectElement;
  private countEl!: HTMLElement;
  private gridEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: PeopleHubPlugin) {
    super(leaf);
  }

  getViewType()    { return DIRECTORY_VIEW_TYPE; }
  getDisplayText() { return "People"; }
  getIcon()        { return "users"; }

  async onOpen() {
    this.addAction("refresh-cw", "Refresh people", () => this.plugin.refresh(true));
    this.build();
    this.update();
  }

  async onClose() { /* nothing to release */ }

  // ── Structure (built once; update() refreshes the data in place) ──────────
  private build() {
    const root = this.contentEl;
    root.empty();
    root.addClass("ph-dir");
    const wrap = root.createDiv({ cls: "ph-dir-wrap" });

    // Header
    const head = wrap.createDiv({ cls: "ph-dir-head" });
    const titles = head.createDiv({ cls: "ph-dir-titles" });
    titles.createDiv({ cls: "ph-dir-eyebrow", text: "PEOPLE HUB" });
    titles.createEl("h1", { cls: "ph-dir-title", text: "People" });
    this.subtitleEl = titles.createDiv({ cls: "ph-dir-subtitle" });

    const add = head.createEl("button", { cls: "ph-dir-add", attr: { "aria-label": "Add person" } });
    setIcon(add.createSpan({ cls: "ph-dir-add-icon" }), "user-plus");
    add.createSpan({ text: "Add person" });
    add.addEventListener("click", () => this.plugin.newPerson());

    // Search + sort
    const bar = wrap.createDiv({ cls: "ph-dir-bar" });
    const searchWrap = bar.createDiv({ cls: "ph-dir-search" });
    setIcon(searchWrap.createSpan({ cls: "ph-dir-search-icon" }), "search");
    const input = searchWrap.createEl("input", {
      type: "search", placeholder: "Search people", cls: "ph-dir-input",
      attr: { "aria-label": "Search people" },
    });
    input.value = this.query.text;
    input.addEventListener("input", () => { this.query.text = input.value; this.renderResults(); });

    const sort = bar.createEl("select", { cls: ["dropdown", "ph-dir-select", "ph-dir-sort"], attr: { "aria-label": "Sort" } });
    for (const o of SORT_OPTIONS) sort.createEl("option", { value: o.key, text: o.label });
    sort.value = this.query.sort;
    sort.addEventListener("change", () => { this.query.sort = sort.value as SortKey; this.renderResults(); });

    // Filters
    const filters = wrap.createDiv({ cls: "ph-dir-filters" });
    this.companySel = filters.createEl("select", { cls: ["dropdown", "ph-dir-select"], attr: { "aria-label": "Company" } });
    this.companySel.addEventListener("change", () => { this.query.company = this.companySel.value; this.renderResults(); });
    this.tagSel = filters.createEl("select", { cls: ["dropdown", "ph-dir-select"], attr: { "aria-label": "Tag" } });
    this.tagSel.addEventListener("change", () => { this.query.tag = this.tagSel.value; this.renderResults(); });

    this.countEl = wrap.createDiv({ cls: "ph-dir-count" });
    this.gridEl = wrap.createDiv({ cls: "ph-dir-grid" });
  }

  // ── Data refresh (keeps search text, focus, selections) ───────────────────
  /** Re-read the index: header, filter options and results. Safe to call on every index change. */
  update() {
    const all = listable(this.plugin.index.entries());
    const folder = this.plugin.settings.peopleFolder;
    this.subtitleEl.setText(`${all.length} ${all.length === 1 ? "person" : "people"}${folder ? ` in ${folder}` : ""}`);

    this.query.company = this.fillSelect(this.companySel, "All companies", companyOptions(all), this.query.company);
    this.query.tag     = this.fillSelect(this.tagSel,     "All tags",      tagOptions(all),     this.query.tag);
    this.renderResults(all);
  }

  /** Rebuild a <select>'s options; returns the (possibly reset) selected value. */
  private fillSelect(sel: HTMLSelectElement, allLabel: string, options: string[], current: string): string {
    const wanted = options.find(o => o.toLowerCase() === current.toLowerCase()) ?? "";
    sel.empty();
    sel.createEl("option", { value: "", text: allLabel });
    for (const o of options) sel.createEl("option", { value: o, text: o });
    sel.value = wanted;
    return wanted;
  }

  private renderResults(all = listable(this.plugin.index.entries())) {
    const rows = filterAndSort(all, this.query);
    this.countEl.setText(rows.length === all.length
      ? `${rows.length} ${rows.length === 1 ? "person" : "people"}`
      : `${rows.length} of ${all.length} people`);

    this.gridEl.empty();
    if (!rows.length) {
      const empty = this.gridEl.createDiv({ cls: "ph-dir-empty" });
      empty.createDiv({ text: all.length ? "No one matches those filters." : "No people yet." });
      if (!all.length) {
        empty.createEl("button", { cls: "ph-dir-add", text: "Add your first person" })
          .addEventListener("click", () => this.plugin.newPerson());
      }
      return;
    }
    for (const e of rows) this.renderCard(e);
  }

  // ── Card ──────────────────────────────────────────────────────────────────
  private renderCard(e: IndexEntry) {
    const label = e.display_name || e.name;
    const card = this.gridEl.createDiv({
      cls: "ph-dir-card",
      attr: { tabindex: 0, role: "link", "aria-label": label },
    });

    const avatar = card.createDiv({ cls: "ph-dir-avatar" });
    const src = resolvePhotoSrc(this.app, e.photo, e.path);
    const showInitials = () => { avatar.empty(); avatar.setText(initials(label)); };
    if (src) {
      const img = avatar.createEl("img", { attr: { src, alt: "", loading: "lazy" } });
      img.addEventListener("error", showInitials);
    } else {
      showInitials();
    }

    const body = card.createDiv({ cls: "ph-dir-body" });
    body.createDiv({ cls: "ph-dir-name", text: label, attr: { title: label } });
    const sub = e.company.join(", ") || e.role || "";
    if (sub) body.createDiv({ cls: "ph-dir-sub", text: sub });
    if (e.last_contacted) body.createDiv({ cls: "ph-dir-meta", text: `Last contact ${e.last_contacted}` });

    if (e.favorite) {
      setIcon(card.createDiv({ cls: "ph-dir-star", attr: { "aria-label": "Favorite" } }), "star");
    }

    const open = (newTab: boolean) => {
      const p = this.plugin.index.view(e.path);
      if (p) this.plugin.openPerson(p, newTab);
    };
    card.addEventListener("click", ev => open(ev.ctrlKey || ev.metaKey));
    card.addEventListener("auxclick", ev => { if (ev.button === 1) { ev.preventDefault(); open(true); } });
    card.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(ev.ctrlKey || ev.metaKey); }
    });
    card.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      const p = this.plugin.index.view(e.path);
      if (!p) return;
      const menu = new Menu();
      menu.addItem(i => i.setTitle("Open").setIcon("file-text").onClick(() => this.plugin.openPerson(p, false)));
      menu.addItem(i => i.setTitle("Open in new tab").setIcon("file-plus").onClick(() => this.plugin.openPerson(p, true)));
      menu.addSeparator();
      menu.addItem(i => i.setTitle("Log talk").setIcon("message-circle").onClick(() => this.plugin.logFor(p)));
      menu.addItem(i => i.setTitle("Quick log").setIcon("zap").onClick(() => this.plugin.quickLogFor(p)));
      menu.showAtMouseEvent(ev);
    });
  }
}
