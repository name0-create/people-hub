import type { TFile } from "obsidian";

export type Tier = "inner" | "close" | "extended" | "professional";
export const TIERS: Tier[] = ["inner", "close", "extended", "professional"];

export interface BirthDate { month: number; day: number; year: number | null; }
export interface BirthdayInfo { date: Date; age: number | null; days: number; }
export interface SocialLink { platform: string; label: string; handle: string; url: string; }

export interface Person {
  file: TFile;
  name: string;
  tier: Tier;
  active: boolean;
  paused: boolean;
  status: string;
  category: string;
  importance: string;
  company: string;
  role: string;
  phone: string;
  email: string;
  photo: string;
  socials: SocialLink[];
  birthdate: BirthDate | null;
  birthday: BirthdayInfo | null;
  lastContacted: Date | null;
  sinceContact: number | null;   // days since last contact
  cadenceDays: number;
  dueDate: Date;                 // last_contacted + cadence (or snoozed_until)
  dueIn: number;                 // negative = overdue
  needsReachOut: boolean;
  nextEncounter: Date | null;
  nextPlace: string;
  nextPurpose: string;
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
  bodyTemplate: string;
  weekStartsOn: 0 | 1;
  showStatusBar: boolean;
  startupNotice: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  peopleFolder: "40 - PEOPLE/People",
  personType: "person",
  excludeFolders: "Templates",
  tierDays: { inner: 7, close: 14, extended: 30, professional: 60 },
  birthdayLookahead: 30,
  meetingLookahead: 14,
  logHeading: "## 🕘 Contact History",
  useTemplater: false,
  templaterTemplate: "",
  bodyTemplate: "",
  weekStartsOn: 1,
  showStatusBar: true,
  startupNotice: true
};
