// ─── UI helpers ───────────────────────────────────────────────────────────────

import { Menu, Notice } from "obsidian";
import type { PeopleHubPlugin } from "../main";
import type { AnniversaryInfo, Person } from "../models/person";
import { snooze, setPaused } from "../repository/person-actions";

// ── Date formatting ───────────────────────────────────────────────────────────
export function relDays(n: number): string {
  if (n === 0) return "today 🎉";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n}d` : `${-n}d ago`;
}
export function fmtShort(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// ── Socials ───────────────────────────────────────────────────────────────────
export function renderSocials(parent: HTMLElement, p: Person) {
  if (!p.socials.length) return;
  const wrap = parent.createDiv({ cls: "ph-socials" });
  for (const s of p.socials) {
    wrap.createEl("a", {
      text: s.label, cls: "ph-social", href: s.url,
      attr: { target: "_blank", rel: "noopener", "aria-label": `${s.platform}: ${s.handle}` },
    });
  }
}

// ── Carnegie bar ──────────────────────────────────────────────────────────────
export function carnegieBar(parent: HTMLElement, avg: number, weakest: string) {
  const pct    = Math.round((avg / 5) * 100);
  const colour = avg >= 4 ? "#22c55e" : avg >= 2.5 ? "#f59e0b" : "#ef4444";
  const wrap   = parent.createDiv({ cls: "ph-cbar-wrap" });
  const bar    = wrap.createDiv({ cls: "ph-cbar" });
  bar.createDiv({ cls: "ph-cbar-fill", attr: { style: `width:${pct}%;background:${colour}` } });
  wrap.createSpan({ text: `C ${avg}/5`, cls: "ph-cbar-lbl", attr: { title: `Weakest: ${weakest}` } });
}

// ── Person row ────────────────────────────────────────────────────────────────
const TIER_ICON: Record<string, string> = {
  inner: "❤️", close: "🟠", extended: "🔵", professional: "🟢",
};

export function renderPersonRow(
  plugin: PeopleHubPlugin,
  parent: HTMLElement,
  p: Person,
  meta: string,
  /** Show action buttons + swipe icon */
  actions: boolean,
  /** Store person reference on el for swipe handler */
  storeRef = true,
): HTMLElement {
  const row = parent.createDiv({ cls: ["ph-row", `ph-tier-${p.tier}`] });
  if (storeRef) (row as any).__person = p;

  const main = row.createDiv({ cls: "ph-row-main" });

  // Name line
  const nl = main.createDiv({ cls: "ph-nameline" });
  nl.createSpan({ text: TIER_ICON[p.tier] ?? "•", cls: "ph-tier-icon", attr: { title: p.tier } });
  const a = nl.createEl("a", { text: p.name, cls: "ph-name" });
  a.addEventListener("click", e => { e.preventDefault(); plugin.openPerson(p, e.ctrlKey || e.metaKey); });
  if (p.typePerson) nl.createSpan({ text: p.typePerson, cls: "ph-type" });
  if (p.paused)     nl.createSpan({ text: "⏸", cls: "ph-paused", attr: { title: "Paused" } });

  if (meta) main.createDiv({ text: meta, cls: "ph-meta" });
  if (p.carnegie.avg > 0) carnegieBar(main, p.carnegie.avg, p.carnegie.weakestLabel);
  renderSocials(main, p);

  if (!actions) return row;

  const act = row.createDiv({ cls: "ph-actions" });

  // 📝 tap button (always visible on mobile, hover on desktop)
  const logBtn = act.createEl("button", {
    text: "📝", cls: ["ph-btn", "ph-log-icon"],
    attr: { "aria-label": `Log talk with ${p.name}`, title: "Log talk" },
  });
  logBtn.addEventListener("click", e => { e.stopPropagation(); plugin.quickLogFor(p); });

  // ⋯ overflow
  const moreBtn = act.createEl("button", { text: "⋯", cls: "ph-btn" });
  moreBtn.addEventListener("click", e => {
    const menu = new Menu();
    menu.addItem(i => i.setTitle("Full log…").setIcon("pencil").onClick(() => plugin.logFor(p)));
    menu.addSeparator();
    for (const d of [1, 3, 7, 30]) {
      menu.addItem(i =>
        i.setTitle(`Snooze ${d}d`).setIcon("clock").onClick(async () => {
          await snooze(plugin.app, p, d);
          new Notice(`${p.name} snoozed ${d}d`);
          plugin.refresh();
        })
      );
    }
    menu.addSeparator();
    menu.addItem(i =>
      i.setTitle(p.paused ? "Resume tracking" : "Pause tracking").setIcon("pause").onClick(async () => {
        await setPaused(plugin.app, p, !p.paused);
        plugin.refresh();
      })
    );
    menu.addItem(i =>
      i.setTitle("Carnegie scores…").setIcon("bar-chart").onClick(() => plugin.carnegieFor(p))
    );
    menu.addItem(i =>
      i.setTitle("Open in new tab").setIcon("file-text").onClick(() => plugin.openPerson(p, true))
    );
    menu.showAtMouseEvent(e);
  });

  return row;
}

// ── Meta strings ──────────────────────────────────────────────────────────────
export function reachOutMeta(p: Person): string {
  return [
    p.frequency || p.tier,
    p.sinceContact !== null ? `last ${p.sinceContact}d ago` : "never contacted",
    p.dueIn < 0 ? `${-p.dueIn}d overdue` : "due today",
    p.healthScore > 0 ? `H${p.healthScore}/5` : "",
    p.nextAction ? `→ ${p.nextAction}` : "",
  ].filter(Boolean).join(" · ");
}

export function birthdayMeta(p: Person): string {
  const b = p.birthday!;
  return [
    fmtShort(b.date),
    relDays(b.days),
    b.age !== null ? `turns ${b.age}` : "",
  ].filter(Boolean).join(" · ");
}

export function anniversaryMeta(p: Person): string {
  const a = p.anniversary!;
  return [
    a.label,
    fmtShort(a.date),
    relDays(a.days),
    a.years !== null ? `${a.years} year${a.years !== 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(" · ");
}
