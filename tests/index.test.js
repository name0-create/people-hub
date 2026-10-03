const assert = require("assert");
const { FakeApp, TFolder } = require("./fake-obsidian");
const { DEFAULT_SETTINGS } = require("../.test-build/core/settings");
const { FolderService } = require("../.test-build/core/folder-service");
const { PeopleIndex } = require("../.test-build/repository/PeopleIndex");
const { MarkdownStore } = require("../.test-build/repository/MarkdownStore");
const { PersonRepository } = require("../.test-build/repository/PersonRepository");
const { isPersonNote, frontmatterTags } = require("../.test-build/core/recognition");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SETTLE = 50;                                   // > fake cache delay (8ms)
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name, "\n    ", e.stack.split("\n").slice(0, 5).join("\n     ")); process.exitCode = 1; } };

function world(seed = true, settingsOverride = {}) {
  const app = new FakeApp();
  const settings = { ...DEFAULT_SETTINGS, ...settingsOverride };
  const folders = new FolderService(app, () => settings);
  const index = new PeopleIndex(app, folders, () => settings, 20);
  index.bind(() => {});
  const store = new MarkdownStore(app, folders, 400);
  const people = new PersonRepository(folders, store, index, () => settings);
  const changes = []; index.onChange(c => changes.push(c));
  if (seed) {
    app.seed("20 - PEOPLE/Jane Doe.md", { type: "person", id: "PERSON-123", name: "Jane Doe", type_person: "friend+mentor", birthday: "--03-14",
      frequency: "weekly", last_contact: "2026-01-01", next_contact: "2026-02-01", tags: ["a"], status: "Active", biz: "Acme" }, "# Jane\n");
    app.seed("20 - PEOPLE/John Doe.md", { type: "person", id: "PER-JOHN", name: "John Doe", favorite: true, importance: "high", role: "CEO", company: ["Globex"] }, "# John\n");
    app.seed("20 - PEOPLE/Not a person.md", { type: "project" }, "x");
  }
  return { app, settings, folders, index, store, people, changes };
}
const J = "20 - PEOPLE/Jane Doe.md", JN = "20 - PEOPLE/John Doe.md";
const names = idx => idx.all().map(p => p.name);

