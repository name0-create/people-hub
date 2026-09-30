// ─── QuickLogSheet ────────────────────────────────────────────────────────────
// A bottom-sheet style modal optimised for mobile one-tap logging.
// Opened by: swipe-right on a row, tapping the 📝 icon, or the "Log" command.
//
// Design principles:
//  • Minimum taps to save. Default = today + call + no extras.
//  • Type picker is a scrollable chip strip (large tap targets, no dropdown).
//  • Optional fields collapse behind a "More ▾" toggle.
//  • Save is the only primary CTA.

import { App, Modal, Notice, Setting } from "obsidian";
import { logTalk, LOG_TYPES, TalkEntry } from "../repository/person-actions";
import type { PeopleHubPlugin } from "../main";
import { describeError } from "../repository/errors";
import type { PersonView } from "../models/person-view";
import { today, toISO } from "../core/dates";

const TYPE_ICON: Record<string, string> = {
  call: "📞", whatsapp: "💬", coffee: "☕", lunch: "🍽️",
  walk: "🚶", "home-1on1": "🏠", video: "💻", message: "💬", email: "✉️",
};

export class QuickLogSheet extends Modal {
  private e: TalkEntry;
  private showMore = false;

  constructor(
    app: App,
    private plugin: PeopleHubPlugin,
    private person: PersonView,
    private onSaved?: () => void,
  ) {
    super(app);
    this.e = {
      date:     toISO(today()),
      type:     "call",
      where:    "",
      note:     "",
      learned:  "",
      next:     "",
      presence: 0,
      energy:   0,
      c2_used:  false,
      c4_used:  false,
      c7_used:  false,
    };
  }

  onOpen() {
    this.modalEl.addClass("ph-sheet");
    this.rebuild();
  }

