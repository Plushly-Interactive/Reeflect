import { initCustomDropdowns } from './dropdown.js';
import { t } from './i18n.js';
import { escapeHtml } from './utils.js';
import { deviceId as thisDeviceId } from '../data/intervalLog.js';
import { knownDeviceIds, setDeviceFilter } from '../data/intervalAggregates.js';
import { devices } from './syncClient.js';
import { host } from './host.js';

// Multi-select of the devices that own rows. The selection lives in page memory only; the
// filtering itself happens in the core (intervalAggregates.setDeviceFilter).
export const DEVICE_NAMES_KEY = '_syncDeviceNames';

export function createDevicePicker() {
  const div = document.createElement('div');
  div.className = 'custom-dropdown';
  div.id = 'device-picker';
  div.style.display = 'none';
  div.innerHTML = `<button class="dropdown-btn" id="device-select" data-value="all"><span id="device-label">${t('devices_all')}</span><span class="dropdown-arrow"><svg width="12" height="12" viewBox="0 0 24 24"><polygon points="6,9 18,9 12,17" fill="currentColor" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/></svg></span></button>
    <div class="dropdown-menu" id="device-menu"></div>`;
  return div;
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
export async function deviceLabeler(ids = []) {
  let names = await cachedNames();
  if (ids.some((id) => !(id in names))) {
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
export async function initDevicePicker(picker, onChange, ids = null) {
  ids ??= await knownDeviceIds();
  if (ids.length < 2) return;
  const label = await deviceLabeler(ids);
  const menu = picker.querySelector('#device-menu');
  const btn = picker.querySelector('#device-select');
  const selected = new Set();
  menu.innerHTML = `<button value="all" class="checked">${t('devices_all')}</button>`
    + ids.map((id) => `<button value="${escapeHtml(id)}">${escapeHtml(label(id))}</button>`).join('');
  initCustomDropdowns(picker);
  menu.querySelectorAll('button').forEach((opt) => opt.addEventListener('click', (e) => {
    e.stopPropagation();
    if (opt.value === 'all') selected.clear();
    else if (selected.has(opt.value)) selected.delete(opt.value);
    else selected.add(opt.value);
    if (selected.size === ids.length) selected.clear();
    menu.querySelectorAll('button').forEach((b) => b.classList.toggle('checked', b.value === 'all' ? selected.size === 0 : selected.has(b.value)));
    const list = selected.size ? [...selected] : null;
    btn.firstChild.textContent = !list ? t('devices_all') : list.length === 1 ? label(list[0]) : t('devices_count', [String(list.length)]);
    btn.dataset.value = list ? list.join(',') : 'all';
    setDeviceFilter(list);
    onChange(list);
  }));
  picker.style.display = '';
}
