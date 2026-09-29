import { Menu, Notice } from "obsidian";
import type PeopleHubPlugin from "./main";
import type { Person } from "./types";
import { setPaused, snooze } from "./actions";

export function relDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n}d` : `${-n}d ago`;
}
export function fmtShort(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

const TIER_ICON: Record<string, string> = { inner: "❤️", close: "🟠", extended: "🔵", professional: "🟢" };
const HEALTH_EMOJI = (n: number) => n >= 4 ? "🟢" : n >= 2.5 ? "🟡" : n > 0 ? "🔴" : "";

export function renderSocials(parent: HTMLElement, p: Person) {
  if (!p.socials.length) return;
  const wrap = parent.createDiv({ cls: "ph-socials" });
  for (const s of p.socials) {
    wrap.createEl("a", {
      text: s.label, cls: "ph-social", href: s.url,
      attr: { target: "_blank", rel: "noopener", "aria-label": `${s.platform}: ${s.handle}` }
    });
  }
}

export function carnegieBar(parent: HTMLElement, avg: number, weakest: string) {
  const pct = Math.round((avg / 5) * 100);
  const colour = avg >= 4 ? "#22c55e" : avg >= 2.5 ? "#f59e0b" : "#ef4444";
  const wrap = parent.createDiv({ cls: "ph-cbar-wrap" });
  const bar = wrap.createDiv({ cls: "ph-cbar" });
  bar.createDiv({ cls: "ph-cbar-fill", attr: { style: `width:${pct}%;background:${colour}` } });
  wrap.createSpan({ text: `C ${avg}/5`, cls: "ph-cbar-lbl", attr: { title: `Weakest: ${weakest}` } });
}

export function renderPersonRow(plugin: PeopleHubPlugin, parent: HTMLElement, p: Person, meta: string, actions: boolean) {
  const row = parent.createDiv({ cls: ["ph-row", `ph-tier-${p.tier}`] });
  const main = row.createDiv({ cls: "ph-row-main" });

  // Name line
  const nameLine = main.createDiv({ cls: "ph-nameline" });
  const icon = nameLine.createSpan({ text: TIER_ICON[p.tier] ?? "•", cls: "ph-tier-icon" });
  icon.setAttribute("title", p.tier);
  const a = nameLine.createEl("a", { text: p.name, cls: "ph-name" });
  a.addEventListener("click", e => { e.preventDefault(); plugin.openPerson(p, e.ctrlKey || e.metaKey); });
  if (p.typePerson) nameLine.createSpan({ text: p.typePerson, cls: "ph-type" });
  if (p.paused) nameLine.createSpan({ text: "⏸", cls: "ph-paused", attr: { title: "Paused" } });

  // Meta line
  if (meta) main.createDiv({ text: meta, cls: "ph-meta" });

  // Carnegie bar (show if has scores)
  if (p.carnegie.avg > 0) carnegieBar(main, p.carnegie.avg, p.carnegie.weakestLabel);

  // Socials
  renderSocials(main, p);

  if (!actions) return;
  const act = row.createDiv({ cls: "ph-actions" });
  act.createEl("button", { text: "Log", cls: "ph-btn" }).addEventListener("click", () => plugin.logFor(p));
  act.createEl("button", { text: "⋯", cls: "ph-btn" }).addEventListener("click", e => {
    const menu = new Menu();
    for (const d of [1, 3, 7, 30]) {
      menu.addItem(i => i.setTitle(`Snooze ${d}d`).setIcon("clock").onClick(async () => {
        await snooze(plugin.app, p, d); new Notice(`${p.name} snoozed ${d}d`);
      }));
    }
    menu.addSeparator();
    menu.addItem(i => i.setTitle(p.paused ? "Resume tracking" : "Pause tracking").setIcon("pause").onClick(async () => {
      await setPaused(plugin.app, p, !p.paused); new Notice(`${p.name} ${p.paused ? "resumed" : "paused"}`);
    }));
    menu.addItem(i => i.setTitle("Open in new tab").setIcon("file-text").onClick(() => plugin.openPerson(p, true)));
    menu.showAtMouseEvent(e);
  });
}

export function reachOutMeta(p: Person): string {
  const parts: string[] = [];
  parts.push(p.frequency || p.tier);
  if (p.sinceContact !== null) parts.push(`last ${p.sinceContact}d ago`);
  else parts.push("never contacted");
  parts.push(p.dueIn < 0 ? `${-p.dueIn}d overdue` : "due today");
  if (HEALTH_EMOJI(p.healthScore)) parts.push(`${HEALTH_EMOJI(p.healthScore)} H${p.healthScore}`);
  if (p.nextAction) parts.push(`→ ${p.nextAction}`);
  return parts.join(" · ");
}
export function birthdayMeta(p: Person): string {
  const b = p.birthday!;
  return [fmtShort(b.date), b.days === 0 ? "TODAY 🎉" : relDays(b.days), b.age !== null ? `turns ${b.age}` : ""].filter(Boolean).join(" · ");
}
