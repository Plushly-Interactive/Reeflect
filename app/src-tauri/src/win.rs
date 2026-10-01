//! The Windows face of the tracker and the shield. Every few seconds, the program in front and the
//! last input, folded by `tracker.rs` into the open stay. The moment any program comes to the front,
//! and on every poll, the core's verdict: a blocked program is minimized and Reeflect covers it with
//! the blocked page, as the Android shield does. Win32 calls only; nothing is decided here.
use crate::AppState;
use crate::tracker::{self, Front, Rows, State, Web};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HWND};
use windows::Win32::Storage::Packaging::Appx::{GetPackageFullName, GetPackagePathByFullName};
use windows::Win32::UI::Shell::SHLoadIndirectString;
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
use windows::Win32::UI::WindowsAndMessaging::{
    EVENT_SYSTEM_FOREGROUND, GA_ROOTOWNER, GetAncestor, GetForegroundWindow, GetMessageW, GetShellWindow, IsIconic, GetWindowThreadProcessId, MSG, SetForegroundWindow, SW_MINIMIZE, ShowWindow, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};
use windows::Win32::Media::Audio::{
    DEVICE_STATE_ACTIVE, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator, eRender,
};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
use windows::core::{Interface, PCWSTR, PWSTR};

const POLL: Duration = Duration::from_secs(5);
/// Three missed polls: the machine slept, or the app was not running.
const GAP_MS: i64 = 15_000;
const DEFAULT_IDLE_THRESHOLD_SEC: i64 = 300;
/// Silence this long ends a program's `audio` row: three polls, invented.
const HOLD_MS: i64 = 15_000;

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// The program that owns a window: its file's full path, and for a Store app its package.
struct Program {
    path: Vec<u16>,
    package: Option<String>,
}

/// The program that owns `window`, or None when there is no window or Windows refuses to name the
/// process (a protected or elevated one).
fn window_program(window: HWND) -> Option<Program> {
    if window.is_invalid() {
        return None;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
    process_program(pid)
}

fn process_program(pid: u32) -> Option<Program> {
    unsafe {
        if pid == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        let read = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let mut full = vec![0u16; 256];
        let mut full_len = full.len() as u32;
        let package = (GetPackageFullName(process, &mut full_len, Some(PWSTR(full.as_mut_ptr()))) == ERROR_SUCCESS)
            .then(|| String::from_utf16_lossy(&full[..full_len.saturating_sub(1) as usize]));
        let _ = CloseHandle(process);
        read.ok()?;
        buf.truncate(len as usize);
        Some(Program { path: buf, package })
    }
}

/// One attribute's value in an XML tag's text, by its exact name.
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let at = tag.find(&format!(" {name}=\""))? + name.len() + 3;
    tag[at..].split('"').next()
}

/// A Store app's name, from its package manifest: the `DisplayName` of the app whose program is
/// `exe` (a package can hold many, as Windows' own holds Search), else the package's. A name is
/// often a reference (`ms-resource:AppName/Text`) that only Windows can turn into text.
fn store_name(package: &str, exe: &str) -> Option<String> {
    let wide: Vec<u16> = package.encode_utf16().chain([0]).collect();
    let mut dir = vec![0u16; 1024];
    let mut len = dir.len() as u32;
    if unsafe { GetPackagePathByFullName(PCWSTR(wide.as_ptr()), &mut len, Some(PWSTR(dir.as_mut_ptr()))) } != ERROR_SUCCESS {
        return None;
    }
    let dir = String::from_utf16_lossy(&dir[..len.saturating_sub(1) as usize]);
    let manifest = std::fs::read_to_string(format!(r"{dir}\AppxManifest.xml")).ok()?;
    let own = manifest.split("<Application ").skip(1).find_map(|app| {
        let app = app.split("</Application>").next()?;
        let file = attr(app, "Executable")?.rsplit(['/', '\\']).next()?;
        file.eq_ignore_ascii_case(exe).then(|| attr(app, "DisplayName")).flatten()
    });
    let packaged = || {
        let start = manifest.find("<DisplayName>")? + "<DisplayName>".len();
        manifest[start..].split("</DisplayName>").next()
    };
    let raw = own.or_else(packaged)?.trim().replace("&amp;", "&");
    let Some(key) = raw.strip_prefix("ms-resource:") else { return Some(raw).filter(|n| !n.is_empty()) };
    let name = package.split('_').next()?;
    // A key names its string in the default resource file, or carries its own file's name first
    // (`Cortana.UI/Resources/TileDisplayName`); Windows resolves only the exact form, so try both.
    let uris = match key {
        k if k.starts_with("//") => vec![format!("ms-resource:{k}")],
        k if k.starts_with('/') => vec![format!("ms-resource://{name}{k}")],
        k => vec![format!("ms-resource://{name}/Resources/{k}"), format!("ms-resource://{name}/{k}")],
    };
    uris.iter().find_map(|uri| {
        let source: Vec<u16> = format!("@{{{package}?{uri}}}").encode_utf16().chain([0]).collect();
        let mut out = vec![0u16; 512];
        unsafe { SHLoadIndirectString(PCWSTR(source.as_ptr()), &mut out, None) }.ok()?;
        let text = String::from_utf16_lossy(&out[..out.iter().position(|&c| c == 0).unwrap_or(out.len())]);
        Some(text.trim().to_string()).filter(|n| !n.is_empty())
    })
}

