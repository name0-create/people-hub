import type { BirthDate, BirthdayInfo, MeetingInfo } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

export function today(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
/** whole days from a to b (b - a) */
export function diffDays(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function mk(y: number, m: number, d: number): Date | null {
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}

/** Accepts YYYY-MM-DD (optionally with time) or DD/MM/YYYY */
export function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return mk(+m[3], +m[2], +m[1]);
  return null;
}

/** YYYY-MM-DD, --MM-DD, MM-DD, DD/MM/YYYY, DD/MM */
export function parseBirthdate(v: unknown): BirthDate | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.includes("{{") || s.includes("<%")) return null;
  let year: number | null = null, month = 0, day = 0;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { year = +m[1]; month = +m[2]; day = +m[3]; }
  else if ((m = s.match(/^(?:--)?(\d{1,2})-(\d{1,2})$/))) { month = +m[1]; day = +m[2]; }
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) { day = +m[1]; month = +m[2]; year = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/))) { day = +m[1]; month = +m[2]; }
  else return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day, year };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function occurrence(bd: BirthDate, year: number): Date {
  let day = bd.day;
  if (bd.month === 2 && day === 29 && !isLeap(year)) day = 28;
  return new Date(year, bd.month - 1, day);
}

export function nextBirthday(bd: BirthDate, from: Date): BirthdayInfo {
  let d = occurrence(bd, from.getFullYear());
  if (d.getTime() < from.getTime()) d = occurrence(bd, from.getFullYear() + 1);
  return {
    date: d,
    age: bd.year ? d.getFullYear() - bd.year : null,
    days: diffDays(from, d)
  };
}

/** next_meeting: YYYY-MM-DD, or YYYY-MM-DDTHH:MM / "YYYY-MM-DD HH:MM" */
export function parseMeeting(v: unknown, note: string, from: Date): MeetingInfo | null {
  if (v === null || v === undefined) return null;
  const m = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const date = mk(+m[1], +m[2], +m[3]);
  if (!date) return null;
  const time = m[4] !== undefined ? `${pad(+m[4])}:${m[5]}` : "";
  return { date, time, note, days: diffDays(from, date) };
}
export const isLeapYear = isLeap;
