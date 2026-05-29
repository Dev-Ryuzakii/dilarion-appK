use base64::{engine::general_purpose, Engine as _};
use screenshots::Screen;
use screenshots::image::{DynamicImage, ImageFormat};
use serde::Serialize;
use sysinfo::System;
use tauri::State;
use std::sync::Mutex;
use std::io::Cursor;

// ── State ─────────────────────────────────────────────────────────────────────

pub struct AppState {
    pub token: Mutex<Option<String>>,
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
        .manage(AppState { token: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            set_token,
            get_token,
            capture_screenshot,
            get_device_info,
            get_battery_info,
            set_badge_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
