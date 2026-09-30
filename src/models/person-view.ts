// ─── PersonView (runtime view model) ──────────────────────────────────────────
// Parsed + computed representation of a person note (holds the TFile, due dates,
// scores…). This is NOT the canonical stored schema — see models/Person.ts.
// Pure data types — no Obsidian API dependencies beyond TFile.
import type { TFile } from "obsidian";

export type Tier = "inner" | "close" | "extended" | "professional";
export const TIERS: Tier[] = ["inner", "close", "extended", "professional"];

export const CARNEGIE_LABELS: Record<string, string> = {
  c1: "Don't criticize",
  c2: "Give genuine appreciation",
  c3: "Arouse eager want",
  c4: "Become genuinely interested",
  c5: "Smile / remember the name",
  c6: "Talk in their interests",
  c7: "Make them feel important",
  c8: "Avoid arguments",
  c9: "Admit quickly / save face",
};

export interface CarnegieScores {
  c1: number; c2: number; c3: number; c4: number; c5: number;
  c6: number; c7: number; c8: number; c9: number;
  avg: number;
  weakest: string;       // "c3"
  weakestLabel: string;  // full label
}

export interface SocialLink { platform: string; label: string; handle: string; url: string; }
export interface BirthDate  { month: number; day: number; year: number | null; }
export interface BirthdayInfo { date: Date; age: number | null; days: number; }

export interface TalkLog {
  date: Date | null; where: string; note: string;
  learned: string; next: string; presence: number; energy: number;
}

// ── Anniversary ───────────────────────────────────────────────────────────────
export interface AnniversaryInfo {
  date: Date;      // this year's occurrence
  years: number | null;
  days: number;    // days until (0 = today)
  label: string;   // e.g. "3-year friendiversary", "wedding anniversary"
}

export interface PersonView {
  file: TFile;
  name: string; fullName: string;
  typePerson: string;
  alsoIs: string;
  tier: Tier;
  active: boolean; paused: boolean; status: string;
  company: string; role: string;
  phone: string; email: string;
  socials: SocialLink[];
  location: string;

  // Birthday
  birthdate: BirthDate | null;
  birthday: BirthdayInfo | null;

  // Anniversary (v0.2)
  anniversaryRaw: string;
  anniversary: AnniversaryInfo | null;

  // Reach-out
  lastContact: Date | null;
  nextContact: Date | null;
  frequency: string;
  sinceContact: number | null;   // days since last_contact
  dueIn: number;                 // negative = overdue
  needsReachOut: boolean;

  // Health
  healthScore: number;
  trustScore: number;

  // Carnegie
  carnegie: CarnegieScores;

  // Promises
  promisesMade: number; promisesKept: number; promiseRatio: number | null;

  // Context
  wants: string; fears: string; interests: string;
  theirStory: string;
  skillCode: string;
  talks: TalkLog[];
  nextAction: string;
  photo: string;
}
