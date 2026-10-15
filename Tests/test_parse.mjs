// Parse every archived issue and report structure statistics (no quote text printed).
// Writes out/js_parse.json, which the Swift test compares against.
import fs from "node:fs";
import path from "node:path";
import { loadScript, loadFixtureItems, OUT_DIR } from "./harness.mjs";

const items = loadFixtureItems();
const { mod } = await loadScript({ httpImpl: async () => { throw new Error("no network in parse test"); } });

const counts = {};
const lengths = [];
const out = [];
const anomalies = [];
for (const item of items) {
  const issue = mod.parseIssue(item);
  out.push(issue);
  const real = /\/3-2-1\/[a-z]+-[0-9]{1,2}-[0-9]{4}\/?$/.test(item.link);
  if (!real) continue;
  const n = issue.ideas.length;
  counts[n] = (counts[n] || 0) + 1;
  if (n !== 3) anomalies.push(`${issue.date} ${issue.link.split("/").pop()} -> ${n} ideas`);
  for (const t of issue.ideas) {
    lengths.push(t.length);
    if (/share this on/i.test(t)) anomalies.push(`${issue.date}: share text leaked`);
    if (/[<>]/.test(t)) anomalies.push(`${issue.date}: angle bracket in idea`);
    if (/&[#a-z0-9]+;/i.test(t)) anomalies.push(`${issue.date}: undecoded entity`);
    if (/[​]/.test(t)) anomalies.push(`${issue.date}: invisible char leaked`);
    if (/^(I|II|III)\./.test(t)) anomalies.push(`${issue.date}: numeral leaked`);
    if (/(QUOTES FROM OTHERS|QUESTION FOR YOU)/.test(t)) anomalies.push(`${issue.date}: next section leaked`);
  }
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "js_parse.json"), JSON.stringify(out));

lengths.sort((a, b) => a - b);
const within = (m) => (100 * lengths.filter((l) => l <= m).length / lengths.length).toFixed(1);
console.log("issues by idea count:", counts, "| total ideas:", lengths.length);
console.log("share of ideas that fit: small " + within(110) + "%, medium " + within(260) + "%, large " + within(560) + "%");
if (anomalies.length) {
  console.log("PARSE ANOMALIES:\n  " + anomalies.join("\n  "));
  process.exit(1);
}
console.log("parse checks passed");
