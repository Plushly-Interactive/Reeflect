# Privacy Policy — Reeflect: Screen Time & Website Blocker

TL;DR: Reeflect stores your browsing activity on your own device to provide screen-time tracking and blocking. Nothing is sent anywhere unless you turn on cross-device sync, and then only in a form the server cannot read.

**Effective date:** 2026-09-06

## What data Reeflect collects

Reeflect collects the following information about your browsing activity, solely to provide its screen-time tracking and website-blocking features:

- **Domain names and URLs** of pages you visit
- **Time spent** on each site, broken down into active (keyboard/mouse input), audio-playing, and idle sessions
- **Rules you create** (site targets, time limits, periods)
- **Settings** (idle threshold, clock format, week start day)

No personal account information, credentials, or payment data is ever collected. Turning on sync creates no account in the usual sense: there is no email, phone number or name, only a 24-word recovery phrase that stays with you.

## How your data is stored

All data is stored **locally on your device**, using the browser's built-in storage APIs (`chrome.storage.local` and IndexedDB). With sync off, which is the default, nothing is ever transmitted to any external server, cloud service, or third party.

## Cross-device sync (optional)

Sync is off until you turn it on from the Sync page. When it is on, Reeflect uploads your browsing intervals to `sync.coralclock.com` so your other devices can download them.

- **Encrypted before it leaves.** Every interval (domain, path, times, kind) and every device name is encrypted on your device with a key that never leaves your devices. The server stores and relays ciphertext it cannot decrypt.
- **What the server can see.** An account identifier derived from your recovery phrase, a public key used to sign in, an identifier for each device, key-version numbers, and when and how much each device uploads. Like any server it also sees your IP address while you are connected.
- **What the server cannot see.** Which sites you visited, when, for how long, on which path, or what your devices are called.
- **No third-party access.** The server exists only to hand ciphertext between your own devices.
- **Your recovery phrase** is the only credential. It is never sent to the server. Anyone who has it can read your data, so keep it private.

## Data sharing

Reeflect does not share, sell, rent, or transmit your data to anyone other than, when sync is on, the sync server described above. There are no analytics services, advertising networks, or third-party SDKs included in the extension.

## Permissions used

Reeflect requests the following browser permissions:

| Permission | Reason |
|---|---|
| `storage` | Save browsing intervals, rules, and settings locally |
| `tabs` | Detect which tab is active to measure time accurately |
| `webNavigation` | Detect page navigations to start and stop time tracking |
| `declarativeNetRequestWithHostAccess` | Block sites when a time limit is reached |
| `alarms` | Flush tracking data periodically and check limits on a schedule |
| `idle` | Detect when you step away from the computer to pause active-time tracking |
| `favicon` | Display site icons in the dashboard |
| `notifications` | Alert you when a time limit is reached or being approached |
| `<all_urls>` (optional host permission) | Requested only for the specific site(s) you set a rule on, so Reeflect can redirect that site once its limit is reached; a rule for a keyword or regex pattern requests it for all sites since no single site can be named in advance. Not held for sites you haven't set a rule for. |

## Your control over your data

You can view, prune, and permanently delete your browsing data at any time using the **Manage Storage** page within Reeflect. Deleting data on a syncing device removes it from your other devices too.

On the Sync page you can sign out any device, and **Stop syncing everywhere** permanently deletes everything the server holds for your account. Uninstalling the extension removes all data on that device; if sync was on, use *Stop syncing everywhere* first, or the encrypted copy stays on the server for your other devices.

## Data export

Reeflect allows you to export your data as a JSON file for backup or personal analysis. This file stays on your device and is never uploaded anywhere by the extension.

## Changes to this policy

If this policy changes materially, the updated version will be published at this URL with a new effective date.
