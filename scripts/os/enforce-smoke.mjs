// Enforcement through the core: one real Chromium profile with seeded usage, a rule past its limit,
// and the extension's own navigation hook. Proves the service worker loads the core, its verdict
// reaches the DNR publisher, and the badge shows the core's number for today.
//   node scripts/os/enforce-smoke.mjs      no server needed
import path from "node:path";
import os from "node:os";
import { rmSync } from "node:fs";

const ext = path.resolve(import.meta.dirname, "..", "..", "dist", "extension");
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

// A rule over two sites and one app synced from a phone. Each is under the limit alone (20 + 20 + 25
// min against 60), together they are over, so both sites get their own redirect.
await sw.evaluate(({ base, MIN }) => globalThis.reeflectSync.appendIntervals([
  { domain: "example.net", path: "/", kind: "active", from: base, to: base + 20 * MIN },
  { domain: "example.edu", path: "/", kind: "active", from: base, to: base + 20 * MIN },
]), { base, MIN });
// A pulled row, as the store keeps it: another device's, with its source.
await sw.evaluate(({ base, MIN }) => new Promise((resolve, reject) => {
  const open = indexedDB.open("browsing-intervals");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction("intervals", "readwrite");
    tx.objectStore("intervals").add({ domain: "com.example.game", path: "", kind: "active", from: base, to: base + 25 * MIN, source: "app", deviceId: "smoke-phone", localId: 1, dirty: 0, mirror: 1, keyEpoch: 0 });
    tx.oncomplete = () => { open.result.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
}), { base, MIN });
await sw.evaluate(() => chrome.storage.local.set({ rules: [
  { id: "smoke-mix", matchers: [
    { matchType: "subdomain", target: "example.net" },
    { matchType: "host", target: "example.edu" },
    { source: "app", matchType: "exact", target: "com.example.game", label: "Game" },
  ], limit: 60, limitUnit: "minutes", period: "day", enabled: true, mode: "active" },
] }));
const mixRules = async () => (await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules()))
  .filter((x) => new URL(x.action.redirect.url).searchParams.get("rule") === "smoke-mix");
await page.goto("https://example.net/", { waitUntil: "commit", timeout: 20000 }).catch(() => {});
const mix = await until(async () => { const r = await mixRules(); return r.length >= 2 ? r : null; }, 20000);
const mixHosts = (mix ?? []).map((x) => JSON.stringify(x.condition).replaceAll("\\", "")).join(" ");
check("a rule over two sites and an app redirects both sites once their combined time is over", mix !== null && /example\.net/.test(mixHosts) && /example\.edu/.test(mixHosts), `${mix?.length ?? 0} rule(s)`);
await page.goto("https://example.edu/", { waitUntil: "commit", timeout: 20000 }).catch(() => {});
await sleep(3000);
const ids = (list) => (list ?? []).map((x) => x.id).sort().join(",");
const again = await mixRules();
check("its redirects keep their ids on the next check", mix !== null && ids(again) === ids(mix), `${ids(mix)} then ${ids(again)}`);

// A keyword covers apps too: 25 min of com.example.game alone puts "game" over its 20 min, and the
// browser blocks the web side of the same keyword.
await sw.evaluate(async () => {
  const { rules } = await chrome.storage.local.get("rules");
  await chrome.storage.local.set({ rules: [...rules, { id: "smoke-kw", matchers: [{ matchType: "keyword", keyword: "game" }, { matchType: "keyword", keyword: "game", source: "app" }], limit: 20, limitUnit: "minutes", period: "day", enabled: true, mode: "active" }] });
});
await page.goto("https://example.net/", { waitUntil: "commit", timeout: 20000 }).catch(() => {});
const kwRule = await until(async () => (await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules()))
  .find((x) => new URL(x.action.redirect.url).searchParams.get("rule") === "smoke-kw") ?? null, 20000);
check("a keyword rule goes over on app time alone and blocks the matching sites", kwRule !== null, JSON.stringify(kwRule?.condition ?? null));

// The form: the picker lists the synced app and the visited sites; an app alone makes a rule.
await sw.evaluate(() => chrome.storage.local.set({ tour: { completed: true, completedAt: new Date().toISOString(), inProgress: null, useMockData: false } }));
const form = await ctx.newPage();
await form.goto(`chrome-extension://${new URL(sw.url()).host}/src/pages/rules/rules.html`);
await form.waitForFunction(() => !document.body.classList.contains("is-loading"), null, { timeout: 15000 });
check("the rule list shows every target", (await form.textContent("#rules-list")).includes("*.example.net, example.edu, Game"));
await form.evaluate(() => { chrome.permissions.request = async () => true; });
const storedRules = () => sw.evaluate(() => chrome.storage.local.get("rules").then((r) => r.rules));
const pick = (name) => form.locator("#picker-list label", { hasText: name }).locator("input");
await form.click("#tab-url");
await form.click("#targets-box");
await until(async () => (await pick("com.example.game").count()) > 0 || null, 5000);
check("the picker offers the synced app and a visited site", (await pick("com.example.game").count()) === 1 && (await pick("example.net").count()) === 1);
await pick("com.example.game").check();
await form.fill("#form-limit", "5");
check("one app alone enables Add rule", !(await form.isDisabled("#save-btn")), await form.textContent("#preview-text"));
const n0 = (await storedRules()).length;
await form.click("#save-btn");
const appOnly = await until(async () => { const r = await storedRules(); return r.length > n0 ? r.at(-1) : null; }, 5000);
check("it saves as a one-app rule", appOnly?.source === "app" && appOnly?.target === "com.example.game" && !appOnly?.matchers && !appOnly?.name, JSON.stringify(appOnly));

