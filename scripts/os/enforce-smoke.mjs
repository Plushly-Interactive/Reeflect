// Enforcement through the core: one real Chromium profile with seeded usage, a rule past its limit,
// and the extension's own navigation hook. Proves the service worker loads the core, its verdict
// reaches the DNR publisher, and the badge shows the core's number for today.
//   node scripts/os/enforce-smoke.mjs      no server needed
import path from "node:path";
import os from "node:os";
import { rmSync } from "node:fs";

const ext = path.resolve(import.meta.dirname, "..", "..");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${label} ${extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(300);
  }
}

// Seeded usage must fall on today's local day, or the day window sees none of it.
const now = Date.now();
const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
const MIN = 60_000;
const base = Math.max(dayStart.getTime() + MIN, now - 180 * MIN);
if (base + 71 * MIN > now) { console.log("skipped: less than 72 minutes into the local day, nothing to seed"); process.exit(0); }

const pw = await import("playwright");
const profile = path.join(os.tmpdir(), "agent-os-ext-profile-reeflect-enforce");
rmSync(profile, { recursive: true, force: true });
const ctx = await pw.chromium.launchPersistentContext(profile, {
  headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-first-run", "--no-default-browser-check", "--window-size=900,700"],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const errors = [];
sw.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await sw.evaluate(() => new Promise(function poll(r) { return globalThis.reeflectSync ? r() : setTimeout(() => poll(r), 50); }));

// 70 min on example.com against a 60 min/day rule; 25 min on example.org with no rule, for the badge.
await sw.evaluate(({ base, MIN }) => globalThis.reeflectSync.appendIntervals([
  { domain: "example.com", path: "/", kind: "active", from: base, to: base + 70 * MIN },
  { domain: "example.org", path: "/", kind: "active", from: base, to: base + 25 * MIN },
]), { base, MIN });
await sw.evaluate(() => chrome.storage.local.set({ rules: [
  { id: "smoke-com", matchType: "host", target: "example.com", limit: 60, limitUnit: "minutes", period: "day", enabled: true, mode: "active" },
] }));
check("usage seeded", (await sw.evaluate(() => globalThis.reeflectSync.count())) >= 2);

// A main-frame navigation is the extension's own trigger: drain, ask the core, publish.
const page = await ctx.newPage();
await page.goto("https://example.com/", { waitUntil: "commit", timeout: 20000 }).catch(() => {});
const rules = await until(async () => {
  const r = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  return r.some((x) => JSON.stringify(x).includes("example.com")) ? r : null;
}, 20000);
check("the core's verdict reached the DNR publisher: a redirect rule for example.com exists", rules !== null, rules ? `${rules.length} dynamic rule(s)` : "none within 20 s");
const ours = rules?.find((x) => JSON.stringify(x).includes("example.com"));
check("the redirect names the rule that tripped", ours ? new URL(ours.action.redirect.url).searchParams.get("rule") === "smoke-com" : false, ours?.action?.redirect?.url ?? "");
// A tab already sitting on the site is sent to the blocked page by the extension itself, through the
// core's matcher, no host permission involved. The first check ran before this tab had a URL to
// match, so navigate once more and expect the redirect.
await page.goto("https://example.com/", { waitUntil: "commit", timeout: 20000 }).catch(() => {});
const redirected = await until(async () => (/blocked\.html/.test(page.url()) ? page.url() : null), 15000);
check("the open tab is sent to the blocked page through the core's matcher", redirected !== null, page.url().slice(0, 90));

// The badge reads the core's number for the active tab's site.
const badgePage = await ctx.newPage();
await badgePage.goto("https://example.org/", { waitUntil: "commit", timeout: 20000 }).catch(() => {});
const badge = await until(async () => {
  const t = await sw.evaluate(() => chrome.action.getBadgeText({}));
  return /^\d+m$/.test(t) ? t : null;
}, 15000);
check("badge shows today's usage from the core (25 min seeded, live tracking may add one)", badge !== null && /^2[5-6]m$/.test(badge), badge ?? "no badge within 15 s");

check("no service-worker errors", errors.length === 0, errors.join(" ~ ").slice(0, 300));
await ctx.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
