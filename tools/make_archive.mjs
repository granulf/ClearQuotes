// Builds Fallback/archive.json, the optional personal archive backup (see Fallback/README.md),
// from a folder of rest-page-*.json files: Tests/fixtures by default, or an unzipped backup's raw/.
// Usage: node tools/make_archive.mjs [folder]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.resolve(process.argv[2] || path.join(root, "Tests", "fixtures"));
const pages = fs.readdirSync(src).filter((f) => /^rest-page-\d+\.json$/.test(f));
if (!pages.length) throw new Error(`No rest-page-*.json files in ${src}`);

const byId = new Map();
for (const f of pages) {
  for (const p of JSON.parse(fs.readFileSync(path.join(src, f), "utf8"))) {
    byId.set(p.id, { id: p.id, date: p.date, link: p.link, title: p.title, content: p.content });
  }
}
const posts = [...byId.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
const out = path.join(root, "Fallback", "archive.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(posts));
console.log(`wrote ${posts.length} posts (${posts[0].date.slice(0, 10)} to ${posts.at(-1).date.slice(0, 10)}) to ${out}`);
