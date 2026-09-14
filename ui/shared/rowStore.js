// Row operations every page uses, written once over the core's commands. Each host keeps only
// its primitives (`data/intervalLog.js`): the core runs the same delete, split, merge and statistics
// on IndexedDB and on SQLite, and every delete queues its origins for the next push.
import { coreCall } from './core.js';

// One definition of "still the same continuous session": the live-row flush extends a row across
// gaps this small, and visit counting merges presence across gaps this small.
export const SESSION_GAP_MS = 1000;

export const touch = (id, to) => coreCall('rows.touch', { localId: id, to });
export const clearAll = () => coreCall('rows.clearAll');
export const deleteByOrigins = (rows) => coreCall('rows.remove', { origins: rows.map(({ deviceId, localId }) => ({ deviceId, localId })) });
export const deleteByDomain = (domain) => coreCall('rows.deleteByDomain', { domain });
export const deleteRange = (fromTs, toTs, domain = null) => coreCall('rows.deleteRange', { fromMs: fromTs, toMs: toTs, domain });
export const deletePath = (domain, path) => coreCall('rows.deletePath', { domain, path });
export const dropPathsBefore = (beforeTs) => coreCall('rows.dropPathsBefore', { beforeMs: beforeTs });
export const count = () => coreCall('rows.count');
export const dirtyCount = () => coreCall('rows.dirtyCount');
export const intervalStats = () => coreCall('rows.stats');