// Several targets and a name: an app, a visited site, and a site typed into the search.
await form.click("#targets-box");
await pick("com.example.game").check();
await pick("example.edu").check();
await form.fill("#picker-search", "example.org");
await form.press("#picker-search", "Enter");
await form.click("#picker-done");
const chips = await form.$$eval("#targets-list .target-chip > span", (els) => els.map((e) => e.textContent.trim()));
check("the box shows every chosen target", chips.join("|").replaceAll("×", "") === "com.example.game|*.example.edu|*.example.org", chips.join("|"));
// A chip's × removes its target; the scope cards set how a typed site counts.
await form.click("#targets-list .target-chip:has-text('example.org') .chip-remove");
await form.click("#targets-box");
await form.fill("#picker-search", "example.org");
check("a typed site shows the three scope cards", await form.isVisible("#scope-host") && await form.isVisible("#scope-subdomain") && await form.isVisible("#scope-page"));
await form.click("#scope-host");
await form.click("#picker-add-btn");
await form.click("#picker-done");
const chips2 = await form.$$eval("#targets-list .target-chip > span", (els) => els.map((e) => e.textContent.trim()));
check("× removed the site and Host only added it back without subdomains", chips2.join("|") === "com.example.game|*.example.edu|example.org", chips2.join("|"));
// A site ticked in the list gets the cards too: Host only applies at once, Path prefix asks for the path.
await form.click("#targets-box");
await pick("example.com").check();
check("a ticked site shows the scope cards under it", await form.isVisible(".pick-scope #scope-host"));
await form.click(".pick-scope #scope-host");
check("Host only on a ticked site drops its subdomains", (await form.textContent("#targets-list")).includes("example.com") && !(await form.textContent("#targets-list")).includes("*.example.com"));
await form.click(".pick-scope #scope-page");
check("Path prefix on a ticked site moves it to the search for its path", (await form.inputValue("#picker-search")) === "example.com/");
await form.type("#picker-search", "docs");
await form.press("#picker-search", "Enter");
await form.click("#picker-done");
const chips3 = await form.$$eval("#targets-list .target-chip > span", (els) => els.map((e) => e.textContent.trim()));
check("the site now counts only under its path", chips3.join("|") === "com.example.game|*.example.edu|example.org|example.com/docs", chips3.join("|"));
check("the name field suggests the targets as the name", (await form.getAttribute("#rule-name", "placeholder")) === "com.example.game, *.example.edu, example.org, example.com/docs");
await form.fill("#rule-name", "Evenings");
await form.fill("#form-limit", "3");
await form.click("#save-btn");
const named = await until(async () => { const r = await storedRules(); return r.length > n0 + 1 ? r.at(-1) : null; }, 5000);
check("it saves one rule with four matchers and the name", named?.name === "Evenings" && named?.matchers?.length === 4, JSON.stringify(named));
check("the list shows the rule by its name", (await form.textContent("#rules-list")).includes("Evenings"));
// The keyword form saves the keyword for sites and for apps, and the list names it once.
await form.click("#tab-keyword");
await form.fill("#keyword-input", "reddit");
const n1 = (await storedRules()).length;
await form.click("#kw-save-btn");
const kwSaved = await until(async () => { const r = await storedRules(); return r.length > n1 ? r.at(-1) : null; }, 5000);
check("a keyword rule saves for sites and apps", kwSaved?.matchers?.length === 2 && kwSaved.matchers.some((m) => m.source === "app" && m.keyword === "reddit"), JSON.stringify(kwSaved));
const kwRow = await form.textContent(`#rule-${kwSaved?.id} .site-label`).catch(() => "");
check("the list names the keyword once", kwRow === "reddit", kwRow);
// The row editor edits the name; clearing it lets the targets name the rule again.
const ruleById = async (id) => (await storedRules()).find((r) => r.id === id);
await form.click(`#rule-${named.id} .edit-btn`);
await form.fill(`#rule-${named.id} .edit-name`, "Nights");
await form.click(`#rule-${named.id} .save-edit-btn`);
const renamed = await until(async () => { const r = await ruleById(named.id); return r?.name === "Nights" ? r : null; }, 5000);
check("the row editor renames a rule", renamed !== null && (await form.textContent(`#rule-${named.id} .site-label`)) === "Nights", JSON.stringify(renamed));
await form.click(`#rule-${named.id} .edit-btn`);
await form.fill(`#rule-${named.id} .edit-name`, "");
await form.click(`#rule-${named.id} .save-edit-btn`);
const unnamed = await until(async () => { const r = await ruleById(named.id); return r && !("name" in r) ? r : null; }, 5000);
check("clearing the name drops it, and the targets name the rule", unnamed !== null && (await form.textContent(`#rule-${named.id} .site-label`)).startsWith("com.example.game"), JSON.stringify(unnamed));

check("no service-worker errors", errors.length === 0, errors.join(" ~ ").slice(0, 300));
await ctx.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
