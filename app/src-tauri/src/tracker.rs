//! The app's presence tracker and block decision, the twin of the extension's `intervalTracker.js`
//! and `enforcement.js`: one row per stay of an app in front, appended when the stay starts and
//! extended on every poll; closed on leave, screen off, keyguard or shutdown. Only launchable
//! packages count. The core stores rows and gives the verdict; this file decides what a stay is
//! and which package an over-limit rule covers. No platform calls: the host hands in events.
use serde::{Deserialize, Serialize};

/// Android's `UsageEvents.Event` type constants, as the host reports them.
pub const ACTIVITY_RESUMED: i32 = 1;
pub const ACTIVITY_PAUSED: i32 = 2;
pub const SCREEN_NON_INTERACTIVE: i32 = 16;
pub const KEYGUARD_SHOWN: i32 = 17;
pub const ACTIVITY_STOPPED: i32 = 23;
pub const DEVICE_SHUTDOWN: i32 = 26;
/// Desktop only, not an Android type: no input for the idle threshold, or a locked screen.
pub const IDLE: i32 = -1;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub package: String,
    pub kind: i32,
    pub at: i64,
    #[serde(default)]
    pub launchable: bool,
    /// The activity's class: a pause or stop closes the stay only for the activity in front.
    #[serde(default)]
    pub class: String,
    /// The launcher label (Reddit for com.reddit.frontpage); synced inside the row so other devices show it.
    #[serde(default)]
    pub label: Option<String>,
}

/// A site read from a browser's address bar, in the extension's shape: `www.` dropped, `path` the
/// pathname without a trailing slash plus the query, or "" when the browser shows the host only.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Web {
    pub domain: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Open {
    pub package: String,
    pub from: i64,
    pub local_id: Option<u64>,
    #[serde(default)]
    pub class: String,
    /// Set while the app in front is a browser whose address bar read: the row is this site.
    pub web: Option<Web>,
    #[serde(default)]
    pub label: Option<String>,
    /// An `idle` row: the program stayed in front with no input.
    #[serde(default)]
    pub idle: bool,
}

/// The last address read in a browser, kept so a stay opened later in that browser starts on it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Address {
    pub package: String,
    pub web: Option<Web>,
}

/// What survives between polls: where the last poll ended and the stay still open.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub since: Option<i64>,
    pub open: Option<Open>,
    pub address: Option<Address>,
    /// Desktop: the programs playing sound, each an `audio` row of its own, in front or not.
    #[serde(default)]
    pub sounds: Vec<Sound>,
}

/// A program playing sound: its `audio` row, and the last poll that heard it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sound {
    pub package: String,
    pub label: Option<String>,
    pub from: i64,
    pub heard: i64,
    pub local_id: Option<u64>,
}

/// The two writes a stay needs from the row store. `web` None: the row is the app itself, named `label`.
pub trait Rows {
    fn append(&self, kind: &str, package: &str, label: Option<&str>, web: Option<&Web>, from: i64, to: i64) -> Result<u64, String>;
    fn touch(&self, local_id: u64, to: i64) -> Result<(), String>;
}

/// A browser's address bar, found by its accessibility view id. Every id comes from the browser's
/// own source: Chromium `chrome/android/java/res/layout/url_bar.xml` (Chrome; Brave and Vivaldi
/// keep it, checked in brave-core and vivaldi-source 8.2.4133), DuckDuckGo `view_omnibar.xml`,
/// Firefox `BrowserToolbarTestTags.kt` (a Compose tag, no package prefix).
pub struct Bar {
    pub package: &'static str,
    pub id: &'static str,
    /// The bar shows the path whenever there is one, so a bare host means "/".
    pub keeps_path: bool,
    /// The address sits in the content description, as "<title> <address>. <hint>" (Firefox).
    pub described: bool,
}

pub const BARS: &[Bar] = &[
    Bar { package: "com.android.chrome", id: "com.android.chrome:id/url_bar", keeps_path: true, described: false },
    Bar { package: "com.brave.browser", id: "com.brave.browser:id/url_bar", keeps_path: true, described: false },
    Bar { package: "com.vivaldi.browser", id: "com.vivaldi.browser:id/url_bar", keeps_path: true, described: false },
    Bar { package: "com.duckduckgo.mobile.android", id: "com.duckduckgo.mobile.android:id/omnibarTextInput", keeps_path: false, described: false },
    Bar { package: "org.mozilla.firefox", id: "ADDRESSBAR_URL_BOX", keeps_path: true, described: true },
];

