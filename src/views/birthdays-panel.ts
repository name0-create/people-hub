// ─── Birthdays panel (sidebar "Birthdays" tab) ────────────────────────────────
// Stat tiles → "Next 30 Days" cards → "Later Birthdays" cards → two-month calendar,
// then the anniversary / missing-data lists. Data comes from PeopleIndex only.

import type { PeopleHubPlugin } from "../main";
import { zodiacLine } from "../core/astro";
import { birthdayStats } from "../core/birthday-stats";
import { toISO, today } from "../core/dates";
import type { PersonView } from "../models/person-view";
import { anniversaryMeta, renderPersonRow } from "./ui";

export interface CalendarNav {
  year: number;
  /** 0-based month of the first calendar shown. */
  month: number;
  shift(deltaMonths: number): void;
  reset(): void;
}

const MONTHS_SHOWN = 2;
const pad = (n: number) => String(n).padStart(2, "0");

export function renderBirthdaysPanel(plugin: PeopleHubPlugin, body: HTMLElement, cal: CalendarNav) {
  const idx = plugin.index;
  const stats = birthdayStats(idx.all());

  // ── Stat tiles ────────────────────────────────────────────────────────────
  const tiles = body.createDiv({ cls: "ph-bd-stats" });
  const tile = (n: number, label: string, accent = false) => {
    const t = tiles.createDiv({ cls: "ph-bd-stat" });
    t.createDiv({ cls: accent ? "ph-bd-stat-n is-accent" : "ph-bd-stat-n", text: String(n) });
    t.createDiv({ cls: "ph-bd-stat-l", text: label });
  };
  tile(stats.total, "Total");
  tile(stats.today, "Today", true);
  tile(stats.within7, "7d");
  tile(stats.within30, "30d");

  // ── Card lists ────────────────────────────────────────────────────────────
  cardSection(plugin, body, "🗓️", "Next 30 Days", stats.next30, "No birthdays in the next 30 days.");
  if (stats.later.length) cardSection(plugin, body, "🔮", "Later Birthdays", stats.later, "");

  // ── Calendar ──────────────────────────────────────────────────────────────
  const head = body.createDiv({ cls: "ph-bd-calhead" });
  const title = head.createEl("h3", { cls: "ph-bd-title" });
  title.createSpan({ cls: "ph-bd-title-icon", text: "📅" });
  title.createSpan({ text: "Birthday Calendar" });
  const nav = head.createDiv({ cls: "ph-bd-calnav" });
  nav.createEl("button", { text: "◀ Prev", cls: "ph-bd-navbtn" }).addEventListener("click", () => cal.shift(-1));
  nav.createEl("button", { text: "Today", cls: "ph-bd-navbtn" }).addEventListener("click", () => cal.reset());
  nav.createEl("button", { text: "Next ▶", cls: "ph-bd-navbtn" }).addEventListener("click", () => cal.shift(1));

  for (let i = 0; i < MONTHS_SHOWN; i++) {
    const first = new Date(cal.year, cal.month + i, 1);
    renderMonth(plugin, body, first.getFullYear(), first.getMonth());
  }

  // ── Anniversaries + data gaps (kept from v0.2, as rows) ───────────────────
  const aUp = idx.upcomingAnniversaries(60);
  rowSection(body, "💍 Anniversaries · 60 days", aUp, (l, p) => renderPersonRow(plugin, l, p, anniversaryMeta(p), false));
  const bMiss = idx.missingBirthdays();
  rowSection(body, "No birthday on file", bMiss, (l, p) => renderPersonRow(plugin, l, p, p.typePerson, false), "Everyone has one. 👏");
  const aMiss = idx.missingAnniversaries();
  rowSection(body, "No anniversary on file", aMiss, (l, p) => renderPersonRow(plugin, l, p, p.typePerson, false));
}

// ── Birthday cards ──────────────────────────────────────────────────────────
function cardSection(
  plugin: PeopleHubPlugin, body: HTMLElement,
  icon: string, title: string, people: PersonView[], empty: string,
) {
  const sec = body.createDiv({ cls: "ph-bd-section" });
  const h = sec.createEl("h3", { cls: "ph-bd-title" });
  h.createSpan({ cls: "ph-bd-title-icon", text: icon });
  h.createSpan({ text: title });
  if (!people.length) { if (empty) sec.createDiv({ cls: "ph-empty", text: empty }); return; }
  for (const p of people) renderBirthdayCard(plugin, sec, p);
}

