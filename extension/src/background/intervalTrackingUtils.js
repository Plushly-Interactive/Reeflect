import { appendInterval, touch, SESSION_GAP_MS } from '../data/intervalLog.js';
import { dbg } from './trackingDebug.js';

const SNAPSHOT_MAX_GAP_MS = 5 * 60 * 1000;
const KEY_SEP = '\n';   // engine keys are `${domain}\n${path}` (see intervalTracker)

function splitKey(key) {
  const i = key.indexOf(KEY_SEP);
  return i < 0 ? { domain: key, path: '' } : { domain: key.slice(0, i), path: key.slice(i + 1) };
}

export function createTrackingModule({ urlToKey, snapshotStorageKey, recoverLegacy }) {
  const tracker = createRangeTracker();
  let _recovered = false;
  // `${key}\0${kind}` → { rowId, lastTo }; sessions persist across SW restarts via snapshot.
  const openRows = new Map();
  const parseSnapshot = recoverLegacy ?? (snap => ({
    activeKeys: snap.activeKeys ?? [],
    audioKeys: snap.audioKeys ?? [],
  }));

  async function init() {
    const windows = await chrome.windows.getAll({ populate: true });
    dbg('iv-init: windows=', windows.length);
    for (const w of windows) {
      if (w.state === 'minimized') { dbg('iv-init: window', w.id, 'minimized, skip'); tracker.markMinimized(w.id); continue; }
      const tab = w.tabs?.find(t => t.active);
      const key = urlToKey(tab?.url);
      dbg('iv-init: window', w.id, 'url=', tab?.url, '→ key=', key);
      if (key) tracker.addWindow(w.id, key);
    }
    const tabs = await chrome.tabs.query({ audible: true });
    for (const tab of tabs) {
      if (tab.mutedInfo?.muted) continue;
      const key = urlToKey(tab.url);
      dbg('iv-init: audible tab', tab.id, 'url=', tab.url, '→ key=', key);
      if (key) tracker.addAudibleTab(tab.id, key, false);
    }
  }

  async function reconcile() {
    dbg('iv-reconcile: start tracked-windows=', tracker.getTrackedWindowIds().length, 'audible-tabs=', tracker.getTrackedAudibleTabIds().length);
    const windows = await chrome.windows.getAll();
    const liveById = new Map(windows.map(w => [w.id, w]));
    for (const id of tracker.getTrackedWindowIds()) {
      const w = liveById.get(id);
      if (!w || w.state === 'minimized') { dbg('iv-reconcile: drop window', id, w ? 'minimized' : 'gone'); tracker.removeWindow(id, w?.state === 'minimized'); }
    }
    for (const w of windows) {
      if (w.state === 'minimized') continue;
      if (tracker.isWindowTracked(w.id)) continue;
      const [tab] = await chrome.tabs.query({ windowId: w.id, active: true });
      const key = urlToKey(tab?.url);
      dbg('iv-reconcile: add window', w.id, 'url=', tab?.url, '→ key=', key);
      if (key) tracker.addWindow(w.id, key);
    }
    const audibleTabs = await chrome.tabs.query({ audible: true });
    const liveAudibleIds = new Set(
      audibleTabs.filter(t => !t.mutedInfo?.muted).map(t => t.id)
    );
    for (const tabId of tracker.getTrackedAudibleTabIds()) {
      if (!liveAudibleIds.has(tabId)) { dbg('iv-reconcile: drop audible tab', tabId); tracker.removeAudibleTab(tabId); }
    }
    for (const tab of audibleTabs) {
      if (tab.mutedInfo?.muted) continue;
      const key = urlToKey(tab.url);
      dbg('iv-reconcile: add audible tab', tab.id, 'url=', tab.url, '→ key=', key);
      if (key) tracker.addAudibleTab(tab.id, key, false);
    }
  }

  async function saveSnapshot(now = Date.now()) {
    const activeKeys = tracker.getActiveKeys();
    const audioKeys = tracker.getAudibleKeys();
    const open = [...openRows.entries()];   // [ [`key\0kind`, {rowId,lastTo}], … ]
    dbg('iv-save', snapshotStorageKey, 'active', activeKeys.length, 'audio', audioKeys.length, 'openRows', open.length, JSON.stringify(open));
    if (activeKeys.length > 0 || audioKeys.length > 0 || open.length > 0) {
      await chrome.storage.local.set({ [snapshotStorageKey]: { activeKeys, audioKeys, openRows: open, at: now } });
    } else {
      await chrome.storage.local.remove(snapshotStorageKey);
    }
  }

  async function recoverFromSnapshot(clipAt, idleSince = null) {
    if (_recovered) return;
    _recovered = true;
    const stored = await chrome.storage.local.get(snapshotStorageKey);
    const snap = stored[snapshotStorageKey];
    if (!snap) { dbg('iv-recover', snapshotStorageKey, 'NO SNAPSHOT'); return; }
    const now = Date.now();
    if (now - snap.at > SNAPSHOT_MAX_GAP_MS) {
      dbg('iv-recover', snapshotStorageKey, 'STALE', now - snap.at, 'ms — discarding');
      await chrome.storage.local.remove(snapshotStorageKey);
      return;
    }
    dbg('iv-recover', snapshotStorageKey, 'gap', now - snap.at, 'ms', 'openRows', snap.openRows?.length ?? 0, JSON.stringify(snap.openRows));
    // Restore open-row state so the gap credited below extends existing rows.
    if (Array.isArray(snap.openRows)) for (const [mk, v] of snap.openRows) openRows.set(mk, v);
    const endAt = Math.min(clipAt ?? now, now);
    const activeEndAt = idleSince !== null ? Math.min(endAt, idleSince) : endAt;
    const idleStartAt = idleSince !== null ? Math.max(snap.at, idleSince) : null;
    const { activeKeys, audioKeys } = parseSnapshot(snap);
    const activeKeySet = new Set(activeKeys);
    const audioKeySet = new Set(audioKeys);
    for (const key of activeKeys) {
      const keyActiveEnd = audioKeySet.has(key) ? endAt : activeEndAt;
      if (keyActiveEnd > snap.at) tracker.pushRange('active', key, [snap.at, keyActiveEnd]);
      if (!audioKeySet.has(key) && idleStartAt !== null && endAt > idleStartAt) tracker.pushRange('idle', key, [idleStartAt, endAt]);
    }
    for (const key of audioKeys) {
      tracker.pushRange('audio', key, [snap.at, endAt]);
      if (activeKeySet.has(key) && endAt > snap.at) {
        tracker.pushRange('overlap', key, [snap.at, endAt]);
      }
    }
  }

  async function flushToStorage(now = Date.now()) {
    tracker.flushAllElapsed(now);
    const active = new Map(tracker.pending.active);
    const audio = new Map(tracker.pending.audio);
    const idle = new Map(tracker.pending.idle);
    tracker.clearPending();
    if (active.size === 0 && audio.size === 0 && idle.size === 0) return;

    async function coalesce(map, kind) {
      for (const [key, ranges] of map) {
        const { domain, path } = splitKey(key);
        const mk = `${key}\0${kind}`;
        let or = openRows.get(mk);
        // Out-of-order ranges possible (recovery pushes [snap.at,…] after flush segments); sort and extend `to` forward only.
        const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        dbg('iv-coalesce', kind, mk, 'or', or ? `row${or.rowId}@${or.lastTo}` : 'NONE', 'ranges', JSON.stringify(sorted));
        for (const [from, to] of sorted) {
          if (to <= from) continue;
          let extended = false;
          if (or && from <= or.lastTo + SESSION_GAP_MS && to > or.lastTo) {   // same session → extend
            const updated = await touch(or.rowId, to).catch(() => 0);
            if (updated) {                                  // row still exists → grew it
              dbg('iv-coalesce', kind, mk, 'EXTEND row', or.rowId, 'to', to, '(gap', from - or.lastTo, 'ms)');
              or.lastTo = to;
              extended = true;
            } else {
              dbg('iv-coalesce', kind, mk, 'row', or.rowId, 'GONE — recreating');
              or = undefined;                               // row vanished (DB cleared) → fall through to NEW
            }
          } else if (or && from <= or.lastTo + SESSION_GAP_MS) {
            extended = true;                                // already covered (to <= lastTo), nothing to do
          }
          if (!extended) {                                  // real gap, first, or row gone → new row
            dbg('iv-coalesce', kind, mk, 'NEW', from, to, or ? `(gap ${from - or.lastTo}ms)` : '(no or)');
            const id = await appendInterval({ domain, path, kind, from, to }).catch(() => null);
            or = id == null ? undefined : { rowId: id, lastTo: to };
          }
        }
        // Keep the open row — a sub-SESSION_GAP_MS resume needs to extend it even if key left the active set.
        if (or) openRows.set(mk, or);
        else openRows.delete(mk);
      }
    }

    await coalesce(active, 'active');
    await coalesce(audio, 'audio');
    await coalesce(idle, 'idle');

    // Prune rows past SESSION_GAP_MS — runs after coalescing so fresh rows survive.
    for (const [mk, v] of openRows) {
      if (v.lastTo < now - SESSION_GAP_MS) openRows.delete(mk);
    }
  }

  function applyIdleClip(idleSince, now) {
    tracker.applyIdleClip(idleSince, now);
  }

  return {
    setWindow: tracker.setWindow,
    removeWindow: tracker.removeWindow,
    markMinimized: tracker.markMinimized,
    addAudibleTab: tracker.addAudibleTab,
    removeAudibleTab: tracker.removeAudibleTab,
    init, reconcile,
    saveSnapshot, recoverFromSnapshot, flushToStorage,
    applyIdleClip,
  };
}

