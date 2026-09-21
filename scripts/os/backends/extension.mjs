// Backend: extension — loads the unpacked extension into Chromium via Playwright persistent context.
// Requires: npm i -D playwright && npx playwright install chromium
// Config: extensionPath (dir holding manifest.json), views, optional defaultView, profileDir, prepare.
//
// An MV3 extension has no localhost URL and its id changes per profile, so the id is read from the
// running service worker and views are addressed as extension-relative page paths:
//   views: { dashboard: { page: "src/pages/dashboard/dashboard.html" } }
// A view may also carry: goto (full URL instead of page), waitFor (selector), click (selectors), settle (ms).
//
// prepare: steps run before the view loads, each opening one extension page.
//   { page, evaluate?, untilStorage?, flag?, timeout? }
//   evaluate     — JS expression run in that page (suppress first-run overlays, write settings).
//   untilStorage — wait until this chrome.storage.local key holds a non-empty value (seeding).
//   flag         — only run when capture is called with --<flag>, e.g. flag: "seed".
import path from "node:path";
import os from "node:os";

async function extensionId(ctx) {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  return new URL(sw.url()).host;
}

async function prepare(ctx, id, steps) {
  for (const step of steps) {
    if (step.flag && !process.argv.includes(`--${step.flag}`)) continue;
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/${step.page}`, { waitUntil: "domcontentloaded" });
    if (step.evaluate) await page.evaluate(step.evaluate);
    if (step.untilStorage) {
      await page.waitForFunction(
        async (key) => {
          const v = (await chrome.storage.local.get(key))[key];
          return v != null && (typeof v !== "object" || Object.keys(v).length > 0);
        },
        step.untilStorage,
        { timeout: step.timeout ?? 120000 },
      );
    }
    await page.close();
  }
}

export async function capture(cfg, opts) {
  let pw;
  try { pw = await import("playwright"); }
  catch { throw new Error("playwright not installed: npm i -D playwright && npx playwright install chromium"); }
  if (!cfg.extensionPath) throw new Error("capture.config.mjs needs extensionPath for the extension backend");
  const ext = path.resolve(cfg.extensionPath);
  const profile = path.join(os.tmpdir(), cfg.profileDir ?? "agent-os-ext-profile");
  const ctx = await pw.chromium.launchPersistentContext(profile, {
    headless: false, // extensions need headed mode
    viewport: { width: opts.width, height: opts.height },
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${opts.width + 20},${opts.height + 120}`,
    ],
  });
  try {
    const id = await extensionId(ctx);
    if (cfg.prepare?.length) await prepare(ctx, id, cfg.prepare);

    const page = await ctx.newPage();
    const consoleLines = [];
    page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));

    const name = opts.view ?? cfg.defaultView;
    const v = name ? cfg.views?.[name] : null;
    if (name && !v) throw new Error(`unknown view "${name}" — add it to capture.config.mjs views`);
    const url = v?.goto ?? `chrome-extension://${id}/${v?.page ?? ""}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (v?.waitFor) await page.waitForSelector(v.waitFor, { timeout: 10000 });
    for (const sel of v?.click ?? []) await page.click(sel);
    await page.waitForTimeout(v?.settle ?? 800);

    const measures = opts.measure ? await page.evaluate((sels) =>
      Object.fromEntries(sels.map((s) => {
        const el = document.querySelector(s); if (!el) return [s, null];
        const r = el.getBoundingClientRect();
        return [s, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }];
      })), opts.measure) : null;
    const evalResult = opts.eval ? await page.evaluate(opts.eval) : undefined;
    const imageBase64 = (await page.screenshot()).toString("base64");
    return { imageBase64, measures, evalResult, consoleLines: opts.console ? consoleLines : undefined };
  } finally { await ctx.close(); }
}
