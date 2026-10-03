// Renders the real compiled views + styles.css in headless Chrome with a fake Obsidian runtime.
//   node tests/visual/render.js            → tests/visual/out/*.png
// Needs .test-build/ (see tests/README.md) and puppeteer (PUPPETEER_PATH or the global mermaid-cli one).
const fs = require("fs"), path = require("path"), cp = require("child_process");
const root = path.resolve(__dirname, "../..");
const build = path.join(root, ".test-build");
const out = path.join(__dirname, "out");
fs.mkdirSync(out, { recursive: true });

// ── puppeteer ───────────────────────────────────────────────────────────────
const gRoot = cp.execSync("npm root -g").toString().trim();
const puppeteer = require(process.env.PUPPETEER_PATH || path.join(gRoot, "@mermaid-js/mermaid-cli/node_modules/puppeteer"));

// ── bundle compiled CJS modules for the browser ─────────────────────────────
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === "node_modules" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
const defs = {};
for (const f of walk(build).filter(f => f.endsWith(".js"))) defs[path.relative(build, f).replace(/\.js$/, "")] = fs.readFileSync(f, "utf8");
defs["fake-obsidian"] = fs.readFileSync(path.join(root, "tests/fake-obsidian.js"), "utf8");
defs["__obsidian"] = fs.readFileSync(path.join(__dirname, "browser-obsidian.js"), "utf8");
const bundle = `
const __defs = {}; const __cache = {};
${Object.entries(defs).map(([k, v]) => `__defs[${JSON.stringify(k)}] = function (module, exports, require) {\n${v}\n};`).join("\n")}
const __norm = p => { const out = []; for (const s of p.split("/")) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); } return out.join("/"); };
function __load(key) {
  if (__cache[key]) return __cache[key].exports;
  const m = { exports: {} }; __cache[key] = m;
  const dir = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
  __defs[key](m, m.exports, req => {
    if (req === "obsidian") return __load("__obsidian");
    if (req.startsWith(".")) { let k = __norm(dir + "/" + req); if (!__defs[k] && __defs[k + "/index"]) k += "/index"; return __load(k); }
    return __load(req);
  });
  return m.exports;
}
window.__load = __load;`;

const themes = {
  dark: `--background-primary:#25262d;--background-primary-alt:#2b2c34;--background-secondary:#25262d;--background-secondary-alt:#2b2c34;
    --background-modifier-border:#3a3b45;--background-modifier-hover:rgba(255,255,255,.07);--background-modifier-form-field:#2d2e37;
    --text-normal:#dcdde2;--text-muted:#a4a5b0;--text-faint:#6e6f7a;--text-accent:#8d92e6;--text-on-accent:#fff;
    --interactive-accent:#767bd0;--interactive-accent-hover:#868bdc;--interactive-normal:#3b3c46;`,
  light: `--background-primary:#fff;--background-primary-alt:#f6f6f8;--background-secondary:#f3f3f6;--background-secondary-alt:#ececf1;
    --background-modifier-border:#dcdce3;--background-modifier-hover:rgba(0,0,0,.05);--background-modifier-form-field:#fff;
    --text-normal:#222;--text-muted:#5f6068;--text-faint:#9a9ba5;--text-accent:#5a5fc4;--text-on-accent:#fff;
    --interactive-accent:#6a6fd0;--interactive-accent-hover:#5a5fc4;--interactive-normal:#e8e8ee;`,
};
const harnessCss = `
body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:var(--text-normal);
  --font-ui-small:13px;--font-ui-smaller:12px;--font-ui-medium:15px;--radius-s:4px;--radius-m:8px;--radius-l:12px;}
*{box-sizing:border-box}
button{background:var(--interactive-normal);color:var(--text-normal);border:0;border-radius:var(--radius-s);padding:4px 12px;height:30px;font:inherit;font-size:var(--font-ui-small)}
select.dropdown{appearance:none;background:var(--interactive-normal) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M0 0l5 6 5-6z' fill='%23999'/></svg>") no-repeat right 10px center;color:var(--text-normal);border:0;border-radius:var(--radius-s);height:30px;font:inherit;font-size:var(--font-ui-small)}
input[type=text],input[type=search]{background:var(--background-modifier-form-field);border:1px solid var(--background-modifier-border);border-radius:var(--radius-s);height:30px;padding:4px 8px;color:var(--text-normal);font:inherit;font-size:var(--font-ui-small)}
h1,h3,h4{margin:0} a{color:var(--text-accent)}
.view-header{display:flex;align-items:center;justify-content:space-between;height:40px;padding:0 14px;color:var(--text-muted);font-size:13px}
.view-header-title{flex:1;text-align:center} .view-actions a{display:inline-flex;color:var(--text-muted)} .view-actions .svg-icon{width:18px;height:18px}
.view-content{padding:0;overflow:auto}
.leaf{background:var(--background-secondary)} .leaf.main{background:var(--background-primary)}
.svg-icon{display:block}`;