pub fn bar(package: &str) -> Option<&'static Bar> {
    BARS.iter().find(|b| b.package == package)
}

/// The site in an address bar's text, or None for a search, an internal page or no address.
pub fn parse_address(bar: &Bar, text: &str) -> Option<Web> {
    let text = text.trim();
    let token = if bar.described {
        let head = text.rsplit_once(". ").map_or(text, |(h, _)| h);
        head.split_whitespace().last()?
    } else {
        // Chrome appends ". <warning>" (UrlBar.onInitializeAccessibilityNodeInfo); anything else
        // after the first word is a search query shown in place of the address.
        let mut words = text.splitn(2, char::is_whitespace);
        let first = words.next()?;
        if words.next().is_some() && !first.ends_with('.') {
            return None;
        }
        first
    };
    let token = token.trim_end_matches('.');
    let rest = match token.split_once("://") {
        Some((scheme, rest)) if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") => rest,
        Some(_) => return None,
        None => token,
    };
    let split = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (host, tail) = rest.split_at(split);
    let host = host.split(':').next()?.to_ascii_lowercase();
    if !host.contains('.') || host.starts_with('.') || host.ends_with('.') || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.') {
        return None;
    }
    let domain = host.strip_prefix("www.").unwrap_or(&host).to_string();
    let tail = tail.split('#').next().unwrap_or("");
    let (pathname, query) = tail.split_once('?').map_or((tail, None), |(p, q)| (p, Some(q)));
    let path = match (pathname, query) {
        ("", None) if !bar.keeps_path => String::new(),
        ("" | "/", q) => format!("/{}", q.map(|q| format!("?{q}")).unwrap_or_default()),
        (p, q) => format!("{}{}", p.trim_end_matches('/'), q.map(|q| format!("?{q}")).unwrap_or_default()),
    };
    Some(Web { domain, path })
}

/// A browser reported its address at `at`: the open stay in that browser splits there when the
/// site changed. `web` None (unreadable, or the opt-in is off) turns the stay back into the app.
pub fn address(state: &mut State, package: &str, web: Option<Web>, at: i64, rows: &impl Rows) -> Result<(), String> {
    state.address = Some(Address { package: package.to_string(), web: web.clone() });
    let Some(open) = state.open.as_mut() else { return Ok(()) };
    if open.package != package || open.web == web {
        return Ok(());
    }
    if open.local_id.is_none() {
        open.web = web;
        return Ok(());
    }
    let at = at.max(open.from);
    let (class, label) = state.open.as_ref().map(|o| (o.class.clone(), o.label.clone())).unwrap_or_default();
    close(state, at, rows)?;
    state.open = Some(Open { package: package.to_string(), from: at, local_id: None, class, web, label, idle: false });
    Ok(())
}

/// Folds the events since the last poll into the open stay, then extends it to `now`. Returns the
/// number of stays closed.
pub fn tick(state: &mut State, events: &[Event], now: i64, rows: &impl Rows, own_package: &str) -> Result<usize, String> {
    let mut closed = 0;
    for e in events {
        match e.kind {
            ACTIVITY_RESUMED => {
                if let Some(o) = state.open.as_mut().filter(|o| o.package == e.package && !o.idle) {
                    o.class = e.class.clone();
                } else {
                    closed += close(state, e.at, rows)?;
                    if e.launchable && e.package != own_package {
                        let web = state.address.as_ref().filter(|a| a.package == e.package).and_then(|a| a.web.clone());
                        state.open = Some(Open { package: e.package.clone(), from: e.at, local_id: None, class: e.class.clone(), web, label: e.label.clone(), idle: false });
                    }
                }
            }
            IDLE => {
                if !state.open.as_ref().is_some_and(|o| o.package == e.package && o.idle) {
                    closed += close(state, e.at, rows)?;
                    if e.package != own_package {
                        state.open = Some(Open { package: e.package.clone(), from: e.at, local_id: None, class: String::new(), web: None, label: e.label.clone(), idle: true });
                    }
                }
            }
            // A trampoline activity (Chrome's launcher) stops after the next one of the same app
            // resumed; only the activity in front ends the stay.
            ACTIVITY_PAUSED | ACTIVITY_STOPPED => {
                if state.open.as_ref().is_some_and(|o| o.package == e.package && (e.class.is_empty() || o.class.is_empty() || o.class == e.class)) {
                    closed += close(state, e.at, rows)?;
                }
            }
            SCREEN_NON_INTERACTIVE | KEYGUARD_SHOWN | DEVICE_SHUTDOWN => closed += close(state, e.at, rows)?,
            _ => {}
        }
    }
    extend(state, now, rows)?;
    state.since = Some(now);
    Ok(closed)
}

