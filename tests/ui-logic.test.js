const assert = require("assert");
const { zodiacLine, westernZodiac, ordinal, chineseDate } = require("../.test-build/core/astro");
const D = require("../.test-build/core/directory");
const { parsePhotoRef } = require("../.test-build/core/photo");
const { birthdayStats } = require("../.test-build/core/birthday-stats");

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name, "\n    ", e.message.split("\n").slice(0, 4).join("\n     ")); process.exitCode = 1; } };
const bd = (year, month, day) => ({ year, month, day });

console.log("Zodiac & lunar");
test("matches the four birthday cards in the design screenshots", () => {
  assert.equal(zodiacLine(bd(2005, 10, 20)), "Rooster · Libra · Lunar Sep 18th");
  assert.equal(zodiacLine(bd(2010, 9, 16)),  "Tiger · Virgo · Lunar Aug 9th");
  assert.equal(zodiacLine(bd(1998, 4, 17)),  "Tiger · Aries · Lunar Mar 21st");
  assert.equal(zodiacLine(bd(1988, 12, 25)), "Dragon · Capricorn · Lunar Nov 17th");
});
test("Chinese zodiac follows the lunar new year, not January 1", () => {
  assert.equal(chineseDate(bd(2005, 1, 15)).animal, "Monkey");     // LNY 2005 = Feb 9
  assert.equal(chineseDate(bd(2005, 2, 10)).animal, "Rooster");
  assert.equal(chineseDate(bd(2000, 1, 1)).animal, "Rabbit");      // LNY 2000 = Feb 5
});
test("leap lunar months are labelled", () => assert.equal(chineseDate(bd(2023, 4, 1)).lunar, "leap Feb 11th"));
test("year-less birthdays show only the western sign", () => assert.equal(zodiacLine({ year: null, month: 3, day: 14 }), "Pisces"));
test("null birthdate → empty", () => assert.equal(zodiacLine(null), ""));
test("western sign boundaries", () => {
  const z = (m, d) => westernZodiac(m, d);
  assert.deepEqual([z(1, 19), z(1, 20), z(2, 18), z(2, 19), z(3, 20), z(3, 21)], ["Capricorn", "Aquarius", "Aquarius", "Pisces", "Pisces", "Aries"]);
  assert.deepEqual([z(12, 21), z(12, 22), z(9, 22), z(9, 23), z(7, 22), z(7, 23)], ["Sagittarius", "Capricorn", "Virgo", "Libra", "Cancer", "Leo"]);
});
test("ordinals", () => assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "30th"]));

