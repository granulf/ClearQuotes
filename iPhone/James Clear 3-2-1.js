// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: quote-right;

/*
 * James Clear 3-2-1: a quote-of-the-day widget for Scriptable (iPhone / iPad).
 *
 * Every day it shows one of James Clear's "3 ideas from me" from his weekly
 * 3-2-1 newsletter, read from his public archive on jamesclear.com.
 * From Friday to Sunday it shows that week's new issue (idea I, II, III);
 * the rest of the week it picks an idea from the archive (2019 to today).
 * The Mac widget (ClearQuotes) uses the same rules, so both devices show the
 * same idea on the same day for the same widget size.
 *
 * Setup: paste this file into a new Scriptable script, add a Scriptable widget
 * to the home or lock screen, long-press it > Edit Widget > Script: this one.
 * Tapping the widget (or running the script inside Scriptable) shows a menu:
 * another idea, open the issue on jamesclear.com, copy, preview, reset.
 * After "Another idea" the widget shows the new idea at its next refresh
 * (within about an hour); the next day starts fresh.
 *
 * Personal use only. All ideas are by James Clear and are loaded from his site.
 */

const CONFIG = {
  // Fri-Sun: show the three ideas from the newest issue, one per day.
  newIssueFirst: true,
  // Longest idea (in characters) that each widget size will show.
  // Keep these identical to QuoteEngine.swift so Mac and iPhone match.
  maxChars: {
    small: 110,
    medium: 260,
    large: 560,
    extraLarge: 900,
    accessoryRectangular: 90,
    accessoryInline: 60,
    accessoryCircular: 60,
  },
};

// ----------------------------- core engine -----------------------------
// Pure logic, mirrored line for line in QuoteEngine.swift.

const API_BASE = "https://jamesclear.com/wp-json/wp/v2/3-2-1";
const FIELDS = "id,date,link,title,content";
const LATEST_URL = `${API_BASE}?per_page=1&_fields=${FIELDS}`;
const offsetURL = (k) => `${API_BASE}?per_page=1&order=asc&offset=${k}&_fields=${FIELDS}`;
const beforeURL = (year) => `${API_BASE}?per_page=1&before=${year}-01-01T00:00:00&_fields=id`;
const MAX_ATTEMPTS = 5;
const WALK_STEP = 7919;
const CACHE_VERSION = 1;
const HR = "\uE000"; // private-use marker for <hr> separators
const ISSUE_LINK = /\/3-2-1\/[a-z]+-[0-9]{1,2}-[0-9]{4}\/?$/;
const NUMERAL_ALONE = /^(I|II|III|IV|V|VI)\.?$/;
const NUMERAL_INLINE = /^(I|II|III|IV|V|VI)\.[ \n]+([\s\S]+)$/;
const SHARE_LINE = /^\(?[ ]*(?:click to )?(?:share|tweet) this(?: on (?:twitter|x))?[ ]*\)?$/i;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00A0",
  hellip: "\u2026", mdash: "\u2014", ndash: "\u2013", lsquo: "\u2018", rsquo: "\u2019",
  ldquo: "\u201C", rdquo: "\u201D", laquo: "\u00AB", raquo: "\u00BB", bull: "\u2022",
  middot: "\u00B7", copy: "\u00A9", reg: "\u00AE", trade: "\u2122", deg: "\u00B0",
  times: "\u00D7", eacute: "\u00E9", egrave: "\u00E8", aacute: "\u00E1", iacute: "\u00ED",
  oacute: "\u00F3", uacute: "\u00FA", ntilde: "\u00F1", auml: "\u00E4", ouml: "\u00F6",
  uuml: "\u00FC", aring: "\u00E5", ccedil: "\u00E7", szlig: "\u00DF",
};

function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
    if (e[0] === "#") {
      const hex = e[1] === "x" || e[1] === "X";
      const cp = parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, e) ? NAMED_ENTITIES[e] : m;
  });
}

