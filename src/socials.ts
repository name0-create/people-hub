import type { SocialLink } from "./types";

type FM = Record<string, any>;

const META: Record<string, { label: string; url: (h: string) => string }> = {
  instagram: { label: "IG", url: h => `https://instagram.com/${h}` },
  linkedin: { label: "in", url: h => (/^(in|company)\//.test(h) ? `https://www.linkedin.com/${h}` : `https://www.linkedin.com/in/${h}`) },
  x: { label: "X", url: h => `https://x.com/${h}` },
  youtube: { label: "YT", url: h => (h.startsWith("@") ? `https://youtube.com/${h}` : `https://youtube.com/@${h}`) },
  github: { label: "GH", url: h => `https://github.com/${h}` },
  tiktok: { label: "TT", url: h => `https://tiktok.com/@${h}` },
  facebook: { label: "FB", url: h => `https://facebook.com/${h}` },
  telegram: { label: "TG", url: h => `https://t.me/${h}` },
  whatsapp: { label: "WA", url: h => `https://wa.me/${h.replace(/\D/g, "")}` },
  website: { label: "🌐", url: h => (/^https?:\/\//i.test(h) ? h : `https://${h}`) }
};

const ALIASES: Record<string, string> = {
  ig: "instagram", instagram: "instagram", insta: "instagram",
  li: "linkedin", linkedin: "linkedin",
  x: "x", xtwitter: "x", twitter: "x",
  yt: "youtube", youtube: "youtube",
  gh: "github", github: "github",
  tiktok: "tiktok", tt: "tiktok",
  fb: "facebook", facebook: "facebook",
  tg: "telegram", telegram: "telegram",
  wa: "whatsapp", whatsapp: "whatsapp",
  web: "website", website: "website", url: "website", site: "website"
};

function normPlatform(k: string): string {
  return ALIASES[k.toLowerCase().replace(/[^a-z]/g, "")] ?? "";
}

function guessFromUrl(u: string): string {
  const s = u.toLowerCase();
  for (const key of Object.keys(META)) if (s.includes(key)) return key;
  if (s.includes("twitter.com") || s.includes("x.com")) return "x";
  return "website";
}

function clean(v: unknown): string {
  if (v === null || v === undefined || typeof v === "object") return "";
  const s = String(v).trim();
  return s.includes("{{") || s.includes("<%") ? "" : s;
}

/** Supports `socials:` as list-of-maps, map, list of URLs, and flat keys (instagram:, linkedin:, ...). */
export function parseSocials(fm: FM, phone: string): SocialLink[] {
  const found = new Map<string, string>();
  const add = (k: string, v: unknown) => {
    const p = normPlatform(k);
    const h = clean(v);
    if (p && h && !found.has(p)) found.set(p, h);
  };
  const s = fm.socials;
  if (Array.isArray(s)) {
    for (const item of s) {
      if (typeof item === "string") { const h = clean(item); if (h) found.set(guessFromUrl(h), h); }
      else if (item && typeof item === "object") for (const [k, v] of Object.entries(item)) add(k, v);
    }
  } else if (s && typeof s === "object") {
    for (const [k, v] of Object.entries(s)) add(k, v);
  }
  for (const k of ["instagram", "ig", "linkedin", "twitter", "x", "x_twitter", "youtube", "github", "tiktok", "facebook", "telegram", "website"]) add(k, fm[k]);
  add("whatsapp", fm.whatsapp || phone);

  const out: SocialLink[] = [];
  for (const [platform, raw] of found) {
    const handle = /^https?:\/\//i.test(raw) ? raw : raw.replace(/^@/, "");
    const meta = META[platform];
    out.push({ platform, label: meta.label, handle, url: /^https?:\/\//i.test(raw) ? raw : meta.url(handle) });
  }
  return out;
}
