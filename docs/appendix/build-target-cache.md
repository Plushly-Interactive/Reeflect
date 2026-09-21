# Build target cache

TL;DR: `app/src-tauri/target/` grows with every build (measured 9.6 GB on 2026-09-21, 6.5 GB of it `debug/`). The Android release build deletes its own dir; `cargo sweep -t 14` prunes the rest.

## Android release build
- `npm run android:release` runs `scripts/os/android-release-build.mjs`.
- It builds `tauri android build --apk --target aarch64`: APK only, no AAB, one cargo pass.
- `aarch64` is the CPU type of phones sold since about 2019. `app/native/` holds the core library for `aarch64` and `x86_64` only, so no other ABI can ship.
- After the build, the script deletes `target/aarch64-linux-android/` (5.5 GB measured). Only the next release build needs it, and that build then compiles from zero (138 s measured).

## Debug and desktop cache
- Not automated. `target/debug/` (desktop `tauri dev`), `target/release/` and `target/x86_64-linux-android/` (`npm run android:debug`) stay, so the next build is short.
- Prune: `cargo sweep -t 14` from `app/src-tauri/`. It deletes build files that nothing touched for 14 days or more. 14 is an invented default, copied from Leitscape, no source.
- Needs the tool once: `cargo install cargo-sweep`.
- `cargo clean` in `app/src-tauri/` deletes everything; the next build compiles from zero.
