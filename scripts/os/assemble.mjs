// assemble — builds dist/extension, the folder Chromium loads unpacked and the store zip is made from,
// out of extension/ (manifest, background, data, vendor) and ui/ (pages, shared, locales, resources).
//   node scripts/os/assemble.mjs          links: edit ui/ or extension/ and reload, no rebuild
//   node scripts/os/assemble.mjs --copy   real copies, for the zip
import { copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const dist = path.join(root, 'dist', 'extension');
const copy = process.argv.includes('--copy');
const map = {
  'extension/manifest.json': 'manifest.json',
  'extension/src/background': 'src/background',
  'extension/src/data': 'src/data',
  'extension/src/vendor': 'src/vendor',
  'ui/pages': 'src/pages',
  'ui/shared': 'src/shared',
  'ui/_locales': '_locales',
  'ui/resources': 'resources',
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
    isDir ? cpSync(src, dst, { recursive: true }) : copyFileSync(src, dst);
  } else if (isDir) {
    symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir');
  } else {
    try { linkSync(src, dst); } catch { copyFileSync(src, dst); }
  }
}
const probe = path.join(dist, 'src/pages/dashboard/dashboard.html');
if (!existsSync(probe)) {
  console.error(`assemble: ${probe} missing after ${copy ? 'copy' : 'link'}`);
  process.exit(1);
}
console.log(`assembled ${dist} (${copy ? 'copies' : 'links'})`);
