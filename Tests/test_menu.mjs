// iPhone: a tap on the widget opens the in-app menu for that widget size, and
// "Another idea" there moves the widget on to the next pick for the day.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadScript, loadFixtureItems, fixtureHTTP, frozenIndex, makeFakeDocument } from "./harness.mjs";

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

// 8) Saving the idea as a picture, from the menu: both layouts go to Photos at the screen's
//    resolution, the menu comes back with a notice, and a refused Photos permission is explained.
const pics = await runMenu("large", ["Save as image", "Save as Lock Screen image", -1]);
check(pics.state.alerts[0].actions.includes("Save as image") && pics.state.alerts[0].actions.includes("Save as Lock Screen image"), "the save actions are missing");
check(pics.state.saved.length === 2 && pics.state.saved.every((img) => img.image.base64 === "UE5H"), "the pictures did not reach Photos");
check(pics.state.alerts[1].title === "Saved to Photos" && pics.state.alerts[2].title === "Saved to Photos", "no notice after saving");
check(/^Today's idea/.test(pics.state.alerts[0].title), "the notice should only follow a save");
const bg = pics.state.drawn.find((x) => x.op === "rect");
check(bg && bg.w === 1179 && bg.h === 2556 && bg.color === "#FBF8F3", "the picture is not screen-sized in the light colors");
const chars = (t) => t.replace(/\s+/g, ""); // lines may break after dashes, so compare without spaces
const savedText = pics.state.drawn.filter((x) => x.op === "text" && /^\d+px Georgia/.test(x.font)).map((x) => x.text).join("");
check(chars(savedText) === chars(pics.state.alerts[2].message.split("\n\nThe widget")[0]), "the picture's text differs from the idea");
const dark = await loadScript({ httpImpl: http, cacheDir, alertChoices: ["Save as image", -1], args: { queryParameters: { family: "medium" } }, device: { dark: true, width: 2556, height: 1179 } });
await dark.mod.main();
const darkBg = dark.state.drawn.find((x) => x.op === "rect");
check(darkBg && darkBg.color === "#1C1A17" && darkBg.w === 1179 && darkBg.h === 2556, "dark mode or a sideways screen is not handled");
const refused = await loadScript({ httpImpl: http, cacheDir, alertChoices: ["Save as image", -1], args: { queryParameters: { family: "small" } }, device: { photosFail: true } });
await refused.mod.main();
check(refused.state.alerts[1].title === "Couldn't save the picture" && /Privacy & Security > Photos/.test(refused.state.alerts[1].message), "a refused Photos permission is not explained");

// 9) Every idea in the archive fits both layouts on an iPhone screen: all words drawn, within the
//    side margins, inside its part of the screen, and the centered layout really centered.
const W = 1179, H = 2556;
const colors = { bg: "#FBF8F3", text: "#1F1C18", muted: "#8C8478", accent: "#B4632A" };
const allIdeas = items.map((item) => mod.parseIssue(item)).flatMap((issue) => issue.ideas);
let laidOut = 0;
let smallest = Infinity;
for (const idea of allIdeas.filter((t) => t.length <= mod.CONFIG.maxChars.extraLarge)) {
  for (const name of ["center", "lockscreen"]) {
    const drawn = [];
    globalThis.document = makeFakeDocument(drawn);
    const box = mod.IMAGE_LAYOUTS[name];
    mod.renderIdea(Object.assign({ width: W, height: H, colors, text: idea, footer: "JAMES CLEAR \u00B7 3-2-1 \u00B7 OCT 8, 2026" }, box));
    delete globalThis.document;
    const texts = drawn.filter((x) => x.op === "text");
    const body = texts.filter((x) => /^\d+px Georgia/.test(x.font));
    const size = Number(/^(\d+)px/.exec(body[0].font)[1]);
    smallest = Math.min(smallest, size);
    const mark = texts[0];
    const footer = texts[texts.length - 1];
    const footSize = Number(/(\d+)px/.exec(footer.font)[1]);
    const first = mark.y + size * 0.15;
    const last = footer.y + footSize * 1.2;
    const where = `${name}, ${idea.length} chars: "${idea.slice(0, 40)}..."`;
    check(chars(body.map((x) => x.text).join("")) === chars(idea), `${where}: text lost`);
    check(body.every((x) => x.x === Math.round(W * 0.1) && x.x + x.width <= W - Math.round(W * 0.1) + 0.5), `${where}: text runs into the margin`);
    check(first >= H * box.top - 0.5 && last <= H * box.bottom + 0.5, `${where}: outside its part of the screen (${Math.round(first)}-${Math.round(last)})`);
    if (name === "center") check(Math.abs((first - H * box.top) - (H * box.bottom - last)) < 2, `${where}: not centered`);
    laidOut++;
  }
}
console.log(`pictures: ${laidOut} layouts checked, smallest text ${smallest}px of ${W} (${(smallest / 3).toFixed(1)} pt)`);

if (failures.length) {
  console.log(`MENU FAILURES (${failures.length}):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("menu checks passed");
