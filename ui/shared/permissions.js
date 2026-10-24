// Android only: the three system grants the tracker, the shield and the foreground notice need.
// One list, read by the first-launch intro and by the dashboard's reminder subheader.
import { host } from './host.js';

export const ANDROID_PERMISSIONS = [
  {
    field: 'usageAccess',
    titleKey: 'permIntro_usageTitle',
    bodyKey: 'permIntro_usageBody',
    grant: () => host.tracker.openUsageSettings(),
  },
  {
    field: 'accessibility',
    titleKey: 'permIntro_blockingTitle',
    bodyKey: 'permIntro_blockingBody',
    grant: () => host.tracker.openAccessibilitySettings(),
    // Switched on but not running: Android stopped it, and only switching it off and on restarts it.
    stoppedField: 'accessibilityStopped',
    // Xiaomi never restarts it after a kill unless autostart is allowed. MIUI does not tell apps
    // whether it is, so the button stays offered.
    autostart: true,
  },
  {
    field: 'notifications',
    titleKey: 'permIntro_notificationsTitle',
    bodyKey: 'permIntro_notificationsBody',
    grant: () => host.tracker.requestNotifications(),
  },
];

const NONE = Object.fromEntries(ANDROID_PERMISSIONS.map(perm => [perm.field, false]));

// Every field false where there is no tracker: the extension and the desktop app.
export async function permissionStatus() {
  if (!host.tracker) return { ...NONE };
  try {
    return await host.tracker.status();
  } catch {
    return { ...NONE };
  }
}

export async function missingPermissions() {
  if (!host.tracker) return [];
  const status = await permissionStatus();
  return ANDROID_PERMISSIONS.filter(perm => !status[perm.field]);
}
