// ─── Zodiac & lunar date ──────────────────────────────────────────────────────
// Pure helpers for the line shown under a birthday: "Rooster · Libra · Lunar Sep 18th".
//
//   Chinese zodiac + lunar date come from the platform's Chinese calendar
//   (Intl, `en-u-ca-chinese`), so the lunar new year boundary is handled correctly
//   (someone born in January 2005 is a Monkey, not a Rooster). If the platform has no
//   Chinese calendar, those two parts are simply omitted.
//   Western sign is from month/day only, so it also works for year-less birthdays.

import type { BirthDate } from "../models/person-view";

const CHINESE_ANIMALS = ["Rat", "Ox", "Tiger", "Rabbit", "Dragon", "Snake", "Horse", "Goat", "Monkey", "Rooster", "Dog", "Pig"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// [month, last day of that sign in the month, sign before, sign from the next day]
const WESTERN: [number, number, string, string][] = [
  [1, 19, "Capricorn", "Aquarius"], [2, 18, "Aquarius", "Pisces"], [3, 20, "Pisces", "Aries"],
  [4, 19, "Aries", "Taurus"], [5, 20, "Taurus", "Gemini"], [6, 20, "Gemini", "Cancer"],
  [7, 22, "Cancer", "Leo"], [8, 22, "Leo", "Virgo"], [9, 22, "Virgo", "Libra"],
  [10, 22, "Libra", "Scorpio"], [11, 21, "Scorpio", "Sagittarius"], [12, 21, "Sagittarius", "Capricorn"],
];

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export function westernZodiac(month: number, day: number): string {
  const row = WESTERN[month - 1];
  return day <= row[1] ? row[2] : row[3];
}

export interface ChineseDate {
  animal: string;
  /** e.g. "Sep 18th", or "leap Apr 5th" */
  lunar: string;
}

/** Chinese zodiac animal + lunar month/day for a full birth date. Null if unavailable. */
export function chineseDate(bd: { year: number; month: number; day: number }): ChineseDate | null {
  try {
    const noon = new Date(bd.year, bd.month - 1, bd.day, 12);      // noon avoids timezone edge cases
    const parts = new Intl.DateTimeFormat("en-u-ca-chinese", { year: "numeric", month: "numeric", day: "numeric" })
      .formatToParts(noon);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
    const related = parseInt(get("relatedYear"), 10);
    const monthRaw = get("month");                                  // "9", or "4bis" for a leap month
    const lunarMonth = parseInt(monthRaw, 10);
    const lunarDay = parseInt(get("day"), 10);
    if (!Number.isFinite(related) || !(lunarMonth >= 1 && lunarMonth <= 12) || !(lunarDay >= 1)) return null;
    const leap = /\D/.test(monthRaw);
    return {
      animal: CHINESE_ANIMALS[(((related - 4) % 12) + 12) % 12],
      lunar: `${leap ? "leap " : ""}${MONTHS[lunarMonth - 1]} ${ordinal(lunarDay)}`,
    };
  } catch {
    return null;
  }
}

/** "Rooster · Libra · Lunar Sep 18th" (parts omitted when they can't be known). */
export function zodiacLine(bd: BirthDate | null): string {
  if (!bd) return "";
  const parts: string[] = [];
  const cn = bd.year ? chineseDate({ year: bd.year, month: bd.month, day: bd.day }) : null;
  if (cn) parts.push(cn.animal);
  parts.push(westernZodiac(bd.month, bd.day));
  if (cn) parts.push(`Lunar ${cn.lunar}`);
  return parts.join(" · ");
}
