//! The JNI face for the Android services: the tracker's tick, the shield's check and the sync run,
//! each a few lines over `tracker.rs`, the prefs file and the core's shared session. Kotlin only
//! collects events and starts activities; nothing is decided there.
use crate::tracker::{self, Event, Rows, State};
use crate::{Core, Prefs};
use jni::JNIEnv;
use jni::objects::{JObject, JString};
use jni::sys::{jlong, jstring};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static CORE: OnceLock<Mutex<Core>> = OnceLock::new();
static STATE: Mutex<Option<State>> = Mutex::new(None);

fn read(env: &mut JNIEnv, s: &JString) -> String {
    crate::keystore::remember_vm(env);
    env.get_string(s).map(|j| j.into()).unwrap_or_default()
}

fn give(env: &JNIEnv, s: String) -> jstring {
    env.new_string(s).map(|j| j.into_raw()).unwrap_or(std::ptr::null_mut())
}

fn core(dir: &Path) -> Result<&'static Mutex<Core>, String> {
    if let Some(c) = CORE.get() {
        return Ok(c);
    }
    let prefs = Prefs::load(dir.join("prefs.json"))?;
    let base_url = prefs.data.get("_syncBaseUrl").and_then(Value::as_str).unwrap_or(crate::SYNC_BASE_URL_DEFAULT).to_string();
    let config = json!({ "clientType": "app", "baseUrl": base_url }).to_string();
    let opened = Core::open(dir.to_str().ok_or("data dir")?, &config)?;
    Ok(CORE.get_or_init(|| Mutex::new(opened)))
}

fn call(dir: &Path, cmd: &str, args: Value) -> Result<Value, String> {
    let reply: Value = serde_json::from_str(&core(dir)?.lock().map_err(|e| e.to_string())?.call(cmd, &args.to_string())?).map_err(|e| e.to_string())?;
    match reply.get("error") {
        Some(e) => Err(e.as_str().unwrap_or("error").to_string()),
        None => Ok(reply.get("ok").cloned().unwrap_or(Value::Null)),
    }
}

struct CoreRows<'a>(&'a Path);

impl Rows for CoreRows<'_> {
    fn append(&self, package: &str, from: i64, to: i64) -> Result<u64, String> {
        let ids = call(self.0, "rows.append", json!({ "rows": [{ "domain": package, "kind": "active", "from": from, "to": to }] }))?;
        ids.get(0).and_then(Value::as_u64).ok_or_else(|| "rows.append: no id".to_string())
    }
    fn touch(&self, local_id: u64, to: i64) -> Result<(), String> {
        call(self.0, "rows.touch", json!({ "localId": local_id, "to": to })).map(|_| ())
    }
}

fn state_path(dir: &Path) -> PathBuf {
    dir.join("tracker.json")
}

fn with_state<T>(dir: &Path, f: impl FnOnce(&mut State) -> Result<T, String>) -> Result<T, String> {
    let mut guard = STATE.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(std::fs::read(state_path(dir)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default());
    }
    let state = guard.as_mut().unwrap();
    let out = f(state)?;
    std::fs::write(state_path(dir), serde_json::to_vec(state).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(out)
}

fn week_start(dir: &Path) -> String {
    Prefs::load(dir.join("prefs.json")).ok().and_then(|p| p.data.get("weekStart").and_then(Value::as_str).map(|w| w.chars().take(3).collect())).unwrap_or_else(|| "mon".to_string())
}

/// Where the next event query starts: the end of the last poll, or now on the first.
#[unsafe(no_mangle)]
pub extern "system" fn Java_app_reeflect_Native_since(mut env: JNIEnv, _this: JObject, data_dir: JString, now: jlong) -> jlong {
    let dir = PathBuf::from(read(&mut env, &data_dir));
    with_state(&dir, |s| Ok(s.since.unwrap_or(now))).unwrap_or(now)
}

/// The events since the last poll (`[{package, kind, at, launchable}]`) folded into the open stay.
#[unsafe(no_mangle)]
pub extern "system" fn Java_app_reeflect_Native_tick(mut env: JNIEnv, _this: JObject, data_dir: JString, events: JString, now: jlong, own_package: JString) -> jstring {
    let dir = PathBuf::from(read(&mut env, &data_dir));
    let events: Vec<Event> = serde_json::from_str(&read(&mut env, &events)).unwrap_or_default();
    let own = read(&mut env, &own_package);
    let out = with_state(&dir, |s| tracker::tick(s, &events, now, &CoreRows(&dir), &own));
    give(&env, match out {
        Ok(closed) => json!({ "closed": closed }).to_string(),
        Err(e) => json!({ "error": e }).to_string(),
    })
}

/// Does an over-limit app rule cover `package` right now? The route to the blocked page, or "".
#[unsafe(no_mangle)]
pub extern "system" fn Java_app_reeflect_Native_check(mut env: JNIEnv, _this: JObject, data_dir: JString, package: JString) -> jstring {
    let dir = PathBuf::from(read(&mut env, &data_dir));
    let package = read(&mut env, &package);
    let route = (|| -> Result<String, String> {
        let rules = Prefs::load(dir.join("prefs.json"))?.data.get("rules").cloned().unwrap_or(Value::Array(Vec::new()));
        if rules.as_array().is_none_or(|r| r.is_empty()) {
            return Ok(String::new());
        }
        let verdict = call(&dir, "verdict", json!({ "rules": rules, "time": { "weekStart": week_start(&dir) } }))?;
        Ok(tracker::blocking_rule(&verdict, &rules, &package).map(|(rule, label)| tracker::blocked_route(&rule, &package, &label)).unwrap_or_default())
    })();
    let route = route.unwrap_or_default();
    give(&env, route)
}

/// The route the shield's launch intent carried, for the next page that asks (`PENDING_ROUTE`).
#[unsafe(no_mangle)]
pub extern "system" fn Java_app_reeflect_Native_setRoute(mut env: JNIEnv, _this: JObject, route: JString) {
    let route = read(&mut env, &route);
    if let Ok(mut pending) = crate::PENDING_ROUTE.lock() {
        *pending = Some(route);
    }
}

/// One sync run with the core's own bookkeeping, when the device syncs.
#[unsafe(no_mangle)]
pub extern "system" fn Java_app_reeflect_Native_syncRun(mut env: JNIEnv, _this: JObject, data_dir: JString) -> jstring {
    let dir = PathBuf::from(read(&mut env, &data_dir));
    let out = call(&dir, "sync.run", json!({ "time": { "weekStart": week_start(&dir) } }));
    give(&env, out.map(|v| v.to_string()).unwrap_or_else(|e| json!({ "error": e }).to_string()))
}