// HTML fragment -> array of plain-text paragraphs (lines inside a paragraph joined by "\n").
function htmlToParagraphs(html) {
  let s = html.replace(/[\r\n\t]+/g, " ");
  s = s.replace(/<(script|style|svg|figure|noscript)\b[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<div\b[^>]*class="[^"]*twitter-share[^"]*"[^>]*>[\s\S]*?<\/div>[ ]*<\/div>/gi, " ");
  s = s.replace(/<a\b[^>]*href="https?:\/\/(?:ctt\.ac|(?:www\.)?twitter\.com\/intent|(?:www\.)?x\.com\/intent)[^"]*"[^>]*>[\s\S]*?<\/a>/gi, " ");
  s = s.replace(/<hr\b[^>]*>/gi, `\n\n${HR}\n\n`);
  s = s.replace(/<br\b[^>]*>/gi, "\n");
  s = s.replace(/<li\b[^>]*>/gi, "\n\u2022 ");
  s = s.replace(/<\/li>/gi, "\n");
  s = s.replace(/<\/?(p|div|ul|ol|h[1-6]|blockquote|figcaption|table|tr|section|header|footer)\b[^>]*>/gi, "\n\n");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "");
  s = s.replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u000B\u000C]/g, " ");
  const paragraphs = [];
  let current = [];
  for (const raw of s.split("\n")) {
    const line = raw.replace(/[ \t]+/g, " ").trim();
    if (line === "") {
      if (current.length) paragraphs.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) paragraphs.push(current.join("\n"));
  return paragraphs.filter((p) => p === HR || (/[A-Za-z0-9]/.test(p) && !SHARE_LINE.test(p)));
}

function stripOuterQuotes(t) {
  if (t.length >= 2 && t.startsWith("\u201C") && t.endsWith("\u201D")) {
    const inner = t.slice(1, -1);
    if (!inner.includes("\u201C") && !inner.includes("\u201D")) return inner.trim();
  }
  return t;
}

// Returns James Clear's own ideas ("3 IDEAS FROM ME") from an issue's HTML.
function extractIdeas(html) {
  const paras = htmlToParagraphs(html);
  const isHeading = (p) => p.length <= 40 && /ideas? from me/i.test(p);
  const isEnd = (p) => p.length <= 40 && /(quotes? from|questions? for you)/i.test(p);
  const start = paras.findIndex(isHeading);
  if (start < 0) return [];
  let end = paras.length;
  for (let i = start + 1; i < paras.length; i++) {
    if (isEnd(paras[i])) { end = i; break; }
  }
  const section = paras.slice(start + 1, end);
  const numeralOf = (p) => {
    let m = NUMERAL_ALONE.exec(p);
    if (m) return { n: m[1], rest: "" };
    m = NUMERAL_INLINE.exec(p);
    return m ? { n: m[1], rest: m[2].trim() } : null;
  };
  // Text before "I." is an intro and is skipped; if "I." is missing, that text is idea I.
  const first = section.map(numeralOf).find((x) => x !== null);
  const ideas = [];
  let current = first && first.n === "I" ? null : [];
  for (const p of section) {
    if (p === HR) {
      if (current && current.length) ideas.push(current);
      if (current !== null) current = [];
      continue;
    }
    const num = numeralOf(p);
    if (num) {
      if (current && current.length) ideas.push(current);
      current = num.rest ? [num.rest] : [];
      continue;
    }
    if (current) current.push(p);
  }
  if (current && current.length) ideas.push(current);
  return ideas
    .map((ps) => stripOuterQuotes(ps.join("\n\n").trim()))
    .filter((t) => /[A-Za-z0-9]/.test(t));
}

function parseIssue(item) {
  const link = String(item.link || "");
  const real = ISSUE_LINK.test(link);
  const title = decodeEntities(String((item.title && item.title.rendered) || "").replace(/<[^>]*>/g, "")).trim();
  return {
    id: item.id,
    date: String(item.date || "").slice(0, 10),
    link,
    title,
    ideas: real ? extractIdeas(String((item.content && item.content.rendered) || "")) : [],
  };
}

