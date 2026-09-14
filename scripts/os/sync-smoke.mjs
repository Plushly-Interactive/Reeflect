// Cloud-sync smoke: two real Chromium profiles sync through a local Worker, driven through the
// actual sync page UI for setup and the service worker for rows and ticks.
//   node scripts/os/sync-smoke.mjs            needs the sync server running locally on 127.0.0.1:8787
// Proves: the WASM core loads under the MV3 CSP, the setup UI works (phrase + 3-word confirmation),
// the Dexie v2 log feeds the engine, rows travel A → server → B, deletes propagate, sign-out is real.
import path from "node:path";
import os from "node:os";
import { rmSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const ext = path.resolve(import.meta.dirname, "..", "..", "dist", "extension");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${label} ${extra}`); };

const up = await fetch(BASE).then((r) => r.status === 404).catch(() => false);
if (!up) { console.log(`skipped: no sync server on ${BASE}`); process.exit(0); }

const pw = await import("playwright");
async function launch(name) {
  const profile = path.join(os.tmpdir(), `agent-os-ext-profile-reeflect-smoke-${name}`);
  rmSync(profile, { recursive: true, force: true });
  const ctx = await pw.chromium.launchPersistentContext(profile, {
    headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-first-run", "--no-default-browser-check", "--window-size=900,700"],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const errors = [];
  sw.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`sw ${m.type()}: ${m.text()}`); });
  // Wait for the seam rather than sleeping a fixed time, then read the base URL back. The default
  // is production, so a storage write that has not landed sends the whole run at the live server.
  await sw.evaluate(() => new Promise(function poll(r) {
    return globalThis.reeflectSync ? r() : setTimeout(() => poll(r), 50);
  }));
  await sw.evaluate((base) => chrome.storage.local.set({ _syncBaseUrl: base, _debug: true }), BASE);
  const seen = await sw.evaluate(async () => (await chrome.storage.local.get('_syncBaseUrl'))._syncBaseUrl);
  if (seen !== BASE) throw new Error(`base url did not stick: wanted ${BASE}, got ${seen}`);
  const id = new URL(sw.url()).host;
  const call = (fn, ...args) => sw.evaluate(([fn, args]) => globalThis.reeflectSync[fn](...args).then((v) => ({ ok: v }), (e) => ({ err: String(e?.message ?? e) })), [fn, args]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`page ${m.type()}: ${m.text()}`); });
  const openSync = async () => {
    await page.goto(`chrome-extension://${id}/src/pages/sync/sync.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#card-off")?.style.display !== undefined);
  };
  return { ctx, sw, page, call, errors, openSync };
}
const visible = (page, sel) => page.$eval(sel, (el) => el.style.display !== "none");
// The "on" card now appears as soon as the sync starts, so it shows live upload progress instead
// of a frozen page. Completion is aria-busy clearing, not the card becoming visible.
const syncedOn = (page, timeout = 60000) => page.waitForFunction(
  () => document.querySelector("#card-on")?.style.display === ""
    && !document.querySelector("#sync-main")?.hasAttribute("aria-busy"),
  null, { timeout });
const row = (domain, from) => ({ domain, path: "/", kind: "active", from, to: from + 60_000 });
const t0 = Date.now() - 3 * 3_600_000;

// ---------- device A: start syncing through the UI ----------

const a = await launch("a");
await a.call("appendIntervals", [row("a1.example", t0), row("a2.example", t0 + 120_000), row("doomed.example", t0 + 240_000)]);
await a.openSync();
check("sync page opens in the off state", await visible(a.page, "#card-off"));
await a.page.click("#start-btn");
// The phrase is generated locally and normally appears in well under a second. When it does not,
// the reason is on screen or in the console, so say what it was instead of a bare timeout.
try {
  await a.page.waitForSelector("#phrase-words li", { timeout: 30000 });
} catch (e) {
  const note = await a.page.$eval("#notification", (el) => `${el.hidden ? "(hidden)" : "(shown)"} ${el.textContent}`).catch(() => "none");
  const card = await a.page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll("section.card")].map((el) => [el.id, el.style.display || "(unset)"])));
  const errors = a.errors.join(" ~ ") || "none";
  if (errors.includes("429")) {
    // One run spends about 8 of the 10 auth requests the Worker allows per minute per IP, and the
    // local simulator does enforce that binding. Two runs inside a minute exhaust it.
    console.log("");
    console.log("STOPPED: the auth rate limit is exhausted. Wait 60 seconds and run it again.");
    process.exit(2);
  }
  console.log(`DIAGNOSTIC notification=${note}`);
  console.log(`DIAGNOSTIC cards=${JSON.stringify(card)}`);
  console.log(`DIAGNOSTIC errors=${errors}`);
  throw e;
}
const words = await a.page.$$eval("#phrase-words li", (els) => els.map((e) => e.textContent));
check("start syncing shows 24 words (WASM ran in the page)", words.length === 24, words.slice(0, 3).join(" ") + " …");

