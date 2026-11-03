//! System tray (Electron `syncLocalServerTray`). Sirf packaged build (ya debug me PL_TAURI_AS_PACKAGED=1).
//! Rule: host role + (sharing ON ya userWantsRunning) -> tray; warna tray hatao.
//! Menu item ids global `on_menu_event` -> `run_action` me jaate hain (tray_open/tray_stop/tray_retry/tray_quit).

use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub const TRAY_ID: &str = "pl-server-tray";

static LAST: OnceLock<Mutex<Value>> = OnceLock::new();

fn last() -> &'static Mutex<Value> {
    LAST.get_or_init(|| Mutex::new(json!({})))
}

pub fn enabled() -> bool {
    crate::p2::dev_or_packaged("PL_TAURI_AS_PACKAGED")
}

pub fn last_state() -> Value {
    last().lock().unwrap().clone()
}

fn b(v: &Value, k: &str) -> bool {
    v.get(k).and_then(|x| x.as_bool()).unwrap_or(false)
}

fn keep_tray(v: &Value) -> bool {
    b(v, "hosting") && (b(v, "userWantsRunning") || b(v, "sharingActive"))
}

/// Window close par tray me chhupana hai ya nahi (Electron `shouldHideMainWindowToTrayOnClose`).
pub fn should_hide_to_tray() -> bool {
    enabled() && keep_tray(&last_state())
}

pub fn on_state(app: &AppHandle, v: &Value) {
    *last().lock().unwrap() = v.clone();
    let keep = enabled() && keep_tray(v);
    crate::native::set_power_block(keep);
    if !b(v, "hosting") && v.get("appRole").and_then(|r| r.as_str()) == Some("client") {
        let o = crate::auth::remote_origin();
        if !o.is_empty() {
            crate::auth::allow_remote_origin(app, &o);
        }
    }
    let h = app.clone();
    let st = v.clone();
    let _ = app.run_on_main_thread(move || sync(&h, &st));
}

fn sync(app: &AppHandle, st: &Value) {
    if !enabled() || !keep_tray(st) || app.state::<crate::AppCtx>().quitting.load(std::sync::atomic::Ordering::SeqCst) {
        let _ = app.remove_tray_by_id(TRAY_ID);
        return;
    }
    let sharing = b(st, "sharingActive");
    let port = st.get("sharingPort").and_then(|p| p.as_u64()).unwrap_or(0);
    let port_label = if port != 0 { format!("port {port}") } else { "running".to_string() };
    let status = if sharing { format!("Sharing on for others ({port_label})") } else { "Starting sharing… (keep PC awake)".to_string() };
    let build = || -> tauri::Result<Menu<tauri::Wry>> {
        let m = Menu::new(app)?;
        m.append(&MenuItem::with_id(app, "tray_status", &status, false, None::<&str>)?)?;
        m.append(&PredefinedMenuItem::separator(app)?)?;
        m.append(&MenuItem::with_id(app, "tray_open", "Open Pocket Ledger", true, None::<&str>)?)?;
        if sharing {
            m.append(&MenuItem::with_id(app, "tray_stop", "Stop sharing (keep app open)", true, None::<&str>)?)?;
        } else if b(st, "userWantsRunning") {
            m.append(&MenuItem::with_id(app, "tray_retry", "Retry start sharing", true, None::<&str>)?)?;
        }
        m.append(&PredefinedMenuItem::separator(app)?)?;
        m.append(&MenuItem::with_id(app, "tray_quit", "Quit Pocket Ledger", true, None::<&str>)?)?;
        Ok(m)
    };
    let menu = match build() {
        Ok(m) => m,
        Err(_) => return,
    };
    let tip = if port != 0 { format!("Pocket Ledger — sharing on port {port}") } else { "Pocket Ledger — sharing starting…".to_string() };
    if let Some(t) = app.tray_by_id(TRAY_ID) {
        let _ = t.set_menu(Some(menu));
        let _ = t.set_tooltip(Some(&tip));
        return;
    }
    let Some(icon) = app.default_window_icon().cloned() else {
        app.state::<crate::AppCtx>().trace.log("PL-MAIN", "tray_icon_missing", &json!({ "sharingPort": port }).to_string());
        return;
    };
    let r = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip(&tip)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = ev {
                let app = tray.app_handle().clone();
                tauri::async_runtime::spawn(async move { crate::focus_or_open_window(&app).await });
            }
        })
        .build(app);
    if r.is_ok() {
        app.state::<crate::AppCtx>().trace.log("PL-MAIN", "tray_created", &json!({ "sharingPort": port }).to_string());
    }
}
