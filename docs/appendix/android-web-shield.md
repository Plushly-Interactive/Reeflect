# Android web shield

TL;DR: the opt-in "Websites in browsers" service that reads browsers' address bars; how each browser's bar is found and how its text becomes a row.

Off by default (`webInBrowsers` in prefs.json). A separate service, so the app shield keeps its "never reads screen content" promise. `tracker.rs` `BARS` lists each browser's address-bar id from its own source: Chrome, Brave and Vivaldi `<package>:id/url_bar` (Chromium `url_bar.xml`), DuckDuckGo `omnibarTextInput`, Firefox the Compose tag `ADDRESSBAR_URL_BOX` (address inside the content description). The site is recorded in the extension's shape (`www.` dropped, path plus query); a browser that shows only the host (DuckDuckGo by default) gives path `""`, meaning unknown. An unreadable address (search, internal page) counts as the browser app; a hidden bar (fullscreen video) keeps the last site. Opt-in off: every address is ignored and browsers count as apps.
| Notifications (`POST_NOTIFICATIONS`, Android 13+) | runtime prompt from the settings card | the service's persistent notice |

The app asks for all three before anything else. `ui/shared/permissionIntro.js` paints one fullscreen panel per permission, swiped sideways, and the guided tour waits for it. The screen returns on every launch until the user reaches the last panel. After that the dashboard carries a subheader while a permission is missing, and that subheader reopens the same panels.
