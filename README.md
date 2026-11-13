# Reeflect

TL;DR: Reeflect tracks website time and blocks sites past hourly, daily or weekly limits. The Vivaldi/Chromium extension uses Manifest V3, the current extension format. Shared pages also run in a Tauri 2 app on Windows and Android. Languages: English, Spanish, French.

## What it does

- **Tracks** active, audio-playing and idle time per site. The app also tracks Android apps and Windows programs; Linux and macOS show pages only. See [android-app](docs/features/android-app.md).
- **Blocks** sites, apps or [groups](docs/features/groups.md) past a limit, with a quote on the blocked page.
- **Shows** dashboards, group activity, per-site and per-path views, a timeline and a popup.
- **Manages storage**: prune, delete, export to JSON, import.
- **Syncs** history and groups between devices when enabled. The device encrypts every record before upload.

## Requirements

| Tool | Why |
|---|---|
| Node.js (v24.13.1 used here, no minimum pinned) | runs every script in `scripts/os/` |
| Vivaldi or another Chromium browser | loads the extension |
| Rust 1.85 or newer | app only: builds `app/src-tauri/` |
| Android SDK and NDK, with `ANDROID_HOME` and `NDK_HOME` set | Android build only |

## Install / first run

```sh
npm install                        # Playwright, for capture and smoke tests only
node scripts/os/assemble.mjs       # links extension/ + ui/ into dist/extension
```

1. Open `vivaldi://extensions` (or `chrome://extensions`).
2. Turn on "Developer mode".
3. Click "Load unpacked".
4. Pick the `dist/extension` folder.

`dist/extension` links to the sources. Edit `ui/` or `extension/`, then reload. Never edit `dist/` or `app/dist/`; assembly recreates them.

Run the app in development:

```sh
node scripts/os/assemble.mjs --app         # copies ui/ and the data layer into app/dist
cd app && npm install                      # the Tauri CLI, first time only
cd app && npx tauri dev --no-watch         # opens the desktop window
```

## Usage

1. Browse. Reeflect records time with no setup.
2. Click the toolbar icon, or press `Alt+Shift+C`, to open the popup.
3. Open the dashboard from the popup to see totals per site.
4. Open the rules page and add a limit for a site. The browser asks for access to that site.
5. Pass the limit. Reeflect redirects the site to the blocked page.

## How it works

```mermaid
graph LR
  ui[ui/: every page and shared module] --> ext[dist/extension]
  extension[extension/: service worker and data layer] --> ext
  ui --> appdist[app/dist]
  appweb[app/web/: app versions of host, core, row store] --> appdist
  appdist --> tauri[app/src-tauri: Rust host]
  core[prebuilt core library: totals and verdicts] --> ext
  core --> tauri
```

The core computes every total and every block verdict. Its source lives outside this repo. Details: [architecture](docs/architecture/architecture.md).

## Tests and checks

All smoke tests need `node scripts/os/assemble.mjs` first. Each one opens a real Chromium window and prints `ok` or `FAIL` per check. The sync server is not in this repo. No formatter and no type-check command exist.

| Task | Command | Notes |
|---|---|---|
| Test blocking | `node scripts/os/enforce-smoke.mjs` | no server needed |
| Test dashboard and timeline | `node scripts/os/dashboard-smoke.mjs` | skips in the first 61 minutes of the local day |
| Test sync between 2 profiles | `node scripts/os/sync-smoke.mjs` | skips without a local sync server |
| Test the paused-sync state | `node scripts/os/sync-paused.mjs` | needs the same server |
| Test the Rust tracker | `cd app/src-tauri && cargo test` | unit tests in `tracker.rs` |
| Screenshot one page | `node scripts/os/capture.mjs --view dashboard --seed` | output in `shots/`; view names in `scripts/os/capture.config.mjs` |
| Check translations | `npm run lint:i18n` | the checker sits in the gitignored `.local/`, not in a fresh clone |
| Check changed docs | `node scripts/os/doc-lint.mjs --changed` | line budgets and TL;DR |

## Build

| Task | Command | Notes |
|---|---|---|
| Assemble for a zip | `node scripts/os/assemble.mjs --copy` | real copies |
| Assemble the app | `node scripts/os/assemble.mjs --app` | also copies the core `.so` to Android; `tauri android build` and `tauri build` run it themselves, `tauri dev` does not |
| Build a debug APK for the emulator | `npm run android:debug` | for `x86_64` (the emulator); installs as `app.reeflect.debug` |
| Build a release APK for a phone | `npm run android:release` | assembles `app/dist`, builds for `aarch64` (current phones), copies it over `D:\Phone\Reeflect.apk`, then deletes its 5.5 GB Rust target dir. **A phone refuses the APK until the one-time [release signing](docs/features/android-app.md#release-signing) setup** |
| Build the Windows installer | `cd app && npx tauri build` | MSI only, core DLL inside (`tauri.windows.conf.json`); unsigned: SmartScreen warns. Bump the version before each build you install, or it cannot replace the old one |
| Prune the Rust build cache | `cargo sweep -t 14` in `app/src-tauri/` | deletes build files unused for 14 days ([build-target-cache](docs/appendix/build-target-cache.md)) |
| Release the extension | push a `vX.Y.Z` tag | `.github/workflows/package.yml` attaches `reeflect.zip` to a GitHub release |

No compile step: `assemble.mjs` builds the folder the browser loads. Output: `dist/extension/` and `app/dist/`, both gitignored. APKs land in `app/src-tauri/gen/android/app/build/outputs/apk/universal/{debug,release}/`. `app/native/<target>/` holds the prebuilt core library per platform, committed. The MSI lands in `app/src-tauri/target/release/bundle/msi/`. Version: `extension/manifest.json` for both (`tauri.conf.json` reads it). The Chrome Web Store upload is manual.

## Limits and known issues

- The `path` view throws `null.split` when the URL has no `ids` ([STATE.md](STATE.md)).
- Prebuilt core libraries exist for Windows x64, Android arm64 and Android x86_64. No macOS or Linux library exists.

## Privacy

All data stays on the device in `chrome.storage.local` and IndexedDB. Sync is off by default. With sync on, the device encrypts each row before upload; the server cannot read sites, times or device names. No analytics, no third-party code. Full text: [privacy policy](docs/privacy/privacy-policy.md).

## Project layout

| Path | What lives there |
|---|---|
| `ui/` | pages (`pages/<name>/`), shared modules, locales, icons |
| `extension/` | `manifest.json`, the service worker, the data layer, vendored code |
| `app/` | the Tauri app: `src-tauri/` (Rust), `web/` (app versions of shared modules), `native/` |
| `scripts/os/` | assemble, capture, smoke tests, doc-lint, git hooks |
| `docs/` | architecture, one doc per feature, privacy policy, appendix |

## Project notes

- [AGENTS.md](AGENTS.md) — instructions for AI coding agents that work in this repo.
- [STATE.md](STATE.md) — where the work stands. [DECISIONS.md](DECISIONS.md) — why. [docs/conventions.md](docs/conventions.md) — the code rules. [docs/README.md](docs/README.md) — the doc index.
