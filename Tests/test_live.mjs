// Optional end-to-end run of the unmodified Scriptable script against the live site
// (about 7 small requests). Run with: ./run_tests.sh --live
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadScript } from "./harness.mjs";

const live = async (url) => {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  return { status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() };
};
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "jc-live-"));
const log = [];
let ok = true;
for (const fam of ["medium", "small", "large", "accessoryRectangular", "accessoryInline", "accessoryCircular"]) {
  const { state } = await loadScript({ httpImpl: live, cacheDir, test: false, log, config: { runsInWidget: true, widgetFamily: fam } });
  const w = state.widget;
  const texts = w ? w.items.filter((x) => x.text !== undefined) : [];
  const good = state.completed && w && texts.length && (fam === "accessoryCircular" || w.url);
  ok = ok && good;
  console.log(`${fam.padEnd(21)} ${good ? "ok" : "FAILED"}  ${w && w.url ? w.url : ""}`);
}
console.log(`HTTP requests: ${log.length}`);
if (!ok) process.exit(1);
console.log("live checks passed");