/// A program or app by its id (`chrome.exe` lowercased, `com.spotify.music`) and its display name.
pub struct Front {
    pub exe: String,
    pub label: Option<String>,
}

#[cfg(not(target_os = "android"))]
/// One desktop poll as the events `tick` folds. A gap longer than `gap_ms` since the last poll is
/// sleep or hibernation, closed where the last poll ended. No input for `idle_ms`, or a locked
/// screen, turns the stay into an idle row from the last input, as the extension does; input
/// ends it there. `front` None (no window, a process we may not read) closes now.
/// With no stay open, an idle row starts no earlier than the poll that last saw nothing open, or
/// this poll after a gap: the last input can predate a sleep, since the tick count runs through it.
pub fn desktop_events(state: &State, front: Option<Front>, locked: bool, last_input: i64, idle_ms: i64, now: i64, gap_ms: i64) -> Vec<Event> {
    let end = |at: i64| Event { package: String::new(), kind: SCREEN_NON_INTERACTIVE, at, launchable: false, class: String::new(), label: None };
    let mut events = Vec::new();
    let mut open = state.open.as_ref();
    let mut floor = if open.is_some() { i64::MIN } else { state.since.unwrap_or(now) };
    if let Some(since) = state.since.filter(|s| now - s > gap_ms) {
        events.push(end(since));
        open = None;
        floor = now;
    }
    let was_idle = open.is_some_and(|o| o.idle);
    let front = if locked { open.map(|o| Front { exe: o.package.clone(), label: o.label.clone() }) } else { front };
    let Some(f) = front else {
        events.push(end(now));
        return events;
    };
    let event = |kind: i32, at: i64| Event { package: f.exe.clone(), kind, at, launchable: true, class: String::new(), label: f.label.clone() };
    if locked || now - last_input >= idle_ms {
        events.push(event(IDLE, if was_idle { now } else { last_input.max(floor).min(now) }));
    } else {
        events.push(event(ACTIVITY_RESUMED, if was_idle { last_input } else { now }));
    }
    events
}

/// One poll of the programs heard now (desktop: a peak above zero, not muted; Android: a media
/// session that is playing), folded into the `audio` rows. A row grows to each poll that hears its program and ends at the last one, once
/// `hold_ms` passes in silence, so a pause between two songs does not split it. Idle and a locked
/// screen leave sound alone, as in the extension; a gap since the last poll (sleep) ends every row.
pub fn audio(state: &mut State, heard: &[Front], now: i64, hold_ms: i64, gap_ms: i64, rows: &impl Rows, own_package: &str) -> Result<(), String> {
    if state.since.is_some_and(|s| now - s > gap_ms) {
        state.sounds.clear();
    }
    state.sounds.retain(|s| now - s.heard < hold_ms || heard.iter().any(|f| f.exe == s.package));
    for f in heard.iter().filter(|f| f.exe != own_package) {
        let sound = match state.sounds.iter_mut().find(|s| s.package == f.exe) {
            Some(s) => s,
            None => {
                state.sounds.push(Sound { package: f.exe.clone(), label: f.label.clone(), from: now, heard: now, local_id: None });
                continue;
            }
        };
        sound.heard = now;
        match sound.local_id {
            Some(id) => rows.touch(id, now)?,
            None => sound.local_id = Some(rows.append("audio", &sound.package, sound.label.as_deref(), None, sound.from, now)?),
        }
    }
    Ok(())
}

fn extend(state: &mut State, to: i64, rows: &impl Rows) -> Result<(), String> {
    let Some(open) = state.open.as_mut() else { return Ok(()) };
    if to <= open.from {
        return Ok(());
    }
    match open.local_id {
        None => {
            let label = if open.web.is_none() { open.label.as_deref() } else { None };
            let kind = if open.idle { "idle" } else { "active" };
            open.local_id = Some(rows.append(kind, &open.package, label, open.web.as_ref(), open.from, to)?);
        }
        Some(id) => rows.touch(id, to)?,
    }
    Ok(())
}

