import { App, Component, MarkdownRenderer, Modal, Notice, TFile } from "obsidian";
import type PeopleHubPlugin from "./main";
import { markContacted, setPaused, snooze } from "./actions";
import { toISO } from "./dates";
import { LogModal } from "./modals";
import type { Person } from "./types";
import { relDays } from "./ui";

/** Strip frontmatter, Meta Bind fields, tables and headings-only noise; keep what the user actually wrote. */
function excerpt(raw: string, max = 900): string {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const lines = body.split("\n").filter(l => {
    const t = l.trim();
    return t && !t.includes("INPUT[") && !t.includes("VIEW[") && !t.startsWith("|") && !/^#\s/.test(t) && !/^(-{3,}|\*{3,})$/.test(t)
      && !/^[-*]\s*\*\*[^*]+:\*\*\s*$/.test(t);   // empty "- **Wants:**" template lines
  });
  let out = "";
  for (const l of lines) { if (out.length + l.length > max) break; out += l + "\n"; }
  return out.trim();
}

/** One overdue person at a time, with the context you already wrote about them. */
export class ReachOutModal extends Modal {
  private queue: Person[] = [];
  private i = 0;
  private done = { contacted: 0, snoozed: 0, skipped: 0 };
  private comp = new Component();

  constructor(app: App, private plugin: PeopleHubPlugin, private only?: Person[]) { super(app); }

  onOpen() {
    this.comp.load();
    this.modalEl.addClass("ph-queue-modal");
    this.queue = this.only ?? this.plugin.index.reachOut();
    const key = (k: string, fn: () => void) => this.scope.register([], k, e => { e.preventDefault(); fn(); });
    key("ArrowRight", () => this.skip());
    key(" ", () => this.skip());
    key("ArrowLeft", () => this.back());
    key("l", () => this.log());
    key("t", () => void this.contacted());
    key("s", () => void this.snoozeFor(7));
    key("o", () => this.openNote());
    key("p", () => void this.pause());
    void this.render();
  }
  onClose() { this.comp.unload(); this.contentEl.empty(); }

  private get p(): Person | undefined { return this.queue[this.i]; }
  private advance() { this.i++; void this.render(); }
  private skip() { if (!this.p) return; this.done.skipped++; this.advance(); }
  private back() { if (this.i > 0) { this.i--; void this.render(); } }
  private openNote() { const p = this.p; if (p) { this.plugin.openPerson(p, false); this.close(); } }
  private log() { const p = this.p; if (p) new LogModal(this.app, this.plugin, p, () => { this.done.contacted++; this.advance(); }).open(); }
  private async contacted() {
    const p = this.p; if (!p) return;
    await markContacted(this.app, p); new Notice(`${p.name} marked contacted today`);
    this.done.contacted++; this.advance();
  }
  private async snoozeFor(d: number) {
    const p = this.p; if (!p) return;
    await snooze(this.app, p, d); new Notice(`${p.name} snoozed ${d}d`);
    this.done.snoozed++; this.advance();
  }
  private async pause() {
    const p = this.p; if (!p) return;
    await setPaused(this.app, p, true); new Notice(`${p.name} paused`);
    this.advance();
  }

