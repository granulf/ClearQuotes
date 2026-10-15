// The iPhone widget must retry within 30 minutes when offline or showing a cached fallback,
// and refresh at least hourly otherwise (so an "Another idea" from the app reaches it).
import { loadScript } from "./harness.mjs";

const { mod } = await loadScript({ httpImpl: async () => { throw new Error("x"); } });
const base = { text: "t", ideaNumber: 1, day: "2026-10-15", isNew: false, issue: { id: 1, date: "2026-10-08", link: "https://jamesclear.com/3-2-1/october-8-2026", title: "t" } };
const mins = (w) => Math.round((w.refreshAfterDate - Date.now()) / 60000);
const online = mod.buildWidget({ ...base, offline: false }, "medium");
const offline = mod.buildWidget({ ...base, offline: true }, "medium");
const none = mod.buildWidget(null, "medium");
console.log(`refresh in minutes -> online: ${mins(online)}, offline fallback: ${mins(offline)}, no quote: ${mins(none)}`);
if (!(mins(offline) <= 31 && mins(none) <= 31 && mins(online) > 0 && mins(online) <= 60)) {
  console.log("REFRESH POLICY FAILED");
  process.exit(1);
}
console.log("refresh checks passed");