/// The product name a program file carries (`FileDescription`, "Google Chrome" for chrome.exe).
fn description(path: &[u16]) -> Option<String> {
    let mut wide = path.to_vec();
    wide.push(0);
    let file = PCWSTR(wide.as_ptr());
    unsafe {
        let size = GetFileVersionInfoSizeW(file, None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(file, None, size, data.as_mut_ptr().cast()).ok()?;
        let query = |key: &str| -> Option<(*const u16, u32)> {
            let key: Vec<u16> = key.encode_utf16().chain([0]).collect();
            let mut out = std::ptr::null_mut();
            let mut len = 0u32;
            VerQueryValueW(data.as_ptr().cast(), PCWSTR(key.as_ptr()), &mut out, &mut len).as_bool().then_some((out as *const u16, len))
        };
        let (pairs, len) = query("\\VarFileInfo\\Translation")?;
        if len < 4 {
            return None;
        }
        let (lang, page) = (*pairs, *pairs.add(1));
        let (text, chars) = query(&format!("\\StringFileInfo\\{lang:04x}{page:04x}\\FileDescription"))?;
        let name = String::from_utf16_lossy(std::slice::from_raw_parts(text, chars as usize));
        let name = name.trim_end_matches('\0').trim();
        (!name.is_empty()).then(|| name.to_string())
    }
}

/// The processes playing sound now, on every output device: a session whose meter peaks above
/// zero and that is not muted, as the extension counts an audible, unmuted tab.
fn sounding() -> Vec<u32> {
    let mut pids = Vec::new();
    let mut sessions = || -> windows::core::Result<()> {
        unsafe {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
            for d in 0..devices.GetCount()? {
                let manager: IAudioSessionManager2 = devices.Item(d)?.Activate(CLSCTX_ALL, None)?;
                let list = manager.GetSessionEnumerator()?;
                for i in 0..list.GetCount()? {
                    let control = list.GetSession(i)?;
                    let pid = control.cast::<IAudioSessionControl2>()?.GetProcessId().unwrap_or(0);
                    let peak = control.cast::<IAudioMeterInformation>()?.GetPeakValue().unwrap_or(0.0);
                    let muted = control.cast::<ISimpleAudioVolume>()?.GetMute().map(|m| m.as_bool()).unwrap_or(false);
                    if pid != 0 && peak > 0.0 && !muted && !pids.contains(&pid) {
                        pids.push(pid);
                    }
                }
            }
            Ok(())
        }
    };
    if let Err(e) = sessions() {
        eprintln!("audio: {e}");
    }
    pids
}

/// When the last keyboard or mouse input happened, as a wall-clock time. Both ticks are 32-bit
/// milliseconds since boot and wrap after 49 days, so only their difference counts.
fn last_input(now: i64) -> i64 {
    let mut info = LASTINPUTINFO { cbSize: size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    unsafe {
        if !GetLastInputInfo(&mut info).as_bool() {
            return now;
        }
        now - GetTickCount().wrapping_sub(info.dwTime) as i64
    }
}

fn file_name(path: &[u16]) -> String {
    let path = String::from_utf16_lossy(path);
    path.rsplit('\\').next().unwrap_or(&path).to_lowercase()
}

fn call(app: &AppHandle, cmd: &str, args: Value) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let reply = state.core.lock().map_err(|e| e.to_string())?.call(cmd, &args.to_string())?;
    let reply: Value = serde_json::from_str(&reply).map_err(|e| e.to_string())?;
    match reply.get("error") {
        Some(e) => Err(e.as_str().unwrap_or("error").to_string()),
        None => Ok(reply.get("ok").cloned().unwrap_or(Value::Null)),
    }
}

struct CoreRows<'a>(&'a AppHandle);

