import { normalizePath, Notice } from "obsidian";
import type PeopleHubPlugin from "./main";
import { isLeapYear, nextBirthday } from "./dates";
import type { Person } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545: fold lines at 75 octets (never splitting a UTF-8 character). */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "", bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ""; bytes = 0; limit = 74; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function buildIcs(people: Person[], includeMeetings: boolean, now = new Date()): string {
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const L: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//People Hub//Obsidian//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:People Hub"
  ];
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const p of people) {
    const bd = p.birthdate;
    if (bd && p.active) {
      const start = bd.year ?? nextBirthday(bd, day).date.getFullYear();
      const leapBaby = bd.month === 2 && bd.day === 29;
      // Feb 29 birthdays: last day of February in non-leap years
      const d0 = leapBaby && !isLeapYear(start) ? new Date(start, 1, 28) : new Date(start, bd.month - 1, bd.day);
      const d1 = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1);
      L.push(
        "BEGIN:VEVENT",
        `UID:${hash(p.file.path)}-bday@people-hub`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(d0)}`,
        `DTEND;VALUE=DATE:${ymd(d1)}`,
        leapBaby ? "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1" : "RRULE:FREQ=YEARLY",
        `SUMMARY:${esc(`🎂 ${p.name}`)}`,
        ...(p.typePerson ? [`DESCRIPTION:${esc(p.typePerson)}`] : []),
        "TRANSP:TRANSPARENT",
        "END:VEVENT"
      );
    }
    const m = p.nextMeeting;
    if (includeMeetings && m && m.days >= 0) {
      L.push("BEGIN:VEVENT", `UID:${hash(p.file.path)}-meet-${ymd(m.date)}@people-hub`, `DTSTAMP:${stamp}`);
      if (m.time) {
        const [h, mi] = m.time.split(":").map(Number);
        const s = new Date(m.date.getFullYear(), m.date.getMonth(), m.date.getDate(), h, mi);
        const e = new Date(s.getTime() + 60 * 60 * 1000);
        const f = (x: Date) => `${ymd(x)}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
        L.push(`DTSTART:${f(s)}`, `DTEND:${f(e)}`);   // floating local time
      } else {
        const e = new Date(m.date.getFullYear(), m.date.getMonth(), m.date.getDate() + 1);
        L.push(`DTSTART;VALUE=DATE:${ymd(m.date)}`, `DTEND;VALUE=DATE:${ymd(e)}`);
      }
      L.push(`SUMMARY:${esc(`📅 ${p.name}${m.note ? " — " + m.note : ""}`)}`, "END:VEVENT");
    }
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

/** Writes the .ics into the vault. Returns the path. */
export async function exportIcs(plugin: PeopleHubPlugin): Promise<string | null> {
  const s = plugin.settings, ad = plugin.app.vault.adapter;
  const people = plugin.index.all();
  const events = people.filter(p => p.birthdate && p.active).length;
  if (!events && !(s.icsIncludeMeetings && people.some(p => p.nextMeeting))) { new Notice("People Hub: nothing to export yet"); return null; }
  const path = normalizePath(s.icsPath.trim() || "People Hub/people.ics");
  const parts = path.split("/").slice(0, -1);
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    if (!(await ad.exists(acc))) await ad.mkdir(acc);
  }
  await ad.write(path, buildIcs(people, s.icsIncludeMeetings));
  new Notice(`People Hub: exported ${events} birthdays → ${path}`);
  return path;
}
