import { App, Modal, Notice } from "obsidian";
import type PeopleHubPlugin from "./main";
import { toISO } from "./dates";
import type { MeetingInfo, Person } from "./types";
import { fmtShort } from "./ui";

export interface MeetingEdit { date: string; time: string; note: string; }

/** Write (or clear) next_meeting / next_meeting_note in the person's frontmatter. */
export async function saveMeeting(app: App, p: Person, m: MeetingEdit | null): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, fm => {
    if (!m || !m.date) { delete fm.next_meeting; delete fm.next_meeting_note; return; }
    fm.next_meeting = m.time ? `${m.date}T${m.time}` : m.date;
    if (m.note.trim()) fm.next_meeting_note = m.note.trim(); else delete fm.next_meeting_note;
  });
}

export function meetingText(m: MeetingInfo): string {
  return [fmtShort(m.date), m.time, m.note].filter(Boolean).join(" · ");
}

/** Inline editor: date + time + note, Save / Clear / Cancel. */
export function renderMeetingEditor(parent: HTMLElement, plugin: PeopleHubPlugin, p: Person, done: () => void) {
  const box = parent.createDiv({ cls: "ph-meet-edit" });
  box.addEventListener("click", e => e.stopPropagation());
  const row = box.createDiv({ cls: "ph-meet-fields" });
  const date = row.createEl("input", { type: "date" });
  const time = row.createEl("input", { type: "time" });
  date.value = p.nextMeeting ? toISO(p.nextMeeting.date) : toISO(new Date());
  time.value = p.nextMeeting?.time ?? "";
  const note = box.createEl("input", { type: "text", placeholder: "Topic / where", cls: "ph-meet-note" });
  note.value = p.nextMeeting?.note ?? "";

  const save = async () => {
    if (!date.value) { new Notice("Pick a date"); return; }
    await saveMeeting(plugin.app, p, { date: date.value, time: time.value, note: note.value });
    new Notice(`Meeting with ${p.name} saved`);
    done();
  };
  const btns = box.createDiv({ cls: "ph-meet-btns" });
  btns.createEl("button", { text: "Save", cls: ["ph-btn", "mod-cta"] }).addEventListener("click", save);
  if (p.nextMeeting) btns.createEl("button", { text: "Clear", cls: "ph-btn" }).addEventListener("click", async () => {
    await saveMeeting(plugin.app, p, null); new Notice(`Meeting with ${p.name} cleared`); done();
  });
  btns.createEl("button", { text: "Cancel", cls: "ph-btn" }).addEventListener("click", () => done());
  box.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); void save(); }
    else if (e.key === "Escape") { e.stopPropagation(); done(); }
  });
  setTimeout(() => date.focus(), 30);
}

/** Editable-in-place "next meeting" line. Click to edit, saves straight to frontmatter. */
export function renderMeetingLine(parent: HTMLElement, plugin: PeopleHubPlugin, p: Person) {
  const wrap = parent.createDiv({ cls: "ph-meet" });
  const draw = () => {
    wrap.empty();
    const m = p.nextMeeting;
    const line = wrap.createDiv({
      cls: ["ph-meet-line", m ? (m.days < 0 ? "is-past" : m.days <= 1 ? "is-soon" : "") : "is-empty"].filter(Boolean),
      text: m ? `📅 ${meetingText(m)}` : "＋ Schedule meeting",
      attr: { "aria-label": "Edit next meeting", role: "button", tabindex: "0" }
    });
    const edit = (e: Event) => { e.stopPropagation(); wrap.empty(); renderMeetingEditor(wrap, plugin, p, draw); };
    line.addEventListener("click", edit);
    line.addEventListener("keydown", e => { if (e.key === "Enter") edit(e); });
  };
  draw();
}

export class MeetingModal extends Modal {
  constructor(app: App, private plugin: PeopleHubPlugin, private person: Person) { super(app); }
  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: `Next meeting · ${this.person.name}` });
    renderMeetingEditor(this.contentEl, this.plugin, this.person, () => this.close());
  }
  onClose() { this.contentEl.empty(); }
}
