// iPhone: a tap on the widget opens the in-app menu for that widget size, and
// "Another idea" there moves the widget on to the next pick for the day.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadScript, loadFixtureItems, fixtureHTTP, frozenIndex } from "./harness.mjs";

const items = loadFixtureItems();
const http = fixtureHTTP(items, { latestIndex: frozenIndex(items) });
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "jc-menu-"));
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const bodyText = (w) => w.items[2].text; // quote mark, spacer, idea, spacer, footer

async function runWidget(family) {
  const { mod, state } = await loadScript({ httpImpl: http, cacheDir, config: { runsInWidget: true, widgetFamily: family } });
  await mod.main();
  return state.widget;
}

async function runMenu(family, alertChoices) {
  const { mod, state } = await loadScript({ httpImpl: http, cacheDir, alertChoices, args: { queryParameters: { family } } });
  await mod.main();
  return { mod, state };
}

// 1) The widget's tap runs this script with its size.
const before = await runWidget("small");
check(before.url === "scriptable:///run/James%20Clear%203-2-1?family=small", `widget tap URL: ${before.url}`);

// 2) The menu shows the tapped widget's idea; "Another idea" twice shows two new ones,
//    "Previous idea" goes back one; then "Done".
const { mod, state } = await runMenu("small", ["Another idea", "Another idea", "Previous idea", -1]);
const shown = state.alerts.map((a) => a.message.split("\n\nThe widget")[0]);
check(state.alerts.length === 4, `expected 4 menus, got ${state.alerts.length}`);
check(state.alerts[0].actions[0] === "Another idea" && state.alerts[0].actions.includes("Open this issue"), "menu actions are missing");
check(!state.alerts[0].actions.includes("Previous idea") && state.alerts[1].actions[1] === "Previous idea", "\"Previous idea\" should show only after a swap");
check(shown[0] === bodyText(before), "the menu did not open on the widget's idea");
check(new Set(shown.slice(0, 3)).size === 3, "\"Another idea\" did not show a new idea each time");
check(shown[3] === shown[1], "\"Previous idea\" did not go back to the idea before");
check(!/next refresh/.test(state.alerts[0].message) && /next refresh/.test(state.alerts[1].message), "the next-refresh hint is wrong");
check(shown.every((t) => t.length <= mod.CONFIG.maxChars.small), "menu ideas are not small-widget sized");

// 3) The widget then shows the idea picked last in the menu.
const after = await runWidget("small");
check(bodyText(after) === shown[3], "the widget did not pick up the idea chosen in the menu");

// 4) Going back to the daily idea hides "Previous idea" again.
const back = await runMenu("small", ["Previous idea", -1]);
check(back.state.alerts[1].message === shown[0] && !back.state.alerts[1].actions.includes("Previous idea"), "back to the daily idea failed");

// 5) "Open this issue" opens the issue of the idea on screen; unknown sizes fall back to medium.
const open = await runMenu("small", ["Open this issue"]);
check(open.state.opened.length === 1 && /\/3-2-1\/[a-z]+-\d{1,2}-\d{4}$/.test(open.state.opened[0]), "\"Open this issue\" did not open the issue");
const odd = await runMenu("constructor", [-1]);
check(odd.state.alerts[0].message.length <= mod.CONFIG.maxChars.medium, "an unknown size did not fall back to medium");

// 6) Archive backup in iCloud Drive > Scriptable: with the site down and no cache, the widget still
//    shows an idea (and retries soon); if iCloud hasn't downloaded the file yet, it asks for it.
const posts = items.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, frozenIndex(items) + 1);
const icloudDir = fs.mkdtempSync(path.join(os.tmpdir(), "jc-icloud-"));
fs.writeFileSync(path.join(icloudDir, mod.ARCHIVE_FILE), JSON.stringify(posts));
const dead = async () => { throw new Error("offline"); };
async function deadWidget(icloud) {
  const run = await loadScript({ httpImpl: dead, cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), "jc-dead-")), icloud,
    config: { runsInWidget: true, widgetFamily: "medium" } });
  await run.mod.main();
  return run.state.widget;
}
const rescued = await deadWidget({ dir: icloudDir });
check(!/Couldn't reach/.test(bodyText(rescued)) && rescued.refreshAfterDate - Date.now() <= 31 * 60000, "the iCloud archive did not rescue an offline widget");
const pending = { dir: icloudDir, downloaded: false };
const waiting = await deadWidget(pending);
check(/Couldn't reach/.test(bodyText(waiting)) && pending.downloads.length === 1, "an archive still in iCloud should be downloaded for next time");
check(/Couldn't reach/.test(bodyText(await deadWidget({}))), "without iCloud the widget should report it is offline");

// 7) Online, the widget keeps the posts published after the iCloud backup in its own cache.
const olderDir = fs.mkdtempSync(path.join(os.tmpdir(), "jc-icloud-old-"));
fs.writeFileSync(path.join(olderDir, mod.ARCHIVE_FILE), JSON.stringify(posts.slice(0, -1)));
const liveCache = fs.mkdtempSync(path.join(os.tmpdir(), "jc-live-"));
const live = await loadScript({ httpImpl: http, cacheDir: liveCache, icloud: { dir: olderDir }, config: { runsInWidget: true, widgetFamily: "small" } });
await live.mod.main();
const saved = JSON.parse(fs.readFileSync(path.join(liveCache, "jamesclear-321", "cache.json"), "utf8"));
check(saved.additions.length === 1 && saved.additions[0].id === posts.at(-1).id, "the newest post was not added to the iPhone's backup");

if (failures.length) {
  console.log(`MENU FAILURES (${failures.length}):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("menu checks passed");
