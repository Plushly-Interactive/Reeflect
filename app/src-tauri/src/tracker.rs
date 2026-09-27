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
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Open {
    pub package: String,
    pub from: i64,
    pub local_id: Option<u64>,
}

/// What survives between polls: where the last poll ended and the stay still open.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub since: Option<i64>,
    pub open: Option<Open>,
}

/// The two writes a stay needs from the row store.
pub trait Rows {
    fn append(&self, package: &str, from: i64, to: i64) -> Result<u64, String>;
    fn touch(&self, local_id: u64, to: i64) -> Result<(), String>;
}

/// Folds the events since the last poll into the open stay, then extends it to `now`. Returns the
/// number of stays closed.
pub fn tick(state: &mut State, events: &[Event], now: i64, rows: &impl Rows, own_package: &str) -> Result<usize, String> {
    let mut closed = 0;
    for e in events {
        match e.kind {
            ACTIVITY_RESUMED => {
                if state.open.as_ref().is_none_or(|o| o.package != e.package) {
                    closed += close(state, e.at, rows)?;
                    if e.launchable && e.package != own_package {
                        state.open = Some(Open { package: e.package.clone(), from: e.at, local_id: None });
                    }
                }
            }
            ACTIVITY_PAUSED | ACTIVITY_STOPPED => {
                if state.open.as_ref().is_some_and(|o| o.package == e.package) {
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
        None => open.local_id = Some(rows.append(&open.package, open.from, to)?),
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

/// The shared blocked page, with the same parameters the extension's redirect carries.
pub fn blocked_route(rule_id: &str, package: &str, label: &str) -> String {
    let q = |s: &str| s.replace('%', "%25").replace('&', "%26").replace('|', "%7C").replace(' ', "%20").replace('#', "%23");
    format!("/src/pages/blocked/blocked.html?rule={}&blockKey={}&site={}", q(rule_id), q(&format!("{package}|exact|")), q(label))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Fake {
        rows: RefCell<Vec<(u64, String, i64, i64)>>,
    }

    impl Rows for Fake {
        fn append(&self, package: &str, from: i64, to: i64) -> Result<u64, String> {
            let mut rows = self.rows.borrow_mut();
            let id = rows.len() as u64 + 1;
            rows.push((id, package.into(), from, to));
            Ok(id)
        }
        fn touch(&self, local_id: u64, to: i64) -> Result<(), String> {
            let mut rows = self.rows.borrow_mut();
            rows.iter_mut().find(|r| r.0 == local_id).ok_or("no such row")?.3 = to;
            Ok(())
        }
    }

    fn ev(package: &str, kind: i32, at: i64) -> Event {
        Event { package: package.into(), kind, at, launchable: true }
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
}
