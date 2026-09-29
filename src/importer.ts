import { App, Modal, normalizePath, Notice, Setting } from "obsidian";
import type PeopleHubPlugin from "./main";
import { toISO, today } from "./dates";
import type { Person } from "./types";

export interface Contact {
  name: string; company: string; role: string;
  phones: string[]; emails: string[];
  birthday: string; location: string; notes: string; website: string;
}
const blank = (): Contact => ({ name: "", company: "", role: "", phones: [], emails: [], birthday: "", location: "", notes: "", website: "" });

/** → "YYYY-MM-DD" or "--MM-DD" (year unknown), or "" */
export function normBirthday(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return m[1] === "1604" || m[1] === "0000" ? `--${m[2]}-${m[3]}` : `${m[1]}-${m[2]}-${m[3]}`;   // 1604/0000 = "year unknown" (Apple/Google)
  m = s.match(/^--(\d{2})-?(\d{2})$/);
  if (m) return `--${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let d = +m[1], mo = +m[2];
    if (mo > 12) [d, mo] = [mo, d];   // M/D/Y when the second slot can't be a month; otherwise D/M/Y (matches the plugin's own parser)
    return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return "";
}

// ─── vCard ────────────────────────────────────────────────────────────────
function qp(v: string): string {
  try {
    const bytes = v.replace(/=([0-9A-F]{2})/gi, (_, h) => "%" + h);
    return decodeURIComponent(bytes);
  } catch { return v; }
}
const unesc = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

export function parseVcf(text: string): Contact[] {
  const raw = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  // join quoted-printable soft line breaks (only on QP lines, so base64 PHOTO padding is untouched)
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let l = raw[i];
    if (/QUOTED-PRINTABLE/i.test(l)) while (l.endsWith("=") && i + 1 < raw.length) l = l.slice(0, -1) + raw[++i];
    lines.push(l);
  }
  const out: Contact[] = [];
  let c: Contact | null = null, fn = "", given = "", family = "";
  for (const line of lines) {
    const u = line.trim().toUpperCase();
    if (u === "BEGIN:VCARD") { c = blank(); fn = given = family = ""; continue; }
    if (u === "END:VCARD") {
      if (c) { c.name = fn || `${given} ${family}`.trim() || c.company || c.emails[0] || ""; if (c.name) out.push(c); }
      c = null; continue;
    }
    if (!c) continue;
    const idx = line.indexOf(":");
    if (idx < 1) continue;
    const head = line.slice(0, idx), params = head.split(";"), prop = params[0].replace(/^.*\./, "").toUpperCase();
    let val = line.slice(idx + 1);
    if (params.some(p => /ENCODING=QUOTED-PRINTABLE/i.test(p))) val = qp(val);
    const parts = val.split(/(?<!\\);/).map(unesc);
    const v = unesc(val).trim();
    switch (prop) {
      case "FN": fn = v; break;
      case "N": family = (parts[0] ?? "").trim(); given = [parts[1], parts[2]].filter(Boolean).join(" ").trim(); break;
      case "ORG": c.company = (parts[0] ?? "").trim(); break;
      case "TITLE": c.role = v; break;
      case "TEL": if (v) c.phones.push(v); break;
      case "EMAIL": if (v) c.emails.push(v); break;
      case "BDAY": c.birthday = normBirthday(v); break;
      case "ADR": c.location = parts.slice(2).map(x => x.trim()).filter(Boolean).join(", "); break;
      case "NOTE": c.notes = v; break;
      case "URL": if (!c.website) c.website = v; break;
    }
  }
  return out;
}

// ─── CSV (Google Contacts / Google Workspace) ─────────────────────────────
export function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

export function parseCsv(text: string): Contact[] {
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names: string[]) => names.map(n => head.indexOf(n)).find(i => i >= 0) ?? -1;
  const multi = (re: RegExp) => head.map((h, i) => (re.test(h) ? i : -1)).filter(i => i >= 0);
  const iFirst = col("first name", "given name"), iMid = col("middle name", "additional name"), iLast = col("last name", "family name");
  const iName = col("name", "file as", "display name"), iNick = col("nickname");
  const iOrg = col("organization name", "organization 1 - name", "company"), iRole = col("organization title", "organization 1 - title", "job title");
  const iBday = col("birthday"), iAddr = col("address 1 - formatted"), iNotes = col("notes"), iWeb = col("website 1 - value", "website");
  const mails = multi(/^e-?mail( \d+)? - value$|^e-?mail address$|^email$/), phones = multi(/^phone( \d+)? - value$|^phone number$|^phone$/);
  const split = (v: string) => v.split(":::").map(x => x.trim()).filter(Boolean);
  const out: Contact[] = [];
  for (const r of rows.slice(1)) {
    const g = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const c = blank();
    c.name = [g(iFirst), g(iMid), g(iLast)].filter(Boolean).join(" ") || g(iName) || g(iNick) || g(iOrg);
    c.company = g(iOrg); c.role = g(iRole);
    c.birthday = normBirthday(g(iBday));
    c.location = g(iAddr).replace(/\s*\n+\s*/g, ", "); c.notes = g(iNotes); c.website = g(iWeb);
    for (const i of mails) c.emails.push(...split(r[i] ?? ""));
    for (const i of phones) c.phones.push(...split(r[i] ?? ""));
    if (!c.name) c.name = c.emails[0] ?? "";
    if (c.name) out.push(c);
  }
  return out;
}

export function parseContacts(fileName: string, text: string): Contact[] {
  if (/BEGIN:VCARD/i.test(text)) return parseVcf(text);
  if (/\.csv$/i.test(fileName) || text.split("\n", 1)[0].includes(",")) return parseCsv(text);
  return [];
}

// ─── de-duplication + note creation ───────────────────────────────────────
const digits = (s: string) => s.replace(/\D/g, "").slice(-9);
export function findDuplicates(contacts: Contact[], existing: Person[]): Set<Contact> {
  const names = new Set(existing.flatMap(p => [p.name, p.fullName].filter(Boolean).map(x => x.toLowerCase())));
  const mails = new Set(existing.map(p => p.email.toLowerCase()).filter(Boolean));
  const tels = new Set(existing.map(p => digits(p.phone)).filter(x => x.length >= 7));
  const dup = new Set<Contact>();
  for (const c of contacts) {
    if (names.has(c.name.toLowerCase()) || c.emails.some(e => mails.has(e.toLowerCase())) || c.phones.some(t => digits(t).length >= 7 && tels.has(digits(t)))) dup.add(c);
  }
  return dup;
}

const yamlStr = (s: string) => JSON.stringify(s);
const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^\[\]]/g, "").replace(/\s+/g, " ").trim() || "Unnamed";

async function ensureFolder(app: App, path: string) {
  let acc = "";
  for (const part of normalizePath(path).split("/")) {
    acc = acc ? `${acc}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(acc)) await app.vault.createFolder(acc);
  }
}

