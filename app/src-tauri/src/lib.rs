//! The app's backend: loads the prebuilt core library, opens its process-wide session in the app's
//! data directory, and exposes it to the pages as `core_call`. Prefs are one JSON file beside it.
//! The tracker plugin is Kotlin on Android (TrackerPlugin.kt) and absent elsewhere. No logic.
#[cfg(target_os = "android")]
mod android;
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
mod tracker;

use libloading::{Library, Symbol};
use serde_json::{Map, Value, json};
use std::ffi::{CStr, CString, c_char};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

type OpenFn = unsafe extern "C" fn(*const c_char, *const c_char) -> *mut c_char;
type CallFn = unsafe extern "C" fn(*const c_char, *const c_char) -> *mut c_char;
type FreeFn = unsafe extern "C" fn(*mut c_char);

pub const SYNC_BASE_URL_DEFAULT: &str = "https://sync.coralclock.com";

// The library's shared session: on Android the services (android.rs) reach the same one.
pub struct Core {
    lib: Library,
}

fn library_path() -> PathBuf {
    if cfg!(target_os = "android") {
        return PathBuf::from("libreeflect_core_ffi.so");
    }
    let file = if cfg!(windows) {
        "reeflect_core_ffi.dll"
    } else if cfg!(target_os = "macos") {
        "libreeflect_core_ffi.dylib"
    } else {
        "libreeflect_core_ffi.so"
    };
    PathBuf::from(env!("REEFLECT_NATIVE_DIR")).join(file)
}

fn take_string(lib: &Library, p: *mut c_char) -> String {
    let s = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
    if let Ok(free) = unsafe { lib.get::<FreeFn>(b"reeflect_free\0") } {
        unsafe { free(p) };
    }
    s
}

impl Core {
    pub fn open(data_dir: &str, config: &str) -> Result<Core, String> {
        let path = library_path();
        let lib = unsafe { Library::new(&path) }.map_err(|e| format!("core library {}: {e}", path.display()))?;
        let dir = CString::new(data_dir).map_err(|e| e.to_string())?;
        let cfg = CString::new(config).map_err(|e| e.to_string())?;
        let err = unsafe {
            let open: Symbol<OpenFn> = lib.get(b"reeflect_open_shared\0").map_err(|e| e.to_string())?;
            open(dir.as_ptr(), cfg.as_ptr())
        };
        if !err.is_null() {
            return Err(take_string(&lib, err));
        }
        Ok(Core { lib })
    }

    pub fn call(&self, cmd: &str, args: &str) -> Result<String, String> {
        let cmd = CString::new(cmd).map_err(|e| e.to_string())?;
        let args = CString::new(args).map_err(|e| e.to_string())?;
        let out = unsafe {
            let call: Symbol<CallFn> = self.lib.get(b"reeflect_call_shared\0").map_err(|e| e.to_string())?;
            call(cmd.as_ptr(), args.as_ptr())
        };
        Ok(take_string(&self.lib, out))
    }
}

pub struct Prefs {
    path: PathBuf,
    pub data: Map<String, Value>,
}

impl Prefs {
    pub fn load(path: PathBuf) -> Result<Prefs, String> {
        let data = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("prefs.json: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Map::new(),
            Err(e) => return Err(format!("prefs.json: {e}")),
        };
        Ok(Prefs { path, data })
    }

    fn save(&self) -> Result<(), String> {
        let bytes = serde_json::to_vec(&self.data).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, bytes).map_err(|e| format!("prefs.json: {e}"))
    }
}

struct AppState {
    core: Mutex<Core>,
    prefs: Mutex<Prefs>,
}

/// One command of the core, JSON in, `{"ok": ...}` or `{"error": "..."}` out as text.
#[tauri::command]
fn core_call(state: State<AppState>, cmd: String, args: String) -> Result<String, String> {
    state.core.lock().map_err(|e| e.to_string())?.call(&cmd, &args)
}

fn key_list(keys: &Value) -> Result<Vec<String>, String> {
    match keys {
        Value::String(k) => Ok(vec![k.clone()]),
        Value::Array(ks) => ks.iter().map(|k| k.as_str().map(str::to_string).ok_or_else(|| "keys: strings only".to_string())).collect(),
        Value::Object(o) => Ok(o.keys().cloned().collect()),
        Value::Null => Ok(Vec::new()),
        _ => Err("keys: a string, an array, an object of defaults, or null".into()),
    }
}

