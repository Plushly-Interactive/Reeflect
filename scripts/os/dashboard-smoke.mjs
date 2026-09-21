// The reading views through the core: one real Chromium profile with rows from two devices, the
// dashboard's picker filters them, the timeline shows the picker too, and the build time is measured.
//   node scripts/os/dashboard-smoke.mjs      no server needed
import path from "node:path";
import os from "node:os";
import { rmSync, mkdirSync } from "node:fs";

const ext = path.resolve(import.meta.dirname, "..", "..", "dist", "extension");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${label} ${extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIN = 60_000;
const now = Date.now();
const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
const base = Math.max(dayStart.getTime() + MIN, now - 180 * MIN);
if (base + 60 * MIN > now) { console.log("skipped: less than 61 minutes into the local day, nothing to seed"); process.exit(0); }

const pw = await import("playwright");
const profile = path.join(os.tmpdir(), "agent-os-ext-profile-reeflect-dashboard");
rmSync(profile, { recursive: true, force: true });
const ctx = await pw.chromium.launchPersistentContext(profile, {
  headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-first-run", "--no-default-browser-check", "--window-size=1200,800"],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
await sw.evaluate(() => new Promise(function poll(r) { return globalThis.reeflectSync ? r() : setTimeout(() => poll(r), 50); }));
const extId = new URL(sw.url()).host;

// This device: 50 min on example.com. Another device (a mirror row): 20 min on other.example.
await sw.evaluate(() => chrome.storage.local.set({ tour: { completed: true, completedAt: new Date().toISOString(), inProgress: null, useMockData: false } }));
await sw.evaluate(({ base, MIN }) => globalThis.reeflectSync.appendIntervals([
  { domain: "example.com", path: "/", kind: "active", from: base, to: base + 50 * MIN },
]), { base, MIN });
mkdirSync(path.join(ext, "shots", "smoke"), { recursive: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`chrome-extension://${extId}/src/pages/dashboard/dashboard.html`, { waitUntil: "load" });
await page.evaluate(async ({ base, MIN }) => {
  const { db } = await import(chrome.runtime.getURL("src/data/intervalLog.js"));
  await db.intervals.bulkAdd([
    { deviceId: "other-device-1234", localId: 1, dirty: 0, mirror: 1, keyEpoch: 1, domain: "other.example", path: "/", kind: "active", from: base, to: base + 20 * MIN },
    { deviceId: "other-device-1234", localId: 2, dirty: 0, mirror: 1, keyEpoch: 1, domain: "example.com", path: "/", kind: "active", from: base + 10 * MIN, to: base + 30 * MIN },
  ]);
  // Rows written behind the adapter's back: drop its saved copy, or the reload paints the old one.
  (await import(chrome.runtime.getURL("src/data/intervalAggregates.js"))).invalidate();
  await chrome.storage.local.set({ _syncDeviceNames: { "other-device-1234": { name: "Laptop with a very long device name that must not wrap", me: false, signedIn: true } } });
}, { base, MIN });
await page.reload({ waitUntil: "load" });
await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

const tableText = async () => (await page.locator("#dashboard-body").innerText()).replace(/\s+/g, " ");
let text = await tableText();
check("all devices: both sites listed", text.includes("example.com") && text.includes("other.example"), text.slice(0, 120));
check("picker shown with two devices", await page.locator("#device-picker").evaluate((el) => el.style.display !== "none"));
const options = await page.locator("#device-menu button").allTextContents();
check("picker lists all + two devices, the other one by its cached name", options.length === 3 && options.some((t) => t.startsWith("Laptop")), JSON.stringify(options));

await page.locator("#device-select").click();
const opt = page.locator("#device-menu button", { hasText: "Laptop" });
check("a long device name stays on one line and is cut with an ellipsis", await opt.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).whiteSpace === "nowrap" && getComputedStyle(el).textOverflow === "ellipsis"));
const sameWidth = () => page.evaluate(() => document.querySelector("#device-menu").offsetWidth === document.querySelector("#device-select").offsetWidth);
check("the menu is exactly as wide as the button (all devices)", await sameWidth());
await page.screenshot({ path: path.join(ext, "shots", "smoke", "dashboard-device-menu.png"), clip: { x: 500, y: 0, width: 400, height: 220 } });
await opt.click();
await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
text = await tableText();
check("Laptop only: other.example stays, example.com shows the other device's 20 min", text.includes("other.example") && /example\.com 20m/.test(text), text.slice(0, 160));
check("picker label names the one device", (await page.locator("#device-select").innerText()).trim().startsWith("Laptop"));
check("a long selected name does not widen the button beyond 240px and is cut with an ellipsis", await page.locator("#device-select").evaluate((el) => el.offsetWidth <= 240 && el.querySelector("#device-label").scrollWidth > el.querySelector("#device-label").clientWidth));
check("the menu is exactly as wide as the button (long name selected)", await sameWidth());
await page.screenshot({ path: path.join(ext, "shots", "smoke", "dashboard-device-label.png"), clip: { x: 500, y: 0, width: 400, height: 220 } });

await page.locator("#device-menu button", { hasText: "Laptop" }).click();
await page.locator("#device-menu button").first().click(); // back to all, then choose this device only
const thisLabel = (await page.locator("#device-menu button").allTextContents()).find((t) => t !== "Laptop" && !/devices|dispositivos|appareils/i.test(t));
await page.locator("#device-menu button", { hasText: thisLabel }).click();
await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
text = await tableText();
check("this device only: other.example gone", !text.includes("other.example") && text.includes("example.com"), text.slice(0, 120));
const shots = path.join(ext, "shots", "smoke");
await page.screenshot({ path: path.join(shots, "dashboard-device-filter.png") });

// build cost in the real browser on a larger log: 30 000 more rows, then one rebuild
const ms = await page.evaluate(async ({ base, MIN }) => {
  const { db } = await import(chrome.runtime.getURL("src/data/intervalLog.js"));
  const rows = [];
  const day = 86_400_000;
  for (let i = 0; i < 30_000; i++) {
    const from = base - 200 * day + Math.floor(i / 150) * day + (i % 150) * 5 * MIN;
    rows.push({ deviceId: i % 2 ? "other-device-1234" : "perf-device", localId: 100 + i, dirty: 0, mirror: 1, keyEpoch: 1, domain: `site${i % 30}.example`, path: `/p/${i % 5}`, kind: i % 7 ? "active" : "audio", from, to: from + 4 * MIN });
  }
  await db.intervals.bulkAdd(rows);
  const agg = await import(chrome.runtime.getURL("src/data/intervalAggregates.js"));
  // The rows went in behind the adapter's back: drop its saved copy so this times a real build.
  agg.invalidate();
  const t0 = performance.now();
  await agg.getSitesByDay();
  return performance.now() - t0;
}, { base, MIN });
const count = await sw.evaluate(() => globalThis.reeflectSync.count());
console.log(`info dashboard rebuild in the browser on ${count} rows (read + core build + parse): ${ms.toFixed(0)} ms`);

// the timeline shows the picker and names devices in its tooltip
const tl = await ctx.newPage();
tl.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
tl.on("pageerror", (e) => errors.push(String(e)));
await tl.goto(`chrome-extension://${extId}/src/pages/browsing-timeline/browsing-timeline.html`, { waitUntil: "load" });
await tl.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
check("timeline: picker shown", await tl.locator("#device-picker").evaluate((el) => el.style.display !== "none"));
const chart = tl.locator("#timeline-chart");
const box = await chart.boundingBox();
if (box) {
  let tip = "";
  for (let f = 0.02; f < 1 && !tip.trim(); f += 0.01) {
    await tl.mouse.move(box.x + box.width * f, box.y + 30);
    await sleep(40);
    if (await tl.locator("#timeline-tooltip").evaluate((el) => el.style.display !== "none")) tip = await tl.locator("#timeline-tooltip").innerText();
  }
  check("timeline tooltip names a device", /Laptop|This device|Este dispositivo|Cet appareil|perf-dev/.test(tip), tip.replace(/\s+/g, " ").slice(0, 160));
} else {
  check("timeline chart rendered", false);
}
await tl.screenshot({ path: path.join(shots, "timeline-device-filter.png") });

// the site page: same picker, its totals follow the selection
const site = await ctx.newPage();
site.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
site.on("pageerror", (e) => errors.push(String(e)));
await site.goto(`chrome-extension://${extId}/src/pages/site/site.html?id=example.com`, { waitUntil: "load" });
await site.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
check("site page: picker shown", await site.locator("#device-picker").evaluate((el) => el.style.display !== "none"));
const statsText = async () => (await site.locator("#stats-list").innerText()).replace(/\s+/g, " ");
const before = await statsText();
await site.locator("#device-select").click();
await site.locator("#device-menu button", { hasText: "Laptop" }).click();
await site.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
const after = await statsText();
check("site page: totals change with the device selection", before !== after && /20m/.test(after), `${before.slice(0, 60)} -> ${after.slice(0, 60)}`);
await site.screenshot({ path: path.join(shots, "site-device-filter.png") });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await ctx.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