console.log("Directory logic");
const E = (o) => ({ path: `P/${o.name}.md`, id: "", display_name: o.name, favorite: false, relationship_type: [], company: [], status: "active", tags: [], ...o });
const people = [
  E({ name: "bruce Lee", company: ["Dojo"], tags: ["type/person", "status/active", "friends"], last_contacted: "2026-08-01" }),
  E({ name: "Almak", company: ["Almak Mobiles"], role: "Founder", last_contacted: "2026-09-21", favorite: true }),
  E({ name: "Cal Newport", tags: ["authors", "Friends"], next_encounter: "2026-10-05" }),
  E({ name: "Dan photography", company: ["dojo"], next_encounter: "2026-10-01", last_contacted: "2026-01-01" }),
  E({ name: "Old Pal", status: "archived", company: ["Dojo"] }),
];
const names = rows => rows.map(e => e.name);
test("archived people are hidden", () => assert.ok(!names(D.filterAndSort(people, D.DEFAULT_QUERY)).includes("Old Pal")));
test("name sort is case-insensitive, both directions", () => {
  assert.deepEqual(names(D.filterAndSort(people, D.DEFAULT_QUERY)), ["Almak", "bruce Lee", "Cal Newport", "Dan photography"]);
  assert.deepEqual(names(D.filterAndSort(people, { ...D.DEFAULT_QUERY, sort: "name-desc" })), ["Dan photography", "Cal Newport", "bruce Lee", "Almak"]);
});
test("search covers name, company, role, tags", () => {
  const q = text => names(D.filterAndSort(people, { ...D.DEFAULT_QUERY, text }));
  assert.deepEqual(q("MOBILE"), ["Almak"]); assert.deepEqual(q("founder"), ["Almak"]); assert.deepEqual(q("authors"), ["Cal Newport"]); assert.deepEqual(q("cal "), ["Cal Newport"]);
});
test("company / tag filters are case-insensitive and combine", () => {
  assert.deepEqual(names(D.filterAndSort(people, { ...D.DEFAULT_QUERY, company: "DOJO" })), ["bruce Lee", "Dan photography"]);
  assert.deepEqual(names(D.filterAndSort(people, { ...D.DEFAULT_QUERY, tag: "friends" })), ["bruce Lee", "Cal Newport"]);
  assert.deepEqual(names(D.filterAndSort(people, { ...D.DEFAULT_QUERY, tag: "friends", company: "dojo" })), ["bruce Lee"]);
});
test("date sorts put missing dates last in both directions", () => {
  assert.deepEqual(names(D.filterAndSort(people, { ...D.DEFAULT_QUERY, sort: "last-newest" })), ["Almak", "bruce Lee", "Dan photography", "Cal Newport"]);
  assert.deepEqual(names(D.filterAndSort(people, { ...D.DEFAULT_QUERY, sort: "last-oldest" })), ["Dan photography", "bruce Lee", "Almak", "Cal Newport"]);
  assert.deepEqual(names(D.filterAndSort(people, { ...D.DEFAULT_QUERY, sort: "next-soonest" })), ["Dan photography", "Cal Newport", "Almak", "bruce Lee"]);
  assert.deepEqual(names(D.filterAndSort(people, { ...D.DEFAULT_QUERY, sort: "favorites" }))[0], "Almak");
});
test("filter options: unique, case-folded, sorted; auto tags (type/, status/) hidden", () => {
  assert.deepEqual(D.companyOptions(D.listable(people)), ["Almak Mobiles", "Dojo"]);
  assert.deepEqual(D.tagOptions(D.listable(people)), ["authors", "friends"]);
});
test("initials", () => {
  assert.deepEqual(["Aurelia Karagai", "Almak", "Elvis Warutumo Git", "  x  ", "", "élan vital", "李 雷"].map(D.initials), ["AK", "AL", "EW", "X", "?", "ÉV", "李雷"]);
});

console.log("Photo references");
test("url / wikilink / embed / markdown / path", () => {
  assert.deepEqual(parsePhotoRef("https://x.io/a.jpg"), { kind: "url", value: "https://x.io/a.jpg" });
  assert.deepEqual(parsePhotoRef("[[a b.jpg]]"), { kind: "link", value: "a b.jpg" });
  assert.deepEqual(parsePhotoRef("![[a.jpg|200]]"), { kind: "link", value: "a.jpg" });
  assert.deepEqual(parsePhotoRef("![alt](My%20Pics/a.png)"), { kind: "link", value: "My Pics/a.png" });
  assert.deepEqual(parsePhotoRef("Attachments/a.png"), { kind: "link", value: "Attachments/a.png" });
  assert.equal(parsePhotoRef("  "), null); assert.equal(parsePhotoRef(undefined), null);
});

console.log("Birthday stats");
test("totals, cumulative windows, and the 30-day split", () => {
  const P = (name, days, active = true) => ({ name, active, birthday: { days } });
  const s = birthdayStats([P("c", 87), P("a", 0), P("b", 21), P("d", 200), P("x", 3, false), { name: "none", active: true, birthday: null }, P("e", 7), P("f", 31)]);
  assert.equal(s.total, 6); assert.equal(s.today, 1); assert.equal(s.within7, 2); assert.equal(s.within30, 3);
  assert.deepEqual(s.next30.map(p => p.name), ["a", "e", "b"]); assert.deepEqual(s.later.map(p => p.name), ["f", "c", "d"]);
});

console.log(`\n${passed} passed${process.exitCode ? " — FAILURES ABOVE" : ""}`);
