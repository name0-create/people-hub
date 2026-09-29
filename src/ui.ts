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

export function renderSocials(parent: HTMLElement, p: Person) {
  if (!p.socials.length) return;
  const wrap = parent.createDiv({ cls: "ph-socials" });
  for (const s of p.socials) {
    wrap.createEl("a", {
      text: s.label, cls: ["ph-social"], href: s.url,
      attr: { target: "_blank", rel: "noopener", "aria-label": `${s.platform}: ${s.handle}` }
    });
  }
}

export function renderPersonRow(plugin: PeopleHubPlugin, parent: HTMLElement, p: Person, meta: string, actions: boolean) {
  const row = parent.createDiv({ cls: ["ph-row", `ph-tier-${p.tier}`] });
  const main = row.createDiv({ cls: "ph-row-main" });
  const a = main.createEl("a", { text: p.name, cls: "ph-name" });
  a.addEventListener("click", e => { e.preventDefault(); plugin.openPerson(p, e.ctrlKey || e.metaKey); });
  if (meta) main.createDiv({ text: meta, cls: "ph-meta" });
  renderSocials(main, p);
  if (!actions) return;

  const act = row.createDiv({ cls: "ph-actions" });
  act.createEl("button", { text: "Log", cls: "ph-btn" }).addEventListener("click", () => plugin.logFor(p));
  act.createEl("button", { text: "⋯", cls: "ph-btn" }).addEventListener("click", e => {
    const menu = new Menu();
    for (const d of [1, 3, 7, 30]) {
      menu.addItem(i => i.setTitle(`Snooze ${d} day${d > 1 ? "s" : ""}`).setIcon("clock").onClick(async () => {
        await snooze(plugin.app, p, d); new Notice(`${p.name} snoozed ${d}d`);
      }));
    }
    menu.addSeparator();
    menu.addItem(i => i.setTitle(p.paused ? "Resume tracking" : "Pause tracking").setIcon("pause").onClick(async () => {
      await setPaused(plugin.app, p, !p.paused);
    }));
    menu.addItem(i => i.setTitle("Open in new tab").setIcon("file-text").onClick(() => plugin.openPerson(p, true)));
    menu.showAtMouseEvent(e);
  });
}

export function reachOutMeta(p: Person): string {
  const parts: string[] = [p.tier];
  parts.push(p.sinceContact === null ? "never contacted" : `last ${p.sinceContact}d ago`);
  parts.push(p.dueIn < 0 ? `${-p.dueIn}d overdue` : "due today");
  return parts.join(" · ");
}
export function birthdayMeta(p: Person): string {
  const b = p.birthday!;
  return [fmtShort(b.date), b.days === 0 ? "TODAY 🎉" : relDays(b.days), b.age !== null ? `turns ${b.age}` : ""].filter(Boolean).join(" · ");
}
export function meetingMeta(p: Person): string {
  const d = p.nextEncounter!;
  return [fmtShort(d), p.nextPlace, p.nextPurpose].filter(Boolean).join(" · ");
}
