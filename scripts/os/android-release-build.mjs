// android-release-build — builds the release APK for a phone (aarch64, apk only, no aab), then deletes
// the ABI's Rust target dir. That dir is a full separate build tree (5.5 GB last measured) that only
// the next release build needs again.
//   node scripts/os/android-release-build.mjs   (or: npm run android:release)
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const app = path.join(root, 'app');
const target = path.join(app, 'src-tauri', 'target');
// One entry per ABI the release ships. app/native/ must hold the core's .so for each.
const abis = { aarch64: 'aarch64-linux-android' };

console.log('android-release-build: building the release APK…');
const build = spawnSync(`npx tauri android build --apk --target ${Object.keys(abis).join(' ')}`, { cwd: app, stdio: 'inherit', shell: true });
if (build.status !== 0) {
  console.error(`android-release-build: the build failed (exit ${build.status ?? '?'})`);
  process.exit(build.status ?? 1);
}

console.log('android-release-build: build done, clearing the ABI target dirs…');
for (const triple of Object.values(abis)) rmSync(path.join(target, triple), { recursive: true, force: true });
console.log('android-release-build: done.');
