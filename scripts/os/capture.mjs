#!/usr/bin/env node
// capture — screenshot + measure + console of the running app. Fixed interface, pluggable backends.
// Usage: node scripts/os/capture.mjs [--view name] [--width N] [--height N]
//        [--measure "css,selectors"] [--console] [--eval "<js expression>"] [--no-shot] [--out path.png]
// Backend contract (scripts/os/backends/<type>.mjs):
//   export async function capture(cfg, opts) -> { imageBase64?, text?, measures?, consoleLines? }
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = (await import(pathToFileURL(path.join(here, "capture.config.mjs")).href)).default;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const opts = {
  view: arg("view", null),
  width: Number(arg("width", 1280)),
  height: Number(arg("height", 800)),
  measure: arg("measure", null)?.toString().split(",").map((s) => s.trim()).filter(Boolean) ?? null,
  console: process.argv.includes("--console"),
  eval: arg("eval", null),                       // JS expression evaluated in the page; result printed as JSON
  shot: !process.argv.includes("--no-shot"),     // --no-shot: skip the screenshot (eval/console/measure only)
  out: arg("out", null),
};

let backend;
try {
  backend = await import(pathToFileURL(path.join(here, "backends", `${cfg.type}.mjs`)).href);
} catch (e) {
  console.error(`capture: no backend for type "${cfg.type}" (${e.message}). Run /os-init to generate one.`);
  process.exit(1);
}

try {
  const res = await backend.capture(cfg, opts);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const root = path.resolve(here, "..", "..");
  if (res.imageBase64) {
    const out = path.resolve(root, opts.out ?? `shots/${opts.view ?? "current"}-${opts.width}-${stamp}.png`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(res.imageBase64, "base64"));
    console.log(`image: ${out}`);
  }
  if (res.text) {
    const out = path.resolve(root, opts.out ?? `shots/${opts.view ?? "current"}-${stamp}.txt`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, res.text);
    console.log(`text: ${out}`);
  }
  if (res.measures) console.log("measures: " + JSON.stringify(res.measures));
  if (res.evalResult !== undefined) console.log("eval: " + JSON.stringify(res.evalResult));
  if (res.consoleLines?.length) {
    const shown = res.consoleLines.slice(-25); // paths-not-pastes: cap chat spill
    console.log(`console (last ${shown.length} of ${res.consoleLines.length}):`);
    for (const l of shown) console.log("  " + l);
  }
} catch (e) {
  console.error(`capture: FAILED (${e.message}). App running? Config url/port right? Report as "unverified" — do not guess.`);
  process.exit(1);
}
