import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type PeopleHubPlugin from "./main";
import type { Person } from "./types";

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

  constructor(leaf: WorkspaceLeaf, private plugin: PeopleHubPlugin) { super(leaf); }
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
    const add = head.createEl("button", { cls: ["ph-page-add", "mod-cta"] });
    setIcon(add.createSpan({ cls: "ph-page-add-ico" }), "user-plus");
    add.createSpan({ text: "Add person" });
    add.addEventListener("click", () => this.plugin.newPerson());

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
    if (p.favorite) setIcon(card.createSpan({ cls: "ph-pcard-star" }), "star");
    card.addEventListener("click", e => this.plugin.openPerson(p, e.ctrlKey || e.metaKey));
    card.addEventListener("auxclick", e => { if (e.button === 1) this.plugin.openPerson(p, true); });
  }
}
