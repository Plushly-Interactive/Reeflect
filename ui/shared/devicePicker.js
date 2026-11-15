import { createCheckboxDropdown, renderCheckboxOptions } from './dropdown.js';
import { t } from './i18n.js';
import { deviceId as thisDeviceId } from '../data/intervalLog.js';
import { knownDeviceIds, setDeviceFilter } from '../data/intervalAggregates.js';
import { devices } from './syncClient.js';
import { host } from './host.js';

// Multi-select of the devices that own rows. The selection lives in page memory only; the
// filtering itself happens in the core (intervalAggregates.setDeviceFilter).
export const DEVICE_NAMES_KEY = '_syncDeviceNames';

export function createDevicePicker() {
  return createCheckboxDropdown({ id: 'device-picker', buttonId: 'device-select', labelId: 'device-label', menuId: 'device-menu', label: t('devices_all') });
}

async function cachedNames() {
  return (await host.prefs.get(DEVICE_NAMES_KEY))[DEVICE_NAMES_KEY] ?? {};
}

// Names cached from the last successful device-registry read. An id never seen before triggers one
// registry read (a network call; offline or signed out it stays as is); an id already confirmed
// absent (a device merged or forgotten elsewhere, so a local row still carries its id) is cached as
// `null` and never retried — without that, a ghost id would fetch the registry on every page load
// forever, since it can never gain a name. Visiting the sync page (a real `devices()` read) drops
// the sentinel again, so a device that returns still gets its name back.
export async function deviceLabeler(ids = [], { refresh = true } = {}) {
  let names = await cachedNames();
  if (refresh && ids.some((id) => !(id in names))) {
    try {
      await devices();
      names = await cachedNames();
      const stillUnknown = Object.fromEntries(ids.filter((id) => !(id in names)).map((id) => [id, null]));
      if (Object.keys(stillUnknown).length) {
        names = { ...names, ...stillUnknown };
        await host.prefs.set({ [DEVICE_NAMES_KEY]: names });
      }
    } catch { /* offline or signed out */ }
  }
  const me = await thisDeviceId();
  return (id) => names[id]?.name || (id === me ? t('sync_deviceThis') : id.slice(0, 8));
}

// Shows the picker once two or more devices own rows (`ids` when the page already has them).
// `onChange(ids | null)` runs after the filter is set; the page re-renders from it.
// Returns a setter so another control can select devices through the same picker.
export async function initDevicePicker(picker, onChange, ids = null) {
  ids ??= await knownDeviceIds();
  if (ids.length < 2) return;
  const label = await deviceLabeler(ids);
  const menu = picker.querySelector('#device-menu');
  const btn = picker.querySelector('#device-select');
  const selected = new Set();
  const options = [{ id: null, label: t('devices_all') }, ...ids.map(id => ({ id, label: label(id) }))];
  function renderOptions() {
    renderCheckboxOptions(menu, options,
      id => selected.size === 0 || (id !== null && selected.has(id)),
      (id, checked) => {
        if (id === null) selected.clear();
        else {
          if (!selected.size) ids.forEach(value => selected.add(value));
          if (checked) selected.add(id);
          else selected.delete(id);
        }
        applySelection();
        menu.querySelectorAll('input')[options.findIndex(option => option.id === id)]?.focus();
      });
  }
  function applySelection() {
    if (selected.size === ids.length) selected.clear();
    renderOptions();
    const list = selected.size ? [...selected] : null;
    btn.firstChild.textContent = !list ? t('devices_all') : list.length === 1 ? label(list[0]) : t('devices_count', [String(list.length)]);
    btn.dataset.value = list ? list.join(',') : 'all';
    setDeviceFilter(list);
    return onChange(list);
  }
  renderOptions();
  picker.style.display = '';
  return (list) => {
    selected.clear();
    for (const id of list ?? []) if (ids.includes(id)) selected.add(id);
    return applySelection();
  };
}