export async function createContactNote(app: App, plugin: PeopleHubPlugin, c: Contact): Promise<void> {
  const s = plugin.settings, t = toISO(today());
  const folder = normalizePath(s.peopleFolder || "20 - PEOPLE");
  await ensureFolder(app, folder);
  const base = safeName(c.name);
  let path = `${folder}/${base}.md`, n = 2;
  while (app.vault.getAbstractFileByPath(path)) path = `${folder}/${base} (${n++}).md`;

  const fm: string[] = [
    "---",
    `type: ${yamlStr(s.personType)}`, `status: "active"`, `created: ${t}`, `source: "import"`,
    `name: ${yamlStr(c.name)}`, `full_name: ${yamlStr(c.name)}`, `type_person: "other"`,
    `frequency: "quarterly"`, `last_contact: ${t}`,
    ...(c.company ? [`company: ${yamlStr(c.company)}`] : []),
    ...(c.role ? [`role: ${yamlStr(c.role)}`] : []),
    ...(c.phones[0] ? [`phone: ${yamlStr(c.phones[0])}`] : []),
    ...(c.emails[0] ? [`email: ${yamlStr(c.emails[0])}`] : []),
    ...(c.location ? [`location: ${yamlStr(c.location)}`] : []),
    ...(c.birthday ? [`birthday: ${yamlStr(c.birthday)}`] : []),
    `tags:`, `  - type/person`, `  - status/active`, `  - imported`,
    "---"
  ];
  const extra: string[] = [];
  if (c.phones.length > 1) extra.push(`- Phones: ${c.phones.join(", ")}`);
  if (c.emails.length > 1) extra.push(`- Emails: ${c.emails.join(", ")}`);
  if (c.website) extra.push(`- Website: ${c.website}`);
  const body = [`\n# ${c.name}\n`, extra.length ? `## Contact\n\n${extra.join("\n")}\n` : "", c.notes ? `## Notes\n\n${c.notes}\n` : "", "## Talks Log\n\n"].filter(Boolean).join("\n");
  await app.vault.create(path, fm.join("\n") + "\n" + body);
}

