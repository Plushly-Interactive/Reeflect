export function displayPath(path) {
  try { return decodeURIComponent(path); }
  catch (_) { return path; }
}

export function stripQuery(path) {
  const i = path.indexOf('?');
  return i === -1 ? path : path.slice(0, i);
}

export function mergePaths(paths, depth) {
  const entries = Object.entries(paths);
  if (!depth) {
    return entries.map(([path, data]) => ({ path, ...data, truncated: false }));
  }
  const map = new Map();
  for (const [path, data] of entries) {
    const segments = path.split('/').filter(Boolean);
    const key = segments.length === 0 ? '/' : '/' + segments.slice(0, depth).join('/');
    const wasTruncated = segments.length > depth;
    const existing = map.get(key);
    if (existing) {
      existing.activeMs += data.activeMs || 0;
      existing.audioMs += data.audioMs || 0;
      existing.overlapMs += data.overlapMs || 0;
      existing.visits += data.visits || 0;
      existing.sourceCount += 1;
      if (wasTruncated) existing.truncated = true;
    } else {
      map.set(key, {
        path: key,
        activeMs: data.activeMs || 0,
        audioMs: data.audioMs || 0,
        overlapMs: data.overlapMs || 0,
        visits: data.visits || 0,
        truncated: wasTruncated,
        sourceCount: 1,
        sourcePath: path,
      });
    }
  }
  for (const g of map.values()) {
    if (g.sourceCount === 1) {
      g.path = g.sourcePath;
      g.truncated = false;
    }
    delete g.sourceCount;
    delete g.sourcePath;
  }
  return [...map.values()];
}
