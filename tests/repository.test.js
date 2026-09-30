const assert = require("assert");
const { FakeApp } = require("./fake-obsidian");
const { DEFAULT_SETTINGS } = require("../.test-build/core/settings");
const { FolderService } = require("../.test-build/core/folder-service");
const { PeopleIndex } = require("../.test-build/repository/PeopleIndex");
const { MarkdownStore } = require("../.test-build/repository/MarkdownStore");
const { PersonRepository } = require("../.test-build/repository/PersonRepository");
const { InteractionRepository } = require("../.test-build/repository/InteractionRepository");
const { MeetingRepository } = require("../.test-build/repository/MeetingRepository");
const actions = require("../.test-build/repository/person-actions");

const BODY = "# Jane\n\nSome *user* text — ünïcode ✓\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## Talks Log\n\n- old entry\n\n## Other\nkeep me\n";
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name, "\n    ", e.stack.split("\n").slice(0, 4).join("\n     ")); process.exitCode = 1; } };
const rejects = async (p, code, re) => {
  try { await p; } catch (e) { assert.equal(e.name, "RepositoryError", "wrong error: " + e.stack); assert.equal(e.code, code, e.message); if (re) assert.match(e.message, re); return e; }
  assert.fail("expected rejection " + code);
};

function world() {
  const app = new FakeApp();
  const settings = { ...DEFAULT_SETTINGS };
  const folders = new FolderService(app, () => settings);
  const index = new PeopleIndex(app, folders, () => settings);
  const store = new MarkdownStore(app, folders, 400);
  let changes = 0;
  const people = new PersonRepository(folders, store, index, () => settings, () => { changes++; });
  const interactions = new InteractionRepository(store, () => { changes++; });
  const meetings = new MeetingRepository(store, () => { changes++; });
  app.seed("20 - PEOPLE/Jane Doe.md", {
    type: "person", id: "PERSON-123", name: "Jane Doe", full_name: "Jane Doe", type_person: "friend+mentor",
    birthday: "--03-14", ig: "jane", frequency: "weekly", interests: "hiking, coffee",
    last_contact: "2026-01-01", next_contact: "2026-02-01", c1_score: 3, custom_user_field: "keep me",
    status: "active", tags: ["a"], times_met: 2,
  }, BODY);
  app.seed("20 - PEOPLE/Random note.md", { type: "project", title: "not a person" }, "hi");
  return { app, settings, folders, index, store, people, interactions, meetings, changes: () => changes, J: "20 - PEOPLE/Jane Doe.md" };
}
const writes = app => app.log.filter(l => l.op !== "create");