/// Same contract as `chrome.storage.local.get`: a key, a list, an object of defaults, or null for everything.
#[tauri::command]
fn prefs_get(state: State<AppState>, keys: Value) -> Result<Value, String> {
    let prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    if keys.is_null() {
        return Ok(Value::Object(prefs.data.clone()));
    }
    let mut out = match &keys {
        Value::Object(defaults) => defaults.clone(),
        _ => Map::new(),
    };
    for k in key_list(&keys)? {
        if let Some(v) = prefs.data.get(&k) {
            out.insert(k, v.clone());
        }
    }
    Ok(Value::Object(out))
}

#[tauri::command]
fn prefs_set(app: AppHandle, state: State<AppState>, items: Map<String, Value>) -> Result<(), String> {
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    let mut changes = Map::new();
    for (k, v) in items {
        let mut change = Map::new();
        if let Some(old) = prefs.data.insert(k.clone(), v.clone()) {
            change.insert("oldValue".into(), old);
        }
        change.insert("newValue".into(), v);
        changes.insert(k, Value::Object(change));
    }
    prefs.save()?;
    app.emit("prefs-changed", Value::Object(changes)).map_err(|e| e.to_string())
}

#[tauri::command]
fn prefs_remove(app: AppHandle, state: State<AppState>, keys: Value) -> Result<(), String> {
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    let mut changes = Map::new();
    for k in key_list(&keys)? {
        if let Some(old) = prefs.data.remove(&k) {
            changes.insert(k, json!({ "oldValue": old }));
        }
    }
    prefs.save()?;
    app.emit("prefs-changed", Value::Object(changes)).map_err(|e| e.to_string())
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

// ---------- the tracker: what the pages may ask of it ----------

#[cfg_attr(not(mobile), allow(dead_code))]
struct Tracker<R: Runtime>(PluginHandle<R>);

/// The page the shield asked for, set by its check in `android.rs`, taken by the next page that asks.
/// A static, not a plugin call: a plugin call waits for the UI thread while holding Tauri's plugin
/// lock, and a navigation on the UI thread takes that same lock (a deadlock seen on the emulator).
pub(crate) static PENDING_ROUTE: Mutex<Option<String>> = Mutex::new(None);

#[cfg(mobile)]
fn tracker_call<R: Runtime>(app: &AppHandle<R>, command: &str) -> Result<Value, String> {
    match app.try_state::<Tracker<R>>() {
        Some(t) => t.0.run_mobile_plugin::<Value>(command, ()).map_err(|e| e.to_string()),
        None => Err("tracker: not on this platform".into()),
    }
}

#[cfg(not(mobile))]
fn tracker_call<R: Runtime>(_app: &AppHandle<R>, _command: &str) -> Result<Value, String> {
    Err("tracker: not on this platform".into())
}

#[tauri::command]
fn status<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    tracker_call(&app, "status")
}

#[tauri::command]
fn open_settings<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    tracker_call(&app, "openSettings")
}

#[tauri::command]
fn pending_route() -> Result<Value, String> {
    Ok(json!({ "url": PENDING_ROUTE.lock().ok().and_then(|mut route| route.take()) }))
}

#[tauri::command]
fn open_accessibility_settings<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    tracker_call(&app, "openAccessibilitySettings")
}

#[tauri::command]
fn request_notifications<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    tracker_call(&app, "requestNotifications")
}

#[tauri::command]
fn apps<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    tracker_call(&app, "apps").map(|v| v.get("apps").cloned().unwrap_or(Value::Array(Vec::new())))
}

fn tracker<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("tracker")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            app.manage(Tracker(api.register_android_plugin("reeflect.app", "TrackerPlugin")?));
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![status, open_settings, open_accessibility_settings, request_notifications, pending_route, apps])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tracker())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let prefs = Prefs::load(dir.join("prefs.json"))?;
            let base_url = prefs.data.get("_syncBaseUrl").and_then(Value::as_str).unwrap_or(SYNC_BASE_URL_DEFAULT).to_string();
            let client_type = if cfg!(target_os = "android") { "app" } else { "desktop" };
            let config = json!({ "clientType": client_type, "baseUrl": base_url }).to_string();
            let core = Core::open(dir.to_str().ok_or("data dir is not UTF-8")?, &config)?;
            app.manage(AppState { core: Mutex::new(core), prefs: Mutex::new(prefs) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![core_call, prefs_get, prefs_set, prefs_remove, app_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
