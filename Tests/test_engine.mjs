// Quote selection tests against the downloaded archive (no live network).
// The archive is frozen at FREEZE_AT so expectations do not move as new issues appear.
// Writes out/js_picks.json for the Swift cross-check.
import fs from "node:fs";
import path from "node:path";
import { loadScript, loadFixtureItems, fixtureHTTP, frozenIndex, memStore, OUT_DIR } from "./harness.mjs";

const items = loadFixtureItems();
const li = frozenIndex(items);
const http = fixtureHTTP(items, { latestIndex: li });
const { mod } = await loadScript({ httpImpl: http });
const { QuoteEngine, CONFIG, dayKey } = mod;

function countingHTTP(inner) {
  const f = async (url) => { f.calls++; return inner(url); };
  f.calls = 0;
  return f;
}

const families = Object.keys(CONFIG.maxChars);
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

// 1) Two independent devices (separate caches) must agree, every day, every size.
const httpA = countingHTTP(http);
const devA = new QuoteEngine(httpA, memStore());
const devB = new QuoteEngine(http, memStore());
const plainPicks = new Map(); // "day|fam" -> pick of a device that never pressed "Another idea"
const DAYS = 365;
for (let i = 0; i < DAYS; i++) {
  const d = new Date(2026, 9, 1 + i, 9, 30);
  for (const fam of families) {
    const a = await devA.quoteFor(d, fam);
    const b = await devB.quoteFor(d, fam);
    plainPicks.set(`${dayKey(d)}|${fam}`, JSON.stringify(a));
    check(JSON.stringify(a) === JSON.stringify(b), `${dayKey(d)} ${fam}: devices disagree`);
    check(a.text.length <= CONFIG.maxChars[fam], `${dayKey(d)} ${fam}: too long (${a.text.length})`);
    check(/\/3-2-1\/[a-z]+-\d{1,2}-\d{4}$/.test(a.issue.link), `${dayKey(d)} ${fam}: bad link ${a.issue.link}`);
  }
  const before = httpA.calls;
  await devA.quoteFor(d, "medium");
  check(httpA.calls === before, `${dayKey(d)}: cached pick triggered a request`);
}
console.log(`requests per day per device: ${(httpA.calls / DAYS).toFixed(2)}`);

// 2) New-issue mode: Fri/Sat/Sun after the Oct 8, 2026 issue -> ideas I, II, III of that issue
const devC = new QuoteEngine(http, memStore());
for (const [day, expectIdea] of [[9, 1], [10, 2], [11, 3], [12, null], [8, null]]) {
  const q = await devC.quoteFor(new Date(2026, 9, day, 8), "large");
  if (expectIdea) check(q.isNew && q.ideaNumber === expectIdea && q.issue.date === "2026-10-08", `Oct ${day}: expected new idea ${expectIdea}`);
  else check(!q.isNew, `Oct ${day}: should not be in new-issue mode`);
}
const noNew = new QuoteEngine(http, memStore(), { newIssueFirst: false });
check(!(await noNew.quoteFor(new Date(2026, 9, 9, 8), "large")).isNew, "newIssueFirst=false still showed new issue");

// 3) Offline behaviour
let threw = false;
try { await new QuoteEngine(fixtureHTTP(items, { failAll: true }), memStore()).quoteFor(new Date(2026, 9, 20), "medium"); } catch (e) { threw = true; }
check(threw, "offline with empty cache should throw");
const store = memStore();
const warm = new QuoteEngine(http, store);
for (let i = 0; i < 5; i++) await warm.quoteFor(new Date(2026, 9, 20 + i), "medium");
const cold = new QuoteEngine(fixtureHTTP(items, { failAll: true }), store);
const q1 = await cold.quoteFor(new Date(2026, 9, 22), "medium");
check(q1 && !q1.offline, "cached pick for a past day should be reused offline");
const q2 = await cold.quoteFor(new Date(2026, 10, 30), "medium");
check(q2 && q2.offline && q2.text.length <= 260, "offline pick from cache failed");

