use base64::{engine::general_purpose, Engine as _};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key as EnigoKey, Keyboard, Mouse, Settings};
use screenshots::Screen;
use screenshots::image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use sysinfo::System;
use tauri::{Manager, State};
use std::sync::Mutex;
use std::io::Cursor;

// ── State ─────────────────────────────────────────────────────────────────────

pub struct AppState {
    pub token: Mutex<Option<String>>,
    // True only while this machine's user has explicitly approved another
    // meeting participant's /control/request — inject_remote_input refuses
    // to do anything while this is false, so the signaling layer (JS) is the
    // only thing that can ever turn real input injection on.
    pub control_session_active: Mutex<bool>,
    // One-shot handoff for the call window: the main window fills this in
    // right before creating the "call" window, and the call window's first
    // action on mount takes (and clears) it. Avoids racing a Tauri event
    // against the new window not having a listener registered yet, and
    // keeps the (possibly large) offer SDP out of the window's URL.
    pub pending_call: Mutex<Option<serde_json::Value>>,
}

// ── Call window handoff ─────────────────────────────────────────────────────

#[tauri::command]
fn set_pending_call(call: serde_json::Value, state: State<'_, AppState>) {
    *state.pending_call.lock().unwrap() = Some(call);
}

#[tauri::command]
fn take_pending_call(state: State<'_, AppState>) -> Option<serde_json::Value> {
    state.pending_call.lock().unwrap().take()
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn set_token(token: String, state: State<'_, AppState>) {
    *state.token.lock().unwrap() = Some(token);
}

#[tauri::command]
fn get_token(state: State<'_, AppState>) -> Option<String> {
    state.token.lock().unwrap().clone()
}

#[tauri::command]
fn capture_screenshot() -> Result<String, String> {
    let screens = Screen::all().map_err(|e| e.to_string())?;
    let screen = screens.into_iter().next().ok_or("No screen found")?;
    let image = screen.capture().map_err(|e| e.to_string())?;

    let mut buf = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    Ok(general_purpose::STANDARD.encode(buf.into_inner()))
}

#[derive(Serialize)]
struct DeviceInfo {
    os: String,
    os_version: String,
    hostname: String,
    cpu: String,
    total_memory_mb: u64,
}

#[tauri::command]
fn get_device_info() -> DeviceInfo {
    let mut sys = System::new_all();
    sys.refresh_all();
    DeviceInfo {
        os: System::name().unwrap_or_else(|| "Unknown".into()),
        os_version: System::os_version().unwrap_or_else(|| "Unknown".into()),
        hostname: System::host_name().unwrap_or_else(|| "Unknown".into()),
        cpu: sys
            .cpus()
            .first()
            .map(|c| c.brand().to_string())
            .unwrap_or_else(|| "Unknown".into()),
        total_memory_mb: sys.total_memory() / 1024 / 1024,
    }
}

#[derive(Serialize)]
struct BatteryInfo {
    status: String,
    percent: Option<f32>,
}

#[tauri::command]
fn get_battery_info() -> BatteryInfo {
    BatteryInfo {
        status: "AC Powered".to_string(),
        percent: None,
    }
}

// ── Remote control (in-meeting) ─────────────────────────────────────────────
// The backend (see /calls/conference/{id}/control/*) only ever signals
// request/approve/end between the two parties. Once approved, the controller's
// side publishes these events over the meeting's LiveKit data channel; this
// machine is the one being controlled and is the only place that actually
// turns an event into real OS input — gated on control_session_active so a
// stray/late data-channel message can't do anything once the session ends.

#[tauri::command]
fn set_control_session_active(active: bool, state: State<'_, AppState>) {
    *state.control_session_active.lock().unwrap() = active;
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum RemoteInputEvent {
    /// x, y normalized 0.0..1.0 against THIS machine's own primary screen —
    /// the controller never needs to know this machine's resolution.
    Move { x: f64, y: f64 },
    Click { button: String, down: bool },
    Scroll { dx: f64, dy: f64 },
    Key { key: String, down: bool },
}

#[tauri::command]
fn inject_remote_input(event: RemoteInputEvent, state: State<'_, AppState>) -> Result<(), String> {
    if !*state.control_session_active.lock().unwrap() {
        return Err("No active control session".into());
    }
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    match event {
        RemoteInputEvent::Move { x, y } => {
            let screens = Screen::all().map_err(|e| e.to_string())?;
            let screen = screens.into_iter().next().ok_or("No screen found")?;
            let (w, h) = (screen.display_info.width as f64, screen.display_info.height as f64);
            let px = (x.clamp(0.0, 1.0) * w) as i32;
            let py = (y.clamp(0.0, 1.0) * h) as i32;
            enigo.move_mouse(px, py, Coordinate::Abs).map_err(|e| e.to_string())?;
        }
        RemoteInputEvent::Click { button, down } => {
            let btn = match button.as_str() {
                "right" => Button::Right,
                "middle" => Button::Middle,
                _ => Button::Left,
            };
            let dir = if down { Direction::Press } else { Direction::Release };
            enigo.button(btn, dir).map_err(|e| e.to_string())?;
        }
        RemoteInputEvent::Scroll { dx, dy } => {
            if dy.abs() > 0.5 {
                enigo.scroll((dy / 20.0) as i32, Axis::Vertical).map_err(|e| e.to_string())?;
            }
            if dx.abs() > 0.5 {
                enigo.scroll((dx / 20.0) as i32, Axis::Horizontal).map_err(|e| e.to_string())?;
            }
        }
        RemoteInputEvent::Key { key, down } => {
            let dir = if down { Direction::Press } else { Direction::Release };
            if let Some(k) = named_key(&key) {
                enigo.key(k, dir).map_err(|e| e.to_string())?;
            } else if down && key.chars().count() == 1 {
                // Printable single character — only inject on the down edge,
                // enigo's text() is a full press+release for a unicode string.
                enigo.text(&key).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Maps a JS KeyboardEvent.key value to an enigo named key, for the keys that
/// aren't a single printable character (those go through enigo.text instead).
fn named_key(key: &str) -> Option<EnigoKey> {
    Some(match key {
        "Enter" => EnigoKey::Return,
        "Backspace" => EnigoKey::Backspace,
        "Tab" => EnigoKey::Tab,
        "Escape" => EnigoKey::Escape,
        " " | "Spacebar" => EnigoKey::Space,
        "ArrowLeft" => EnigoKey::LeftArrow,
        "ArrowRight" => EnigoKey::RightArrow,
        "ArrowUp" => EnigoKey::UpArrow,
        "ArrowDown" => EnigoKey::DownArrow,
        "Shift" => EnigoKey::Shift,
        "Control" => EnigoKey::Control,
        "Alt" => EnigoKey::Alt,
        "Meta" => EnigoKey::Meta,
        "Delete" => EnigoKey::Delete,
        "Home" => EnigoKey::Home,
        "End" => EnigoKey::End,
        "PageUp" => EnigoKey::PageUp,
        "PageDown" => EnigoKey::PageDown,
        _ => return None,
    })
}

// ── Org device-policy compliance agent ──────────────────────────────────────
// Only ever runs when the backend has this device's MonitoringConsent with
// allow_app_policy_monitoring set — see AppComplianceMonitor.tsx, which polls
// the admin-defined blocklist and calls this only in that state. This command
// itself just answers "what's currently running", app-level (process names),
// not window/tab titles — it doesn't gate or decide anything on its own.

#[tauri::command]
fn list_running_processes() -> Vec<String> {
    let mut sys = System::new_all();
    sys.refresh_all();
    let mut names: Vec<String> = sys
        .processes()
        .values()
        .map(|p| p.name().to_string_lossy().to_lowercase())
        .collect();
    names.sort();
    names.dedup();
    names
}

// ── Badge count ───────────────────────────────────────────────────────────────

#[tauri::command]
fn set_badge_count(count: i64, app_handle: tauri::AppHandle) {
    let _ = &app_handle; // suppress unused-variable on platforms that don't need it
    #[cfg(target_os = "macos")]
    unsafe {
        use objc::{class, msg_send, sel, sel_impl, runtime::Object};
        let label: *mut Object = if count > 0 {
            let s = count.to_string();
            let cs = std::ffi::CString::new(s).unwrap();
            msg_send![class!(NSString), stringWithUTF8String: cs.as_ptr()]
        } else {
            msg_send![class!(NSString), string]
        };
        let app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let dock_tile: *mut Object = msg_send![app, dockTile];
        let _: () = msg_send![dock_tile, setBadgeLabel: label];
        let _: () = msg_send![dock_tile, display];
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app_handle.get_webview_window("main") {
            let title = if count > 0 {
                format!("Dilarion ({})", count)
            } else {
                "Dilarion".to_string()
            };
            let _ = window.set_title(&title);
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (count, app_handle);
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState { token: Mutex::new(None), control_session_active: Mutex::new(false), pending_call: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            set_token,
            get_token,
            capture_screenshot,
            get_device_info,
            get_battery_info,
            set_badge_count,
            set_control_session_active,
            inject_remote_input,
            list_running_processes,
            set_pending_call,
            take_pending_call,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