  private async render() {
    const el = this.contentEl; el.empty();
    const p = this.p;
    if (!p) {
      const d = this.done;
      el.createEl("h2", { text: this.queue.length ? "Queue clear 🎉" : "You're all caught up 🎉" });
      if (this.queue.length) el.createEl("p", { text: `${d.contacted} contacted · ${d.snoozed} snoozed · ${d.skipped} skipped`, cls: "ph-sub" });
      el.createEl("button", { text: "Close", cls: "mod-cta" }).addEventListener("click", () => this.close());
      return;
    }

    // progress
    const prog = el.createDiv({ cls: "ph-q-prog" });
    prog.createSpan({ text: `${this.i + 1} of ${this.queue.length}`, cls: "ph-q-count" });
    prog.createDiv({ cls: "ph-q-bar" }).createDiv({ cls: "ph-q-fill", attr: { style: `width:${Math.round((this.i / this.queue.length) * 100)}%` } });

    // header
    const head = el.createDiv({ cls: "ph-q-head" });
    const nm = head.createEl("a", { text: p.name, cls: "ph-q-name" });
    nm.addEventListener("click", e => { e.preventDefault(); this.openNote(); });
    const chips = head.createDiv({ cls: "ph-q-chips" });
    for (const c of [p.typePerson, p.tier, p.frequency, p.company].filter(Boolean)) chips.createSpan({ text: c, cls: "ph-type" });

    // status
    const st = el.createDiv({ cls: "ph-q-status" });
    st.createSpan({ text: p.dueIn < 0 ? `${-p.dueIn}d overdue` : "due today", cls: p.dueIn < -14 ? "ph-q-late" : "ph-q-due" });
    if (p.lastContact) {
      st.createSpan({ text: ` · last contact ${toISO(p.lastContact)} (${p.sinceContact}d ago)` });
      if (p.lastContactSource === "note") st.createSpan({ text: " · from your notes", cls: "ph-q-src" });
    } else st.createSpan({ text: " · never contacted" });

    // recent mentions in dated notes
    if (p.recentContacts.length) {
      const box = el.createDiv({ cls: "ph-q-box" });
      box.createDiv({ text: `Recent mentions (${p.mentions} total)`, cls: "ph-q-h" });
      for (const r of p.recentContacts.slice(0, 3)) {
        const f = this.app.vault.getAbstractFileByPath(r.path);
        const row = box.createDiv({ cls: "ph-q-mention" });
        row.createSpan({ text: `${toISO(r.date)} · `, cls: "ph-meta" });
        const a = row.createEl("a", { text: f instanceof TFile ? f.basename : r.path });
        a.addEventListener("click", e => { e.preventDefault(); if (f instanceof TFile) { this.app.workspace.getLeaf(e.ctrlKey || e.metaKey ? "tab" : false).openFile(f); this.close(); } });
      }
    }

    // remembered facts
    const facts: [string, string][] = [["Next", p.nextAction], ["Wants", p.wants], ["Interests", p.interests], ["Fears", p.fears], ["Story", p.theirStory]];
    const known = facts.filter(([, v]) => v);
    const t0 = p.talks[0];
    if (known.length || t0) {
      const box = el.createDiv({ cls: "ph-q-box" });
      for (const [k, v] of known) { const r = box.createDiv({ cls: "ph-q-fact" }); r.createSpan({ text: k, cls: "ph-q-k" }); r.createSpan({ text: v }); }
      if (t0) {
        const r = box.createDiv({ cls: "ph-q-fact" });
        r.createSpan({ text: "Last talk", cls: "ph-q-k" });
        r.createSpan({ text: [t0.date ? toISO(t0.date) : "", t0.note, t0.learned && `learned: ${t0.learned}`, t0.next && `→ ${t0.next}`].filter(Boolean).join(" · ") });
      }
    }

    // note excerpt
    const raw = await this.app.vault.cachedRead(p.file);
    if (this.p !== p) return;   // user moved on while reading
    const ex = excerpt(raw);
    if (ex) {
      const box = el.createDiv({ cls: "ph-q-box ph-q-note" });
      box.createDiv({ text: "From their note", cls: "ph-q-h" });
      await MarkdownRenderer.render(this.app, ex, box.createDiv({ cls: "ph-q-md" }), p.file.path, this.comp);
    }

    // actions
    const bar = el.createDiv({ cls: "ph-q-actions" });
    const btn = (text: string, cta: boolean, fn: () => void, hint: string) => {
      const b = bar.createEl("button", { text, cls: cta ? "mod-cta" : "", attr: { "aria-label": hint } });
      b.addEventListener("click", fn); return b;
    };
    btn("Log talk", true, () => this.log(), "L");
    btn("Contacted today", false, () => void this.contacted(), "T");
    btn("Snooze 7d", false, () => void this.snoozeFor(7), "S");
    btn("Open note", false, () => this.openNote(), "O");
    btn("Skip →", false, () => this.skip(), "Space / →");
    const more = el.createDiv({ cls: "ph-q-more" });
    more.createSpan({ text: "Snooze:" });
    for (const d of [1, 3, 30]) more.createEl("button", { text: `${d}d`, cls: "ph-btn" }).addEventListener("click", () => void this.snoozeFor(d));
    more.createEl("button", { text: "Pause tracking", cls: "ph-btn" }).addEventListener("click", () => void this.pause());
    if (this.i > 0) more.createEl("button", { text: "← Back", cls: "ph-btn" }).addEventListener("click", () => this.back());
    el.createDiv({ text: "L log · T contacted today · S snooze 7d · O open · P pause · Space skip · ← back", cls: "ph-q-keys" });
  }
}
