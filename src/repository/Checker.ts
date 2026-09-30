// ─── Checker ──────────────────────────────────────────────────────────────────
// Tiny field-validation helper for the Interaction / Meeting repositories.
// (Person validation is driven by SchemaRegistry instead.)

import { isIsoDate } from "../models/PropertyValidation";

export interface Issue { key: string; message: string; }
type Rec = Record<string, unknown>;

export class Checker {
  readonly issues: Issue[] = [];
  constructor(private rec: Rec) {}

  private add(key: string, message: string) { this.issues.push({ key, message }); return this; }
  private val(key: string, required: boolean): unknown {
    const v = this.rec[key];
    if (v === undefined && required) this.add(key, `"${key}" is required`);
    return v;
  }

  text(key: string, required = false) {
    const v = this.val(key, required);
    if (v !== undefined && (typeof v !== "string" || !v.trim())) this.add(key, `"${key}" must be a non-empty string`);
    return this;
  }
  date(key: string, required = false) {
    const v = this.val(key, required);
    if (v !== undefined && !(typeof v === "string" && isIsoDate(v))) this.add(key, `"${key}" must be a valid date (YYYY-MM-DD)`);
    return this;
  }
  time(key: string) {
    const v = this.rec[key];
    if (v !== undefined && !(typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v))) this.add(key, `"${key}" must be a time (HH:mm)`);
    return this;
  }
  number(key: string, min = -Infinity, max = Infinity) {
    const v = this.rec[key];
    if (v !== undefined && !(typeof v === "number" && Number.isFinite(v) && v >= min && v <= max)) {
      this.add(key, `"${key}" must be a number${min > -Infinity || max < Infinity ? ` between ${min} and ${max}` : ""}`);
    }
    return this;
  }
  oneOf(key: string, allowed: readonly string[], required = false) {
    const v = this.val(key, required);
    if (v !== undefined && !(typeof v === "string" && allowed.includes(v))) this.add(key, `"${key}" must be one of: ${allowed.join(", ")}`);
    return this;
  }
  list(key: string, opts: { required?: boolean; nonEmpty?: boolean; allowed?: readonly string[] } = {}) {
    const v = this.val(key, !!opts.required);
    if (v === undefined) return this;
    if (!Array.isArray(v) || !v.every(x => typeof x === "string" && x.trim())) return this.add(key, `"${key}" must be a list of non-empty strings`);
    if (opts.nonEmpty && v.length === 0) return this.add(key, `"${key}" needs at least one entry`);
    const bad = opts.allowed ? (v as string[]).filter(x => !opts.allowed!.includes(x)) : [];
    if (bad.length) this.add(key, `"${key}" has invalid entries: ${bad.join(", ")}`);
    return this;
  }
}