(async () => {
  console.log("PersonRepository — reads");
  await test("getPerson normalises a legacy v0.2 note without modifying it", async () => {
    const w = world(); const before = JSON.stringify(w.app.fm(w.J));
    const r = w.people.getPerson(w.J);
    assert.equal(r.person.name, "Jane Doe");
    assert.deepEqual(r.person.relationship_type, ["friend", "mentor"]);
    assert.equal(r.person.birthdate, "--03-14");
    assert.equal(r.person.instagram, "jane");
    assert.equal(r.person.cadence, "weekly");
    assert.deepEqual(r.person.interests, ["hiking", "coffee"]);
    assert.equal(r.person.last_contacted, "2026-01-01");
    assert.equal(r.person.schema_version, 0); assert.equal(r.needsMigration, true);
    assert.equal(r.person.id, "PERSON-123"); assert.equal(r.person.display_name, "Jane Doe");
    assert.equal(JSON.stringify(w.app.fm(w.J)), before); assert.equal(w.app.log.length, 0);
  });
  await test("getPerson → null for missing file and non-person notes; getPersonById works", async () => {
    const w = world();
    assert.equal(w.people.getPerson("nope.md"), null);
    assert.equal(w.people.getPerson("20 - PEOPLE/Random note.md"), null);
    assert.equal(w.people.getPersonById("PERSON-123").path, w.J);
    assert.equal(w.people.getPersonById("PER-NOPE"), null);
  });

  console.log("PersonRepository — safe updates");
  await test("update = one processFrontMatter; body + unknown keys untouched; legacy alias replaced; index sees it", async () => {
    const w = world();
    const rec = await w.people.updatePerson(w.J, { birthdate: "1990-03-14", nickname: "JJ" });
    assert.deepEqual(writes(w.app).map(l => l.op), ["processFrontMatter"]);       // no process / rename / rewrite
    assert.equal(w.app.body(w.J), BODY);                                           // body byte-identical
    const fm = w.app.fm(w.J);
    assert.equal(fm.birthdate, "1990-03-14"); assert.ok(!("birthday" in fm));
    assert.equal(fm.nickname, "JJ"); assert.equal(fm.ig, "jane");                  // untouched
    assert.equal(fm.custom_user_field, "keep me"); assert.equal(fm.c1_score, 3);
    assert.ok(fm.updated); assert.equal(rec.person.birthdate, "1990-03-14");
    assert.equal(w.changes(), 1);
    const jane = w.index.all().find(p => p.name === "Jane Doe");                   // index refreshed AFTER cache caught up
    assert.notEqual(jane.birthday.age, null);
  });
  await test("no-op patch does not bump `updated` or notify", async () => {
    const w = world(); await w.people.updatePerson(w.J, { nickname: "JJ" }); const u = w.app.fm(w.J).updated; const c = w.changes();
    await new Promise(r => setTimeout(r, 5));
    await w.people.updatePerson(w.J, { nickname: "JJ" });
    assert.equal(w.app.fm(w.J).updated, u); assert.equal(w.changes(), c);
  });
  await test("undefined removes a property", async () => {
    const w = world(); await w.people.updatePerson(w.J, { nickname: "JJ" });
    await w.people.updatePerson(w.J, { nickname: undefined });
    assert.ok(!("nickname" in w.app.fm(w.J)));
  });
  await test("invalid patches are rejected before anything is written", async () => {
    const w = world(); const before = JSON.stringify(w.app.fm(w.J));
    await rejects(w.people.updatePerson(w.J, { prm_tier: "nope" }), "validation", /prm_tier/);
    await rejects(w.people.updatePerson(w.J, { id: "x" }), "validation", /managed/);
    await rejects(w.people.updatePerson(w.J, { title: "x" }), "validation", /managed/);
    await rejects(w.people.updatePerson(w.J, { made_up: 1 }), "validation", /unknown/);
    await rejects(w.people.updatePerson(w.J, { name: undefined }), "validation", /required/);
    await rejects(w.people.updatePerson(w.J, { birthdate: "1990-13-45" }), "validation", /birthdate/);
    await rejects(w.people.updatePerson(w.J, { times_met: "3" }), "validation", /number/);
    await rejects(w.people.updatePerson(w.J, { wins: "one" }), "validation", /list/);
    assert.equal(JSON.stringify(w.app.fm(w.J)), before); assert.equal(w.app.log.length, 0);
  });
  await test("year-less birthday (--MM-DD) still accepted", async () => {
    const w = world(); await w.people.updatePerson(w.J, { birthdate: "--12-25" }); assert.equal(w.app.fm(w.J).birthdate, "--12-25");
  });
  await test("errors: missing file → not_found; non-person → not_a_note; malformed YAML → io, file untouched", async () => {
    const w = world();
    await rejects(w.people.updatePerson("nope.md", {}), "not_found");
    await rejects(w.people.updatePerson("20 - PEOPLE/Random note.md", {}), "not_a_note");
    w.app.badYaml.add(w.J); const before = JSON.stringify(w.app.fm(w.J));
    await rejects(w.people.updatePerson(w.J, { nickname: "x" }), "io", /YAML/);
    assert.equal(JSON.stringify(w.app.fm(w.J)), before);
  });

  console.log("PersonRepository — name / rename flow");
  await test("name edit → name, display_name, title synced; file renamed via renameFile; legacy full_name dropped", async () => {
    const w = world();
    const rec = await w.people.updatePerson(w.J, { name: "Janet Doe" });
    const P = "20 - PEOPLE/Janet Doe.md";
    assert.equal(rec.path, P); assert.ok(w.app.has(P)); assert.ok(!w.app.has(w.J));
    const fm = w.app.fm(P);
    assert.equal(fm.name, "Janet Doe"); assert.equal(fm.display_name, "Janet Doe"); assert.equal(fm.title, "Janet Doe");
    assert.ok(!("full_name" in fm)); assert.equal(w.app.body(P), BODY);
    assert.deepEqual(w.app.log.map(l => l.op), ["processFrontMatter", "rename"]);
    assert.equal(rec.person.title, "Janet Doe");
    assert.equal(w.index.all().find(p => p.file.path === P).name, "Janet Doe");
  });
  await test("custom display_name is preserved on rename", async () => {
    const w = world(); await w.people.updatePerson(w.J, { display_name: "Dr. Jane" });
    await w.people.renamePerson(w.J, "Janet Doe");
    assert.equal(w.app.fm("20 - PEOPLE/Janet Doe.md").display_name, "Dr. Jane");
  });
  await test("rename onto an existing note → conflict, and NOTHING is written", async () => {
    const w = world(); await w.people.createPerson({ name: "Bob" }); w.app.log.length = 0;
    const bob = "20 - PEOPLE/Bob.md"; const before = JSON.stringify(w.app.fm(bob));
    await rejects(w.people.renamePerson(bob, "Jane Doe"), "conflict");
    assert.equal(w.app.log.length, 0); assert.equal(JSON.stringify(w.app.fm(bob)), before);
  });
  await test("renameFile:false updates name only, leaves title + file alone", async () => {
    const w = world();
    await w.people.updatePerson(w.J, { name: "Janet Doe" }, { renameFile: false });
    assert.ok(w.app.has(w.J)); assert.equal(w.app.fm(w.J).name, "Janet Doe"); assert.ok(!("title" in w.app.fm(w.J)));
  });

  console.log("PersonRepository — create");
  await test("createPerson writes canonical frontmatter; index understands it; duplicates get a suffix", async () => {
    const w = world();
    const r = await w.people.createPerson({ name: "Alice Smith", phone: "123", relationship_type: ["friend"], prm_tier: "close", birthdate: "--05-01" },
      { extension: { c1_score: 0, health_score: 3 } });
    const P = "20 - PEOPLE/Alice Smith.md"; const fm = w.app.fm(P);
    assert.equal(r.path, P); assert.match(fm.id, /^PER-[0-9A-Z]{9,}$/);
    assert.equal(fm.id_prefix, "PER"); assert.equal(fm.schema_version, 1); assert.equal(fm.type, "person");
    assert.equal(fm.title, "Alice Smith"); assert.equal(fm.display_name, "Alice Smith"); assert.equal(fm.status, "active");
    assert.equal(fm.times_met, 0); assert.match(fm.created, /^\d{4}-\d\d-\d\dT/); assert.match(fm.created_date, /^\d{4}-\d\d-\d\d$/);
    assert.equal(fm.c1_score, 0); assert.equal(w.app.body(P), "# Alice Smith\n"); assert.equal(r.needsMigration, false);
    const v = w.index.all().find(p => p.name === "Alice Smith");
    assert.equal(v.tier, "close"); assert.equal(v.typePerson, "friend");           // canonical keys read by the index
    const r2 = await w.people.createPerson({ name: "Alice Smith" });
    assert.equal(r2.path, "20 - PEOPLE/Alice Smith 2.md"); assert.equal(w.app.fm(r2.path).title, "Alice Smith 2"); assert.equal(w.app.fm(r2.path).name, "Alice Smith");
    assert.notEqual(r2.person.id, r.person.id);
  });
  await test("createPerson validation + extension clash + rollback when frontmatter write fails", async () => {
    const w = world(); const n = w.app.entries.size;
    await rejects(w.people.createPerson({ name: "  " }), "validation", /name/);
    await rejects(w.people.createPerson({ name: "X", prm_tier: "bad" }), "validation");
    await rejects(w.people.createPerson({ name: "X" }, { extension: { name: "y" } }), "validation", /extension/);
    assert.equal(w.app.entries.size, n);
    w.app.failNextFM = "disk full";
    await rejects(w.people.createPerson({ name: "Ghost" }), "io", /disk full/);
    assert.ok(!w.app.has("20 - PEOPLE/Ghost.md"));                                // half-made file cleaned up
    assert.ok(w.app.log.some(l => l.op === "trash"));
  });

  console.log("PersonRepository — archive / restore / delete");
  await test("archive → moves + status; idempotent; restore → back + active", async () => {
    const w = world(); await w.people.createPerson({ name: "Alice Smith" }); const A = "20 - PEOPLE/Alice Smith.md", Z = "20 - PEOPLE/_Archive/Alice Smith.md";
    const r = await w.people.archivePerson(A);
    assert.equal(r.path, Z); assert.ok(w.app.has(Z) && !w.app.has(A)); assert.equal(w.app.fm(Z).status, "archived");
    w.app.log.length = 0; await new Promise(r => setTimeout(r, 5)); await w.people.archivePerson(Z);
    assert.ok(!w.app.log.some(l => l.op === "rename"));
    const back = await w.people.restorePerson(Z);
    assert.equal(back.path, A); assert.equal(w.app.fm(A).status, "active"); assert.ok(!w.app.has(Z));
  });
  await test("restore leaves a non-archived status (paused) alone", async () => {
    const w = world(); await w.people.createPerson({ name: "Al" }); await w.people.updatePerson("20 - PEOPLE/Al.md", { status: "paused" });
    await w.people.archivePerson("20 - PEOPLE/Al.md"); await w.people.updatePerson("20 - PEOPLE/_Archive/Al.md", { status: "paused" });
    const r = await w.people.restorePerson("20 - PEOPLE/_Archive/Al.md"); assert.equal(r.person.status, "paused");
  });
  await test("deletePerson trashes (recoverable) and the person is gone", async () => {
    const w = world(); await w.people.deletePerson(w.J);
    assert.deepEqual(w.app.log.map(l => l.op), ["trash"]); assert.equal(w.people.getPerson(w.J), null);
    await rejects(w.people.deletePerson(w.J), "not_found");
  });

  console.log("person-actions (v0.2 features on top of the repository)");
  await test("logTalk: one atomic FM write + one body append; times_met increments from write-time value", async () => {
    const w = world(); const view = () => w.index.all().find(p => p.name === "Jane Doe");
    const e = { date: "2026-09-30", type: "coffee", where: "Cafe", note: "chat", learned: "l", next: "n", presence: 4, energy: 3, c2_used: true, c4_used: false, c7_used: false };
    await actions.logTalk(w.people, w.settings, view(), e);
    assert.deepEqual(w.app.log.map(l => l.op), ["processFrontMatter", "process"]);
    let fm = w.app.fm(w.J);
    assert.equal(fm.last_contacted, "2026-09-30"); assert.ok(!("last_contact" in fm)); assert.equal(fm.times_met, 3);
    assert.equal(fm.talk1_where, "Cafe"); assert.equal(fm.custom_user_field, "keep me");
    const body = w.app.body(w.J);
    assert.ok(body.includes("- old entry\n- 2026-09-30 ☕ @ Cafe — chat · learned: l · Carnegie: C2 · presence 4/5 → n\n\n## Other\nkeep me\n"));
    assert.ok(body.startsWith(BODY.slice(0, BODY.indexOf("- old entry"))));          // everything above the log unchanged
    await new Promise(r => setTimeout(r, 30));
    // two concurrent logs must not lose an increment; rotation preserved
    await Promise.all([actions.logTalk(w.people, w.settings, view(), { ...e, date: "2026-10-01" }), actions.logTalk(w.people, w.settings, view(), { ...e, date: "2026-10-02" })]);
    fm = w.app.fm(w.J); assert.equal(fm.times_met, 5); assert.equal(fm.talk2_date, "2026-10-01"); assert.equal(fm.talk3_date, "2026-09-30");
  });
  await test("quickLog of a non-in-person type doesn't bump times_met", async () => {
    const w = world(); await actions.quickLog(w.people, w.settings, w.index.all().find(p => p.name === "Jane Doe"), "call");
    const d = new Date(), p2 = n => String(n).padStart(2, "0");
    assert.equal(w.app.fm(w.J).times_met, 2); assert.equal(w.app.fm(w.J).last_contacted, `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`);
  });
  await test("snooze + setPaused", async () => {
    const w = world(); const v = () => w.index.all().find(p => p.name === "Jane Doe");
    await actions.snooze(w.people, v(), 7);
    let fm = w.app.fm(w.J); assert.ok(fm.next_encounter && fm.snoozed_until === fm.next_encounter); assert.ok(!("next_contact" in fm));
    await new Promise(r => setTimeout(r, 30));
    await actions.setPaused(w.people, v(), true); assert.equal(w.app.fm(w.J).status, "paused");
  });
  await test("createPerson (UI path) → canonical + v0.2 scoring fields, template body", async () => {
    const w = world();
    const file = await actions.createPerson(w.people, w.settings, { name: "Carol", typePerson: "friend+mentor", tier: "inner", phone: "", email: "c@x.io", ig: "carol", linkedin: "", frequency: "", birthday: "1988-02-29", anniversary: "" });
    const fm = w.app.fm(file.path);
    assert.deepEqual(fm.relationship_type, ["friend", "mentor"]); assert.equal(fm.prm_tier, "inner"); assert.equal(fm.cadence, "daily");
    assert.equal(fm.instagram, "carol"); assert.ok(!("phone" in fm)); assert.ok(!("linkedin" in fm));
    assert.equal(fm.health_score, 3); assert.equal(fm.c9_score, 0); assert.ok(w.app.body(file.path).includes("## Talks Log"));
  });
  await test("extension cannot touch schema properties; bad function patch aborts with no write", async () => {
    const w = world(); const before = JSON.stringify(w.app.fm(w.J));
    await rejects(w.people.updatePerson(w.J, {}, { extension: fm => { fm.name = "hax"; } }), "validation", /extension/);
    await rejects(w.people.updatePerson(w.J, {}, { extension: fm => { fm.ig = "hax"; } }), "validation", /extension/);     // legacy alias counts too
    await rejects(w.people.updatePerson(w.J, () => ({ prm_tier: "nope" })), "validation");
    assert.equal(JSON.stringify(w.app.fm(w.J)), before);
  });

  console.log("Interaction / Meeting repositories");
  await test("interaction: create / query / update / validate / delete", async () => {
    const w = world();
    const r = await w.interactions.createInteraction({ date: "2026-09-30", interaction_type: "call", people: ["[[Jane Doe]]"], presence: 4 });
    assert.equal(r.path, "20 - PEOPLE/_Interactions/2026-09-30 call with Jane Doe.md");
    assert.match(r.data.id, /^INT-/); assert.equal(r.data.type, "interaction"); assert.equal(r.data.title, "call with Jane Doe");
    assert.equal(w.interactions.listForPerson("jane doe").length, 1); assert.equal(w.interactions.listForPerson("[[Bob]]").length, 0);
    assert.equal(w.interactions.getInteractionById(r.data.id).path, r.path);
    const n = w.app.log.length;
    await rejects(w.interactions.updateInteraction(r.path, { presence: 9 }), "validation", /presence/);
    await rejects(w.interactions.updateInteraction(r.path, { id: "x" }), "validation", /managed/);
    await rejects(w.interactions.updateInteraction(r.path, { people: undefined }), "validation", /required/);
    assert.equal(w.app.log.length, n);
    const u = await w.interactions.updateInteraction(r.path, { presence: 5, next_step: "Call in 2 weeks" });
    assert.equal(u.data.presence, 5); assert.equal(w.app.fm(r.path).next_step, "Call in 2 weeks");
    await rejects(w.interactions.createInteraction({ date: "2026-02-31", interaction_type: "call", people: [] }), "validation");
    await w.interactions.deleteInteraction(r.path); assert.equal(w.interactions.getInteraction(r.path), null);
  });
  await test("meeting: defaults, ordering, time validation, upcoming window", async () => {
    const w = world();
    const a = await w.meetings.createMeeting({ date: "2026-10-05", start_time: "14:00", people: ["[[Jane Doe]]"] });
    await w.meetings.createMeeting({ date: "2026-10-02", people: ["[[Bob]]"], title: "Lunch" });
    await w.meetings.createMeeting({ date: "2026-12-01", people: ["[[Bob]]"] });
    assert.equal(a.data.status, "planned"); assert.equal(a.data.title, "Meeting with Jane Doe"); assert.match(a.data.id, /^MTG-/);
    assert.deepEqual(w.meetings.listUpcoming("2026-10-01", 30).map(r => r.data.date), ["2026-10-02", "2026-10-05"]);
    await rejects(w.meetings.createMeeting({ date: "2026-10-05", start_time: "14:00", end_time: "13:00", people: ["[[X]]"] }), "validation", /end_time/);
    await rejects(w.meetings.createMeeting({ date: "2026-10-05", start_time: "25:00", people: ["[[X]]"] }), "validation", /start_time/);
    await w.meetings.updateMeeting(a.path, { status: "held", outcome: "good" }); assert.equal(w.app.fm(a.path).status, "held");
  });

  console.log(`\n${passed} passed${process.exitCode ? " — FAILURES ABOVE" : ""}`);
})();