fn close(state: &mut State, at: i64, rows: &impl Rows) -> Result<usize, String> {
    if state.open.is_none() {
        return Ok(0);
    }
    extend(state, at, rows)?;
    state.open = None;
    Ok(1)
}

/// Which over-limit rule covers `package` of `source` (`app`, `desktop`), from the core's verdict:
/// `(rule id, label)`. `covers` is the core's answer for one matcher (exact, keyword or regex), so
/// the shield holds no matching.
pub fn blocking_rule(verdict: &serde_json::Value, rules: &serde_json::Value, package: &str, source: &str, covers: impl Fn(&serde_json::Value) -> bool) -> Option<(String, String)> {
    let over = verdict.get("overage")?.as_object()?;
    for (rule_id, entry) in over {
        let matchers = entry.get("matchers")?.as_array()?;
        let hit = matchers.iter().any(|m| m.get("source").and_then(|s| s.as_str()) == Some(source) && covers(m));
        if hit {
            let label = rules
                .as_array()
                .and_then(|list| list.iter().find(|r| r.get("id").and_then(|i| i.as_str()) == Some(rule_id)))
                .and_then(|r| r.get("label").and_then(|l| l.as_str()))
                .unwrap_or(package)
                .to_string();
            return Some((rule_id.clone(), label));
        }
    }
    None
}

/// Which over-limit rule covers a site, and the web matcher that does, from the core's verdict.
/// `covers` is the core's `matchesRule` for one web matcher.
pub fn web_blocking_rule(verdict: &serde_json::Value, covers: impl Fn(&serde_json::Value) -> bool) -> Option<(String, serde_json::Value)> {
    let over = verdict.get("overage")?.as_object()?;
    over.iter().find_map(|(rule_id, entry)| {
        let matchers = entry.get("matchers")?.as_array()?;
        let m = matchers.iter().find(|m| m.get("source").and_then(|s| s.as_str()).unwrap_or("web") == "web" && covers(m))?;
        Some((rule_id.clone(), m.clone()))
    })
}

fn q(s: &str) -> String {
    s.replace('%', "%25").replace('&', "%26").replace('|', "%7C").replace(' ', "%20").replace('#', "%23").replace('+', "%2B")
}

/// The verdict's numbers for the blocked page, `&overBy=…&visits=…`, so it shows them without a core call.
/// Empty when the verdict has no entry for the rule; the page then asks the core itself.
pub fn stats_query(verdict: &serde_json::Value, rule_id: &str) -> String {
    let Some(entry) = verdict.get("overage").and_then(|o| o.get(rule_id)) else { return String::new() };
    let n = |k: &str| entry.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
    format!("&overBy={}&visits={}", n("overBy"), n("visits"))
}

/// The shared blocked page, with the same parameters the extension's redirect carries.
pub fn blocked_route(rule_id: &str, package: &str, label: &str) -> String {
    format!("/src/pages/blocked/blocked.html?rule={}&blockKey={}&site={}", q(rule_id), q(&format!("{package}|exact|")), q(label))
}

