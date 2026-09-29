/** Chinese zodiac, Western sign and lunar date helpers (uses Intl's built-in Chinese calendar). */

const ANIMALS = ["Rat", "Ox", "Tiger", "Rabbit", "Dragon", "Snake", "Horse", "Goat", "Monkey", "Rooster", "Dog", "Pig"];
const SIGNS: [number, number, string][] = [ // [month, first day of sign, name]
  [1, 20, "Aquarius"], [2, 19, "Pisces"], [3, 21, "Aries"], [4, 20, "Taurus"], [5, 21, "Gemini"], [6, 21, "Cancer"],
  [7, 23, "Leo"], [8, 23, "Virgo"], [9, 23, "Libra"], [10, 23, "Scorpio"], [11, 22, "Sagittarius"], [12, 22, "Capricorn"]
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function westernSign(month: number, day: number): string {
  // sign names run Aquarius(Jan20) … Capricorn(Dec22); before Jan 20 it's Capricorn
  if (month === 1 && day < 20) return "Capricorn";
  let name = "Capricorn";
  for (const [m, d, n] of SIGNS) if (month > m || (month === m && day >= d)) name = n;
  return name;
}
const ord = (n: number) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
};

export interface LunarInfo { animal: string; label: string; }

/** Lunar month/day + zodiac animal for a Gregorian date. Returns null if Intl lacks the Chinese calendar. */
export function lunarInfo(date: Date): LunarInfo | null {
  try {
    const parts = new Intl.DateTimeFormat("en-u-ca-chinese", { month: "numeric", day: "numeric", year: "numeric" }).formatToParts(date);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
    const related = parseInt(get("relatedYear"), 10);
    const monthRaw = get("month");            // e.g. "8" or "6bis" (leap)
    const leap = /bis|leap/i.test(monthRaw);
    const month = parseInt(monthRaw, 10);
    const day = parseInt(get("day"), 10);
    if (isNaN(related) || isNaN(month) || isNaN(day)) return null;
    return {
      animal: ANIMALS[(((related - 4) % 12) + 12) % 12],
      label: `Lunar ${leap ? "Leap " : ""}${MONTHS[month - 1]} ${ord(day)}`
    };
  } catch { return null; }
}