export function renderBirthdayCard(plugin: PeopleHubPlugin, parent: HTMLElement, p: PersonView) {
  const b = p.birthday!;
  const bd = p.birthdate!;
  const card = parent.createDiv({
    cls: "ph-bd-card",
    attr: { tabindex: 0, role: "link", "aria-label": `${p.name}, birthday in ${b.days} days` },
  });
  if (b.days === 0) card.addClass("is-today");

  card.createDiv({ cls: "ph-bd-name", text: p.name });
  if (plugin.settings.showZodiac) {
    const z = zodiacLine(bd);
    if (z) card.createDiv({ cls: "ph-bd-zodiac", text: z });
  }

  const dates = card.createDiv({ cls: "ph-bd-dates" });
  dates.createSpan({ cls: "ph-bd-lbl", text: "Birthday: " });
  dates.createSpan({ text: bd.year ? `${bd.year}-${pad(bd.month)}-${pad(bd.day)}` : `${pad(bd.month)}-${pad(bd.day)}` });
  dates.createSpan({ cls: "ph-bd-lbl ph-bd-next", text: "Next: " });
  dates.createSpan({ text: toISO(b.date) });

  const foot = card.createDiv({ cls: "ph-bd-foot" });
  foot.createSpan({ cls: "ph-bd-days", text: b.days === 0 ? "Today 🎉" : `${b.days}d` });
  if (b.age !== null) foot.createSpan({ cls: "ph-bd-age", text: `${b.age} years old` });

  const open = (newTab: boolean) => plugin.openPerson(p, newTab);
  card.addEventListener("click", e => open(e.ctrlKey || e.metaKey));
  card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e.ctrlKey || e.metaKey); }
  });
}

// ── Calendar month ──────────────────────────────────────────────────────────
function renderMonth(plugin: PeopleHubPlugin, body: HTMLElement, year: number, month0: number) {
  const s = plugin.settings;
  const idx = plugin.index;
  const wrap = body.createDiv({ cls: "ph-bd-month" });
  wrap.createDiv({
    cls: "ph-bd-monthname",
    text: new Date(year, month0, 1).toLocaleDateString(undefined, { year: "numeric", month: "long" }),
  });

  const grid = wrap.createDiv({ cls: "ph-bd-grid" });
  for (let i = 0; i < 7; i++) {
    // 2023-01-01 was a Sunday
    const d = new Date(2023, 0, 1 + ((i + s.weekStartsOn) % 7));
    grid.createDiv({ cls: "ph-bd-dow", text: d.toLocaleDateString(undefined, { weekday: "short" }) });
  }

  const birthdays = idx.birthdaysInMonth(year, month0);
  const anniversaries = idx.anniversariesInMonth(year, month0);
  const first = new Date(year, month0, 1);
  const offset = (first.getDay() - s.weekStartsOn + 7) % 7;
  const dim = new Date(year, month0 + 1, 0).getDate();
  const total = Math.ceil((offset + dim) / 7) * 7;
  const t = today();

  for (let i = 0; i < total; i++) {
    const day = i - offset + 1;
    const cell = grid.createDiv({ cls: "ph-bd-cell" });
    if (day < 1 || day > dim) {
      cell.addClass("is-out");
      cell.createDiv({ cls: "ph-bd-daynum", text: String(new Date(year, month0, day).getDate()) });
      continue;
    }
    if (t.getFullYear() === year && t.getMonth() === month0 && t.getDate() === day) cell.addClass("is-today");
    const people: [PersonView, string][] = [
      ...(birthdays.get(day) ?? []).map(p => [p, "🎂"] as [PersonView, string]),
      ...(anniversaries.get(day) ?? []).map(p => [p, "💍"] as [PersonView, string]),
    ];
    if (people.length) cell.addClass("has-event");
    cell.createDiv({ cls: "ph-bd-daynum", text: String(day) });
    for (const [p, icon] of people) {
      const chip = cell.createEl("a", {
        cls: "ph-bd-chip",
        attr: { title: p.name, tabindex: 0, role: "link" },
      });
      chip.createSpan({ cls: "ph-bd-chip-icon", text: icon });
      chip.createSpan({ text: p.name });
      chip.addEventListener("click", e => { e.preventDefault(); plugin.openPerson(p, e.ctrlKey || e.metaKey); });
    }
  }
}

// ── Row sections (anniversaries, data gaps) ─────────────────────────────────
function rowSection(
  body: HTMLElement, title: string, people: PersonView[],
  row: (list: HTMLElement, p: PersonView) => void, empty = "",
) {
  if (!people.length && !empty) return;
  const sec = body.createDiv({ cls: "ph-section" });
  sec.createEl("h4", { text: `${title} (${people.length})` });
  const list = sec.createDiv({ cls: "ph-list" });
  if (!people.length) { list.createDiv({ text: empty, cls: "ph-empty" }); return; }
  people.forEach(p => row(list, p));
}