function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (const b of utf8Bytes(str)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function utf8Bytes(str) {
  const out = [];
  for (const ch of str) {
    let cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

const pad2 = (n) => (n < 10 ? "0" : "") + n;
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
function epochDay(key) {
  let [y, m, d] = key.split("-").map(Number);
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function prettyDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function truncate(text, max) {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(1, max - 1));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // don't split an emoji
  const space = cut.lastIndexOf(" ");
  if (space > max * 0.6) cut = cut.slice(0, space);
  return cut.replace(/[ \n,;:.\u2014\u2013-]+$/, "") + "\u2026";
}

// Picks are cached as "day|max" for skip 0 and "day|max|s<n>" after "Another idea".
const pickKey = (day, max, skip) => (skip === 0 ? `${day}|${max}` : `${day}|${max}|s${skip}`);

function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

// Keeps nothing: for the throwaway engine that reads the archive backup.
const NULL_STORE = { load: () => null, save: () => {}, clear: () => {} };

// Serves the three WordPress API requests the engine makes (latest, offset, before) from a list
// of posts: the optional personal archive backup (raw WordPress posts, see Fallback/README.md).
function archiveHTTP(posts) {
  const asc = [...posts].sort((a, b) => {
    const da = String(a.date || "");
    const db = String(b.date || "");
    return da < db ? -1 : da > db ? 1 : a.id - b.id;
  });
  return async (url) => {
    const param = (name) => {
      const m = new RegExp(`[?&]${name}=([^&]*)`).exec(url);
      return m ? decodeURIComponent(m[1]) : null;
    };
    const before = param("before");
    if (before !== null) {
      const n = asc.filter((p) => String(p.date || "") < before).length;
      return { status: 200, headers: { "x-wp-total": String(n) }, body: JSON.stringify(n > 0 ? [{ id: asc[0].id }] : []) };
    }
    const total = asc.length;
    const offset = Number(param("offset") || 0);
    const idx = param("order") === "asc" ? offset : total - 1 - offset;
    return { status: 200, headers: { "x-wp-total": String(total) }, body: JSON.stringify(idx >= 0 && idx < total ? [asc[idx]] : []) };
  };
}

class QuoteEngine {
  // http(url) -> Promise<{status, headers, body}>; store: {load(), save(obj), clear()}
  // options: CONFIG overrides, plus archive: () => [posts] or null (the optional archive backup)
  constructor(http, store, options) {
    this.http = http;
    this.store = store;
    this.opts = Object.assign({}, CONFIG, options || {});
    const c = store.load();
    this.cache = c && c.v === CACHE_VERSION ? c : { v: CACHE_VERSION, meta: null, base: null, issues: {}, picks: {} };
    if (!this.cache.skips) this.cache.skips = {}; // "Another idea" presses per day (older caches lack it)
    if (!this.cache.additions) this.cache.additions = []; // posts published after the archive backup (raw)
  }

  maxCharsFor(family) {
    return this.opts.maxChars[family] || this.opts.maxChars.medium;
  }

  skipCount(day) {
    return this.cache.skips[day] || 0;
  }

  save() {
    const keys = Object.keys(this.cache.picks).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete this.cache.picks[k];
    const days = Object.keys(this.cache.skips).sort();
    for (const d of days.slice(0, Math.max(0, days.length - 14))) delete this.cache.skips[d];
    try { this.store.save(this.cache); } catch (e) { /* cache is best-effort */ }
  }

  async getJSON(url) {
    const r = await this.http(url);
    if (r.status !== 200) throw new Error(`HTTP ${r.status} for ${url}`);
    return { json: JSON.parse(r.body), headers: r.headers };
  }

  async refreshMeta(day) {
    const meta = this.cache.meta;
    if (meta && meta.fetchedDay === day) return meta;
    const { json, headers } = await this.getJSON(LATEST_URL);
    const total = parseInt(headerValue(headers, "x-wp-total"), 10);
    if (!Array.isArray(json) || !json.length || !(total > 0)) throw new Error("Unexpected archive response");
    this.cache.meta = { total, latest: parseIssue(json[0]), fetchedDay: day };
    await this.extendArchive(total, json[0]);
    return this.cache.meta;
  }

  // Keeps the archive backup current on this device: posts published after it are kept (raw, in the
  // cache) and the fallback uses them together with it. The newest post comes with the daily request;
  // posts this device missed are fetched by position, oldest first, a few a day.
  async extendArchive(total, latest) {
    const backup = this.backupPosts();
    if (!backup) return;
    const backupIDs = new Set(backup.map((p) => p.id));
    const added = this.cache.additions.filter((p) => !backupIDs.has(p.id)); // a newer backup may hold them
    let newest = backup.concat(added).reduce((max, p) => (String(p.date || "") > max ? String(p.date || "") : max), "");
    const append = (post) => {
      const date = String(post.date || "");
      if (!Number.isInteger(post.id) || backupIDs.has(post.id) || added.some((p) => p.id === post.id) || date < newest) return false;
      added.push(post);
      if (post.date) newest = date;
      return true;
    };
    try {
      let k = backup.length + added.length;
      let fetched = 0;
      while (k < total - 1 && fetched < MAX_ATTEMPTS) {
        fetched++;
        const { json } = await this.getJSON(offsetURL(k));
        if (!Array.isArray(json) || !json.length || !append(json[0])) return;
        this.cache.issues[String(k)] = parseIssue(json[0]);
        k++;
      }
      if (k === total - 1) append(latest);
    } catch (e) {
      // best effort: try again tomorrow
    } finally {
      this.cache.additions = added;
    }
  }

  // The archive backup, if there is one: a list of posts that each have a numeric id.
  backupPosts() {
    let posts = null;
    try { posts = this.opts.archive ? this.opts.archive() : null; } catch (e) { posts = null; }
    return Array.isArray(posts) && posts.length && posts.every((p) => p && Number.isInteger(p.id)) ? posts : null;
  }

  async issueAt(k) {
    const key = String(k);
    if (this.cache.issues[key]) return this.cache.issues[key];
    const { json } = await this.getJSON(offsetURL(k));
    if (!Array.isArray(json) || !json.length) return null;
    const issue = parseIssue(json[0]);
    this.cache.issues[key] = issue;
    return issue;
  }

  makeQuote(issue, idx, day, max, flags) {
    return {
      text: truncate(issue.ideas[idx], max),
      ideaNumber: idx + 1,
      day,
      isNew: !!flags.isNew,
      offline: !!flags.offline,
      issue: { id: issue.id, date: issue.date, link: issue.link, title: issue.title },
    };
  }

  // Offline with an archive backup: the same rules, run against the backup (plus this device's
  // additions) instead of the live site.
  // Marked offline, so it isn't cached and the widget keeps retrying the site.
  async archivePick(date, family, skip) {
    const backup = this.backupPosts();
    if (!backup) return null;
    const backupIDs = new Set(backup.map((p) => p.id));
    const posts = backup.concat(this.cache.additions.filter((p) => !backupIDs.has(p.id)));
    const local = new QuoteEngine(archiveHTTP(posts), NULL_STORE, Object.assign({}, this.opts, { archive: null }));
    for (let i = 0; i < skip; i++) local.nextIdea(date);
    try {
      const quote = await local.quoteFor(date, family);
      return Object.assign({}, quote, { offline: true });
    } catch (e) {
      return null;
    }
  }

  offlinePick(day, max, skip) {
    const all = [];
    const keys = Object.keys(this.cache.issues).sort((a, b) => Number(a) - Number(b));
    for (const k of keys) {
      const issue = this.cache.issues[k];
      issue.ideas.forEach((t, i) => { if (t.length <= max) all.push([issue, i]); });
    }
    const latest = this.cache.meta && this.cache.meta.latest;
    if (latest) latest.ideas.forEach((t, i) => { if (t.length <= max) all.push([latest, i]); });
    if (!all.length) return null;
    const salt = skip === 0 ? `${day}|offline` : `${day}|skip${skip}|offline`;
    const [issue, i] = all[fnv1a32(salt) % all.length];
    return this.makeQuote(issue, i, day, max, { offline: true });
  }

  async quoteFor(date, family) {
    const day = dayKey(date);
    const max = this.maxCharsFor(family);
    const skip = this.skipCount(day);
    const cached = this.cache.picks[pickKey(day, max, skip)];
    if (cached) return cached;

    let quote = null;
    try {
      quote = await this.pick(day, max, skip);
    } catch (e) {
      quote = null;
    }
    if (!quote) {
      quote = await this.archivePick(date, family, skip);
    }
    if (!quote) {
      quote = this.offlinePick(day, max, skip);
    }
    this.save();
    if (!quote) throw new Error("Could not reach jamesclear.com and nothing is cached yet.");
    return quote;
  }

  // "Another idea": every widget size moves on to the next pick for the day. Returns the new skip count.
  nextIdea(date) {
    const day = dayKey(date);
    const n = this.skipCount(day) + 1;
    this.cache.skips[day] = n;
    this.save();
    return n;
  }

  // Back to the idea shown before the last "Another idea" (picks are fixed per skip). Returns the new skip count.
  previousIdea(date) {
    const day = dayKey(date);
    const n = Math.max(0, this.skipCount(day) - 1);
    if (n === 0) delete this.cache.skips[day];
    else this.cache.skips[day] = n;
    this.save();
    return n;
  }

  // The pick for one skip, cached. Earlier skips are picked first so that "Another idea"
  // never repeats an idea shown earlier that day, whatever is in the cache.
  async pick(day, max, skip) {
    const key = pickKey(day, max, skip);
    if (this.cache.picks[key]) return this.cache.picks[key];
    let quote;
    if (skip === 0) {
      quote = await this.choose(day, max);
    } else {
      const shown = new Set();
      for (let k = 0; k < skip; k++) {
        const q = await this.pick(day, max, k);
        if (q) shown.add(`${q.issue.id}#${q.ideaNumber}`);
      }
      quote = await this.chooseAnother(day, max, skip, shown);
    }
    if (quote) this.cache.picks[key] = quote;
    return quote;
  }

  // Skip n > 0: random issues from the whole archive (no new-issue mode), salted with the skip.
  async chooseAnother(day, max, skip, shown) {
    const meta = await this.refreshMeta(day);
    let fallback = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const k = fnv1a32(`${day}|skip${skip}|issue|${attempt}`) % meta.total;
      const issue = await this.issueAt(k);
      if (!issue || !issue.ideas.length) continue;
      const n = issue.ideas.length;
      const start = fnv1a32(`${day}|skip${skip}|idea|${attempt}`) % n;
      for (let j = 0; j < n; j++) {
        const idx = (start + j) % n;
        if (shown.has(`${issue.id}#${idx + 1}`)) continue;
        const len = issue.ideas[idx].length;
        if (len <= max) return this.makeQuote(issue, idx, day, max, {});
        if (!fallback || len < fallback[2]) fallback = [issue, idx, len];
      }
    }
    return fallback ? this.makeQuote(fallback[0], fallback[1], day, max, {}) : null;
  }

  // Number of posts published before January 1 of the day's year (fixed for the whole year).
  async yearBase(day) {
    const year = day.slice(0, 4);
    const base = this.cache.base;
    if (base && base.year === year) return base.n;
    const { headers } = await this.getJSON(beforeURL(year));
    const n = parseInt(headerValue(headers, "x-wp-total"), 10);
    if (!(n > 0)) throw new Error("Unexpected archive response");
    this.cache.base = { year, n };
    return n;
  }

  async choose(day, max) {
    const meta = await this.refreshMeta(day);
    const latest = meta.latest;
    if (this.opts.newIssueFirst && latest && latest.ideas.length) {
      const age = epochDay(day) - epochDay(latest.date);
      const idx = age - 1;
      if (age >= 1 && age <= 3 && idx < latest.ideas.length && latest.ideas[idx].length <= max) {
        return this.makeQuote(latest, idx, day, max, { isNew: true });
      }
    }
    let fallback = null;
    const tryIssue = async (k, salt) => {
      const issue = await this.issueAt(k);
      if (!issue || !issue.ideas.length) return null;
      const n = issue.ideas.length;
      const start = fnv1a32(`${day}|idea|${salt}`) % n;
      for (let j = 0; j < n; j++) {
        const idx = (start + j) % n;
        const len = issue.ideas[idx].length;
        if (len <= max) return this.makeQuote(issue, idx, day, max, {});
        if (!fallback || len < fallback[2]) fallback = [issue, idx, len];
      }
      return null;
    };
    // 1) A no-repeat walk through every issue published before January 1:
    //    7919 is prime and larger than the archive, so each issue comes up once a year.
    const year = day.slice(0, 4);
    const base = await this.yearBase(day);
    const dayOfYear = epochDay(day) - epochDay(`${year}-01-01`);
    const k0 = (WALK_STEP * dayOfYear + (fnv1a32(`year|${year}`) % base)) % base;
    let quote = await tryIssue(k0, "walk");
    if (quote) return quote;
    // 2) If that issue has no idea short enough for this widget size, try a few random issues.
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      const k = fnv1a32(`${day}|issue|${attempt}`) % meta.total;
      quote = await tryIssue(k, String(attempt));
      if (quote) return quote;
    }
    return fallback ? this.makeQuote(fallback[0], fallback[1], day, max, {}) : null;
  }
}

// ----------------------------- Scriptable glue -----------------------------

const COLORS = {
  bg: () => Color.dynamic(new Color("#FBF8F3"), new Color("#1C1A17")),
  text: () => Color.dynamic(new Color("#1F1C18"), new Color("#F1ECE4")),
  muted: () => Color.dynamic(new Color("#8C8478"), new Color("#9A9286")),
  accent: () => Color.dynamic(new Color("#B4632A"), new Color("#E3A35F")),
};

async function scriptableHTTP(url) {
  const req = new Request(url);
  req.timeoutInterval = 10;
  req.headers = { Accept: "application/json" };
  const body = await req.loadString();
  const res = req.response || {};
  return { status: res.statusCode || 0, headers: res.headers || {}, body };
}

function scriptableStore() {
  const fm = FileManager.local();
  const dir = fm.joinPath(fm.libraryDirectory(), "jamesclear-321");
  const file = fm.joinPath(dir, "cache.json");
  return {
    load() {
      try { return fm.fileExists(file) ? JSON.parse(fm.readString(file)) : null; } catch (e) { return null; }
    },
    save(obj) {
      if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
      fm.writeString(file, JSON.stringify(obj));
    },
    clear() {
      if (fm.fileExists(file)) fm.remove(file);
    },
  };
}

// Optional personal archive backup, saved next to this script in iCloud Drive > Scriptable.
// Read only when jamesclear.com can't be reached (see Fallback/README.md in the ClearQuotes project).
const ARCHIVE_FILE = "James Clear 3-2-1 archive.json";

function scriptableArchive() {
  try {
    const fm = FileManager.iCloud();
    const file = fm.joinPath(fm.documentsDirectory(), ARCHIVE_FILE);
    if (!fm.fileExists(file)) return null;
    if (!fm.isFileDownloaded(file)) {
      fm.downloadFileFromiCloud(file).catch(() => {}); // ready next time
      return null;
    }
    return JSON.parse(fm.readString(file));
  } catch (e) {
    return null;
  }
}

function footerText(quote, family) {
  if (!quote) return "JAMES CLEAR \u00B7 3-2-1";
  const tag = quote.isNew ? "NEW" : "3-2-1";
  if (family === "small") return quote.isNew ? "NEW \u00B7 JAMES CLEAR" : "JAMES CLEAR";
  return `JAMES CLEAR \u00B7 ${tag} \u00B7 ${prettyDate(quote.issue.date).toUpperCase()}`;
}

// Tapping the widget opens the in-app menu (with "Another idea"); false opens the issue directly.
const TAP_OPENS_MENU = true;

function nextRefreshDate(ok) {
  const now = new Date();
  if (!ok) return new Date(now.getTime() + 30 * 60 * 1000);
  // A new idea just after midnight. Refresh hourly until then (from the cache, no requests),
  // so that an "Another idea" picked in the app reaches the widget.
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0);
  return new Date(Math.min(midnight.getTime(), now.getTime() + 60 * 60 * 1000));
}