// 4) Robustness: server returns an error, an HTML page, or an empty list
const weird = [
  async () => ({ status: 500, headers: {}, body: "oops" }),
  async () => ({ status: 200, headers: { "X-WP-Total": "379" }, body: "<html>maintenance</html>" }),
  async () => ({ status: 200, headers: {}, body: "[]" }),
];
for (const [i, h] of weird.entries()) {
  let ok = false;
  try { await new QuoteEngine(h, memStore()).quoteFor(new Date(2026, 9, 20), "small"); } catch (e) { ok = /Could not reach/.test(e.message); }
  check(ok, `weird server response #${i} not handled gracefully`);
}

// 5) Repeats within a calendar year (2027 walks every issue published before Jan 1)
for (const fam of ["large", "medium"]) {
  const dev = new QuoteEngine(http, memStore());
  const seen = new Map();
  for (let i = 0; i < 365; i++) {
    const q = await dev.quoteFor(new Date(2027, 0, 1 + i, 9), fam);
    const k = `${q.issue.id}#${q.ideaNumber}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dups = [...seen.values()].filter((n) => n > 1).length;
  console.log(`2027 ${fam}: ${seen.size} distinct ideas in 365 days (${dups} repeated)`);
  check(dups <= (fam === "large" ? 5 : 30), `2027 ${fam}: too many repeats (${dups})`);
}

// 6) Pick table for the Swift cross-check: today's idea (skip 0), then "Another idea" three times
const SKIPS = 3;
const table = [];
const devD = new QuoteEngine(http, memStore());
for (let i = 0; i < 120; i++) {
  const d = new Date(2026, 9, 1 + i, 12);
  for (let skip = 0; skip <= SKIPS; skip++) {
    if (skip > 0) check(devD.nextIdea(d) === skip, `${dayKey(d)}: nextIdea did not return ${skip}`);
    for (const fam of families) {
      const q = await devD.quoteFor(d, fam);
      table.push({ day: dayKey(d), fam, skip, id: q.issue.id, idea: q.ideaNumber, isNew: q.isNew, offline: q.offline, len: q.text.length, text: q.text });
    }
  }
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "js_picks.json"), JSON.stringify(table));

// 7) "Another idea"
const rowKey = (r) => `${r.day}|${r.fam}`;
const byDayFam = new Map();
for (const r of table) {
  if (!byDayFam.has(rowKey(r))) byDayFam.set(rowKey(r), []);
  byDayFam.get(rowKey(r)).push(r);
}
for (const [k, rows] of byDayFam) {
  const ideas = new Set(rows.map((r) => `${r.id}#${r.idea}`));
  check(ideas.size === rows.length, `${k}: "Another idea" repeated an idea shown earlier that day`);
  for (const r of rows.filter((x) => x.skip > 0)) {
    check(!r.isNew && !r.offline, `${k} skip ${r.skip}: should be an online archive pick`);
    check(r.len <= CONFIG.maxChars[r.fam], `${k} skip ${r.skip}: too long (${r.len})`);
  }
}
// Skip 0 is today's rule exactly, and each new day starts fresh even after shuffling the day before.
for (const r of table.filter((x) => x.skip === 0)) {
  const p = JSON.parse(plainPicks.get(rowKey(r)));
  const same = r.day === p.day && r.id === p.issue.id && r.idea === p.ideaNumber && r.isNew === p.isNew && r.text === p.text;
  check(same, `${rowKey(r)}: skip 0 differs from a device that never shuffled`);
}
// The pick for a skip doesn't depend on which earlier picks happen to be cached.
const d1015 = new Date(2026, 9, 15, 8);
const jumper = new QuoteEngine(http, memStore());
for (let i = 0; i < SKIPS; i++) jumper.nextIdea(d1015);
for (const fam of ["small", "medium", "large"]) {
  const q = await jumper.quoteFor(d1015, fam);
  const want = table.find((r) => r.day === "2026-10-15" && r.fam === fam && r.skip === SKIPS);
  check(q.issue.id === want.id && q.ideaNumber === want.idea, `skip ${SKIPS} straight away (${fam}) differs from step by step`);
}
// Back and forth: "Previous idea" returns to the earlier picks, "Another idea" then repeats them.
const rowFor = (fam, skip) => table.find((r) => r.day === "2026-10-15" && r.fam === fam && r.skip === skip);
const sameAs = (q, r) => q.issue.id === r.id && q.ideaNumber === r.idea && q.text === r.text;
const walker = new QuoteEngine(http, memStore());
for (let i = 0; i < SKIPS; i++) walker.nextIdea(d1015);
const steps = [["previous", 2], ["previous", 1], ["next", 2], ["previous", 1], ["previous", 0], ["previous", 0], ["next", 1]];
for (const [dir, want] of steps) {
  const got = dir === "next" ? walker.nextIdea(d1015) : walker.previousIdea(d1015);
  check(got === want, `${dir}: skip ${got}, expected ${want}`);
  for (const fam of ["small", "large"]) {
    check(sameAs(await walker.quoteFor(d1015, fam), rowFor(fam, want)), `${dir} to skip ${want} (${fam}) shows another idea`);
  }
}
walker.previousIdea(d1015);
check(!("2026-10-15" in walker.cache.skips), "skip 0 should not be stored");
// Skips persist across launches, and the day after starts at skip 0.
const skipStore = memStore();
const e1 = new QuoteEngine(http, skipStore);
e1.nextIdea(d1015);
e1.nextIdea(d1015);
const e1q = await e1.quoteFor(d1015, "medium");
const e2 = new QuoteEngine(http, skipStore);
check(e2.skipCount("2026-10-15") === 2, "skip count was not saved");
check(JSON.stringify(await e2.quoteFor(d1015, "medium")) === JSON.stringify(e1q), "reloaded engine shows another pick");
const next = await e2.quoteFor(new Date(2026, 9, 16, 8), "medium");
check(JSON.stringify(next) === plainPicks.get("2026-10-16|medium"), "the day after a shuffle did not start fresh");
// Only the last 14 days of skips are kept.
const many = new QuoteEngine(http, memStore());
for (let i = 0; i < 20; i++) many.nextIdea(new Date(2026, 9, 1 + i, 8));
check(Object.keys(many.cache.skips).length === 14 && many.skipCount("2026-10-20") === 1 && many.skipCount("2026-10-06") === 0, "skips are not trimmed to 14 days");
// Old caches without skips still load and are kept.
const oldStore = memStore();
await new QuoteEngine(http, oldStore).quoteFor(d1015, "medium");
const oldData = oldStore.load();
delete oldData.skips;
oldStore.save(oldData);
const fromOld = new QuoteEngine(fixtureHTTP(items, { failAll: true }), oldStore);
check(!(await fromOld.quoteFor(d1015, "medium")).offline, "an older cache without skips was discarded");
fromOld.nextIdea(d1015);
check(fromOld.skipCount("2026-10-15") === 1, "nextIdea failed on an older cache");
// Offline: "Another idea" moves on to another cached idea too.
const offStore = memStore();
const offWarm = new QuoteEngine(http, offStore);
for (let i = 0; i < 10; i++) await offWarm.quoteFor(new Date(2026, 9, 1 + i, 8), "large");
const offline = new QuoteEngine(fixtureHTTP(items, { failAll: true }), offStore);
const off0 = await offline.quoteFor(new Date(2026, 10, 30, 8), "large");
offline.nextIdea(new Date(2026, 10, 30, 8));
const off1 = await offline.quoteFor(new Date(2026, 10, 30, 8), "large");
check(off0.offline && off1.offline && `${off0.issue.id}#${off0.ideaNumber}` !== `${off1.issue.id}#${off1.ideaNumber}`, "offline \"Another idea\" showed the same idea");

// 8) Archive backup: offline, the same rules run against the backup. With a backup of the archive as
//    the site has it (frozen at FREEZE_AT), every pick equals the online one, only marked offline.
const ascItems = [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const archivePosts = ascItems.slice(0, li + 1);
const deadSite = fixtureHTTP(items, { failAll: true });
const archStore = memStore();
const arch = new QuoteEngine(deadSite, archStore, { archive: () => archivePosts });
let archived = 0;
for (let i = 0; i < 30; i++) {
  const d = new Date(2026, 9, 1 + i, 12);
  for (let skip = 0; skip <= 2; skip++) {
    if (skip > 0) arch.nextIdea(d);
    for (const fam of families) {
      const q = await arch.quoteFor(d, fam);
      const want = table.find((r) => r.day === dayKey(d) && r.fam === fam && r.skip === skip);
      check(q.offline && q.issue.id === want.id && q.ideaNumber === want.idea && q.isNew === want.isNew && q.text === want.text,
        `${dayKey(d)} ${fam} skip ${skip}: archive pick differs from the online one`);
      archived++;
    }
  }
}
check(Object.keys(arch.cache.picks).length === 0, "archive picks should not be cached");
const back = new QuoteEngine(http, archStore);
const backQ = await back.quoteFor(new Date(2026, 9, 25, 12), "medium"); // two swaps that day, kept in the store (last 14 days)
const backWant = table.find((r) => r.day === "2026-10-25" && r.fam === "medium" && r.skip === 2);
check(!backQ.offline && backQ.issue.id === backWant.id && backQ.ideaNumber === backWant.idea, "the online pick did not replace the archive pick");
// The archive is preferred to the few issues in the cache, and a broken archive is ignored.
const warmStore = memStore();
await new QuoteEngine(http, warmStore).quoteFor(new Date(2026, 9, 1, 8), "large");
const viaArchive = await new QuoteEngine(deadSite, warmStore, { archive: () => archivePosts }).quoteFor(new Date(2026, 9, 20, 8), "large");
const wantArchive = table.find((r) => r.day === "2026-10-20" && r.fam === "large" && r.skip === 0);
check(viaArchive.offline && viaArchive.issue.id === wantArchive.id, "the archive was not preferred to the cache");
for (const [name, loader] of [["empty", () => []], ["garbage", () => [{}, { id: "x" }]], ["throws", () => { throw new Error("x"); }], ["not a list", () => ({})]]) {
  let threwBad = false;
  try { await new QuoteEngine(deadSite, memStore(), { archive: loader }).quoteFor(new Date(2026, 9, 20), "medium"); } catch (e) { threwBad = /Could not reach/.test(e.message); }
  check(threwBad, `a ${name} archive was not ignored`);
}
console.log(`archive fallback: ${archived} offline picks match the online ones`);

// 9) The backup grows on each device: posts published after it are added, the newest with the daily
//    request and missed ones by position (at most 5 a day). Backup plus additions then match the site.
const siteAt = (idx) => fixtureHTTP(items, { latestIndex: idx });
const idsOf = (list) => list.map((p) => p.id).join(",");
const ascIds = (from, to) => idsOf(ascItems.slice(from, to + 1));
async function day(eng, key, http) {
  eng.http = countingHTTP(http);
  await eng.refreshMeta(key);
  eng.save(); // as quoteFor does
  return eng.http.calls - 1; // requests beyond the daily one for the newest post
}
// Weekly growth: each new post comes with the daily request, so no extra requests.
const weekly = new QuoteEngine(siteAt(li), memStore(), { archive: () => ascItems.slice(0, li - 1) });
check(await day(weekly, "2026-10-01", siteAt(li - 1)) === 0 && idsOf(weekly.cache.additions) === ascIds(li - 1, li - 1), "weekly: first new post not added");
check(await day(weekly, "2026-10-02", siteAt(li - 1)) === 0 && idsOf(weekly.cache.additions) === ascIds(li - 1, li - 1), "weekly: no new post, but additions changed");
check(await day(weekly, "2026-10-03", siteAt(li)) === 0 && idsOf(weekly.cache.additions) === ascIds(li - 1, li), "weekly: second new post not added");
// A device that missed 12 posts catches up 5 a day, oldest first.
const missStore = memStore();
const missed = new QuoteEngine(siteAt(li), missStore, { archive: () => ascItems.slice(0, li - 11) });
const catchUp = [];
for (const key of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]) catchUp.push(await day(missed, key, siteAt(li)));
check(catchUp.join(",") === "5,5,1,0" && idsOf(missed.cache.additions) === ascIds(li - 11, li), `missed posts: requests ${catchUp}, additions ${missed.cache.additions.length}`);
// Backup plus additions then gives the same picks as the site.
const grown = new QuoteEngine(deadSite, missStore, { archive: () => ascItems.slice(0, li - 11) });
for (let i = 0; i < 10; i++) {
  const d = new Date(2026, 9, 20 + i, 12);
  for (const fam of ["small", "medium", "large"]) {
    const q = await grown.quoteFor(d, fam);
    const want = table.find((r) => r.day === dayKey(d) && r.fam === fam && r.skip === 0);
    check(q.offline && q.issue.id === want.id && q.ideaNumber === want.idea, `${dayKey(d)} ${fam}: backup plus additions differs from the site`);
  }
}
// A newer backup takes over: additions it holds are dropped, so nothing is doubled.
const newer = new QuoteEngine(siteAt(li), missStore, { archive: () => ascItems.slice(0, li - 2) });
check(await day(newer, "2026-10-05", siteAt(li)) === 0 && idsOf(newer.cache.additions) === ascIds(li - 2, li), "a newer backup did not replace the additions");
const full = new QuoteEngine(siteAt(li), missStore, { archive: () => archivePosts });
check(await day(full, "2026-10-06", siteAt(li)) === 0 && full.cache.additions.length === 0, "a complete backup should leave no additions");
// No backup, a broken backup, a site with fewer posts, and failures along the way change nothing.
for (const [name, loader] of [["no", undefined], ["broken", () => [{ id: "x" }]]]) {
  const eng = new QuoteEngine(siteAt(li), memStore(), loader ? { archive: loader } : {});
  check(await day(eng, "2026-10-01", siteAt(li)) === 0 && eng.cache.additions.length === 0, `${name} backup: additions or extra requests`);
}
const shrunk = new QuoteEngine(siteAt(li), memStore(), { archive: () => ascItems.slice(0, li - 1) });
check(await day(shrunk, "2026-10-01", siteAt(li - 5)) === 0 && shrunk.cache.additions.length === 0, "a site with fewer posts than the backup changed the additions");
const flakyBase = siteAt(li);
let offsetCalls = 0;
const flaky = async (url) => (/offset=/.test(url) && ++offsetCalls > 2 ? { status: 503, headers: {}, body: "" } : flakyBase(url));
const interrupted = new QuoteEngine(siteAt(li), memStore(), { archive: () => ascItems.slice(0, li - 11) });
await day(interrupted, "2026-10-01", flaky);
check(idsOf(interrupted.cache.additions) === ascIds(li - 11, li - 10) && interrupted.cache.meta.fetchedDay === "2026-10-01", "a failure while catching up lost additions or the day's newest post");
console.log(`backup additions: missed posts caught up in ${catchUp.length - 1} days (${catchUp.slice(0, 3).join("+")} requests)`);

if (failures.length) {
  console.log(`ENGINE FAILURES (${failures.length}):\n  ` + failures.slice(0, 20).join("\n  "));
  process.exit(1);
}
console.log(`engine checks passed (wrote ${table.length} picks, skips 0-${SKIPS}, for the Swift cross-check)`);
