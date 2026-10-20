// Loads the Scriptable script in Node with mocked Scriptable APIs, plus fixture helpers.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT_PATH = path.join(TESTS_DIR, "..", "iPhone", "James Clear 3-2-1.js");
export const FIXTURES_DIR = path.join(TESTS_DIR, "fixtures");
export const OUT_DIR = path.join(TESTS_DIR, "out");
// Tests pretend the archive ends with the issue of this date, so expectations stay fixed.
export const FREEZE_AT = "2026-10-08T23:59:59";

class MockColor {
  constructor(hex, alpha) { this.hex = hex; this.alpha = alpha; }
  static dynamic(light, dark) { const c = new MockColor(light.hex); c.dark = dark.hex; return c; }
}
class MockFont {
  constructor(name, size) { this.name = name; this.size = size; }
  static systemFont(s) { return new MockFont("system", s); }
  static semiboldSystemFont(s) { return new MockFont("system-semibold", s); }
  static semiboldRoundedSystemFont(s) { return new MockFont("system-semibold-rounded", s); }
}
class MockText {
  constructor(text) { this.text = text; }
  centerAlignText() { this.align = "center"; }
  leftAlignText() { this.align = "left"; }
}
class MockWidget {
  constructor() { this.items = []; this.padding = null; }
  addText(t) { if (typeof t !== "string") throw new Error("addText expects string"); const x = new MockText(t); this.items.push(x); return x; }
  addSpacer(n) { this.items.push({ spacer: n === undefined ? "flex" : n }); }
  setPadding(t, l, b, r) { this.padding = [t, l, b, r]; }
  async presentSmall() { this.presented = "small"; }
  async presentMedium() { this.presented = "medium"; }
  async presentLarge() { this.presented = "large"; }
}

// root: FileManager.local()'s library folder; icloud: { dir, downloaded = true, downloads = [] } for FileManager.iCloud().
export function makeFileManager(root, icloud = {}) {
  const files = {
    joinPath: (a, b) => path.join(a, b),
    fileExists: (p) => fs.existsSync(p),
    readString: (p) => fs.readFileSync(p, "utf8"),
    writeString: (p, s) => fs.writeFileSync(p, s),
    createDirectory: (p) => fs.mkdirSync(p, { recursive: true }),
    remove: (p) => fs.rmSync(p, { force: true }),
  };
  return {
    local() {
      return { ...files, libraryDirectory: () => root };
    },
    iCloud() {
      if (!icloud.dir) throw new Error("iCloud Drive is not available");
      return {
        ...files,
        documentsDirectory: () => icloud.dir,
        isFileDownloaded: () => icloud.downloaded !== false,
        downloadFileFromiCloud: async (p) => { (icloud.downloads ||= []).push(p); },
      };
    },
  };
}

// httpImpl(url) -> {status, headers, body}
export function makeRequestClass(httpImpl, log) {
  return class MockRequest {
    constructor(url) { this.url = url; this.headers = {}; this.timeoutInterval = 60; this.response = null; }
    async loadString() {
      if (log) log.push(this.url);
      const r = await httpImpl(this.url);
      this.response = { statusCode: r.status, headers: r.headers };
      return r.body;
    }
  };
}

// A canvas that records what is drawn. Text is measured as 0.5 x font size per character.
export function makeFakeDocument(drawn) {
  return {
    createElement: () => {
      const canvas = { width: 0, height: 0 };
      const ctx = {
        font: "10px serif", fillStyle: "#000", textBaseline: "alphabetic",
        fillRect: (x, y, w, h) => drawn.push({ op: "rect", x, y, w, h, color: ctx.fillStyle }),
        measureText: (t) => ({ width: t.length * 0.5 * Number(/([0-9.]+)px/.exec(ctx.font)[1]) }),
        fillText: (text, x, y) => drawn.push({ op: "text", text, x, y, font: ctx.font, color: ctx.fillStyle, width: ctx.measureText(text).width }),
      };
      canvas.getContext = () => ctx;
      canvas.toDataURL = () => "data:image/png;base64,UE5H";
      drawn.canvas = canvas;
      return canvas;
    },
  };
}