(async () => {
  console.log("Recognition (pure)");
  const cfg = { personType: "person", excludeFolders: "Templates,99 - SYSTEM", peopleFolder: "20 - PEOPLE", detectByFolder: true };
  const rec = (path, fm, over = {}) => isPersonNote(path, fm, { ...cfg, ...over });
  await test("type: person", () => assert.equal(rec("Any/x.md", { type: "person" }), true));
  await test("type is case-insensitive; other explicit type is not a person", () => {
    assert.equal(rec("Any/x.md", { type: "Person" }), true); assert.equal(rec("20 - PEOPLE/x.md", { type: "project" }), false);
  });
  await test("tags: list, '#'-prefixed, comma/space string, key `tag`", () => {
    assert.equal(rec("Any/x.md", { tags: ["type/person", "x"] }), true);
    assert.equal(rec("Any/x.md", { tags: ["#type/person"] }), true);
    assert.equal(rec("Any/x.md", { tags: "#type/person, friends" }), true);
    assert.equal(rec("Any/x.md", { tags: "friends type/person" }), true);
    assert.equal(rec("Any/x.md", { tag: "type/person" }), true);
    assert.equal(rec("Any/x.md", { tags: ["type/company"] }), false);
    assert.deepEqual(frontmatterTags({ tags: "#A, b" }), ["a", "b"]);
  });
  await test("a type/person tag wins over another explicit type (spec: 'or')", () => assert.equal(rec("Any/x.md", { type: "contact", tags: ["type/person"] }), true));
  await test("folder detection: only without a type, only in People folder, and switchable", () => {
    assert.equal(rec("20 - PEOPLE/x.md", { name: "x" }), true);
    assert.equal(rec("Elsewhere/x.md", { name: "x" }), false);
    assert.equal(rec("20 - PEOPLE/x.md", { name: "x" }, { detectByFolder: false }), false);
    assert.equal(rec("20 - PEOPLE/x.md", undefined), false);                       // no frontmatter
  });
  await test("excluded folders always win; configurable person type", () => {
    assert.equal(rec("Templates/x.md", { type: "person" }), false);
    assert.equal(rec("Any/x.md", { type: "contact" }, { personType: "contact" }), true);
    assert.equal(rec("Any/x.md", { tags: ["type/contact"] }, { personType: "contact" }), true);
  });

  console.log("Initial scan");
  await test("scan recognises people and builds lean, normalised entries", () => {
    const w = world();
    assert.deepEqual(names(w.index), ["Jane Doe", "John Doe"]); assert.equal(w.index.size, 2);
    assert.deepEqual(w.index.entry(J), { path: J, id: "PERSON-123", name: "Jane Doe", display_name: "Jane Doe", photo: undefined, favorite: false,
      relationship_type: ["friend", "mentor"], company: ["Acme"], role: undefined, status: "active", birthday: "--03-14",
      last_contacted: "2026-01-01", next_encounter: "2026-02-01", cadence: "weekly", importance: undefined, tags: ["a"] });
    const jn = w.index.entry(JN); assert.equal(jn.favorite, true); assert.equal(jn.importance, "high"); assert.equal(jn.role, "CEO"); assert.deepEqual(jn.company, ["Globex"]);
    assert.equal(w.index.stats.scans, 1); assert.equal(w.index.stats.parses, 2);      // the non-person is never parsed
  });
  await test("the index never writes to the vault", () => { const w = world(); w.index.all(); w.index.entries(); assert.equal(w.app.log.length, 0); });
  await test("a person is found by tag alone, anywhere in the vault", () => {
    const w = world(false); w.app.seed("Random/Somewhere/Ann.md", { tags: ["type/person"] }, ""); assert.deepEqual(names(w.index), ["Ann"]);
  });

  console.log("Incremental updates");
  await test("modify: only the affected note is re-parsed; no rescan; listeners get that path", async () => {
    const w = world(); w.index.all(); const p0 = w.index.stats.parses, s0 = w.index.stats.scans;
    w.app.externalEdit(JN, fm => { fm.role = "CTO"; }); await sleep(SETTLE);
    assert.equal(w.index.stats.parses - p0, 1); assert.equal(w.index.stats.scans, s0);
    assert.equal(w.index.entry(JN).role, "CTO"); assert.equal(w.index.view(JN).role, "CTO");
    assert.deepEqual(w.changes.map(c => c.paths), [[JN]]); assert.equal(w.changes[0].full, false);
  });
  await test("body-only edit re-parses but does NOT notify (no view churn while typing)", async () => {
    const w = world(); w.index.all(); const p0 = w.index.stats.parses;
    w.app.externalEdit(JN, null, "# John\nnew paragraph"); await sleep(SETTLE);
    assert.equal(w.index.stats.parses - p0, 1);      // metadata 'changed' fired; fm identical
    assert.equal(w.changes.length, 0);
  });
  await test("create: a new person appears (first without frontmatter, then with) — one entry", async () => {
    const w = world(); w.index.all();
    const file = await w.app.vault.create("20 - PEOPLE/New Guy.md", "# hi"); await sleep(SETTLE);
    assert.equal(w.index.size, 2);                                                // no frontmatter yet → not a person
    await w.app.fileManager.processFrontMatter(file, fm => { fm.type = "person"; fm.name = "New Guy"; fm.id = "PER-NEW"; }); await sleep(SETTLE);
    assert.equal(w.index.size, 3); assert.equal(w.index.entryById("PER-NEW").path, "20 - PEOPLE/New Guy.md");
  });
  await test("rename: entry moves to the new path; id lookup follows; both paths notified", async () => {
    const w = world(); w.index.all(); w.changes.length = 0; const s0 = w.index.stats.scans;
    const f = w.app.vault.getAbstractFileByPath(JN); await w.app.fileManager.renameFile(f, "20 - PEOPLE/Johnny.md"); await sleep(SETTLE);
    assert.equal(w.index.entry(JN), undefined); assert.equal(w.index.entry("20 - PEOPLE/Johnny.md").id, "PER-JOHN");
    assert.equal(w.index.entryById("PER-JOHN").path, "20 - PEOPLE/Johnny.md"); assert.equal(w.index.stats.scans, s0);
    assert.deepEqual([...new Set(w.changes.flatMap(c => c.paths))].sort(), ["20 - PEOPLE/Johnny.md", JN].sort());
  });
  await test("rename into an excluded folder removes the person; back restores", async () => {
    const w = world(); w.index.all(); w.app.folders.add("Templates");
    const f = w.app.vault.getAbstractFileByPath(JN); await w.app.fileManager.renameFile(f, "Templates/John Doe.md"); await sleep(SETTLE);
    assert.deepEqual(names(w.index), ["Jane Doe"]);
    await w.app.fileManager.renameFile(f, JN); await sleep(SETTLE); assert.deepEqual(names(w.index), ["Jane Doe", "John Doe"]);
  });
  await test("folder move → rescan; children keep working at new paths", async () => {
    const w = world(); w.index.all(); const s0 = w.index.stats.scans;
    w.app.moveFolder("20 - PEOPLE", "30 - PEOPLE"); await sleep(SETTLE);
    assert.equal(w.index.stats.scans, s0 + 1);
    // folder detection no longer applies (People folder setting unchanged) but type: person still does
    assert.deepEqual(names(w.index), ["Jane Doe", "John Doe"]); assert.ok(w.index.entry("30 - PEOPLE/John Doe.md"));
    assert.ok(w.changes.some(c => c.full));
  });
  await test("delete: removed from index; id lookup gone; folder delete removes children", async () => {
    const w = world(); w.index.all();
    await w.app.fileManager.trashFile(w.app.vault.getAbstractFileByPath(JN)); await sleep(SETTLE);
    assert.deepEqual(names(w.index), ["Jane Doe"]); assert.equal(w.index.entryById("PER-JOHN"), undefined);
    w.app.emitVault("delete", new TFolder("20 - PEOPLE")); assert.deepEqual(names(w.index), []);
  });
  await test("type flips: person → project removes; project → person adds (and tag route)", async () => {
    const w = world(); w.index.all();
    w.app.externalEdit(JN, fm => { fm.type = "project"; }); await sleep(SETTLE); assert.deepEqual(names(w.index), ["Jane Doe"]);
    w.app.externalEdit(JN, fm => { fm.type = "project"; fm.tags = ["type/person"]; }); await sleep(SETTLE); assert.deepEqual(names(w.index), ["Jane Doe", "John Doe"]);
  });
  await test("bursts are batched: 25 edits → ONE notification listing every path", async () => {
    const w = world(false); for (let i = 0; i < 25; i++) w.app.seed(`20 - PEOPLE/P${i}.md`, { type: "person", name: `P${i}` }, "");
    w.index.all(); w.changes.length = 0;
    for (let i = 0; i < 25; i++) w.app.externalEdit(`20 - PEOPLE/P${i}.md`, fm => { fm.role = "x"; });
    await sleep(120); assert.equal(w.changes.length, 1); assert.equal(w.changes[0].paths.length, 25);
  });
  await test("unsubscribe stops notifications; a throwing listener doesn't break others", async () => {
    const w = world(); w.index.all(); let n = 0; const off = w.index.onChange(() => { n++; }); w.index.onChange(() => { throw new Error("boom"); });
    const err = console.error; console.error = () => {};
    w.app.externalEdit(JN, fm => { fm.role = "A"; }); await sleep(SETTLE); off(); w.app.externalEdit(JN, fm => { fm.role = "B"; }); await sleep(SETTLE);
    console.error = err; assert.equal(n, 1); assert.equal(w.changes.length, 2);
  });

  console.log("Integration with PersonRepository");
  await test("updatePerson refreshes just that entry (no rescan) and notifies once", async () => {
    const w = world(); w.index.all(); w.changes.length = 0; const s0 = w.index.stats.scans, p0 = w.index.stats.parses;
    await w.people.updatePerson(JN, { importance: "critical", tags: ["vip"] }); await sleep(SETTLE);
    assert.equal(w.index.entry(JN).importance, "critical"); assert.deepEqual(w.index.entry(JN).tags, ["vip"]);
    assert.equal(w.index.stats.scans, s0); assert.ok(w.index.stats.parses - p0 <= 2);   // repo refresh + the cache event
    assert.equal(w.changes.length, 1);                                                   // duplicates suppressed by fingerprint
  });
  await test("create / rename / archive / delete through the repository keep the index exact", async () => {
    const w = world(); w.index.all();
    const c = await w.people.createPerson({ name: "Zed", prm_tier: "close" }); assert.ok(w.index.entry(c.path));
    const r = await w.people.renamePerson(c.path, "Zed Two"); assert.equal(w.index.entry(c.path), undefined); assert.equal(w.index.entry(r.path).name, "Zed Two");
    const a = await w.people.archivePerson(r.path); assert.equal(w.index.entry(a.path).status, "archived"); assert.equal(w.index.entry(r.path), undefined);
    const b = await w.people.restorePerson(a.path); assert.equal(w.index.entry(b.path).status, "active");
    await w.people.deletePerson(b.path); assert.equal(w.index.entry(b.path), undefined); assert.equal(w.index.entryById(c.person.id), undefined);
    await sleep(SETTLE);
    assert.equal(JSON.stringify(w.index.entries()), JSON.stringify(new PeopleIndex(w.app, w.folders, () => w.settings).entries()));
  });

  console.log("Lookups");
  await test("entryById, duplicateIds, search, invalidate", () => {
    const w = world(); w.app.seed("20 - PEOPLE/Dupe.md", { type: "person", id: "PER-JOHN", name: "Dupe" }, "");
    assert.deepEqual(w.index.duplicateIds(), ["PER-JOHN"]); assert.equal(w.index.entryById("PER-NOPE"), undefined);
    assert.deepEqual(w.index.search("globex").map(e => e.name), ["John Doe"]); assert.deepEqual(w.index.search("MENTOR").map(e => e.name), ["Jane Doe"]);
    assert.deepEqual(w.index.search("  ").length, 3);
    w.app.seed("20 - PEOPLE/Late.md", { type: "person", name: "Late" }, ""); assert.equal(w.index.size, 3);   // unseen: no event bound for seed
    w.index.invalidate(); assert.equal(w.index.size, 4);
  });

  console.log("Day rollover");
  await test("date-dependent fields recompute when the day changes; rollover notifies", async () => {
    const RealDate = Date; let now = new RealDate(2026, 8, 30, 12, 0, 0).getTime();
    global.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(now); } static now() { return now; } };
    try {
      const w = world(false); w.app.seed("20 - PEOPLE/Due.md", { type: "person", name: "Due", next_contact: "2026-10-01" }, "");
      assert.equal(w.index.all()[0].dueIn, 1); assert.equal(w.index.rolloverIfNeeded(), false);
      now = new RealDate(2026, 9, 1, 8, 0, 0).getTime();
      assert.equal(w.index.rolloverIfNeeded(), true); w.index.flush();
      assert.equal(w.index.all()[0].dueIn, 0); assert.equal(w.index.all()[0].needsReachOut, true); assert.equal(w.changes.length, 1);
    } finally { global.Date = RealDate; }
  });

  console.log("Invariant: incremental index == fresh scan");
  const rng = (a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(20260930);
  const pick = a => a[Math.floor(rng() * a.length)];
  await test("300 random create/edit/rename/move/delete/type-flip operations never let the index drift", async () => {
    const w = world(false); w.index.all();
    const dirs = ["20 - PEOPLE", "20 - PEOPLE/_Archive", "Elsewhere", "Templates"]; dirs.forEach(d => w.app.folders.add(d));
    const variants = [() => ({ type: "person", name: pick(["Al", "Bo", "Cy"]) + Math.floor(rng() * 9) }), () => ({ tags: ["type/person"], name: "T" + Math.floor(rng() * 9) }),
      () => ({ tags: "#type/person, x", name: "S" + Math.floor(rng() * 9) }), () => ({ type: "project", name: "Proj" }), () => ({ name: "Bare" + Math.floor(rng() * 9) }), () => ({})];
    const edits = [fm => { fm.status = pick(["active", "Paused", "archived"]); }, fm => { fm.birthday = pick(["--03-14", "1990-05-05", "x", "2000-02-30"]); }, fm => { fm.type = pick(["person", "project", "person"]); },
      fm => { fm.next_contact = pick(["2026-01-01", "2027-01-01"]); }, fm => { fm.tags = pick([["type/person"], ["x"], "type/person"]); }, fm => { delete fm.name; }, fm => { fm.id = pick(["PER-1", "PER-2", "PER-3"]); },
      fm => { fm.company = pick(["Acme", ["A", "B"], ""]); }];
    let n = 0;
    for (let i = 0; i < 300; i++) {
      const files = [...w.app.entries.keys()]; const op = pick(["create", "create", "edit", "edit", "edit", "body", "rename", "delete", "folder"]);
      try {
        if (op === "create" || !files.length) { const p = `${pick(dirs)}/N${n++}.md`; const f = await w.app.vault.create(p, "b"); const v = pick(variants)();
          if (Object.keys(v).length) await w.app.fileManager.processFrontMatter(f, fm => Object.assign(fm, v)); }
        else if (op === "edit") { const p = pick(files); await w.app.fileManager.processFrontMatter(w.app.vault.getAbstractFileByPath(p), pick(edits)); }
        else if (op === "body") w.app.externalEdit(pick(files), null, "new body " + i);
        else if (op === "rename") { const p = pick(files), to = `${pick(dirs)}/R${n++}.md`; await w.app.fileManager.renameFile(w.app.vault.getAbstractFileByPath(p), to); }
        else if (op === "delete") await w.app.fileManager.trashFile(w.app.vault.getAbstractFileByPath(pick(files)));
        else if (op === "folder" && rng() < 0.15) { w.app.moveFolder("Elsewhere", "Moved"); w.app.moveFolder("Moved", "Elsewhere"); }
      } catch (e) { if (!/exists|does not exist/.test(e.message)) throw e; }
      await sleep(14);
      const fresh = new PeopleIndex(w.app, w.folders, () => w.settings);
      const sig = idx => JSON.stringify([idx.entries(), idx.all().map(v => [v.file.path, v.name, v.dueIn, v.status, v.tier, v.birthdate])]);
      if (sig(w.index) !== sig(fresh)) assert.fail(`drift after op #${i} (${op}):\n incremental: ${JSON.stringify(w.index.entries().map(e => e.path))}\n fresh:       ${JSON.stringify(fresh.entries().map(e => e.path))}`);
    }
    assert.equal(w.index.stats.scans <= 1 + Math.ceil(300 * 0.15) * 2, true, "expected mostly incremental work, got scans=" + w.index.stats.scans);
  });

  console.log(`\n${passed} passed${process.exitCode ? " — FAILURES ABOVE" : ""}`);
})();