// ─── modal ────────────────────────────────────────────────────────────────
export class ImportModal extends Modal {
  private contacts: Contact[] = [];
  private dups = new Set<Contact>();
  private skipDups = true;
  private onlyBirthdays = false;
  constructor(app: App, private plugin: PeopleHubPlugin) { super(app); }

  onOpen() { this.draw(); }
  onClose() { this.contentEl.empty(); }

  private draw() {
    const el = this.contentEl; el.empty();
    el.createEl("h3", { text: "Import contacts" });
    el.createEl("p", { text: "Choose a .vcf file (iPhone, Android, Google, Outlook) or a Google Contacts / Google Workspace CSV export.", cls: "ph-sub" });

    const input = el.createEl("input", { type: "file", attr: { accept: ".vcf,.vcard,.csv,.txt,text/vcard,text/csv" } });
    input.addEventListener("change", async () => {
      const f = input.files?.[0]; if (!f) return;
      try {
        this.contacts = parseContacts(f.name, await f.text());
        this.dups = findDuplicates(this.contacts, this.plugin.index.all());
        if (!this.contacts.length) new Notice("No contacts found in that file");
      } catch (e) { console.error(e); new Notice("Couldn't read that file"); }
      this.draw();
    });
    if (!this.contacts.length) return;

    const shown = () => this.contacts.filter(c => (!this.skipDups || !this.dups.has(c)) && (!this.onlyBirthdays || c.birthday));
    el.createEl("p", { text: `Found ${this.contacts.length} contacts · ${this.dups.size} already in your vault · ${this.contacts.filter(c => c.birthday).length} with birthdays` });
    new Setting(el).setName("Skip contacts already in vault").setDesc("Matched by name, email or phone.")
      .addToggle(t => t.setValue(this.skipDups).onChange(v => { this.skipDups = v; this.draw(); }));
    new Setting(el).setName("Only contacts with a birthday")
      .addToggle(t => t.setValue(this.onlyBirthdays).onChange(v => { this.onlyBirthdays = v; this.draw(); }));

    const list = shown();
    const prev = el.createDiv({ cls: "ph-imp-prev" });
    list.slice(0, 8).forEach(c => prev.createDiv({ text: [c.name, c.company, c.birthday].filter(Boolean).join(" · ") }));
    if (list.length > 8) prev.createDiv({ text: `…and ${list.length - 8} more`, cls: "ph-empty" });

    new Setting(el).addButton(b => b.setButtonText(`Import ${list.length}`).setCta().setDisabled(!list.length).onClick(async () => {
      b.setDisabled(true);
      let ok = 0, fail = 0;
      for (const c of list) {
        try { await createContactNote(this.app, this.plugin, c); ok++; } catch (e) { console.error("import failed", c.name, e); fail++; }
      }
      new Notice(`People Hub: imported ${ok} contacts${fail ? ` (${fail} failed)` : ""}`);
      this.close();
      setTimeout(() => this.plugin.refresh(), 800);
    }));
  }
}
