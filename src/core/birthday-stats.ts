// ─── Birthday stats (sidebar Birthdays tab) ───────────────────────────────────
// Pure: counts and the "Next 30 days" / "Later" split over PersonView records.

import type { PersonView } from "../models/person-view";

export interface BirthdayStats {
  total: number;
  today: number;
  within7: number;     // includes today
  within30: number;    // includes today
  next30: PersonView[];
  later: PersonView[];
}

export function birthdayStats(people: PersonView[], soonDays = 30): BirthdayStats {
  const withBirthday = people
    .filter(p => p.birthday && p.active)
    .sort((a, b) => a.birthday!.days - b.birthday!.days || a.name.localeCompare(b.name));
  const days = (p: PersonView) => p.birthday!.days;
  return {
    total: withBirthday.length,
    today: withBirthday.filter(p => days(p) === 0).length,
    within7: withBirthday.filter(p => days(p) <= 7).length,
    within30: withBirthday.filter(p => days(p) <= 30).length,
    next30: withBirthday.filter(p => days(p) <= soonDays),
    later: withBirthday.filter(p => days(p) > soonDays),
  };
}
