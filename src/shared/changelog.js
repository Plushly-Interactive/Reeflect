import { CHANGELOG_ENTRIES } from './changelogEntries.js';
import { host } from './host.js';

const CHANGELOG_KEY = 'lastShownChangelogVersion';

async function readLastShownVersion() {
  const { [CHANGELOG_KEY]: version } = await host.prefs.get(CHANGELOG_KEY);
  return version;
}

async function writeLastShownVersion(version) {
  await host.prefs.set({ [CHANGELOG_KEY]: version });
}

// Manifest versions are dot-separated integers with no pre-release suffixes,
// so comparing part by part is enough.
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function newestEntryVersion() {
  return CHANGELOG_ENTRIES.at(-1)?.version ?? host.version();
}

export async function seedChangelogOnInstall() {
  await writeLastShownVersion(newestEntryVersion());
}

// On update Chrome reports the version the user came from. Seeding with it lets
// getUnseenChangelogEntries() surface every release since, including the one
// they just moved to. An already-stored value is left alone so entries the user
// has dismissed are not shown again.
export async function seedChangelogOnUpdate(previousVersion) {
  if (!previousVersion) return;
  const lastShown = await readLastShownVersion();
  if (lastShown !== undefined) return;
  await writeLastShownVersion(previousVersion);
}

export async function getUnseenChangelogEntries() {
  const lastShown = await readLastShownVersion();
  // No stored value and no update event to learn from: treat as caught up
  // rather than showing past releases to what may be a fresh install.
  if (lastShown === undefined) {
    await seedChangelogOnInstall();
    return [];
  }
  // Compared by version rather than matched by identity, so a stored value with
  // no authored entry of its own (a release with nothing worth announcing)
  // still resolves to the right set.
  return CHANGELOG_ENTRIES.filter(e => compareVersions(e.version, lastShown) > 0);
}

export async function markChangelogSeen() {
  await writeLastShownVersion(newestEntryVersion());
}