const SAMPLE = `
const A = window.__load("__obsidian"), { FakeApp, TFile } = A;
const { DEFAULT_SETTINGS } = __load("core/settings");
const { FolderService } = __load("core/folder-service");
const { PeopleIndex } = __load("repository/PeopleIndex");
const { DirectoryView } = __load("views/directory-view");
const { PeopleView } = __load("views/sidebar-view");
const app = new FakeApp();
const settings = { ...DEFAULT_SETTINGS, peopleFolder: "40 - PEOPLE/People", archiveFolder: "40 - PEOPLE/_Archive", weekStartsOn: 0 };
const folders = new FolderService(app, () => settings);
const P = "40 - PEOPLE/People/";
const seed = (name, fm = {}) => app.seed(P + name + ".md", { type: "person", name, tags: ["type/person", "status/active"], ...fm }, "");
seed("Almak", { company: ["Almak Mobiles"] });
seed("Aurelia Karagai", { company: ["Aurelia"], photo: "[[aurelia.jpg]]", favorite: true, last_contacted: "2026-09-21", birthdate: "1998-04-17", tags: ["type/person","friends"] });
seed("Bruce Lee"); seed("Bwire Simon", { company: ["Bwire Simon"] }); seed("Cal Newport", { tags: ["type/person","authors"] });
seed("Christopher okey"); seed("Cosmas Okey"); seed("Dan photography", { company: ["Dan photography"] });
seed("Doreen Stella", { birthdate: "1988-12-25" }); seed("Eliud launde"); seed("Elvis Warutumo Gitau", { company: ["Click2skill"] });
seed("Ernest Ernesto"); seed("Greg McKeown", { tags: ["type/person","authors"] }); seed("Hellen Njeri"); seed("Ian Mwangi", { favorite: true });
seed("Jane Atieno"); seed("Kevin Otieno"); seed("Lilian Wanjiru"); seed("Mooo", { birthdate: "2005-10-20" }); seed("Naomi Achieng");
seed("Nicky SP", { birthdate: "2010-09-16" }); seed("Oscar Mutua"); seed("Peter Kiprop"); seed("Ruth Chebet");
const img = new TFile("Attachments/aurelia.jpg");
const PINK = "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#b5473a'/><stop offset='1' stop-color='#f0a6c8'/></linearGradient></defs><rect width='64' height='64' fill='url(#g)'/><circle cx='32' cy='26' r='11' fill='#6b3a2e'/><path d='M8 64c2-16 14-22 24-22s22 6 24 22z' fill='#f5b8d6'/></svg>");
app.metadataCache.getFirstLinkpathDest = l => l === "aurelia.jpg" ? img : null;
app.vault.getResourcePath = () => PINK;
const index = new PeopleIndex(app, folders, () => settings, 0);
const plugin = { app, settings, index, folders, pendingTab: null, openPerson() {}, newPerson() {}, logFor() {}, quickLogFor() {}, carnegieFor() {}, refresh() {} };
window.mount = (kind, el) => {
  const leaf = { app };
  const v = kind === "directory" ? new DirectoryView(leaf, plugin) : new PeopleView(leaf, plugin);
  if (kind !== "directory") v.tab = kind;            // "today" | "people" | "birthdays" | "carnegie"
  v.syncTitle(); el.appendChild(v.containerEl); v.onOpen(); return v;
};
window.__app = app; window.__plugin = plugin;
`;