impl Rows for CoreRows<'_> {
    fn append(&self, kind: &str, package: &str, label: Option<&str>, _web: Option<&Web>, from: i64, to: i64) -> Result<u64, String> {
        let row = json!({ "domain": package, "label": label, "kind": kind, "from": from, "to": to });
        let ids = call(self.0, "rows.append", json!({ "rows": [row] }))?;
        ids.get(0).and_then(Value::as_u64).ok_or_else(|| "rows.append: no id".to_string())
    }
    fn touch(&self, local_id: u64, to: i64) -> Result<(), String> {
        call(self.0, "rows.touch", json!({ "localId": local_id, "to": to })).map(|_| ())
    }
}

fn pref(app: &AppHandle, key: &str) -> Option<Value> {
    app.state::<AppState>().prefs.lock().ok().and_then(|p| p.data.get(key).cloned())
}

/// Does an over-limit desktop rule cover `exe` right now? The route to the blocked page.
fn blocked(app: &AppHandle, exe: &str) -> Option<String> {
    let rules = pref(app, "rules").filter(|r| r.as_array().is_some_and(|r| !r.is_empty()))?;
    let week_start: String = pref(app, "weekStart").and_then(|w| w.as_str().map(|w| w.chars().take(3).collect())).unwrap_or_else(|| "mon".into());
    let verdict = call(app, "verdict", json!({ "rules": rules, "time": { "weekStart": week_start } })).ok()?;
    let covers = |m: &Value| call(app, "matchesRule", json!({ "matcher": m, "source": "desktop", "domain": exe, "path": "" })).ok() == Some(Value::Bool(true));
    tracker::blocking_rule(&verdict, &rules, exe, "desktop", covers).map(|(rule, label)| tracker::blocked_route(&rule, exe, &label))
}

/// A blocked program in front gives way: minimized, with Reeflect maximized over it on the blocked
/// page. Restoring it brings it to the front again, which lands here again.
fn shield(app: &AppHandle, window: HWND) {
    let Some(program) = window_program(window) else { return };
    let exe = file_name(&program.path);
    let Some(route) = blocked(app, &exe) else { return };
    unsafe {
        let root = GetAncestor(window, GA_ROOTOWNER);
        let _ = ShowWindow(root, SW_MINIMIZE);
        if let Ok(mut last) = BLOCKED.lock() {
            *last = Some(root.0 as usize);
        }
        // The hook can fire before Windows finishes restoring the window, and the restore then wins
        // over the minimize (seen within 100 ms in 5 of 6 blocks of Element): check again for half
        // a second.
        let root = root.0 as usize;
        std::thread::spawn(move || {
            for _ in 0..5 {
                std::thread::sleep(Duration::from_millis(100));
                let window = HWND(root as *mut _);
                if !IsIconic(window).as_bool() {
                    let _ = ShowWindow(window, SW_MINIMIZE);
                }
            }
        });
    }
    if let Ok(mut pending) = crate::PENDING_ROUTE.lock() {
        *pending = Some(route);
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.maximize();
        let _ = w.set_focus();
    }
    let _ = app.emit("shield", ());
}

/// The window the shield last minimized. Windows hands a minimize to the program's own thread,
/// which may act on it late or not at all, so "Close app" asks again before it uncovers the window.
static BLOCKED: Mutex<Option<usize>> = Mutex::new(None);