function widgetTapURL(quote, family) {
  if (!TAP_OPENS_MENU) return quote ? quote.issue.link : null;
  const run = URLScheme.forRunningScript();
  return `${run}${run.includes("?") ? "&" : "?"}family=${encodeURIComponent(family)}`;
}

function buildWidget(quote, family, error) {
  const w = new ListWidget();
  const tap = widgetTapURL(quote, family);
  if (tap) w.url = tap;
  w.refreshAfterDate = nextRefreshDate(!!quote && !quote.offline); // retry soon if offline
  const text = quote ? quote.text : "Couldn't reach jamesclear.com yet. I'll try again soon.";

  if (family === "accessoryInline") {
    const quoted = /^[\u201C"]/.test(text) ? text : `\u201C${text}\u201D`;
    w.addText(quote ? quoted : "3-2-1: offline");
    return w;
  }
  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const t = w.addText("3\u00B72\u00B71");
    t.font = Font.semiboldRoundedSystemFont(13);
    t.centerAlignText();
    return w;
  }
  if (family === "accessoryRectangular") {
    const t = w.addText(text);
    t.font = Font.systemFont(13);
    t.minimumScaleFactor = 0.6;
    t.lineLimit = 4;
    return w;
  }

  const size = { small: 14, medium: 16, large: 19, extraLarge: 22 }[family] || 16;
  w.backgroundColor = COLORS.bg();
  w.setPadding(family === "small" ? 12 : 14, 16, 12, 16);

  const mark = w.addText("\u201C");
  mark.font = new Font("Georgia-Bold", family === "small" ? 22 : Math.round(size * 1.9));
  mark.textColor = COLORS.accent();
  mark.lineLimit = 1;
  w.addSpacer(family === "small" ? 0 : 2);

  const body = w.addText(text);
  body.font = new Font("Georgia", size);
  body.textColor = quote ? COLORS.text() : COLORS.muted();
  body.minimumScaleFactor = family === "small" ? 0.55 : 0.6;

  w.addSpacer();
  const foot = w.addText(footerText(quote, family));
  foot.font = Font.semiboldSystemFont(family === "small" ? 8 : 9);
  foot.textColor = quote && quote.isNew ? COLORS.accent() : COLORS.muted();
  foot.lineLimit = 1;
  foot.minimumScaleFactor = 0.7;
  return w;
}

