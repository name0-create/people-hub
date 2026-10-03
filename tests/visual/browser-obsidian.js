// Browser-side stand-in for the `obsidian` module, used only by the visual harness.
// Adds Obsidian's DOM helpers, ItemView/Menu/Notice and a few Lucide icons on top of fake-obsidian.js.
const base = window.__load("fake-obsidian");

// ── DOM helpers Obsidian patches onto elements ──────────────────────────────
const P = Element.prototype;
P.createEl = function (tag, o = {}) {
  const el = document.createElement(tag);
  if (o.cls) (Array.isArray(o.cls) ? o.cls : [o.cls]).filter(Boolean).forEach(c => el.classList.add(...c.split(" ").filter(Boolean)));
  if (o.text !== undefined) el.textContent = o.text;
  if (o.href) el.setAttribute("href", o.href);
  if (o.type) el.setAttribute("type", o.type);
  if (o.placeholder) el.setAttribute("placeholder", o.placeholder);
  if (o.value !== undefined) el.value = o.value;
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
  this.appendChild(el);
  return el;
};
P.createDiv  = function (o) { return this.createEl("div", o); };
P.createSpan = function (o) { return this.createEl("span", o); };
P.empty      = function () { while (this.firstChild) this.removeChild(this.firstChild); };
P.addClass   = function (...c) { this.classList.add(...c); };
P.removeClass= function (...c) { this.classList.remove(...c); };
P.toggleClass= function (c, v) { this.classList.toggle(c, v); };
P.setText    = function (t) { this.textContent = t; };
P.setAttr    = function (k, v) { this.setAttribute(k, String(v)); };

// ── Lucide icons (as Obsidian renders them: svg.svg-icon) ───────────────────
const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  "user-plus": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
};
function setIcon(el, id) {
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="svg-icon lucide-${id}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[id] || ""}</svg>`;
}

// ── Views ───────────────────────────────────────────────────────────────────
class ItemView {
  constructor(leaf) {
    this.leaf = leaf; this.app = leaf.app;
    this.containerEl = document.createElement("div"); this.containerEl.className = "workspace-leaf-content";
    const header = this.containerEl.createDiv({ cls: "view-header" });
    this.titleEl = header.createDiv({ cls: "view-header-title" });
    this.actionsEl = header.createDiv({ cls: "view-actions" });
    this.contentEl = this.containerEl.createDiv({ cls: "view-content" });
  }
  addAction(icon, title, cb) {
    const a = this.actionsEl.createEl("a", { cls: "view-action", attr: { "aria-label": title } });
    setIcon(a, icon); a.addEventListener("click", cb); return a;
  }
  syncTitle() { this.titleEl.textContent = this.getDisplayText(); }
}
class Menu { addItem() { return this; } addSeparator() { return this; } showAtMouseEvent() { return this; } hide() {} }
class Notice { constructor(m) { window.__notices = (window.__notices || []).concat(m); } }

module.exports = { ...base, ItemView, Menu, Notice, setIcon };