/// "Close app" on the blocked page: the blocked window minimized again and the desktop in front
/// before Reeflect hides, as Android goes to the home screen. Hidden first, Windows would hand the
/// front to the next window in line, which can be the blocked program itself.
pub fn leave<R: tauri::Runtime>(app: &AppHandle<R>) {
    unsafe {
        if let Some(last) = BLOCKED.lock().ok().and_then(|mut b| b.take()) {
            let window = HWND(last as *mut _);
            let _ = ShowWindow(window, SW_MINIMIZE);
        }
        let _ = SetForegroundWindow(GetShellWindow());
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

static APP: OnceLock<AppHandle> = OnceLock::new();

unsafe extern "system" fn on_foreground(_hook: HWINEVENTHOOK, _event: u32, window: HWND, _object: i32, _child: i32, _thread: u32, _at: u32) {
    if let Some(app) = APP.get() {
        shield(app, window);
    }
}

/// Windows calls `on_foreground` on this thread, through its message loop, whenever any other
/// process's window comes to the front.
fn watch_foreground(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::spawn(|| unsafe {
        let _hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_foreground), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
    });
}

/// The pages name a program from `_syncAppLabels`, which sync fills with the names other devices
/// captured. This device's own names go there too, so the pages know them with or without sync.
fn remember_name(app: &AppHandle, exe: &str, label: &str) {
    let state = app.state::<AppState>();
    let Ok(mut prefs) = state.prefs.lock() else { return };
    let names = prefs.data.entry("_syncAppLabels").or_insert_with(|| json!({}));
    if names.get(exe).and_then(Value::as_str) == Some(label) {
        return;
    }
    if let Some(map) = names.as_object_mut() {
        map.insert(exe.to_string(), Value::from(label));
    }
    let _ = prefs.save();
}

fn idle_ms(app: &AppHandle) -> i64 {
    let prefs = app.state::<AppState>().prefs.lock().ok().and_then(|p| p.data.get("idleThresholdSec").and_then(Value::as_i64));
    prefs.unwrap_or(DEFAULT_IDLE_THRESHOLD_SEC) * 1000
}

/// The poll loop, on its own thread for as long as the app runs. The state survives a restart in
/// `tracker.json`, so the first poll after one closes the old stay where it ended.
pub fn start(app: AppHandle, dir: PathBuf) {
    watch_foreground(app.clone());
    std::thread::spawn(move || {
        let own = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase())).unwrap_or_default();
        let path = dir.join("tracker.json");
        let mut state: State = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let mut labels: HashMap<String, Option<String>> = HashMap::new();
        let mut named = |p: Program| {
            let exe = file_name(&p.path);
            let label = labels.entry(exe.clone()).or_insert_with(|| {
                let label = description(&p.path).or_else(|| p.package.as_deref().and_then(|pkg| store_name(pkg, &exe)));
                if let Some(l) = label.as_ref().filter(|_| exe != own) {
                    remember_name(&app, &exe, l);
                }
                label
            }).clone();
            Front { exe, label }
        };
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        loop {
            let now = now_ms();
            let window = unsafe { GetForegroundWindow() };
            shield(&app, window);
            let front = window_program(window).map(&mut named);
            let mut heard: Vec<Front> = Vec::new();
            for f in sounding().into_iter().filter_map(process_program).map(&mut named) {
                if !heard.iter().any(|h| h.exe == f.exe) {
                    heard.push(f);
                }
            }
            if let Err(e) = tracker::desktop_audio(&mut state, &heard, now, HOLD_MS, GAP_MS, &CoreRows(&app), &own) {
                eprintln!("audio: {e}");
            }
            let locked = front.as_ref().is_some_and(|f| f.exe == "lockapp.exe");
            let events = tracker::desktop_events(&state, front, locked, last_input(now), idle_ms(&app), now, GAP_MS);
            if let Err(e) = tracker::tick(&mut state, &events, now, &CoreRows(&app), &own) {
                eprintln!("tracker: {e}");
            }
            if let Ok(bytes) = serde_json::to_vec(&state) {
                let _ = std::fs::write(&path, bytes);
            }
            std::thread::sleep(POLL);
        }
    });
}
