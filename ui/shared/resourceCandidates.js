import { loadInstalledApps } from './utils.js';
import { appLabel, isAppId } from './labels.js';
import { coreCall } from './core.js';

export async function loadResourceCandidates({ fromMs = 0, activeOnly = false } = {}) {
  const byKey = new Map();
  const put = (source, target, label, ms) => {
    const key = `${source}\n${target}`;
    const c = byKey.get(key) ?? { source, target, label: label ?? target, ms: 0 };
    if (label) c.label = label;
    c.ms += ms;
    byKey.set(key, c);
  };
  for (const [pkg, app] of await loadInstalledApps()) put('app', pkg, app.label, 0);
  for (const r of await coreCall('rows.since', { fromMs })) {
    if (!r.domain || (activeOnly && r.kind !== 'active')) continue;
    const source = r.source ?? (isAppId(r.domain) ? 'app' : 'web');
    const program = source === 'app' || source === 'desktop';
    put(source, r.domain, program ? (appLabel(r.domain) ?? r.label) : null, r.to - r.from);
  }
  return [...byKey.values()].sort((a, b) => b.ms - a.ms || a.label.localeCompare(b.label));
}
