const assert = require("assert");
const { FakeApp } = require("./fake-obsidian");
const { DEFAULT_SETTINGS } = require("../.test-build/core/settings");
const { FolderService } = require("../.test-build/core/folder-service");
const { PeopleIndex } = require("../.test-build/repository/PeopleIndex");
const { MarkdownStore } = require("../.test-build/repository/MarkdownStore");
const { PersonRepository } = require("../.test-build/repository/PersonRepository");

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name, "\n    ", e.stack.split("\n").slice(0, 5).join("\n     ")); process.exitCode = 1; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const settle = () => sleep(30);                       // fake metadata cache catches up after 8 ms
const P = "20 - PEOPLE";

/** A vault + a PeopleIndex wired to events the way main.ts wires it. `scans` counts full scans. */
function world(seedFn) {
  const app = new FakeApp();
  const settings = { ...DEFAULT_SETTINGS };
  const folders = new FolderService(app, () => settings);
  const index = new PeopleIndex(app, folders, () => settings);
  let scans = 0;
  const scan = index.scan.bind(index);
  index.scan = () => { scans++; return scan(); };
  const events = [];
  index.onChange(c => events.push(c));
  index.watch(() => {});
  if (seedFn) seedFn(app);
  const store = new MarkdownStore(app, folders, 400);
  let notified = 0;
  const people = new PersonRepository(folders, store, index, () => settings, () => { notified++; });
  return { app, settings, folders, index, people, events, scans: () => scans, notified: () => notified };
}
const paths = index => index.entries().map(e => e.path);
const person = (extra = {}) => ({ type: "person", ...extra });

