// assemble — builds the folder a client loads out of ui/ (pages, shared, locales, resources) plus the
// client's own files. Extension: dist/extension = extension/ + ui/. App: app/dist = ui/ + the extension's
// data layer and site resolution + app/web/ overlays (the platform twins: host, core, sync, row store).
//   node scripts/os/assemble.mjs          extension, links: edit ui/ or extension/ and reload, no rebuild
//   node scripts/os/assemble.mjs --copy   extension, real copies, for the zip
//   node scripts/os/assemble.mjs --app    app, always copies (Tauri reads app/dist)
import { copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const app = process.argv.includes('--app');
const dist = app ? path.join(root, 'app', 'dist') : path.join(root, 'dist', 'extension');
const copy = app || process.argv.includes('--copy');
const ui = {
  'ui/pages': 'src/pages',
  'ui/shared': 'src/shared',
  'ui/_locales': '_locales',
  'ui/resources': 'resources',
};
const map = app
  ? {
      ...ui,
      'extension/src/data': 'src/data',
      'extension/src/background/siteResolution.js': 'src/background/siteResolution.js',
      'extension/src/vendor/tldts.js': 'src/vendor/tldts.js',
      'extension/src/vendor/dexie.min.mjs': 'src/vendor/dexie.min.mjs',   // the saved dashboard build (intervalAggregates.js)
      'app/web/shared/host.js': 'src/shared/host.js',
      'app/web/shared/core.js': 'src/shared/core.js',
      'app/web/data/intervalLog.js': 'src/data/intervalLog.js',
    }
  : {
      'extension/manifest.json': 'manifest.json',
      'extension/src/background': 'src/background',
      'extension/src/data': 'src/data',
      'extension/src/vendor': 'src/vendor',
      ...ui,
    };

// Removes dist without ever following a link into the sources.
function clean(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      try { unlinkSync(p); } catch { rmdirSync(p); }
    } else if (st.isDirectory()) {
      clean(p);
      rmdirSync(p);
    } else {
      unlinkSync(p);
    }
  }
}

clean(dist);
for (const [from, to] of Object.entries(map)) {
  const src = path.join(root, from);
  const dst = path.join(dist, to);
  mkdirSync(path.dirname(dst), { recursive: true });
  const isDir = lstatSync(src).isDirectory();
  if (copy) {
    isDir ? cpSync(src, dst, { recursive: true, force: true }) : copyFileSync(src, dst);
  } else if (isDir) {
    symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir');
  } else {
    try { linkSync(src, dst); } catch { copyFileSync(src, dst); }
  }
}
// The app's Android project packages whatever sits in jniLibs; the prebuilt core goes there by ABI.
if (app) {
  const jni = path.join(root, 'app/src-tauri/gen/android/app/src/main/jniLibs');
  if (existsSync(path.dirname(path.dirname(jni)))) {
    for (const [triple, abi] of [['aarch64-linux-android', 'arm64-v8a'], ['x86_64-linux-android', 'x86_64']]) {
      const so = path.join(root, 'app/native', triple, 'libreeflect_core_ffi.so');
      if (!existsSync(so)) continue;
      mkdirSync(path.join(jni, abi), { recursive: true });
      copyFileSync(so, path.join(jni, abi, 'libreeflect_core_ffi.so'));
    }
  }
}
const probe = path.join(dist, 'src/pages/dashboard/dashboard.html');
if (!existsSync(probe)) {
  console.error(`assemble: ${probe} missing after ${copy ? 'copy' : 'link'}`);
  process.exit(1);
}
console.log(`assembled ${dist} (${copy ? 'copies' : 'links'})`);
