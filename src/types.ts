import type { TFile } from "obsidian";

export type Tier = "inner" | "close" | "extended" | "professional";
export const TIERS: Tier[] = ["inner", "close", "extended", "professional"];
export const CARNEGIE_LABELS: Record<string, string> = {
  c1: "Don't criticize", c2: "Genuine appreciation", c3: "Arouse eager want",
  c4: "Become genuinely interested", c5: "Remember name / smile",
  c6: "Talk in their interests", c7: "Make them feel important",
  c8: "Avoid arguments", c9: "Admit quickly / save face"
};

export interface CarnegieScores {
  c1: number; c2: number; c3: number; c4: number; c5: number;
  c6: number; c7: number; c8: number; c9: number;
  avg: number; weakest: string; weakestLabel: string;
}

export interface SocialLink { platform: string; label: string; handle: string; url: string; }
export interface BirthDate { month: number; day: number; year: number | null; }
export interface BirthdayInfo { date: Date; age: number | null; days: number; }

export interface ContactRef { date: Date; path: string; }
export interface MeetingInfo { date: Date; time: string; note: string; days: number; }

export interface TalkLog {
  date: Date | null; where: string; note: string;
  learned: string; next: string; presence: number; energy: number;
}

export interface Person {
  file: TFile;
  name: string; fullName: string;
  typePerson: string;   // family / mentor / prospect / girlfriend / random …
  alsoIs: string;
  tier: Tier;           // derived: family/girlfriend → inner etc.
  active: boolean; paused: boolean; status: string;
  company: string; role: string;
  phone: string; email: string;
  socials: SocialLink[];
  location: string;
  birthdate: BirthDate | null;
  birthday: BirthdayInfo | null;
  anniversary: Date | null;
  nextMeeting: MeetingInfo | null;
  lastContact: Date | null;
  lastContactSource: "note" | "manual" | "";
  recentContacts: ContactRef[];   // newest first, from dated-note links
  mentions: number;
  nextContact: Date | null;
  frequency: string;
  sinceContact: number | null;
  dueIn: number;
  needsReachOut: boolean;
  healthScore: number;
  trustScore: number;
  carnegie: CarnegieScores;
  promisesMade: number; promisesKept: number; promiseRatio: number | null;
  wants: string; fears: string; interests: string;
  theirStory: string;
  skillCode: string;
  talks: TalkLog[];
  nextAction: string;
  photo: string;
  tags: string[];
  favorite: boolean;
}

export interface PluginSettings {
  peopleFolder: string;
  personType: string;
  excludeFolders: string;
  tierDays: Record<Tier, number>;
  birthdayLookahead: number;
  meetingLookahead: number;
  logHeading: string;
  useTemplater: boolean;
  templaterTemplate: string;
  weekStartsOn: 0 | 1;
  showStatusBar: boolean;
  startupNotice: boolean;
  // v0.2
  autoInjectBirthdays: boolean;
  injectHeading: string;
  injectLookahead: number;
  injectPosition: "top" | "bottom";
  dailyNoteFolder: string;
  dailyNoteFormat: string;
  icsPath: string;
  icsIncludeMeetings: boolean;
  deriveContactFromNotes: boolean;
  journalDateField: string;
}
export const DEFAULT_SETTINGS: PluginSettings = {
  peopleFolder: "20 - PEOPLE",
  personType: "person",
  excludeFolders: "Templates,99 - SYSTEM",
  tierDays: { inner: 1, close: 7, extended: 30, professional: 90 },
  birthdayLookahead: 30,
  meetingLookahead: 14,
  logHeading: "## Talk 1 - Latest",
  useTemplater: false,
  templaterTemplate: "99 - SYSTEM/Templates/Template - Person - Full.md",
  weekStartsOn: 1,
  showStatusBar: true,
  startupNotice: true,
  autoInjectBirthdays: false,
  injectHeading: "## 🎂 Birthdays",
  injectLookahead: 7,
  injectPosition: "top",
  dailyNoteFolder: "",
  dailyNoteFormat: "",
  icsPath: "People Hub/people.ics",
  icsIncludeMeetings: true,
  deriveContactFromNotes: true,
  journalDateField: "date"
};