export function createRangeTracker() {
  const states = new Map();
  const windowToKey = new Map();
  const minimizedWindowIds = new Set();
  const audibleTabToKey = new Map();
  const audibleTabLastVisitKey = new Map();
  const pendingActive = new Map();
  const pendingAudio = new Map();
  const pendingOverlap = new Map();
  const pendingIdle = new Map();
  const pendingVisits = new Map();

  function newState() {
    return { activeWindowIds: new Set(), audibleTabIds: new Set(), startedAt: 0, wasActive: false, wasAudible: false };
  }

  function recordElapsed(key, now = Date.now()) {
    const s = states.get(key);
    if (!s || (!s.wasActive && !s.wasAudible)) return;
    if (now > s.startedAt) {
      const range = [s.startedAt, now];
      if (s.wasActive) {
        const ranges = pendingActive.get(key) ?? [];
        ranges.push(range);
        pendingActive.set(key, ranges);
      }
      if (s.wasAudible) {
        const ranges = pendingAudio.get(key) ?? [];
        ranges.push(range);
        pendingAudio.set(key, ranges);
      }
      if (s.wasActive && s.wasAudible) {
        const ranges = pendingOverlap.get(key) ?? [];
        ranges.push(range);
        pendingOverlap.set(key, ranges);
      }
    }
    s.startedAt = now;
  }

  function addWindow(windowId, key) {
    let s = states.get(key);
    if (!s) {
      s = newState();
      states.set(key, s);
    }
    s.activeWindowIds.add(windowId);
    windowToKey.set(windowId, key);
    if (!s.wasActive) {
      if (s.wasAudible) recordElapsed(key);
      else s.startedAt = Date.now();
      s.wasActive = true;
    }
  }

  function removeWindow(windowId, minimized = false) {
    const key = windowToKey.get(windowId);
    if (minimized) minimizedWindowIds.add(windowId);
    else minimizedWindowIds.delete(windowId);
    if (!key) return;
    windowToKey.delete(windowId);
    const s = states.get(key);
    if (!s) return;
    s.activeWindowIds.delete(windowId);
    if (s.activeWindowIds.size === 0 && s.wasActive) {
      recordElapsed(key);
      s.wasActive = false;
    }
  }

  function setWindow(windowId, key) {
    const oldKey = windowToKey.get(windowId);
    if (oldKey === key) return;
    if (!oldKey && !key) return;
    if (oldKey) removeWindow(windowId);
    if (key) {
      const wasMinimized = minimizedWindowIds.delete(windowId);
      const existing = states.get(key);
      const wasTracked = wasMinimized || (!!existing && (existing.wasActive || existing.wasAudible));
      addWindow(windowId, key);
      if (!wasTracked) {
        pendingVisits.set(key, (pendingVisits.get(key) ?? 0) + 1);
      }
    }
  }

  function addAudibleTab(tabId, key, countVisit = true) {
    if (!key) return;
    const oldKey = audibleTabToKey.get(tabId);
    if (oldKey === key) return;
    if (oldKey) removeAudibleTab(tabId);
    audibleTabToKey.set(tabId, key);
    let s = states.get(key);
    if (!s) {
      s = newState();
      states.set(key, s);
    }
    const wasTracked = s.wasActive || s.wasAudible;
    recordElapsed(key);
    s.audibleTabIds.add(tabId);
    s.wasAudible = true;
    if (!wasTracked) s.startedAt = Date.now();
    const alreadyCounted = audibleTabLastVisitKey.get(tabId) === key;
    audibleTabLastVisitKey.set(tabId, key);
    if (countVisit && !alreadyCounted) {
      pendingVisits.set(key, (pendingVisits.get(key) ?? 0) + 1);
    }
  }

  function removeAudibleTab(tabId) {
    const key = audibleTabToKey.get(tabId);
    if (!key) return;
    audibleTabToKey.delete(tabId);
    const s = states.get(key);
    if (!s) return;
    s.audibleTabIds.delete(tabId);
    if (s.audibleTabIds.size === 0 && s.wasAudible) {
      recordElapsed(key);
      s.wasAudible = false;
    }
  }

  function flushAllElapsed(now) {
    for (const key of states.keys()) recordElapsed(key, now);
  }

  function applyIdleClip(idleSince, now) {
    for (const [key, s] of states) {
      if (!s.wasActive && !s.wasAudible) continue;
      const clip = s.wasAudible ? now : Math.max(s.startedAt, Math.min(idleSince, now));
      if (s.wasActive && clip > s.startedAt) {
        const ranges = pendingActive.get(key) ?? [];
        ranges.push([s.startedAt, clip]);
        pendingActive.set(key, ranges);
        if (s.wasAudible) {
          const oranges = pendingOverlap.get(key) ?? [];
          oranges.push([s.startedAt, clip]);
          pendingOverlap.set(key, oranges);
        }
      }
      if (s.wasActive && now > clip) {
        const ranges = pendingIdle.get(key) ?? [];
        ranges.push([clip, now]);
        pendingIdle.set(key, ranges);
      }
      if (s.wasAudible && now > s.startedAt) {
        const ranges = pendingAudio.get(key) ?? [];
        ranges.push([s.startedAt, now]);
        pendingAudio.set(key, ranges);
      }
      s.startedAt = now;
    }
  }

  function getActiveKeys() {
    return [...new Set(windowToKey.values())].filter(Boolean);
  }

  function getAudibleKeys() {
    return [...new Set(audibleTabToKey.values())].filter(Boolean);
  }

  function getTrackedWindowIds() {
    return [...windowToKey.keys()];
  }

  function getTrackedAudibleTabIds() {
    return [...audibleTabToKey.keys()];
  }

  function isWindowTracked(windowId) {
    return windowToKey.has(windowId);
  }

  function pushRange(field, key, range) {
    const map = field === 'active' ? pendingActive
      : field === 'audio' ? pendingAudio
      : field === 'idle' ? pendingIdle
      : pendingOverlap;
    const ranges = map.get(key) ?? [];
    ranges.push(range);
    map.set(key, ranges);
  }

  function clearPending() {
    pendingActive.clear();
    pendingAudio.clear();
    pendingOverlap.clear();
    pendingIdle.clear();
    pendingVisits.clear();
  }

  return {
    setWindow, addWindow, removeWindow, markMinimized: (id) => minimizedWindowIds.add(id), addAudibleTab, removeAudibleTab,
    flushAllElapsed, applyIdleClip, getActiveKeys, getAudibleKeys,
    getTrackedWindowIds, getTrackedAudibleTabIds, isWindowTracked,
    pushRange, clearPending,
    pending: { active: pendingActive, audio: pendingAudio, overlap: pendingOverlap, idle: pendingIdle, visits: pendingVisits },
  };
}