(async () => {
  console.log("Initial scan — recognition");
  await test("type: person, tags type/person (list, string, #, nested) or the people folder; everything else is skipped", async () => {
    const w = world(app => {
      app.seed(`${P}/A.md`, person({ name: "A" }));
      app.seed("Elsewhere/B.md", { tags: ["type/person"] });
      app.seed("Elsewhere/C.md", { tags: "#type/person, other" });
      app.seed("Elsewhere/D.md", { tags: ["type/person/vip"] });
      app.seed(`${P}/E.md`, { title: "no type → folder-based" });
      app.seed(`${P}/I.md`, { type: "project", tags: ["type/person"] });      // explicit tag wins
      app.seed(`${P}/F.md`, { type: "project" });                              // other type → not a person
      app.seed("Elsewhere/G.md", { name: "no type, no tag, wrong folder" });
      app.seed("Templates/H.md", person());                                    // excluded folder
      app.seed("Elsewhere/J.md", { tags: ["type/place"] });
    });
    assert.deepEqual(paths(w.index).sort(), [`${P}/A.md`, `${P}/E.md`, `${P}/I.md`, "Elsewhere/B.md", "Elsewhere/C.md", "Elsewhere/D.md"]);
    assert.equal(w.scans(), 1);
  });
  await test("a custom personType changes both the type value and the tag that is recognised", async () => {
    const w = world(app => { app.seed("X/a.md", { type: "contact" }); app.seed("X/b.md", { tags: ["type/contact"] }); app.seed("X/c.md", { type: "person" }); });
    w.settings.personType = "contact"; w.index.invalidate();
    assert.deepEqual(paths(w.index), ["X/a.md", "X/b.md"]);
  });

  console.log("Entry shape");
  await test("legacy v0.2 note → entry with every Phase 4 field", async () => {
    const w = world(app => app.seed(`${P}/Jane Doe.md`, person({
      id: "PERSON-123", name: "Jane Doe", type_person: "friend+mentor", company: "[[Acme Corp|Acme]]", role: "CTO", status: "Active",
      birthday: "--03-14", last_contact: "2026-01-01", next_contact: "2026-02-01", frequency: "weekly", photo: "jane.jpg",
      favorite: true, tags: ["a", "#b"], importance: "high",
    })));
    assert.deepEqual(w.index.entries()[0], {
      path: `${P}/Jane Doe.md`, id: "PERSON-123", name: "Jane Doe", display_name: "Jane Doe", photo: "jane.jpg", favorite: true,
      relationship_type: ["friend", "mentor"], company: ["Acme"], role: "CTO", status: "active", birthday: "--03-14",
      last_contacted: "2026-01-01", next_encounter: "2026-02-01", cadence: "weekly", importance: "high", tags: ["a", "b"],
    });
  });
  await test("canonical keys; a note with nothing but a name gets empty defaults (never undefined)", async () => {
    const w = world(app => {
      app.seed(`${P}/Zed.md`, person({ id: "PER-1", name: "Zed", display_name: "Z", relationship_type: ["family", "friend"], company: ["A", "[[B]]"],
        birthdate: "1990-05-02", last_contacted: "2026-09-21", next_encounter: "2026-10-20", cadence: "monthly", favorite: "yes", prm_tier: "close" }));
      app.seed(`${P}/Bare.md`, person());
    });
    const z = w.index.getEntry(`${P}/Zed.md`);
    assert.equal(z.display_name, "Z"); assert.equal(z.name, "Zed"); assert.equal(z.favorite, true);
    assert.deepEqual(z.relationship_type, ["family", "friend"]); assert.deepEqual(z.company, ["A", "B"]);
    assert.equal(z.birthday, "1990-05-02"); assert.equal(z.last_contacted, "2026-09-21"); assert.equal(z.next_encounter, "2026-10-20");
    assert.deepEqual(w.index.getEntry(`${P}/Bare.md`), {
      path: `${P}/Bare.md`, id: "", name: "Bare", display_name: "Bare", photo: "", favorite: false, relationship_type: [], company: [], role: "",
      status: "active", birthday: null, last_contacted: null, next_encounter: null, cadence: "", importance: "", tags: [],
    });
  });
  await test("the PersonView the existing tabs use is cached alongside; lookups by path and id; facets are distinct + sorted", async () => {
    const w = world(app => {
      app.seed(`${P}/B.md`, person({ id: "PER-B", name: "B", company: ["Zeta", "Acme"], tags: ["x", "y"] }));
      app.seed(`${P}/A.md`, person({ id: "PER-A", name: "A", company: "Acme", tags: ["y"] }));
    });
    assert.equal(w.index.all().map(p => p.name).join(), "A,B");
    assert.equal(w.index.get(`${P}/B.md`).name, "B"); assert.equal(w.index.get("nope.md"), null);
    assert.equal(w.index.findById("PER-A").path, `${P}/A.md`); assert.equal(w.index.findById("PER-NOPE"), null); assert.equal(w.index.findById(""), null);
    assert.deepEqual(w.index.companies(), ["Acme", "Zeta"]); assert.deepEqual(w.index.tags(), ["x", "y"]);
    assert.equal(w.index.size, 2); assert.ok(w.index.has(`${P}/A.md`));
  });

  console.log("Incremental updates (no re-scan)");
  const J = `${P}/Jane.md`;
  const jane = app => app.seed(J, person({ id: "PER-J", name: "Jane", role: "Dev", tags: ["a"] }));
  await test("edit → only that person is re-parsed and an upsert is announced", async () => {
    const w = world(jane); w.index.all(); w.events.length = 0;
    w.app.editFm(J, fm => { fm.role = "CEO"; });
    await settle();
    assert.equal(w.index.getEntry(J).role, "CEO"); assert.equal(w.index.get(J).role, "CEO");
    assert.deepEqual(w.events, [{ kind: "upsert", path: J }]); assert.equal(w.scans(), 1);
  });
  await test("a change event for an unchanged note (e.g. body-only edit) re-parses nothing and notifies nobody", async () => {
    const w = world(jane); w.index.all(); w.events.length = 0;
    const before = w.index.getEntry(J);
    w.app.editFm(J, () => {});
    await settle();
    assert.deepEqual(w.events, []); assert.equal(w.index.getEntry(J), before);     // same object: not rebuilt
  });
  await test("new note: ignored at vault 'create' (no frontmatter yet), added when the cache reports it; non-people never enter", async () => {
    const w = world(jane); w.index.all(); w.events.length = 0;
    w.app.addNote(`${P}/Bob.md`, person({ name: "Bob" }));
    assert.equal(w.index.has(`${P}/Bob.md`), false);
    w.app.addNote("Elsewhere/Task.md", { type: "task" });
    await settle();
    assert.equal(w.index.has(`${P}/Bob.md`), true); assert.equal(w.index.has("Elsewhere/Task.md"), false);
    assert.deepEqual(w.events, [{ kind: "upsert", path: `${P}/Bob.md` }]); assert.equal(w.scans(), 1);
  });
  await test("a note stops being a person when its type changes, and becomes one when it's set", async () => {
    const w = world(jane); w.index.all(); w.events.length = 0;
    w.app.editFm(J, fm => { fm.type = "project"; });
    await settle();
    assert.equal(w.index.has(J), false); assert.deepEqual(w.events, [{ kind: "remove", path: J }]);
    w.app.editFm(J, fm => { fm.type = "person"; });
    await settle();
    assert.equal(w.index.has(J), true); assert.equal(w.events.at(-1).kind, "upsert"); assert.equal(w.scans(), 1);
  });
  await test("rename: re-keyed, name follows the file name when the note has no name property", async () => {
    const w = world(app => app.seed(`${P}/Old Name.md`, person())); w.index.all(); w.events.length = 0;
    const f = w.app.vault.getAbstractFileByPath(`${P}/Old Name.md`);
    await w.app.fileManager.renameFile(f, `${P}/New Name.md`);
    assert.deepEqual(paths(w.index), [`${P}/New Name.md`]); assert.equal(w.index.get(`${P}/New Name.md`).name, "New Name");
    assert.deepEqual(w.events, [{ kind: "rename", path: `${P}/New Name.md`, oldPath: `${P}/Old Name.md` }]); assert.equal(w.scans(), 1);
  });
  await test("moving a folder-detected person out of the people folder drops them; moving one in adds them", async () => {
    const w = world(app => { app.seed(`${P}/In.md`, { status: "active" }); app.seed("Other/Out.md", { status: "active" }); });
    w.app.folders.add("Other"); w.index.all(); w.events.length = 0;
    await w.app.fileManager.renameFile(w.app.vault.getAbstractFileByPath(`${P}/In.md`), "Other/In.md");
    await w.app.fileManager.renameFile(w.app.vault.getAbstractFileByPath("Other/Out.md"), `${P}/Out.md`);
    assert.deepEqual(paths(w.index), [`${P}/Out.md`]);
    assert.deepEqual(w.events.map(e => e.kind), ["remove", "upsert"]);
  });
  await test("delete → removed and announced; unknown paths are a no-op", async () => {
    const w = world(jane); w.index.all(); w.events.length = 0;
    await w.app.fileManager.trashFile(w.app.vault.getAbstractFileByPath(J));
    assert.equal(w.index.size, 0); assert.deepEqual(w.events, [{ kind: "remove", path: J }]);
    assert.equal(w.index.remove("nope.md"), false); assert.equal(w.events.length, 1); assert.equal(w.scans(), 1);
  });
  await test("renaming a folder re-keys everyone in it; deleting one removes everyone in it", async () => {
    const w = world(app => { app.seed(`${P}/Team/A.md`, person({ name: "A" })); app.seed(`${P}/Team/B.md`, person({ name: "B" })); app.seed(`${P}/C.md`, person({ name: "C" })); });
    w.index.all();
    w.app.renameFolder(`${P}/Team`, `${P}/Crew`);
    assert.deepEqual(paths(w.index), [`${P}/Crew/A.md`, `${P}/Crew/B.md`, `${P}/C.md`]);
    w.events.length = 0;
    w.app.deleteFolder(`${P}/Crew`);
    assert.deepEqual(paths(w.index), [`${P}/C.md`]);
    assert.deepEqual(w.events.map(e => e.kind), ["remove", "remove"]);
  });
  await test("events that arrive before the first scan are ignored; the scan then sees the note", async () => {
    const w = world(jane);                                           // index never read yet
    assert.equal(w.index.upsert(w.app.vault.getAbstractFileByPath(J)), false);
    assert.equal(w.events.length, 0); assert.equal(w.scans(), 0);
    assert.equal(w.index.size, 1); assert.equal(w.scans(), 1);
  });

  console.log("Rebuilds");
  await test("invalidate() → lazy re-scan on next read; rebuild() scans now and announces it; onChange unsubscribes", async () => {
    const w = world(jane); w.index.all();
    w.index.invalidate(); assert.equal(w.scans(), 1); w.index.all(); assert.equal(w.scans(), 2);
    w.events.length = 0; w.index.rebuild(); assert.equal(w.scans(), 3); assert.deepEqual(w.events, [{ kind: "rebuild" }]);
    const seen = []; const off = w.index.onChange(c => seen.push(c)); off(); w.index.rebuild(); assert.equal(seen.length, 0);
  });
  await test("the calendar day rolling over re-scans (countdowns and due dates are relative to today)", async () => {
    const w = world(jane); w.index.all(); assert.equal(w.scans(), 1);
    w.index.builtOn = "2000-01-01";
    w.index.all(); assert.equal(w.scans(), 2); w.index.all(); assert.equal(w.scans(), 2);
  });
  await test("a throwing listener doesn't stop the others or the index", async () => {
    const w = world(jane); w.index.all();
    const quiet = console.error; console.error = () => {};
    try { w.index.onChange(() => { throw new Error("boom"); }); const ok = []; w.index.onChange(c => ok.push(c)); w.index.rebuild(); assert.equal(ok.length, 1); }
    finally { console.error = quiet; }
  });

  console.log("Writes through PersonRepository keep the index current without re-scanning");
  await test("create / update / rename / archive / restore / delete each update just that person", async () => {
    const w = world(); w.index.all();
    const rec = await w.people.createPerson({ name: "Ann Lee", company: ["Acme"], role: "PM" });
    const a = rec.path;
    assert.equal(w.index.getEntry(a).role, "PM"); assert.deepEqual(w.index.getEntry(a).company, ["Acme"]);

    await w.people.updatePerson(a, { role: "VP", favorite: true });
    assert.equal(w.index.getEntry(a).role, "VP"); assert.equal(w.index.getEntry(a).favorite, true);

    const renamed = await w.people.renamePerson(a, "Ann Lee-Smith");
    assert.equal(w.index.has(a), false); assert.equal(w.index.getEntry(renamed.path).name, "Ann Lee-Smith");

    const arch = await w.people.archivePerson(renamed.path);
    assert.equal(w.index.has(renamed.path), false); assert.equal(w.index.getEntry(arch.path).status, "archived");
    assert.ok(arch.path.startsWith("20 - PEOPLE/_Archive/"));

    const back = await w.people.restorePerson(arch.path);
    assert.equal(w.index.has(arch.path), false); assert.equal(w.index.getEntry(back.path).status, "active");

    await w.people.deletePerson(back.path);
    assert.equal(w.index.size, 0);
    await settle();                                                  // the watcher repeats each change → must be a no-op
    assert.equal(w.index.size, 0); assert.equal(w.scans(), 1);
    assert.ok(w.notified() >= 6);
  });
  await test("the watcher repeating a repository write is ignored (nothing announced twice)", async () => {
    const w = world(jane); w.index.all();
    await w.people.updatePerson(J, { role: "CTO" });
    w.events.length = 0;
    await settle();
    assert.deepEqual(w.events, []);
  });

  console.log(`\n${passed} passed`);
})();