// alertChoices: what the in-app menu answers, in order (action labels or indexes; then "Done"); args: Scriptable's args.
// device: { width, height, dark, photosFail } for the screen, the appearance and Photos.
export async function loadScript({ httpImpl, cacheDir, config = {}, test = true, log = [], alertChoices = [], args = {}, icloud = {}, device = {} }) {
  const code = fs.readFileSync(SCRIPT_PATH, "utf8");
  const exportsLine = "\nreturn { CONFIG, decodeEntities, htmlToParagraphs, extractIdeas, parseIssue, fnv1a32, epochDay, dayKey, truncate, prettyDate, QuoteEngine, buildWidget, main, scriptableStore, scriptableHTTP, LATEST_URL, offsetURL, TAP_OPENS_MENU, archiveHTTP, ARCHIVE_FILE, renderIdea, IMAGE_LAYOUTS };";
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const state = { widget: null, completed: false, shortcutOutput: null, alerts: [], opened: [], saved: [], drawn: [] };
  const Script = {
    setWidget: (w) => { state.widget = w; },
    complete: () => { state.completed = true; },
    setShortcutOutput: (o) => { state.shortcutOutput = o; },
  };
  const names = ["Request", "FileManager", "ListWidget", "Color", "Font", "Script", "config", "args", "Alert", "Safari", "Pasteboard", "URLScheme", "WebView", "Device", "Photos", "Image", "Data"];
  const values = [
    makeRequestClass(httpImpl, log),
    makeFileManager(cacheDir || fs.mkdtempSync(path.join(os.tmpdir(), "jc-")), icloud),
    MockWidget, MockColor, MockFont, Script,
    Object.assign({ runsInWidget: false, runsWithSiri: false, widgetFamily: undefined }, config),
    Object.assign({ widgetParameter: null }, args),
    class MockAlert {
      constructor() { this.actions = []; }
      addAction(t) { this.actions.push(t); }
      addDestructiveAction(t) { this.actions.push(t); }
      addCancelAction() {}
      async presentSheet() {
        state.alerts.push({ title: this.title, message: this.message, actions: this.actions });
        const c = alertChoices.length ? alertChoices.shift() : -1;
        return typeof c === "string" ? this.actions.indexOf(c) : c;
      }
    },
    { open(url) { state.opened.push(url); } }, { copy() {} },
    { forRunningScript: () => "scriptable:///run/James%20Clear%203-2-1" },
    class MockWebView {
      async loadHTML(html) { this.html = html; }
      async evaluateJavaScript(js) {
        const src = /<script>([\s\S]*)<\/script>/.exec(this.html)[1];
        state.drawn = [];
        return new Function("document", `${src}\nreturn ${js};`)(makeFakeDocument(state.drawn));
      }
    },
    {
      screenResolution: () => ({ width: device.width || 1179, height: device.height || 2556 }),
      isUsingDarkAppearance: () => !!device.dark,
    },
    { save: (image) => { if (device.photosFail) throw new Error("denied"); state.saved.push(image); } },
    { fromData: (data) => ({ image: data }) },
    { fromBase64String: (b64) => ({ base64: b64 }) },
  ];
  const body = test ? code + exportsLine : code;
  const fn = new AsyncFunction(...names, ...(test ? ["__TEST__"] : []), body);
  const mod = await fn(...values, ...(test ? [true] : []));
  return { mod, state };
}

export function loadFixtureItems() {
  if (!fs.existsSync(FIXTURES_DIR)) throw new Error("No fixtures: run `node fetch_fixtures.mjs` first.");
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => /^rest-page-\d+\.json$/.test(f));
  if (!files.length) throw new Error("No fixtures: run `node fetch_fixtures.mjs` first.");
  return files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8")));
}

/** Index (in date order) of the last post published on or before `freezeAt`. */
export function frozenIndex(items, freezeAt = FREEZE_AT) {
  const asc = [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let li = -1;
  asc.forEach((x, i) => { if (x.date <= freezeAt) li = i; });
  return li;
}

// Fixture-backed HTTP: serves the WordPress API from the downloaded archive.
export function fixtureHTTP(items, { failAll = false, latestIndex } = {}) {
  const asc = [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const li = latestIndex === undefined ? asc.length - 1 : latestIndex;
  return async (url) => {
    if (failAll) throw new Error("offline");
    const u = new URL(url);
    if (!u.pathname.endsWith("/wp-json/wp/v2/3-2-1")) return { status: 404, headers: {}, body: "[]" };
    const before = u.searchParams.get("before");
    if (before) {
      const n = asc.slice(0, li + 1).filter((x) => x.date < before).length;
      return { status: 200, headers: { "x-wp-total": String(n) }, body: JSON.stringify(n ? [{ id: asc[0].id }] : []) };
    }
    const total = li + 1; // pretend the archive ends at latestIndex
    const order = u.searchParams.get("order") || "desc";
    const offset = Number(u.searchParams.get("offset") || 0);
    let item;
    if (order === "asc") item = offset < total ? asc[offset] : undefined;
    else item = asc[li - offset];
    return { status: 200, headers: { "X-WP-Total": String(total) }, body: JSON.stringify(item ? [item] : []) };
  };
}

export function memStore() {
  let data = null;
  return {
    load: () => (data ? JSON.parse(JSON.stringify(data)) : null),
    save: (o) => { data = JSON.parse(JSON.stringify(o)); },
    clear: () => { data = null; },
  };
}
