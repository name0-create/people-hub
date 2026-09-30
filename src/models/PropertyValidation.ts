// ─── PropertyValidation ───────────────────────────────────────────────────────
// Pure functions driven by PropertyDefinition (SchemaRegistry).
//
//   coerceValue    READ path  — lenient. Turns whatever is in a note (including v0.2
//                  shapes such as a comma-separated string where a list is now
//                  expected) into the canonical shape. Never throws, never loses data
//                  it can represent. Returns undefined when there is no usable value.
//
//   validateValue  WRITE path — strict. Checks a value about to be written and
//                  returns an error message, or null when it is valid.

import type { PropertyDefinition } from "./PersonProperty";

const TEMPLATE_RE = /\{\{|<%/;          // un-rendered Templater / Obsidian template placeholders
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PARTIAL_DATE_RE = /^--(\d{2})-(\d{2})$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

export function isIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isPartialDate(s: string): boolean {
  const m = s.match(PARTIAL_DATE_RE);
  if (!m) return false;
  const month = +m[1], day = +m[2];
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return month >= 1 && month <= 12 && day >= 1 && day <= max;
}

// ── Read path ─────────────────────────────────────────────────────────────────
function scalarToString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const s = v.trim();
    return s && !TEMPLATE_RE.test(s) ? s : undefined;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function toText(raw: unknown): string | undefined {
  if (Array.isArray(raw)) {
    const parts = raw.map(scalarToString).filter((x): x is string => !!x);
    return parts.length ? parts.join(", ") : undefined;
  }
  return scalarToString(raw);
}

function toStringList(raw: unknown, multiselect: boolean): string[] | undefined {
  let items: string[];
  if (Array.isArray(raw)) {
    items = raw.map(scalarToString).filter((x): x is string => !!x);
  } else {
    const s = scalarToString(raw);
    if (!s) return undefined;
    // v0.2 stored several values in one string ("friend+mentor", "a, b").
    items = s.split(multiselect ? /[,;+/\n]+/ : /[,;\n]+/).map(x => x.trim()).filter(Boolean);
  }
  return items.length ? items : undefined;
}

export function coerceValue(def: PropertyDefinition, raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined;
  switch (def.type) {
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      const s = String(raw).trim().toLowerCase();
      if (["true", "yes", "1"].includes(s)) return true;
      if (["false", "no", "0"].includes(s)) return false;
      return undefined;
    }
    case "number": {
      if (typeof raw === "string" && !raw.trim()) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "list": case "links": return toStringList(raw, false);
    case "multiselect":        return toStringList(raw, true);
    default:                   return toText(raw);   // text, longtext, select, date, datetime
  }
}

// ── Write path ────────────────────────────────────────────────────────────────
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function checkOption(def: PropertyDefinition, v: string): string | null {
  if (def.options && !def.allowCustom && !def.options.includes(v)) {
    return `"${def.key}" must be one of: ${def.options.join(", ")} (got "${v}")`;
  }
  return null;
}

/** Strict check of a value about to be written. `undefined` (= remove) is handled by the caller. */
export function validateValue(def: PropertyDefinition, v: unknown): string | null {
  const k = def.key;
  switch (def.type) {
    case "text": case "longtext":
      return isNonEmptyString(v) ? null : `"${k}" must be a non-empty string`;
    case "select":
      if (!isNonEmptyString(v)) return `"${k}" must be a non-empty string`;
      return checkOption(def, v);
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? null : `"${k}" must be a number`;
    case "boolean":
      return typeof v === "boolean" ? null : `"${k}" must be true or false`;
    case "date":
      if (typeof v !== "string") return `"${k}" must be a date string (YYYY-MM-DD)`;
      if (isIsoDate(v)) return null;
      if (def.partialDate && isPartialDate(v)) return null;
      return `"${k}" must be a valid date (YYYY-MM-DD${def.partialDate ? " or --MM-DD" : ""}), got "${v}"`;
    case "datetime":
      return typeof v === "string" && ISO_DATETIME_RE.test(v) && !isNaN(Date.parse(v))
        ? null : `"${k}" must be an ISO 8601 timestamp`;
    case "list": case "links":
      return Array.isArray(v) && v.every(isNonEmptyString)
        ? null : `"${k}" must be a list of non-empty strings`;
    case "multiselect": {
      if (!Array.isArray(v) || !v.every(isNonEmptyString)) return `"${k}" must be a list of non-empty strings`;
      for (const item of v) { const e = checkOption(def, item); if (e) return e; }
      return null;
    }
  }
}