await a.page.click("#phrase-next");
check("confirmation asks for 3 words", (await a.page.$$("#confirm-fields input")).length === 3);
// a wrong answer must be refused
const fieldIds = await a.page.$$eval("#confirm-fields input", (els) => els.map((e) => e.id));
await a.page.fill(`#${fieldIds[0]}`, "definitelywrong");
await a.page.click("#confirm-submit");
check("a wrong word is refused", await a.page.$eval("#confirm-error", (el) => !el.hasAttribute("hidden")) && await visible(a.page, "#card-confirm"));
for (const id of fieldIds) {
  const index = Number(id.replace("confirm-word-", ""));
  await a.page.fill(`#${id}`, words[index]);
}
await a.page.click("#confirm-submit");
await syncedOn(a.page);
check("correct words switch the page to the on state", await visible(a.page, "#card-on"));
check("A's rows pushed on the first sync", (await a.page.textContent("#sync-status")).includes("Sent 3"), await a.page.textContent("#sync-status"));

const phrase = words.join(" ");
await a.page.waitForSelector(".device-row", { timeout: 30000 });
const devicesA = await a.page.$$eval(".device-row", (els) => els.length);
check("device list shows this device", devicesA === 1);

// ---------- device B: link through the UI ----------

const b = await launch("b");
await b.call("appendIntervals", [row("b1.example", t0 + 360_000)]);
await b.openSync();
await b.page.click("#link-open-btn");
await b.page.fill("#link-input", "not a real phrase at all");
await b.page.click("#link-submit");
check("a phrase that is not 24 words is refused", await b.page.$eval("#link-error", (el) => !el.hasAttribute("hidden")));
await b.page.fill("#link-input", phrase);
await b.page.click("#link-submit");
await syncedOn(b.page);
check("B links with the phrase and syncs", (await b.page.textContent("#sync-status")).includes("received 3"), await b.page.textContent("#sync-status"));
check("B's log holds all 4 rows", (await b.call("count")).ok === 4);
await b.page.waitForSelector(".device-row:nth-child(2)");
check("B sees both devices", (await b.page.$$eval(".device-row", (els) => els.length)) === 2);

// ---------- rename, delete propagation, sign-out ----------

const rows = await b.page.$$(".device-row");
const meRow = (await b.page.$$eval(".device-row", (els) => els.findIndex((e) => e.textContent.includes("This device")))) + 1;
await b.page.click(`.device-row:nth-child(${meRow}) .device-actions button:first-child`);
await b.page.fill(".device-name-input", "Work laptop");
await b.page.click(`.device-row:nth-child(${meRow}) .device-actions button:first-child`);
await b.page.waitForFunction(() => document.body.textContent.includes("Work laptop"));
check("renaming a device sticks", (await b.page.textContent("#devices-list")).includes("Work laptop"), `${rows.length} rows`);
await a.openSync();
await a.page.waitForSelector(".device-row");
check("A sees the name B set (decrypted with the shared key)", (await a.page.textContent("#devices-list")).includes("Work laptop"));

check("B deletes A's row locally", (await b.call("deleteByDomain", "doomed.example")).ok === 1);
check("B pushes the delete", (await b.call("runSync")).ok?.lastReport?.pushed === 1);
await a.call("resetReconcileGate");
const runA2 = (await a.call("runSync")).ok;
check("A pulls B's row and reconciles the delete away", runA2?.lastReport?.pulled === 1 && runA2?.lastReport?.deletedLocal === 1, JSON.stringify(runA2));
check("both logs hold the same 3 rows", (await a.call("count")).ok === 3 && (await b.call("count")).ok === 3);

