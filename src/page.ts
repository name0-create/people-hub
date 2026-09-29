import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type PeopleHubPlugin from "./main";
import type { Person } from "./types";
import { exportIcs } from "./ics";
import { ImportModal } from "./importer";
import { MeetingModal, renderMeetingLine } from "./meeting";
import { today } from "./dates";

export const PAGE_TYPE = "people-hub-page";
type Sort = "name-asc" | "name-desc" | "contact-recent" | "contact-oldest" | "birthday" | "carnegie";
const SORTS: [Sort, string][] = [
  ["name-asc", "Name (ascending)"], ["name-desc", "Name (descending)"],
  ["contact-recent", "Last contact (recent)"], ["contact-oldest", "Last contact (oldest)"],
  ["birthday", "Next birthday"], ["carnegie", "Carnegie (highest)"]
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export class PeoplePageView extends ItemView {
  private search = ""; private sort: Sort = "name-asc"; private company = ""; private tag = "";
  private tab: "people" | "calendar" = "people";
  private calYear = today().getFullYear(); private calMonth = today().getMonth();

  constructor(leaf: WorkspaceLeaf, private plugin: PeopleHubPlugin) {
    super(leaf);
    this.tab = plugin.pendingPageTab ?? "people"; plugin.pendingPageTab = null;
  }
  setTab(t: "people" | "calendar") { this.tab = t; this.render(true); }
  getViewType() { return PAGE_TYPE; }
  getDisplayText() { return "People"; }
  getIcon() { return "users"; }
  async onOpen() { this.render(true); }

  private photoSrc(p: Person): string | null {
    let v = p.photo.trim();
    if (!v) return null;
    if (/^(https?:|data:)/i.test(v)) return v;
    v = v.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0];
    const md = v.match(/^!?\[[^\]]*\]\(([^)]+)\)/); if (md) v = md[1];
    const f = this.app.metadataCache.getFirstLinkpathDest(v, p.file.path)
      ?? this.app.vault.getAbstractFileByPath(v);
    return f instanceof TFile ? this.app.vault.getResourcePath(f) : null;
  }

  render(force = false) {
    const active = document.activeElement;
    if (!force && active instanceof HTMLInputElement && this.contentEl.contains(active)) return;
    const el = this.contentEl; el.empty(); el.addClass("ph-page");
    const wrap = el.createDiv({ cls: "ph-page-inner" });
    const all = this.plugin.index.all();

    // Header
    const head = wrap.createDiv({ cls: "ph-page-head" });
    const titles = head.createDiv();
    titles.createDiv({ text: "KNOWN", cls: "ph-page-eyebrow" });
    titles.createEl("h1", { text: "People", cls: "ph-page-title" });
    titles.createDiv({ text: `${all.length} people in ${this.plugin.settings.peopleFolder}`, cls: "ph-page-sub" });
    const actions = head.createDiv({ cls: "ph-page-actions" });
    const due = this.plugin.index.reachOut().length;
    if (due) {
      const q = actions.createEl("button", { cls: "ph-page-import" });
      setIcon(q.createSpan({ cls: "ph-page-add-ico" }), "phone");
      q.createSpan({ text: `Reach out (${due})` });
      q.addEventListener("click", () => this.plugin.startQueue());
    }
    const imp = actions.createEl("button", { cls: "ph-page-import" });
    setIcon(imp.createSpan({ cls: "ph-page-add-ico" }), "upload");
    imp.createSpan({ text: "Import" });
    imp.addEventListener("click", () => new ImportModal(this.app, this.plugin).open());
    const add = actions.createEl("button", { cls: ["ph-page-add", "mod-cta"] });
    setIcon(add.createSpan({ cls: "ph-page-add-ico" }), "user-plus");
    add.createSpan({ text: "Add person" });
    add.addEventListener("click", () => this.plugin.newPerson());

    const seg = wrap.createDiv({ cls: "ph-seg" });
    for (const [id, label] of [["people", "People"], ["calendar", "Calendar"]] as const) {
      const b = seg.createEl("button", { text: label, cls: "ph-seg-btn" });
      if (id === this.tab) b.addClass("is-active");
      b.addEventListener("click", () => this.setTab(id));
    }
    if (this.tab === "calendar") { this.renderCalendar(wrap); return; }

    // Controls
    const bar = wrap.createDiv({ cls: "ph-page-bar" });
    const sw = bar.createDiv({ cls: "ph-page-search" });
    setIcon(sw.createSpan({ cls: "ph-page-search-ico" }), "search");
    const input = sw.createEl("input", { type: "text", placeholder: "Search people" });
    input.value = this.search;
    const sortSel = bar.createEl("select", { cls: ["dropdown", "ph-page-sort"] });
    for (const [v, l] of SORTS) sortSel.createEl("option", { value: v, text: l });
    sortSel.value = this.sort;

    const filters = wrap.createDiv({ cls: "ph-page-filters" });
    const compSel = filters.createEl("select", { cls: "dropdown" });
    compSel.createEl("option", { value: "", text: "All companies" });
    for (const c of [...new Set(all.map(p => p.company).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
      compSel.createEl("option", { value: c, text: c });
    compSel.value = this.company;
    const tagSel = filters.createEl("select", { cls: "dropdown" });
    tagSel.createEl("option", { value: "", text: "All tags" });
    for (const t of [...new Set(all.flatMap(p => p.tags))].sort((a, b) => a.localeCompare(b)))
      tagSel.createEl("option", { value: t, text: t });
    tagSel.value = this.tag;

    const count = wrap.createDiv({ cls: "ph-page-count" });
    const grid = wrap.createDiv({ cls: "ph-grid" });

    const draw = () => {
      const q = this.search.toLowerCase();
      const rows = all.filter(p =>
        (!q || `${p.name} ${p.fullName} ${p.company} ${p.role} ${p.typePerson} ${p.alsoIs} ${p.interests} ${p.tags.join(" ")}`.toLowerCase().includes(q)) &&
        (!this.company || p.company === this.company) &&
        (!this.tag || p.tags.includes(this.tag)));
      const big = 1e9;
      const cmp: Record<Sort, (a: Person, b: Person) => number> = {
        "name-asc": (a, b) => a.name.localeCompare(b.name),
        "name-desc": (a, b) => b.name.localeCompare(a.name),
        "contact-recent": (a, b) => (a.sinceContact ?? big) - (b.sinceContact ?? big),
        "contact-oldest": (a, b) => (b.sinceContact ?? -1) - (a.sinceContact ?? -1),
        "birthday": (a, b) => (a.birthday?.days ?? big) - (b.birthday?.days ?? big),
        "carnegie": (a, b) => b.carnegie.avg - a.carnegie.avg
      };
      rows.sort((a, b) => Number(b.favorite) - Number(a.favorite) || cmp[this.sort](a, b) || a.name.localeCompare(b.name));
      count.setText(`${rows.length} ${rows.length === 1 ? "person" : "people"}`);
      grid.empty();
      if (!rows.length) { grid.createDiv({ text: "No matches.", cls: "ph-empty" }); return; }
      for (const p of rows) this.card(grid, p);
    };
    input.addEventListener("input", () => { this.search = input.value; draw(); });
    sortSel.addEventListener("change", () => { this.sort = sortSel.value as Sort; draw(); });
    compSel.addEventListener("change", () => { this.company = compSel.value; draw(); });
    tagSel.addEventListener("change", () => { this.tag = tagSel.value; draw(); });
    draw();
  }

  private card(grid: HTMLElement, p: Person) {
    const card = grid.createDiv({ cls: "ph-pcard" });
    const src = this.photoSrc(p);
    const av = card.createDiv({ cls: "ph-avatar" });
    if (src) av.createEl("img", { attr: { src, alt: p.name } });
    else av.setText(p.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?");
    const info = card.createDiv({ cls: "ph-pcard-info" });
    info.createDiv({ text: p.name, cls: "ph-pcard-name" });
    const sub = p.company || p.role || p.typePerson;
    if (sub) info.createDiv({ text: sub, cls: "ph-pcard-sub" });
    if (p.lastContact) info.createDiv({ text: `Last contact ${iso(p.lastContact)}`, cls: "ph-pcard-meta" });
    renderMeetingLine(info, this.plugin, p);
    if (p.favorite) setIcon(card.createSpan({ cls: "ph-pcard-star" }), "star");
    card.addEventListener("click", e => this.plugin.openPerson(p, e.ctrlKey || e.metaKey));
    card.addEventListener("auxclick", e => { if (e.button === 1) this.plugin.openPerson(p, true); });
  }
  // ─── full-page calendar ───────────────────────────────────────────────────
  private renderCalendar(wrap: HTMLElement) {
    const s = this.plugin.settings;
    const bar = wrap.createDiv({ cls: "ph-fcal-bar" });
    bar.createEl("h2", { text: new Date(this.calYear, this.calMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }), cls: "ph-fcal-title" });
    const btns = bar.createDiv({ cls: "ph-calbtns" });
    const shift = (d: number) => { const dt = new Date(this.calYear, this.calMonth + d, 1); this.calYear = dt.getFullYear(); this.calMonth = dt.getMonth(); this.render(true); };
    btns.createEl("button", { text: "◀ Prev", cls: "ph-btn" }).addEventListener("click", () => shift(-1));
    btns.createEl("button", { text: "Today", cls: "ph-btn" }).addEventListener("click", () => { const n = today(); this.calYear = n.getFullYear(); this.calMonth = n.getMonth(); this.render(true); });
    btns.createEl("button", { text: "Next ▶", cls: "ph-btn" }).addEventListener("click", () => shift(1));
    btns.createEl("button", { text: "Export .ics", cls: "ph-btn" }).addEventListener("click", () => { void exportIcs(this.plugin); });
    wrap.createDiv({ text: "🎂 birthday · 📅 next meeting (click to edit)", cls: "ph-page-count" });

    const grid = wrap.createDiv({ cls: "ph-cal ph-cal-full" });
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 0; i < 7; i++) grid.createDiv({ text: names[(i + s.weekStartsOn) % 7], cls: "ph-calhd" });
    const offset = (new Date(this.calYear, this.calMonth, 1).getDay() - s.weekStartsOn + 7) % 7;
    const dim = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    const total = Math.ceil((offset + dim) / 7) * 7;
    const bdays = this.plugin.index.birthdaysInMonth(this.calYear, this.calMonth);
    const meets = this.plugin.index.meetingsInMonth(this.calYear, this.calMonth);
    const t = today();
    for (let i = 0; i < total; i++) {
      const day = i - offset + 1;
      const cell = grid.createDiv({ cls: "ph-cell" });
      if (day < 1 || day > dim) {
        cell.addClass("is-out");
        cell.createDiv({ text: String(new Date(this.calYear, this.calMonth, day).getDate()), cls: "ph-daynum" });
        continue;
      }
      if (t.getFullYear() === this.calYear && t.getMonth() === this.calMonth && t.getDate() === day) cell.addClass("is-today");
      const bs = bdays.get(day) ?? [], ms = meets.get(day) ?? [];
      cell.createDiv({ text: String(day), cls: ["ph-daynum", bs.length || ms.length ? "has-bd" : ""].filter(Boolean) });
      for (const p of bs) {
        const chip = cell.createEl("a", { cls: "ph-chip", attr: { "aria-label": p.name } });
        chip.createSpan({ text: "🎂" }); chip.createSpan({ text: p.name });
        chip.addEventListener("click", e => { e.preventDefault(); this.plugin.openPerson(p, e.ctrlKey || e.metaKey); });
      }
      for (const p of ms) {
        const chip = cell.createEl("a", { cls: ["ph-chip", "ph-chip-meet"], attr: { "aria-label": `Edit meeting with ${p.name}` } });
        chip.createSpan({ text: "📅" }); chip.createSpan({ text: `${p.nextMeeting!.time ? p.nextMeeting!.time + " " : ""}${p.name}` });
        chip.addEventListener("click", e => { e.preventDefault(); new MeetingModal(this.app, this.plugin, p).open(); });
      }
    }
  }
}