  private rebuild() {
    const { contentEl } = this;
    contentEl.empty();

    // ── Header ──────────────────────────────────────────────────────────────
    const hd = contentEl.createDiv({ cls: "ph-sheet-hd" });
    hd.createDiv({ cls: "ph-sheet-drag" });
    hd.createEl("h3", { text: `📝 ${this.person.name}`, cls: "ph-sheet-title" });
    const sub = [this.person.typePerson, this.person.frequency].filter(Boolean).join(" · ");
    if (sub) hd.createDiv({ text: sub, cls: "ph-sheet-sub" });

    // ── Type chips ───────────────────────────────────────────────────────────
    const chipWrap = contentEl.createDiv({ cls: "ph-chip-strip" });
    for (const t of LOG_TYPES) {
      const chip = chipWrap.createEl("button", {
        text: `${TYPE_ICON[t] ?? ""} ${t}`,
        cls: ["ph-type-chip", t === this.e.type ? "is-active" : ""],
      });
      chip.addEventListener("click", () => {
        this.e.type = t;
        chipWrap.querySelectorAll(".ph-type-chip").forEach(c => c.removeClass("is-active"));
        chip.addClass("is-active");
      });
    }

    // ── Required fields ──────────────────────────────────────────────────────
    new Setting(contentEl).setName("Date").addText(t => {
      t.inputEl.type = "date";
      t.inputEl.addClass("ph-date-input");
      t.setValue(this.e.date).onChange(v => (this.e.date = v));
    });

    const noteArea = contentEl.createDiv({ cls: "ph-note-wrap" });
    noteArea.createEl("label", { text: "What did you talk about?", cls: "ph-label" });
    const ta = noteArea.createEl("textarea", { cls: "ph-textarea", attr: { rows: "3", placeholder: "Quick note…" } });
    ta.addEventListener("input", () => (this.e.note = ta.value));

    // ── More toggle ──────────────────────────────────────────────────────────
    const moreToggle = contentEl.createEl("button", {
      text: this.showMore ? "▾ Less" : "▸ More (presence, Carnegie, learned)",
      cls: "ph-more-toggle",
    });
    moreToggle.addEventListener("click", () => {
      this.showMore = !this.showMore;
      this.rebuild();
    });

    if (this.showMore) {
      // Where
      new Setting(contentEl).setName("Where").addText(t =>
        t.setPlaceholder("Coffee shop / Home / Video").onChange(v => (this.e.where = v))
      );
      // You learned
      new Setting(contentEl).setName("Learned").addText(t =>
        t.onChange(v => (this.e.learned = v))
      );
      // Next
      new Setting(contentEl).setName("Agreed next").addText(t =>
        t.setPlaceholder("Call in 2 weeks / Send article…").onChange(v => (this.e.next = v))
      );
      // Presence
      new Setting(contentEl).setName("Presence /5").addDropdown(d => {
        d.addOption("0", "—");
        for (let i = 5; i >= 1; i--) d.addOption(String(i), `${i}/5`);
        d.setValue(String(this.e.presence)).onChange(v => (this.e.presence = parseInt(v)));
      });
      // Energy
      new Setting(contentEl).setName("Energy after /5").addDropdown(d => {
        d.addOption("0", "—");
        for (let i = 5; i >= 1; i--) d.addOption(String(i), `${i}/5`);
        d.setValue(String(this.e.energy)).onChange(v => (this.e.energy = parseInt(v)));
      });
      // Carnegie
      const cWrap = contentEl.createDiv({ cls: "ph-c-toggles" });
      cWrap.createEl("p", { text: "Carnegie used this talk?", cls: "ph-label" });
      for (const [key, label] of [
        ["c2_used", "C2 Appreciation"],
        ["c4_used", "C4 Genuine interest"],
        ["c7_used", "C7 Made feel important"],
      ] as const) {
        new Setting(cWrap).setName(label).addToggle(t =>
          t.onChange(v => { (this.e as any)[key] = v; })
        );
      }
    }

    // ── Save ─────────────────────────────────────────────────────────────────
    const foot = contentEl.createDiv({ cls: "ph-sheet-foot" });
    const saveBtn = foot.createEl("button", { text: "Save talk", cls: ["ph-btn", "ph-btn-primary"] });
    saveBtn.addEventListener("click", async () => {
      saveBtn.setText("Saving…");
      saveBtn.setAttr("disabled", "true");
      try {
        await logTalk(this.plugin.people, this.plugin.settings, this.person, this.e);
      } catch (err) {
        new Notice(`Could not save talk: ${describeError(err)}`, 8000);
        saveBtn.setText("Save talk");
        saveBtn.removeAttribute("disabled");
        return;
      }
      new Notice(`✓ Logged talk with ${this.person.name}${this.e.presence ? ` · Presence ${this.e.presence}/5` : ""}`);
      this.onSaved?.();
      this.close();
    });
    const cancelBtn = foot.createEl("button", { text: "Cancel", cls: "ph-btn" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose() { this.contentEl.empty(); }
}

// ─── SwipeHandler ─────────────────────────────────────────────────────────────
// Attaches swipe-right gesture detection to a list container.
// On swipe, opens the QuickLogSheet for the swiped person row.

export class SwipeHandler {
  private startX = 0;
  private startY = 0;
  private target: HTMLElement | null = null;

  constructor(
    private container: HTMLElement,
    private getPersonForEl: (el: HTMLElement) => PersonView | null,
    private open: (p: PersonView) => void,
  ) {
    this.attach();
  }

  private attach() {
    this.container.addEventListener("touchstart", this.onStart, { passive: true });
    this.container.addEventListener("touchend",   this.onEnd,   { passive: true });
  }

  detach() {
    this.container.removeEventListener("touchstart", this.onStart);
    this.container.removeEventListener("touchend",   this.onEnd);
  }

  private onStart = (e: TouchEvent) => {
    const t = e.touches[0];
    this.startX = t.clientX;
    this.startY = t.clientY;
    this.target = e.target as HTMLElement;
  };

  private onEnd = (e: TouchEvent) => {
    if (!e.changedTouches.length) return;
    const t    = e.changedTouches[0];
    const dx   = t.clientX - this.startX;
    const dy   = t.clientY - this.startY;
    const adx  = Math.abs(dx);
    const ady  = Math.abs(dy);
    // swipe right: horizontal > 60px, more horizontal than vertical, not too fast scroll
    if (dx > 60 && adx > ady * 1.5 && this.target) {
      const row = this.target.closest<HTMLElement>(".ph-row");
      if (row) {
        const person = this.getPersonForEl(row);
        if (person) {
          this.flashRow(row);
          this.open(person);
        }
      }
    }
    this.target = null;
  };

  private flashRow(row: HTMLElement) {
    row.addClass("ph-swiped");
    setTimeout(() => row.removeClass("ph-swiped"), 400);
  }
}