// ---------- merge: A's history moves under B; A is signed out, re-links, and gets it back as B's ----------
await b.openSync();
await b.page.waitForSelector(".device-row:nth-child(2)");
const aRowB = (await b.page.$$eval(".device-row", (els) => els.findIndex((e) => !e.textContent.includes("This device")))) + 1;
await b.page.click(`.device-row:nth-child(${aRowB}) .device-actions button:nth-child(3)`);
await b.page.click("#confirm-dialog-ok");
await b.page.waitForFunction(() => document.querySelectorAll(".device-row").length === 1, null, { timeout: 30000 });
check("after the merge B's list holds only itself", true);
check("B holds the 3 rows, all its own now", (await b.call("count")).ok === 3 && (await b.call("ownCount")).ok === 3, `own ${(await b.call("ownCount")).ok}`);
check("B's next tick pushes nothing again", (await b.call("runSync")).ok?.lastReport?.pushed === 0);
check("A's tick reports the sign-out", (await a.call("runSync")).ok?.lastError === "NeedsReauth");
check("A kept its rows", (await a.call("count")).ok === 3);
await a.openSync();
check("A's page shows the signed-out state after the merge", await visible(a.page, "#card-signed-out"));
await a.page.click("#relink-btn");
await a.page.fill("#link-input", phrase);
await a.page.click("#link-submit");
await syncedOn(a.page);
await a.call("resetReconcileGate");
const relinked = (await a.call("runSync")).ok;
// Known caveat: linking re-pushes every own row, so a merged-away install that links again brings
// its history back twice (its 2 own rows next to B's 2 moved copies). The merged device is meant
// to stay retired.
check("a merged-away install that re-links duplicates its own rows (documented)", (await a.call("count")).ok === 5 && (await a.call("ownCount")).ok === 2, `count ${(await a.call("count")).ok} own ${(await a.call("ownCount")).ok} ${JSON.stringify(relinked?.lastReport)}`);

// A signs B out; B must fall back to the signed-out state and keep its rows.
await a.openSync();
await a.page.waitForSelector(".device-row");
const bRow = (await a.page.$$eval(".device-row", (els) => els.findIndex((e) => !e.textContent.includes("This device")))) + 1;
await a.page.click(`.device-row:nth-child(${bRow}) .device-actions button:nth-child(2)`);
await a.page.click("#confirm-dialog-ok");
await a.page.waitForFunction(() => document.getElementById("devices-list").textContent.includes("Signed out"), null, { timeout: 15000 });
check("A's registry shows B signed out", (await a.page.textContent("#devices-list")).includes("Signed out"));
check("B's tick reports the sign-out", (await b.call("runSync")).ok?.lastError === "NeedsReauth");
await b.openSync();
check("B's page shows the signed-out state", await visible(b.page, "#card-signed-out"));
check("B kept its rows after the sign-out", (await b.call("count")).ok === 3);

// A signed-out device whose old account is gone can only recover by starting a new one, so that
// path must be reachable from the signed-out card, not just from a never-synced device.
await b.page.click("#restart-btn");
await b.page.waitForSelector("#phrase-words li", { timeout: 30000 });
const newWords = await b.page.$$eval("#phrase-words li", (els) => els.map((e) => e.textContent));
check("signed-out device can start a fresh account", newWords.length === 24);
await b.page.click("#phrase-next");
for (const el of await b.page.$$("#confirm-fields input")) {
  const idx = Number((await el.getAttribute("id")).replace("confirm-word-", ""));
  await el.fill(newWords[idx]);
}
await b.page.click("#confirm-submit");
await syncedOn(b.page);
// Only B's own rows upload: the three it owns since the merge. Rows mirrored from another device
// would belong to the old account and stay local, which is what the design asks for.
check("its own rows upload to the new account", (await b.page.textContent("#sync-status")).includes("Sent 3"), await b.page.textContent("#sync-status"));
check("the rows are still on the device", (await b.call("count")).ok === 3);

// ---------- the progress bar on another page while the background uploads ----------
// The page only asks; the background runs. 6000 rows = 12 batches, long enough to be seen.
await b.call("appendIntervals", Array.from({ length: 6000 }, (_, i) => row(`bulk${i}.example`, t0 - 100_000_000 + i * 1000)));
await b.page.goto(`chrome-extension://${new URL(b.sw.url()).host}/src/pages/dashboard/dashboard.html`, { waitUntil: "domcontentloaded" });
await b.sw.evaluate(() => { globalThis.reeflectSync.runSync(); });
const stripText = await b.page.waitForFunction(() => {
  const el = document.querySelector("#sync-subheader");
  return el && !el.hidden && el.textContent.includes("Uploading") ? el.textContent : false;
}, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
check("the dashboard shows the upload bar while the background syncs", stripText !== null, stripText ?? "never visible");
await b.page.waitForFunction(() => document.querySelector("#sync-subheader")?.hidden === true, null, { timeout: 120000 });
check("the bar goes away when the run ends", (await b.call("syncStatus")).ok?.running === undefined);

// ---------- alarm and errors ----------

const alarm = await a.sw.evaluate(async () => (await chrome.alarms.get("sync"))?.periodInMinutes ?? null);
check("sync alarm is scheduled", alarm !== null, `period ${alarm} min`);
check("no page or service-worker errors or warnings", a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].join(" | ").slice(0, 300));

await a.ctx.close();
await b.ctx.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
