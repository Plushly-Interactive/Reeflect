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
}

/// The two writes a stay needs from the row store. `web` None: the row is the app itself, named `label`.
pub trait Rows {
    fn append(&self, package: &str, label: Option<&str>, web: Option<&Web>, from: i64, to: i64) -> Result<u64, String>;
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
    state.open = Some(Open { package: package.to_string(), from: at, local_id: None, class, web, label });
    Ok(())
}

/// Folds the events since the last poll into the open stay, then extends it to `now`. Returns the
/// number of stays closed.
pub fn tick(state: &mut State, events: &[Event], now: i64, rows: &impl Rows, own_package: &str) -> Result<usize, String> {
    let mut closed = 0;
    for e in events {
        match e.kind {
            ACTIVITY_RESUMED => {
                if let Some(o) = state.open.as_mut().filter(|o| o.package == e.package) {
                    o.class = e.class.clone();
                } else {
                    closed += close(state, e.at, rows)?;
                    if e.launchable && e.package != own_package {
                        let web = state.address.as_ref().filter(|a| a.package == e.package).and_then(|a| a.web.clone());
                        state.open = Some(Open { package: e.package.clone(), from: e.at, local_id: None, class: e.class.clone(), web, label: e.label.clone() });
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

fn extend(state: &mut State, to: i64, rows: &impl Rows) -> Result<(), String> {
    let Some(open) = state.open.as_mut() else { return Ok(()) };
    if to <= open.from {
        return Ok(());
    }
    match open.local_id {
        None => {
            let label = if open.web.is_none() { open.label.as_deref() } else { None };
            open.local_id = Some(rows.append(&open.package, label, open.web.as_ref(), open.from, to)?);
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

/// Which over-limit rule covers `package`, from the core's verdict: `(rule id, label)`. `covers` is
/// the core's answer for one app matcher (exact, keyword or regex), so the shield holds no matching.
pub fn blocking_rule(verdict: &serde_json::Value, rules: &serde_json::Value, package: &str, covers: impl Fn(&serde_json::Value) -> bool) -> Option<(String, String)> {
    let over = verdict.get("overage")?.as_object()?;
    for (rule_id, entry) in over {
        let matchers = entry.get("matchers")?.as_array()?;
        let hit = matchers.iter().any(|m| m.get("source").and_then(|s| s.as_str()) == Some("app") && covers(m));
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
        fn append(&self, package: &str, label: Option<&str>, web: Option<&Web>, from: i64, to: i64) -> Result<u64, String> {
            self.labels.borrow_mut().push(label.map(str::to_string));
            let mut rows = self.rows.borrow_mut();
            let id = rows.len() as u64 + 1;
            let name = web.map_or(package.to_string(), |w| format!("{}{}", w.domain, w.path));
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
        assert_eq!(blocking_rule(&verdict, &rules, "com.x", exact("com.x")), Some(("r1".into(), "X".into())));
        assert_eq!(blocking_rule(&verdict, &rules, "com.y", exact("com.y")), None);
        // A web matcher is never asked, whatever the core would say.
        let web = serde_json::json!({ "overage": { "r2": { "matchers": [{ "source": "web", "matchType": "keyword", "keyword": "x" }], "overBy": 5 } } });
        assert_eq!(blocking_rule(&web, &rules, "com.x", |_| true), None);
        assert_eq!(blocked_route("r1", "com.x", "X app"), "/src/pages/blocked/blocked.html?rule=r1&blockKey=com.x%7Cexact%7C&site=X%20app");
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
}