/// The blocked page for a web matcher: `blockKey`, `site` and `path` as the extension's
/// `blockedUrl` builds them (`ui/shared/rules.js` `blockKey`).
pub fn web_blocked_route(rule_id: &str, m: &serde_json::Value) -> String {
    let s = |k: &str| m.get(k).and_then(|v| v.as_str()).unwrap_or("");
    let key = match s("matchType") {
        "regex" => format!("{}|regex|", s("pattern")),
        "keyword" => format!("{}|keyword|", s("keyword")),
        t => format!("{}|{t}|{}", s("target"), s("path")),
    };
    let mut route = format!("/src/pages/blocked/blocked.html?rule={}&blockKey={}", q(rule_id), q(&key));
    if !s("target").is_empty() {
        route += &format!("&site={}", q(s("target")));
        if !s("path").is_empty() {
            route += &format!("&path={}", q(s("path")));
        }
    }
    route
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Fake {
        rows: RefCell<Vec<(u64, String, i64, i64)>>,
        labels: RefCell<Vec<Option<String>>>,
    }

    impl Rows for Fake {
        fn append(&self, kind: &str, package: &str, label: Option<&str>, web: Option<&Web>, from: i64, to: i64) -> Result<u64, String> {
            self.labels.borrow_mut().push(label.map(str::to_string));
            let mut rows = self.rows.borrow_mut();
            let id = rows.len() as u64 + 1;
            let name = web.map_or(package.to_string(), |w| format!("{}{}", w.domain, w.path));
            let name = if kind == "active" { name } else { format!("{kind}:{name}") };
            rows.push((id, name, from, to));
            Ok(id)
        }
        fn touch(&self, local_id: u64, to: i64) -> Result<(), String> {
            let mut rows = self.rows.borrow_mut();
            rows.iter_mut().find(|r| r.0 == local_id).ok_or("no such row")?.3 = to;
            Ok(())
        }
    }

    fn ev(package: &str, kind: i32, at: i64) -> Event {
        Event { package: package.into(), kind, at, launchable: true, class: String::new(), label: None }
    }

    #[test]
    fn an_app_row_carries_its_launcher_label_and_a_site_row_none() {
        let rows = Fake::default();
        let mut s = State::default();
        let named = |package: &str, label: &str, at| Event { label: Some(label.into()), ..ev(package, ACTIVITY_RESUMED, at) };
        tick(&mut s, &[named("com.reddit.frontpage", "Reddit", 1_000)], 2_000, &rows, "own").unwrap();
        tick(&mut s, &[named("com.android.chrome", "Chrome", 3_000)], 3_000, &rows, "own").unwrap();
        address(&mut s, "com.android.chrome", Some(Web { domain: "a.example".into(), path: "/".into() }), 3_000, &rows).unwrap();
        tick(&mut s, &[], 4_000, &rows, "own").unwrap();
        assert_eq!(*rows.labels.borrow(), [Some("Reddit".to_string()), None]);
    }

    #[test]
    fn a_trampoline_activity_stopping_late_leaves_the_stay_open() {
        let rows = Fake::default();
        let mut state = State::default();
        let on = |class: &str, kind, at| Event { class: class.into(), ..ev("chrome", kind, at) };
        let events = [on("Launcher", ACTIVITY_RESUMED, 1_000), on("Launcher", ACTIVITY_PAUSED, 1_100), on("Tabbed", ACTIVITY_RESUMED, 1_200), on("Launcher", ACTIVITY_STOPPED, 3_000)];
        tick(&mut state, &events, 5_000, &rows, "me").unwrap();
        assert_eq!(state.open.as_ref().map(|o| o.class.as_str()), Some("Tabbed"));
        assert_eq!(rows.rows.borrow().last().unwrap().3, 5_000, "still growing");
        tick(&mut state, &[on("Tabbed", ACTIVITY_PAUSED, 6_000)], 8_000, &rows, "me").unwrap();
        assert!(state.open.is_none());
    }

    #[test]
    fn a_stay_is_one_row_extended_on_every_poll_and_closed_when_left() {
        let rows = Fake::default();
        let mut state = State::default();
        tick(&mut state, &[ev("a", ACTIVITY_RESUMED, 1_000)], 6_000, &rows, "me").unwrap();
        assert_eq!(rows.rows.borrow()[0], (1, "a".into(), 1_000, 6_000));
        tick(&mut state, &[], 11_000, &rows, "me").unwrap();
        assert_eq!(rows.rows.borrow()[0].3, 11_000, "the same row grows");
        let closed = tick(&mut state, &[ev("a", ACTIVITY_PAUSED, 12_000), ev("b", ACTIVITY_RESUMED, 12_100)], 16_000, &rows, "me").unwrap();
        assert_eq!(closed, 1);
        assert_eq!(rows.rows.borrow()[0].3, 12_000);
        assert_eq!(rows.rows.borrow()[1], (2, "b".into(), 12_100, 16_000));
        tick(&mut state, &[ev("b", SCREEN_NON_INTERACTIVE, 17_000)], 20_000, &rows, "me").unwrap();
        assert!(state.open.is_none());
        assert_eq!(rows.rows.borrow().len(), 2);
        assert_eq!(state.since, Some(20_000));
    }

    #[test]
    fn the_launcher_and_the_app_itself_never_open_a_stay() {
        let rows = Fake::default();
        let mut state = State::default();
        let mut launcher = ev("launcher", ACTIVITY_RESUMED, 1_000);
        launcher.launchable = false;
        tick(&mut state, &[launcher, ev("me", ACTIVITY_RESUMED, 2_000)], 5_000, &rows, "me").unwrap();
        assert!(state.open.is_none());
        assert!(rows.rows.borrow().is_empty());
    }

    #[test]
    fn the_verdict_names_the_rule_that_covers_the_package() {
        let rules = serde_json::json!([{ "id": "r1", "source": "app", "target": "com.x", "label": "X" }]);
        let verdict = serde_json::json!({ "overage": { "r1": { "matchers": [{ "source": "app", "matchType": "exact", "target": "com.x" }], "overBy": 5 } } });
        let exact = |pkg: &'static str| move |m: &serde_json::Value| m.get("target").and_then(|t| t.as_str()) == Some(pkg);
        assert_eq!(blocking_rule(&verdict, &rules, "com.x", "app", exact("com.x")), Some(("r1".into(), "X".into())));
        assert_eq!(blocking_rule(&verdict, &rules, "com.y", "app", exact("com.y")), None);
        // A web matcher is never asked, whatever the core would say.
        let web = serde_json::json!({ "overage": { "r2": { "matchers": [{ "source": "web", "matchType": "keyword", "keyword": "x" }], "overBy": 5 } } });
        assert_eq!(blocking_rule(&web, &rules, "com.x", "app", |_| true), None);
        // An app matcher never blocks a desktop program of the same name, nor the reverse.
        assert_eq!(blocking_rule(&verdict, &rules, "com.x", "desktop", |_| true), None);
        assert_eq!(blocked_route("r1", "com.x", "X app"), "/src/pages/blocked/blocked.html?rule=r1&blockKey=com.x%7Cexact%7C&site=X%20app");
        assert_eq!(stats_query(&verdict, "r1"), "&overBy=5&visits=0", "a verdict without visits reads as none");
        assert_eq!(stats_query(&verdict, "r9"), "", "no entry, no numbers");
    }

    fn web(domain: &str, path: &str) -> Option<Web> {
        Some(Web { domain: domain.into(), path: path.into() })
    }

    #[test]
    fn an_address_bar_reads_as_the_extension_would_record_the_site() {
        let chrome = bar("com.android.chrome").unwrap();
        assert_eq!(parse_address(chrome, "example.com"), web("example.com", "/"));
        assert_eq!(parse_address(chrome, "www.Example.com/a/b/?q=1#top"), web("example.com", "/a/b?q=1"));
        assert_eq!(parse_address(chrome, "https://news.example.com:8443/x"), web("news.example.com", "/x"));
        assert_eq!(parse_address(chrome, "example.com/login. Not secure"), web("example.com", "/login"));
        assert_eq!(parse_address(chrome, "chrome://settings"), None);
        assert_eq!(parse_address(chrome, "cats and dogs"), None);
        assert_eq!(parse_address(chrome, "cats.com is good"), None, "a search, not an address");
        assert_eq!(parse_address(chrome, ""), None);
        let ddg = bar("com.duckduckgo.mobile.android").unwrap();
        assert_eq!(parse_address(ddg, "example.com"), web("example.com", ""), "host only: path unknown");
        assert_eq!(parse_address(ddg, "example.com/a"), web("example.com", "/a"));
        let firefox = bar("org.mozilla.firefox").unwrap();
        assert_eq!(parse_address(firefox, "Example Domain example.com/page. Tap to edit"), web("example.com", "/page"));
        assert_eq!(parse_address(firefox, "Example Domain example.com"), web("example.com", "/"));
    }

    #[test]
    fn a_browser_stay_splits_at_each_site_and_falls_back_to_the_browser_when_unreadable() {
        let rows = Fake::default();
        let mut state = State::default();
        address(&mut state, "chrome", web("a.com", "/"), 500, &rows).unwrap();
        tick(&mut state, &[ev("chrome", ACTIVITY_RESUMED, 1_000)], 5_000, &rows, "me").unwrap();
        assert_eq!(rows.rows.borrow()[0], (1, "a.com/".into(), 1_000, 5_000), "the stay starts on the last address");
        address(&mut state, "chrome", web("a.com", "/"), 6_000, &rows).unwrap();
        assert_eq!(rows.rows.borrow().len(), 1, "the same address changes nothing");
        address(&mut state, "chrome", web("b.com", "/x"), 7_000, &rows).unwrap();
        tick(&mut state, &[], 10_000, &rows, "me").unwrap();
        assert_eq!(rows.rows.borrow()[0].3, 7_000);
        assert_eq!(rows.rows.borrow()[1], (2, "b.com/x".into(), 7_000, 10_000));
        address(&mut state, "chrome", None, 11_000, &rows).unwrap();
        tick(&mut state, &[], 12_000, &rows, "me").unwrap();
        assert_eq!(rows.rows.borrow()[2], (3, "chrome".into(), 11_000, 12_000));
        address(&mut state, "other", web("c.com", "/"), 12_500, &rows).unwrap();
        assert_eq!(state.open.as_ref().unwrap().package, "chrome", "another browser's address leaves this stay alone");
    }

    #[test]
    fn a_web_block_names_the_matcher_the_blocked_page_expects() {
        let verdict = serde_json::json!({ "overage": { "r1": { "matchers": [
            { "source": "app", "matchType": "exact", "target": "com.x" },
            { "source": "web", "matchType": "pathPrefix", "target": "a.com", "path": "/news" }
        ] } } });
        let (rule, m) = web_blocking_rule(&verdict, |m| m.get("target").and_then(|t| t.as_str()) == Some("a.com")).unwrap();
        assert_eq!(rule, "r1");
        assert_eq!(web_blocked_route(&rule, &m), "/src/pages/blocked/blocked.html?rule=r1&blockKey=a.com%7CpathPrefix%7C/news&site=a.com&path=/news");
        assert_eq!(web_blocking_rule(&verdict, |m| m.get("source").and_then(|s| s.as_str()) == Some("app")), None, "an app matcher never blocks a site");
        let kw = serde_json::json!({ "matchType": "keyword", "keyword": "cats" });
        assert_eq!(web_blocked_route("r2", &kw), "/src/pages/blocked/blocked.html?rule=r2&blockKey=cats%7Ckeyword%7C");
    }

    fn poll_as(state: &mut State, rows: &Fake, exe: Option<&str>, locked: bool, last_input: i64, now: i64) {
        let front = exe.map(|e| Front { exe: e.into(), label: Some(e.to_uppercase()) });
        let events = desktop_events(state, front, locked, last_input, 300_000, now, 15_000);
        tick(state, &events, now, rows, "reeflect.exe").unwrap();
    }

    fn poll(state: &mut State, rows: &Fake, exe: Option<&str>, last_input: i64, now: i64) {
        poll_as(state, rows, exe, false, last_input, now);
    }

    #[test]
    fn a_desktop_stay_follows_the_program_in_front_and_skips_reeflect_itself() {
        let rows = Fake::default();
        let mut s = State::default();
        poll(&mut s, &rows, Some("code.exe"), 0, 0);
        poll(&mut s, &rows, Some("code.exe"), 5_000, 5_000);
        poll(&mut s, &rows, Some("chrome.exe"), 10_000, 10_000);
        poll(&mut s, &rows, Some("reeflect.exe"), 15_000, 15_000);
        poll(&mut s, &rows, Some("reeflect.exe"), 20_000, 20_000);
        assert_eq!(*rows.rows.borrow(), [(1, "code.exe".into(), 0, 10_000), (2, "chrome.exe".into(), 10_000, 15_000)]);
        assert_eq!(rows.labels.borrow()[0].as_deref(), Some("CODE.EXE"));
    }

    #[test]
    fn sleep_closes_the_stay_where_the_last_poll_ended() {
        let rows = Fake::default();
        let mut s = State::default();
        poll(&mut s, &rows, Some("code.exe"), 0, 0);
        poll(&mut s, &rows, Some("code.exe"), 5_000, 5_000);
        poll(&mut s, &rows, Some("code.exe"), 3_600_000, 3_600_000);
        poll(&mut s, &rows, Some("code.exe"), 3_605_000, 3_605_000);
        assert_eq!(*rows.rows.borrow(), [(1, "code.exe".into(), 0, 5_000), (2, "code.exe".into(), 3_600_000, 3_605_000)]);
    }

    #[test]
    fn idle_after_sleep_starts_at_the_wake_not_at_the_input_before_it() {
        let rows = Fake::default();
        let mut s = State::default();
        poll(&mut s, &rows, Some("code.exe"), 0, 0);
        poll(&mut s, &rows, Some("code.exe"), 5_000, 5_000);
        poll(&mut s, &rows, Some("code.exe"), 5_000, 3_600_000);
        poll(&mut s, &rows, Some("code.exe"), 5_000, 3_605_000);
        poll(&mut s, &rows, Some("code.exe"), 3_607_000, 3_610_000);
        assert_eq!(*rows.rows.borrow(), [(1, "code.exe".into(), 0, 5_000), (2, "idle:code.exe".into(), 3_600_000, 3_607_000), (3, "code.exe".into(), 3_607_000, 3_610_000)]);
    }

    #[test]
    fn idle_after_sleep_starts_at_the_wake_when_no_window_was_in_front_at_first() {
        let rows = Fake::default();
        let mut s = State::default();
        poll(&mut s, &rows, Some("code.exe"), 0, 0);
        poll(&mut s, &rows, Some("code.exe"), 5_000, 5_000);
        poll(&mut s, &rows, None, 5_000, 3_600_000);
        poll(&mut s, &rows, Some("code.exe"), 5_000, 3_605_000);
        poll(&mut s, &rows, Some("code.exe"), 5_000, 3_610_000);
        assert_eq!(*rows.rows.borrow(), [(1, "code.exe".into(), 0, 5_000), (2, "idle:code.exe".into(), 3_600_000, 3_610_000)]);
    }

    #[test]
    fn no_input_turns_the_stay_idle_from_the_last_input_until_input_returns() {
        let rows = Fake::default();
        let mut s = State::default();
        for t in (0..=400_000).step_by(5_000) {
            poll(&mut s, &rows, Some("code.exe"), t.min(60_000), t);
        }
        poll(&mut s, &rows, Some("code.exe"), 403_000, 405_000);
        assert_eq!(*rows.rows.borrow(), [(1, "code.exe".into(), 0, 60_000), (2, "idle:code.exe".into(), 60_000, 403_000), (3, "code.exe".into(), 403_000, 405_000)]);
    }

    #[test]
    fn a_locked_screen_is_idle_at_once_and_a_lost_window_closes_the_stay() {
        let rows = Fake::default();
        let mut s = State::default();
        poll(&mut s, &rows, Some("code.exe"), 0, 0);
        poll_as(&mut s, &rows, Some("lockapp.exe"), true, 4_000, 5_000);
        poll_as(&mut s, &rows, Some("lockapp.exe"), true, 4_000, 10_000);
        poll(&mut s, &rows, Some("code.exe"), 13_000, 15_000);
        poll(&mut s, &rows, None, 19_000, 20_000);
        assert_eq!(*rows.rows.borrow(), [(1, "code.exe".into(), 0, 4_000), (2, "idle:code.exe".into(), 4_000, 13_000), (3, "code.exe".into(), 13_000, 20_000)]);
        assert!(s.open.is_none());
    }

    fn hear(state: &mut State, rows: &Fake, exes: &[&str], now: i64) {
        let heard: Vec<Front> = exes.iter().map(|e| Front { exe: e.to_string(), label: None }).collect();
        audio(state, &heard, now, 15_000, 15_000, rows, "reeflect.exe").unwrap();
        state.since = Some(now);
    }

    #[test]
    fn sound_is_a_row_per_program_that_rides_out_a_short_pause() {
        let rows = Fake::default();
        let mut s = State::default();
        hear(&mut s, &rows, &["spotify.exe", "reeflect.exe"], 0);
        hear(&mut s, &rows, &["spotify.exe"], 5_000);
        hear(&mut s, &rows, &[], 10_000);
        hear(&mut s, &rows, &["spotify.exe", "chrome.exe"], 15_000);
        hear(&mut s, &rows, &["chrome.exe"], 20_000);
        assert_eq!(*rows.rows.borrow(), [(1, "audio:spotify.exe".into(), 0, 15_000), (2, "audio:chrome.exe".into(), 15_000, 20_000)]);
        for t in [25_000, 30_000, 35_000] {
            hear(&mut s, &rows, &[], t);
        }
        hear(&mut s, &rows, &["spotify.exe"], 40_000);
        hear(&mut s, &rows, &["spotify.exe"], 45_000);
        assert_eq!(rows.rows.borrow()[0].3, 15_000, "silence past the hold ends the row at the last sound");
        assert_eq!(rows.rows.borrow()[2], (3, "audio:spotify.exe".into(), 40_000, 45_000));
    }

    #[test]
    fn sleep_ends_every_sound_where_the_last_poll_heard_it() {
        let rows = Fake::default();
        let mut s = State::default();
        hear(&mut s, &rows, &["spotify.exe"], 0);
        hear(&mut s, &rows, &["spotify.exe"], 5_000);
        hear(&mut s, &rows, &["spotify.exe"], 3_600_000);
        hear(&mut s, &rows, &["spotify.exe"], 3_605_000);
        assert_eq!(*rows.rows.borrow(), [(1, "audio:spotify.exe".into(), 0, 5_000), (2, "audio:spotify.exe".into(), 3_600_000, 3_605_000)]);
    }
}