// The in-app menu, for the widget size that was tapped. "Another idea" and "Previous idea"
// show that pick and open the menu again, until one sticks.
async function presentInApp(engine, family) {
  const fresh = async (fam) => {
    try { return await engine.quoteFor(new Date(), fam); } catch (e) { return null; }
  };
  for (;;) {
    const quote = await fresh(family);
    const shuffled = engine.skipCount(dayKey(new Date())) > 0;
    const a = new Alert();
    a.title = quote ? `Today's idea (${prettyDate(quote.issue.date)})` : "James Clear 3-2-1";
    a.message = quote ? quote.text : "Couldn't load an idea. Check your connection and try again.";
    if (quote && shuffled) a.message += "\n\nThe widget shows this idea at its next refresh.";
    // Each action returns true to show the menu again.
    const actions = [];
    const add = (label, run, destructive) => {
      if (destructive) a.addDestructiveAction(label);
      else a.addAction(label);
      actions.push(run);
    };
    add("Another idea", () => { engine.nextIdea(new Date()); return true; });
    if (shuffled) add("Previous idea", () => { engine.previousIdea(new Date()); return true; });
    add("Open this issue", () => { if (quote) Safari.open(quote.issue.link); });
    add("Copy idea", () => { if (quote) Pasteboard.copy(`${quote.text}\n\n\u2014 James Clear, 3-2-1 (${quote.issue.link})`); });
    add("Preview small", async () => { await buildWidget(await fresh("small"), "small").presentSmall(); });
    add("Preview medium", async () => { await buildWidget(await fresh("medium"), "medium").presentMedium(); });
    add("Preview large", async () => { await buildWidget(await fresh("large"), "large").presentLarge(); });
    add("Reset cache", () => { engine.store.clear(); }, true);
    a.addCancelAction("Done");
    const run = actions[await a.presentSheet()];
    if (run && (await run())) continue;
    return;
  }
}

async function main() {
  // A tap on the widget runs the script in the app with ?family=<widget size>.
  const asked = (args.queryParameters || {}).family;
  const known = Object.prototype.hasOwnProperty.call(CONFIG.maxChars, asked || "");
  const family = config.runsInWidget ? config.widgetFamily || "medium" : known ? asked : "medium";
  const engine = new QuoteEngine(scriptableHTTP, scriptableStore(), { archive: scriptableArchive });
  if (config.runsInWidget || config.runsWithSiri) {
    let quote = null;
    let error = null;
    try {
      quote = await engine.quoteFor(new Date(), family);
    } catch (e) {
      error = e;
    }
    if (config.runsInWidget) {
      Script.setWidget(buildWidget(quote, family, error));
    } else {
      Script.setShortcutOutput(quote ? `${quote.text}\n\u2014 James Clear` : "");
    }
  } else {
    await presentInApp(engine, family);
  }
  Script.complete();
}

if (typeof __TEST__ === "undefined") await main();
