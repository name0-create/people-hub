// Fake Obsidian runtime: in-memory vault with lagging metadata cache + write log.
const clone = v => JSON.parse(JSON.stringify(v));
const normalizePath = p => p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
class TAbstractFile { constructor(path) { this.path = path; } get name() { return this.path.split("/").pop(); } }
class TFile extends TAbstractFile {
  constructor(path) { super(path); this.stat = { ctime: 1700000000000, mtime: 1700000100000, size: 0 }; }
  get basename() { return this.name.replace(/\.md$/, ""); }
  get extension() { return "md"; }
}
class TFolder extends TAbstractFile { constructor(path, children = []) { super(path); this.children = children; } }
class Notice { constructor(m) { Notice.last = m; } }
class Plain { constructor() {} }
class FakeApp {
  constructor({ cacheDelay = 8 } = {}) {
    this.entries = new Map(); this.folders = new Set(); this.cache = new Map();
    this.listeners = []; this.vaultListeners = []; this.log = []; this.cacheDelay = cacheDelay; this.failNextFM = null; this.badYaml = new Set();
    const app = this;
    this.vault = {
      getAbstractFileByPath(p) {
        p = normalizePath(p);
        if (app.entries.has(p)) return app.entries.get(p).file;
        if (app.folders.has(p)) return new TFolder(p, [...app.entries.keys()].filter(k => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")).map(k => app.entries.get(k).file));
        return null;
      },
      getMarkdownFiles() { return [...app.entries.values()].map(e => e.file); },
      async create(path, data) {
        path = normalizePath(path);
        if (app.entries.has(path)) throw new Error("File already exists.");
        const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (dir && !app.folders.has(dir)) throw new Error("Folder does not exist");
        const file = new TFile(path); app.entries.set(path, { file, fm: {}, body: data });
        app.log.push({ op: "create", path }); app.emitVault("create", file); app.schedule(path); return file;
      },
      async createFolder(p) { app.folders.add(normalizePath(p)); },
      async process(file, fn) {
        const e = app.entries.get(file.path); await Promise.resolve();
        const lines = Object.entries(e.fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
        const data = `---\n${lines}\n---\n${e.body}`;
        const out = fn(data); e.body = out.slice(out.indexOf("\n---\n", 3) + 5);
        app.log.push({ op: "process", path: file.path }); return out;
      },
      on(name, cb) { const ref = { name, cb }; app.vaultListeners.push(ref); return ref; },
    };
    this.fileManager = {
      async processFrontMatter(file, fn) {
        const e = app.entries.get(file.path); await Promise.resolve();
        if (app.badYaml.has(file.path)) throw new Error("YAMLParseError");
        if (app.failNextFM) { const m = app.failNextFM; app.failNextFM = null; throw new Error(m); }
        const work = clone(e.fm); fn(work);          // atomic: nothing is committed if fn throws
        e.fm = work; app.log.push({ op: "processFrontMatter", path: file.path }); app.schedule(file.path);
      },
      async renameFile(file, newPath) {
        newPath = normalizePath(newPath);
        if (app.entries.has(newPath)) throw new Error("Destination file already exists!");
        const dir = newPath.includes("/") ? newPath.slice(0, newPath.lastIndexOf("/")) : "";
        if (dir && !app.folders.has(dir)) throw new Error("Folder does not exist");
        const old = file.path, e = app.entries.get(old);
        app.entries.delete(old); file.path = newPath; app.entries.set(newPath, e);
        if (app.cache.has(old)) { app.cache.set(newPath, app.cache.get(old)); app.cache.delete(old); }
        app.log.push({ op: "rename", from: old, to: newPath }); app.emitVault("rename", file, old);
      },
      async trashFile(file) { app.entries.delete(file.path); app.cache.delete(file.path); app.log.push({ op: "trash", path: file.path }); app.emitVault("delete", file); },
    };
    this.metadataCache = {
      getFileCache(file) { const c = app.cache.get(file.path); return c ? { frontmatter: { ...clone(c), position: {} } } : null; },
      on(name, cb) { app.listeners.push(cb); cb.__name = name; return { name, cb }; },
      off(name, cb) { app.listeners = app.listeners.filter(l => l !== cb); },
    };
  }
  schedule(path) {
    setTimeout(() => {
      const e = this.entries.get(path); if (!e) return;
      this.cache.set(path, clone(e.fm)); for (const l of [...this.listeners]) if (l.__name === "changed") l(e.file);
    }, this.cacheDelay);
  }
  seed(path, fm, body) {
    path = normalizePath(path); const dir = path.slice(0, path.lastIndexOf("/"));
    for (let i = 0, cur = ""; i < dir.split("/").length; i++) { cur = dir.split("/").slice(0, i + 1).join("/"); this.folders.add(cur); }
    const file = new TFile(path); this.entries.set(path, { file, fm, body }); this.cache.set(path, clone(fm)); return file;
  }
  emitVault(name, ...args) { for (const r of [...this.vaultListeners]) if (r.name === name) r.cb(...args); }
  /** A note the user (or a sync) adds: Obsidian fires vault "create" first; the metadata cache catches up later. */
  addNote(path, fm, body = "") {
    path = normalizePath(path); const dir = path.slice(0, path.lastIndexOf("/"));
    for (let i = 0; i < dir.split("/").length; i++) this.folders.add(dir.split("/").slice(0, i + 1).join("/"));
    const file = new TFile(path); this.entries.set(path, { file, fm, body });
    this.emitVault("create", file); this.schedule(path); return file;
  }
  /** The user edits properties: cache catches up later and fires metadata "changed". */
  editFm(path, mutate) { const e = this.entries.get(path); mutate(e.fm); this.schedule(path); }
  /** Rename/move a whole folder: children keep their TFile objects; events fire for the folder, then each child. */
  renameFolder(oldPath, newPath) {
    oldPath = normalizePath(oldPath); newPath = normalizePath(newPath);
    const moved = [...this.entries.keys()].filter(k => k.startsWith(oldPath + "/"));
    this.folders.add(newPath); this.folders.delete(oldPath);
    const folder = new TFolder(newPath);
    const pairs = moved.map(k => { const e = this.entries.get(k); const nk = newPath + k.slice(oldPath.length); this.entries.delete(k); e.file.path = nk; this.entries.set(nk, e);
      if (this.cache.has(k)) { this.cache.set(nk, this.cache.get(k)); this.cache.delete(k); } return [e.file, k]; });
    this.emitVault("rename", folder, oldPath);
    for (const [f, k] of pairs) this.emitVault("rename", f, k);
  }
  deleteFolder(path) {
    path = normalizePath(path);
    for (const k of [...this.entries.keys()]) if (k.startsWith(path + "/")) { this.entries.delete(k); this.cache.delete(k); }
    this.folders.delete(path); this.emitVault("delete", new TFolder(path));
  }
  body(path) { return this.entries.get(path).body; }
  fm(path) { return this.entries.get(path).fm; }
  has(path) { return this.entries.has(path); }
}
module.exports = { normalizePath, TAbstractFile, TFile, TFolder, Notice, FakeApp,
  PluginSettingTab: Plain, Setting: Plain, Modal: Plain, FuzzySuggestModal: Plain, ItemView: Plain, Plugin: Plain, Menu: Plain, Events: Plain, Component: Plain, View: Plain };
