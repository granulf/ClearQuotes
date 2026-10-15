// Downloads the whole 3-2-1 archive once (100 posts per request, about 4-5 requests)
// into Tests/fixtures/. The other tests run offline against these files.
// Existing files are replaced only after a complete download with at least as many posts,
// so a broken or shrunken site can't wipe the local copy.
import fs from "node:fs";
import path from "node:path";
import { FIXTURES_DIR } from "./harness.mjs";

const BASE = "https://jamesclear.com/wp-json/wp/v2/3-2-1?per_page=100&order=asc&_fields=id,date,link,title,content";
fs.mkdirSync(FIXTURES_DIR, { recursive: true });
const oldFiles = fs.readdirSync(FIXTURES_DIR).filter((f) => /^rest-page-\d+\.json$/.test(f));
const oldCount = oldFiles.reduce((n, f) => n + JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8")).length, 0);
const kept = oldFiles.length ? "; kept the existing fixtures" : "";

const downloaded = [];
let page = 1;
let pages = 1;
let count = 0;
do {
  const r = await fetch(`${BASE}&page=${page}`, { headers: { Accept: "application/json" } });
  if (r.status !== 200) throw new Error(`HTTP ${r.status} on page ${page}${kept}`);
  pages = Number(r.headers.get("x-wp-totalpages") || 1);
  const items = await r.json();
  if (!Array.isArray(items)) throw new Error(`Unexpected response on page ${page}${kept}`);
  count += items.length;
  downloaded.push(items);
  page++;
  await new Promise((res) => setTimeout(res, 1000)); // be polite
} while (page <= pages);
if (count < oldCount) throw new Error(`Only ${count} posts, fewer than the ${oldCount} on disk${kept}`);

for (const f of oldFiles) fs.rmSync(path.join(FIXTURES_DIR, f));
downloaded.forEach((items, i) => fs.writeFileSync(path.join(FIXTURES_DIR, `rest-page-${i + 1}.json`), JSON.stringify(items)));
console.log(`fetched ${count} posts in ${pages} pages into ${FIXTURES_DIR}`);