const open = async (browser, kind, { theme = "dark", width, height, mainLeaf = false }) => {
  const page = await browser.newPage();
  page.errors = [];
  page.on("pageerror", e => page.errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") page.errors.push(m.text()); });
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{${themes[theme]}}${harnessCss}</style>
    <style>${fs.readFileSync(path.join(root, "styles.css"), "utf8")}</style></head>
    <body class="theme-${theme}"><div class="leaf ${mainLeaf ? "main" : ""}" id="leaf" style="width:${width}px"></div></body></html>`);
  await page.evaluate(() => {                         // freeze "today" to 2026-09-29 12:00 local, like the screenshots
    const Real = Date, now = new Real(2026, 8, 29, 12, 0, 0).getTime();
    window.Date = class extends Real { constructor(...a) { a.length ? super(...a) : super(now); } static now() { return now; } };
  });
  await page.addScriptTag({ content: bundle });
  await page.addScriptTag({ content: SAMPLE });
  await page.evaluate((k) => {
    window.__opened = [];
    window.__plugin.openPerson = (p, newTab) => window.__opened.push([p.name, !!newTab]);
    window.__view = mount(k, document.getElementById("leaf"));
  }, kind);
  return page;
};

const shot = async (browser, name, opts) => {
  const page = await open(browser, opts.kind, opts);
  if (opts.setup) await page.evaluate(opts.setup);
  await (await page.$("#leaf")).screenshot({ path: path.join(out, name + ".png") });
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  const errors = page.errors; await page.close();
  if (errors.length) { console.log("  ✗", name, "errors:", errors); process.exitCode = 1; } else console.log("  " + (overflowX ? "✗" : "✓"), name, overflowX ? "(HORIZONTAL OVERFLOW)" : "");
  if (overflowX) process.exitCode = 1;
};

// ── DOM assertions on the rendered views ────────────────────────────────────
const assert = require("assert");
let passed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name, "\n    ", e.message.split("\n").slice(0, 6).join("\n     ")); process.exitCode = 1; } };
const texts = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent.trim()));
const fire = (page, sel, type, extra = {}) => page.$eval(sel, (el, type, extra) => el.dispatchEvent(new (type === "keydown" ? KeyboardEvent : MouseEvent)(type, { bubbles: true, cancelable: true, ...extra })), type, extra);
const setInput = (page, sel, value, ev = "input") => page.$eval(sel, (el, v, ev) => { el.value = v; el.dispatchEvent(new Event(ev, { bubbles: true })); }, value, ev);

const runChecks = async (browser) => {
  console.log("DOM checks — sidebar birthdays");
  let page = await open(browser, "birthdays", { width: 420, height: 1500 });
  await check("stat tiles show Total 4 · Today 0 · 7d 0 · 30d 1 (as in the design)", async () => {
    assert.deepEqual(await texts(page, ".ph-bd-stat-n"), ["4", "0", "0", "1"]);
    assert.deepEqual(await texts(page, ".ph-bd-stat-l"), ["Total", "Today", "7d", "30d"]);
  });
  await check("Next 30 Days card for Mooo matches the design (zodiac, dates, 21d, 21 years old)", async () => {
    const card = await page.evaluate(() => { const el = [...document.querySelectorAll(".ph-bd-section")].find(s => s.textContent.includes("Next 30 Days")).querySelector(".ph-bd-card"); return ({
      name: el.querySelector(".ph-bd-name").textContent, zodiac: el.querySelector(".ph-bd-zodiac").textContent,
      dates: el.querySelector(".ph-bd-dates").textContent, days: el.querySelector(".ph-bd-days").textContent, age: el.querySelector(".ph-bd-age").textContent }); });
    assert.deepEqual(card, { name: "Mooo", zodiac: "Rooster · Libra · Lunar Sep 18th", dates: "Birthday: 2005-10-20Next: 2026-10-20", days: "21d", age: "21 years old" });
  });
  await check("Later Birthdays: Doreen 87d, Aurelia 200d, Nicky 352d, in that order", async () => {
    const rows = await page.evaluate(() => [...[...document.querySelectorAll(".ph-bd-section")].find(s => s.textContent.includes("Later Birthdays")).querySelectorAll(".ph-bd-card")].map(e => `${e.querySelector(".ph-bd-name").textContent}:${e.querySelector(".ph-bd-days").textContent}`));
    assert.deepEqual(rows, ["Doreen Stella:87d", "Aurelia Karagai:200d", "Nicky SP:352d"]);
  });
  await check("two month calendars; today outlined; Nicky SP on the 16th; out-of-month days dimmed", async () => {
    assert.deepEqual(await texts(page, ".ph-bd-monthname"), ["September 2026", "October 2026"]);
    assert.equal(await page.$eval(".ph-bd-cell.is-today .ph-bd-daynum", e => e.textContent), "29");
    assert.match(await page.$eval(".ph-bd-cell.has-event .ph-bd-chip", e => e.textContent), /Nicky SP/);
    assert.equal(await page.$eval(".ph-bd-cell.has-event .ph-bd-daynum", e => e.textContent), "16");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".ph-bd-month")[0].querySelectorAll(".ph-bd-cell.is-out").length), 5);   // 30, 31 · 1, 2, 3
  });
  await check("weekday header starts on the configured day (Sunday here)", async () => {
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".ph-bd-grid")[0].querySelectorAll(".ph-bd-dow")].map(e => e.textContent)), ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });
  await check("Prev / Next / Today move the calendar", async () => {
    const label = () => page.$eval(".ph-bd-monthname", e => e.textContent);
    const click = async (t) => { await page.evaluate(t => [...document.querySelectorAll(".ph-bd-navbtn")].find(b => b.textContent.includes(t)).click(), t); await page.evaluate(() => window.__view.render(true)); };
    await click("Next"); assert.equal(await label(), "October 2026");
    await click("Prev"); await click("Prev"); assert.equal(await label(), "August 2026");
    await click("Today"); assert.equal(await label(), "September 2026");
  });
  await check("clicking a card / chip opens the person; Ctrl-click opens a new tab; Enter works", async () => {
    await fire(page, ".ph-bd-card", "click");
    await fire(page, ".ph-bd-card", "click", { ctrlKey: true });
    await fire(page, ".ph-bd-card", "keydown", { key: "Enter" });
    await fire(page, ".ph-bd-chip", "click");
    assert.deepEqual(await page.evaluate(() => window.__opened), [["Mooo", false], ["Mooo", true], ["Mooo", false], ["Nicky SP", false]]);
  });
  await check("turning zodiac off hides the line", async () => {
    await page.evaluate(() => { window.__plugin.settings.showZodiac = false; window.__view.render(true); });
    assert.equal(await page.$$eval(".ph-bd-zodiac", e => e.length), 0);
  });
  await check("no render errors", async () => assert.deepEqual(page.errors, []));
  await page.close();

  console.log("DOM checks — main window directory");
  page = await open(browser, "directory", { width: 1309, height: 700, mainLeaf: true });
  const cards = () => texts(page, ".ph-dir-name");
  await check("header, subtitle and count", async () => {
    assert.equal(await page.$eval(".ph-dir-title", e => e.textContent), "People");
    assert.equal(await page.$eval(".ph-dir-subtitle", e => e.textContent), "24 people in 40 - PEOPLE/People");
    assert.equal(await page.$eval(".ph-dir-count", e => e.textContent), "24 people");
    assert.equal((await cards()).length, 24); assert.equal((await cards())[0], "Almak");
  });
  await check("avatars: photo for Aurelia, initials for the rest; 2 favourites starred", async () => {
    assert.equal(await page.$$eval(".ph-dir-avatar img", e => e.length), 1);
    assert.match(await page.$eval(".ph-dir-avatar img", e => e.src), /^data:image/);
    assert.deepEqual((await texts(page, ".ph-dir-avatar")).slice(0, 4).map(t => t || "(photo)"), ["AL", "(photo)", "BL", "BS"]);
    assert.equal(await page.$$eval(".ph-dir-star", e => e.length), 2);
  });
  await check("subtitle shows company; last-contact line only when known", async () => {
    assert.deepEqual(await texts(page, ".ph-dir-sub").then(a => a.slice(0, 3)), ["Almak Mobiles", "Aurelia", "Bwire Simon"]);
    assert.deepEqual(await texts(page, ".ph-dir-meta"), ["Last contact 2026-09-21"]);
  });
  await check("search narrows live, shows 'N of M', and recovers", async () => {
    await setInput(page, ".ph-dir-input", "okey");
    assert.deepEqual(await cards(), ["Christopher okey", "Cosmas Okey"]);
    assert.equal(await page.$eval(".ph-dir-count", e => e.textContent), "2 of 24 people");
    await setInput(page, ".ph-dir-input", "zzzz");
    assert.equal(await page.$eval(".ph-dir-empty", e => e.textContent.trim()), "No one matches those filters.");
    await setInput(page, ".ph-dir-input", ""); assert.equal((await cards()).length, 24);
  });
  await check("company + tag dropdowns are populated from the data and filter", async () => {
    const opts = sel => page.$$eval(sel + " option", o => o.map(x => x.textContent));
    const [companySel, tagSel] = await page.$$eval(".ph-dir-filters select", s => s.map((_, i) => i));
    assert.deepEqual((await opts(".ph-dir-filters select:nth-child(1)"))[0], "All companies");
    assert.ok((await opts(".ph-dir-filters select:nth-child(1)")).includes("Click2skill"));
    assert.deepEqual(await opts(".ph-dir-filters select:nth-child(2)"), ["All tags", "authors", "friends"]);   // type/ and status/ auto-tags hidden
    await setInput(page, ".ph-dir-filters select:nth-child(1)", "Click2skill", "change"); assert.deepEqual(await cards(), ["Elvis Warutumo Gitau"]);
    await setInput(page, ".ph-dir-filters select:nth-child(1)", "", "change");
    await setInput(page, ".ph-dir-filters select:nth-child(2)", "authors", "change"); assert.deepEqual(await cards(), ["Cal Newport", "Greg McKeown"]);
    await setInput(page, ".ph-dir-filters select:nth-child(2)", "", "change");
  });
  await check("sorting: name desc, last contact newest, favourites first", async () => {
    await setInput(page, ".ph-dir-sort", "name-desc", "change"); assert.equal((await cards())[0], "Ruth Chebet");
    await setInput(page, ".ph-dir-sort", "last-newest", "change"); assert.equal((await cards())[0], "Aurelia Karagai");
    await setInput(page, ".ph-dir-sort", "favorites", "change"); assert.deepEqual((await cards()).slice(0, 2), ["Aurelia Karagai", "Ian Mwangi"]);
    await setInput(page, ".ph-dir-sort", "name-asc", "change");
  });
  await check("live update: a new person in the index appears without re-opening; search text survives", async () => {
    await setInput(page, ".ph-dir-input", "zed");
    await page.evaluate(() => {
      const f = __app.seed("40 - PEOPLE/People/Zed Zulu.md", { type: "person", name: "Zed Zulu", company: ["Zulu Inc"] }, "");
      __plugin.index.refreshFile(f); __view.update();
    });
    assert.deepEqual(await cards(), ["Zed Zulu"]);
    assert.equal(await page.$eval(".ph-dir-input", e => e.value), "zed");
    assert.equal(await page.$eval(".ph-dir-subtitle", e => e.textContent), "25 people in 40 - PEOPLE/People");
    assert.ok((await page.$$eval(".ph-dir-filters select:nth-child(1) option", o => o.map(x => x.textContent))).includes("Zulu Inc"));
    await page.evaluate(() => { __app.entries.delete("40 - PEOPLE/People/Zed Zulu.md"); __plugin.index.removePath("40 - PEOPLE/People/Zed Zulu.md"); __view.update(); });
    assert.deepEqual(await cards(), []); await setInput(page, ".ph-dir-input", "");
  });
  await check("a filter whose value disappears from the data resets to 'All'", async () => {
    await setInput(page, ".ph-dir-filters select:nth-child(1)", "Click2skill", "change");
    await page.evaluate(() => { const e = __app.fm("40 - PEOPLE/People/Elvis Warutumo Gitau.md"); delete e.company; __app.cache.set("40 - PEOPLE/People/Elvis Warutumo Gitau.md", JSON.parse(JSON.stringify(e))); __plugin.index.refreshFile(__app.entries.get("40 - PEOPLE/People/Elvis Warutumo Gitau.md").file); __view.update(); });
    assert.equal((await cards()).length, 24); assert.equal(await page.$eval(".ph-dir-filters select:nth-child(1)", e => e.value), "");
  });
  await check("click / Ctrl-click / middle-click / Enter / Space open the person", async () => {
    await page.evaluate(() => { window.__opened.length = 0; });
    await fire(page, ".ph-dir-card", "click"); await fire(page, ".ph-dir-card", "click", { ctrlKey: true });
    await fire(page, ".ph-dir-card", "auxclick", { button: 1 });
    await fire(page, ".ph-dir-card", "keydown", { key: "Enter" }); await fire(page, ".ph-dir-card", "keydown", { key: " " });
    assert.deepEqual(await page.evaluate(() => window.__opened), [["Almak", false], ["Almak", true], ["Almak", true], ["Almak", false], ["Almak", false]]);
  });
  await check("cards are keyboard-focusable links with labels", async () => {
    assert.deepEqual(await page.$eval(".ph-dir-card", e => [e.getAttribute("tabindex"), e.getAttribute("role"), e.getAttribute("aria-label")]), ["0", "link", "Almak"]);
  });
  await check("archived people are hidden from the directory", async () => {
    await page.evaluate(() => { const p = "40 - PEOPLE/People/Bruce Lee.md"; __app.fm(p).status = "archived"; __app.cache.set(p, JSON.parse(JSON.stringify(__app.fm(p)))); __plugin.index.refreshFile(__app.entries.get(p).file); __view.update(); });
    assert.ok(!(await cards()).includes("Bruce Lee")); assert.equal(await page.$eval(".ph-dir-subtitle", e => e.textContent), "23 people in 40 - PEOPLE/People");
  });
  await check("no render errors", async () => assert.deepEqual(page.errors, []));
  await page.close();

  console.log("DOM checks — empty vault");
  page = await open(browser, "directory", { width: 900, height: 500, mainLeaf: true });
  await check("empty state offers 'Add your first person'", async () => {
    await page.evaluate(() => { __app.entries.clear(); __plugin.index.invalidate(); __view.update(); });
    assert.equal(await page.$eval(".ph-dir-subtitle", e => e.textContent), "0 people in 40 - PEOPLE/People");
    assert.match(await page.$eval(".ph-dir-empty", e => e.textContent), /No people yet\.\s*Add your first person/);
    assert.deepEqual(page.errors, []);
  });
  await page.close();
  console.log(`\n${passed} DOM checks passed${process.exitCode ? " — FAILURES ABOVE" : ""}`);
};

(async () => {
  const candidates = [process.env.CHROME_PATH,
    ...["/home/claude/.cache/puppeteer/chrome", require("os").homedir() + "/.cache/puppeteer/chrome"].flatMap(d => fs.existsSync(d) ? fs.readdirSync(d).map(v => `${d}/${v}/chrome-linux64/chrome`) : []),
    ...(fs.existsSync("/opt/pw-browsers") ? fs.readdirSync("/opt/pw-browsers").filter(n => n.startsWith("chromium-")).map(n => `/opt/pw-browsers/${n}/chrome-linux/chrome`) : [])];
  const exe = candidates.find(c => c && fs.existsSync(c));
  if (!exe) throw new Error("No Chrome found; set CHROME_PATH");
  const browser = await puppeteer.launch({ executablePath: exe, args: ["--no-sandbox", "--force-color-profile=srgb"] });
  try {
    await shot(browser, "sidebar-birthdays-dark",  { kind: "birthdays", width: 420, height: 1500 });
    await shot(browser, "directory-dark",          { kind: "directory", width: 1309, height: 700, mainLeaf: true });
    await shot(browser, "sidebar-birthdays-light", { kind: "birthdays", theme: "light", width: 420, height: 1500 });
    await shot(browser, "directory-light",         { kind: "directory", theme: "light", width: 1309, height: 700, mainLeaf: true });
    await shot(browser, "directory-mobile",        { kind: "directory", width: 390, height: 900, mainLeaf: true });
    await shot(browser, "sidebar-birthdays-narrow",{ kind: "birthdays", width: 300, height: 1500 });
    await shot(browser, "sidebar-today-dark",      { kind: "today",    width: 420, height: 900 });
    await shot(browser, "sidebar-people-dark",     { kind: "people",   width: 420, height: 900 });
    await shot(browser, "sidebar-carnegie-dark",   { kind: "carnegie", width: 420, height: 600 });
    await shot(browser, "directory-filtered",      { kind: "directory", width: 1309, height: 520, mainLeaf: true,
      setup: `(() => { const v = window.__view; v.query.text = "o"; v.query.tag = "authors"; v.update(); })()` });
    await runChecks(browser);
  } finally { await browser.close(); }
})();
