// When the server will not take writes yet it answers 503 write_quota_exceeded with a wait. This
// drives a real browser through that answer and checks the three things that matter: the page
// calls it a pause rather than a failure, it never shows the user why the server said no, and the
// device holds off instead of retrying on every alarm.
//   node scripts/os/sync-paused.mjs     needs the sync server running locally on 127.0.0.1:8787
import path from "node:path"; import os from "node:os"; import { rmSync } from "node:fs"; import { pathToFileURL } from "node:url";
const ext = "D:/GitHub/Personal Repositories/reeflect";
const OUT = process.argv[2] ?? null;
const pw = await import(pathToFileURL(path.join(ext, "node_modules/playwright/index.mjs")).href);
let failures = 0;
const check = (l, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${l} ${extra}`); };
const profile = path.join(os.tmpdir(), "reeflect-paused");
rmSync(profile, { recursive: true, force: true });
const ctx = await pw.chromium.launchPersistentContext(profile, { headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-first-run", "--no-default-browser-check"] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
await sw.evaluate(() => new Promise(function poll(r) { return globalThis.reeflectSync ? r() : setTimeout(() => poll(r), 50); }));
await sw.evaluate(() => chrome.storage.local.set({ _syncBaseUrl: "http://127.0.0.1:8787" }));
const id = new URL(sw.url()).host;
const page = await ctx.newPage();
await page.goto(`chrome-extension://${id}/src/pages/sync/sync.html`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("#card-off")?.style.display !== undefined);
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.click("#start-btn");
try {
  await page.waitForSelector("#phrase-words li", { timeout: 30000 });
} catch (e) {
  // One run spends most of the 10 auth requests the Worker allows per minute per IP, and the
  // local simulator does enforce that binding.
  if (errs.join(" ").includes("429")) {
    console.log("STOPPED: the auth rate limit is exhausted. Wait 60 seconds and run it again.");
    process.exit(2);
  }
  console.log(`DIAGNOSTIC errors=${errs.join(" ~ ") || "none"}`);
  throw e;
}
const words = await page.$$eval("#phrase-words li", (e) => e.map((x) => x.textContent));
await page.click("#phrase-next");
for (const el of await page.$$("#confirm-fields input")) {
  const i = Number((await el.getAttribute("id")).replace("confirm-word-", ""));
  await el.fill(words[i]);
}
await page.click("#confirm-submit");
await page.waitForFunction(() => !document.querySelector("#sync-main")?.hasAttribute("aria-busy"), null, { timeout: 60000 });

// Now make every push answer the way the real Worker does when the store will not take writes.
let pushes = 0;
await page.route("**/sync/push", (route) => {
  pushes++;
  route.fulfill({ status: 503, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ error: "write_quota_exceeded", retryAfterSecs: 5400 }) });
});
await sw.evaluate(() => globalThis.reeflectSync.appendIntervals([{ domain: "p.example", path: "/", kind: "active", from: Date.now() - 60000, to: Date.now() - 30000 }]));
await page.click("#sync-now-btn");
await page.waitForFunction(() => !document.querySelector("#sync-main")?.hasAttribute("aria-busy"), null, { timeout: 30000 });
const text = await page.textContent("#sync-status");
check("the page reports a pause, not a failure", /paused until/i.test(text), JSON.stringify(text));
check("it never names the backend reason", !/quota|limit|D1|internal|500|503/i.test(text), JSON.stringify(text));
const st = await sw.evaluate(() => chrome.storage.local.get("syncStatus").then((s) => s.syncStatus));
check("the wait the server named is stored", st.retryAfter - st.lastRunAt === 5400000, `${(st.retryAfter - st.lastRunAt) / 1000}s`);
check("the error is normalised", st.lastError === "Paused", String(st.lastError));
const before = pushes;
const again = await sw.evaluate(() => globalThis.reeflectSync.runSync());
check("a further tick holds off instead of retrying", pushes === before && again.skipped === "paused", `pushes ${pushes}, skipped ${again.skipped}`);
if (OUT) await page.screenshot({ path: `${OUT}/4-paused.png` });

// A push is not the only write. Renaming a device hits the store too, and that path must show the
// same neutral wait rather than the raw code the server sent.
await page.unroute("**/sync/push");
await page.route("**/devices*", (route) => route.fulfill({ status: 503, contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify({ error: "write_quota_exceeded", retryAfterSecs: 5400 }) }));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const t = document.querySelector("#devices-list")?.textContent ?? "";
  return t.length > 0 && !/^Loading/.test(t);
}, null, { timeout: 30000 });
const devText = await page.textContent("#devices-list");
check("a refused device call reads as a pause too", /paused until/i.test(devText), JSON.stringify(devText.slice(0, 90)));
check("and still never names the reason", !/quota|limit|D1|503|Protocol/i.test(devText), JSON.stringify(devText.slice(0, 90)));
await ctx.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
