// Pocket Ledger desktop — Tauri v2 shell (Electron `electron/main.js` ka replacement).
// Release build me console window nahi.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod bridge;
mod device;
mod migrate;
mod native;
mod p2;
mod sidecar;
mod tabs;
mod trace;
mod tray;

use serde_json::json;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::ipc::CapabilityBuilder;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Webview};

pub const SHIM_JS: &str = include_str!("../shim/pl-desktop-shim.js");

pub struct AppCtx {
    pub app_ui_port: AtomicU16,
    /// (entry url, entry error) — Go sidecar se
    pub entry: Mutex<(String, String)>,
    pub boot_session_id: String,
    pub user_agent: String,
    pub selftest: bool,
    pub trace_verbose: bool,
    pub started: Instant,
    pub first_load_done: AtomicBool,
    pub quitting: AtomicBool,
    pub trace: trace::TraceLog,
    pub sidecar: OnceLock<Arc<sidecar::Sidecar>>,
    pub content_ports: Mutex<HashSet<u16>>,
}

impl AppCtx {
    pub fn entry_url(&self) -> Result<String, String> {
        let (u, e) = self.entry.lock().unwrap().clone();
        if !e.is_empty() {
            return Err(e);
        }
        if u.is_empty() {
            return Err("app server not ready".into());
        }
        Ok(u)
    }
}

/// Local app-content (http://localhost:<appUiPort>) ki poori permission list.
const LOCAL_ONLY_PERMS: &[&str] = &[
    "allow-pl-pick-directory",
    "allow-pl-backup-write",
    "allow-pl-backup-list",
    "allow-pl-backup-read",
    "allow-pl-att-write",
    "allow-pl-att-write-binary",
    "allow-pl-att-read",
    "allow-pl-att-delete",
    "allow-pl-att-exists",
    "allow-pl-att-stat-sizes",
    "allow-pl-local-server",
    "allow-pl-bridge-upsert",
    "allow-pl-update-download",
    "allow-pl-bridge-result",
    "allow-pl-open-external-auth",
];

fn add_content_capability(app: &AppHandle, port: u16) -> Result<(), String> {
    let ctx = app.state::<AppCtx>();
    if !ctx.content_ports.lock().unwrap().insert(port) {
        return Ok(());
    }
    let mut cap = CapabilityBuilder::new(format!("app-content-{port}"))
        .remote(format!("http://localhost:{port}/*"))
        .remote(format!("http://127.0.0.1:{port}/*"))
        .local(false)
        .webview("tab-*");
    for p in auth::REMOTE_PERMS.iter().chain(LOCAL_ONLY_PERMS.iter()) {
        cap = cap.permission(*p);
    }
    app.add_capability(cap).map_err(|e| e.to_string())
}

/// App UI port badla (restart) — headers + capability update.
pub fn on_app_ui_port_changed(app: &AppHandle, port: u16) {
    let ctx = app.state::<AppCtx>();
    ctx.app_ui_port.store(port, Ordering::SeqCst);
    {
        let mut e = ctx.entry.lock().unwrap();
        if let Ok(mut u) = tauri::Url::parse(&e.0) {
            if matches!(u.host_str(), Some("localhost") | Some("127.0.0.1")) {
                let _ = u.set_port(Some(port));
                e.0 = u.to_string();
            }
        }
    }
    auth::set_app_ui_port(port);
    if let Err(e) = add_content_capability(app, port) {
        ctx.trace.log("PL-SERVER", "content_capability_failed", &e);
    }
}

pub fn show_entry_error(app: &AppHandle, e: &str) {
    app.state::<AppCtx>().trace.log("PL-MAIN", "entry_error", &json!({ "error": e }).to_string());
    let msg = format!("Pocket Ledger could not open the app:\n\n{e}");
    std::thread::spawn(move || message_box("Pocket Ledger", &msg));
}

fn message_box(title: &str, text: &str) {
    #[cfg(windows)]
    unsafe {
        use windows::core::HSTRING;
        use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
        MessageBoxW(None, &HSTRING::from(text), &HSTRING::from(title), MB_OK | MB_ICONWARNING);
    }
    #[cfg(not(windows))]
    {
        eprintln!("{title}: {text}");
    }
}

/// Window close (Electron `win.on("close")`): sharing chal raha ho to saari windows tray me chhupao.
pub fn on_window_close_requested(app: &AppHandle, _win: &str) -> bool {
    let ctx = app.state::<AppCtx>();
    if ctx.quitting.load(Ordering::SeqCst) || !tray::should_hide_to_tray() {
        return false;
    }
    for w in tabs::window_labels(app) {
        if let Some(win) = app.get_window(&w) {
            let _ = win.hide();
        }
    }
    ctx.trace.log("PL-MAIN", "window_hidden_server_running", &tray::last_state().to_string());
    if let Some(sc) = ctx.sidecar.get().cloned() {
        tauri::async_runtime::spawn(async move {
            let _ = sc.ctl("windowClosedToTray", json!({}), Duration::from_secs(10)).await;
        });
    }
    true
}

/// Aakhri app window band — Electron `window-all-closed` -> quit.
pub fn on_window_destroyed(app: &AppHandle, _win: &str) {
    if tabs::window_labels(app).is_empty() {
        quit_app(app);
    }
}

/// Electron `quitPocketLedgerFully`.
pub fn quit_app(app: &AppHandle) {
    let ctx = app.state::<AppCtx>();
    if ctx.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    ctx.trace.log("PL-MAIN", "full_quit_requested", "{}");
    native::set_power_block(false);
    let _ = app.remove_tray_by_id(tray::TRAY_ID);
    if let Some(sc) = ctx.sidecar.get().cloned() {
        let _ = sc.ctl_blocking("quit", json!({}), Duration::from_secs(5));
    }
    app.exit(0);
}

/// Electron `powerMonitor.on("resume")`: tabs ko live-sync + sidecar sharing ensure.
pub fn on_system_resume(app: &AppHandle) {
    app.state::<AppCtx>().trace.log("PL-MAIN", "system_resume_live_sync", "{}");
    tabs::notify_live_sync_resume(app, "system_resume");
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(sc) = app2.state::<AppCtx>().sidecar.get().cloned() {
            let _ = sc.ctl("resume", json!({}), Duration::from_secs(30)).await;
        }
    });
}

pub async fn focus_or_open_window(app: &AppHandle) {
    let wins = tabs::window_labels(app);
    if wins.is_empty() {
        let _ = tabs::create_window(app).await;
        return;
    }
    for w in &wins {
        if let Some(win) = app.get_window(w) {
            let _ = win.show();
            let _ = win.unminimize();
        }
    }
    let target = tabs::focused_window(app).unwrap_or_else(|| wins[0].clone());
    if let Some(win) = app.get_window(&target) {
        let _ = win.set_focus();
    }
    if let Some(sc) = app.state::<AppCtx>().sidecar.get().cloned() {
        let _ = sc.ctl("resume", json!({}), Duration::from_secs(30)).await;
    }
}

fn dev_flag(name: &str) -> bool {
    cfg!(debug_assertions) && std::env::var(name).map(|v| v == "1").unwrap_or(false)
}

/// `out/` kahan hai: bundle resource -> (debug) env PL_STATIC_ROOT -> project ../out -> %TEMP% test copy.
fn resolve_static_root(app: &AppHandle) -> Option<PathBuf> {
    let has_index = |p: &PathBuf| p.join("index.html").is_file();
    if cfg!(debug_assertions) {
        if let Some(p) = std::env::var_os("PL_STATIC_ROOT").map(PathBuf::from) {
            if has_index(&p) {
                return Some(p);
            }
        }
    }
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("out");
        if has_index(&p) {
            return Some(p);
        }
    }
    if cfg!(debug_assertions) {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("out");
        if has_index(&p) {
            return Some(p);
        }
        if let Some(t) = std::env::var_os("TEMP") {
            let p = PathBuf::from(t).join("pl-tauri-test-static").join("out");
            if has_index(&p) {
                return Some(p);
            }
        }
    }
    None
}

/// Electron jaisa UA: React `navigator.userAgent.includes("electron")` se desktop mode pehchanta hai.
fn build_user_agent() -> String {
    let chrome = tauri::webview_version().unwrap_or_else(|_| "130.0.0.0".into());
    format!(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) pocket-ledger-electron/{v} Chrome/{chrome} Electron/compat Safari/537.36 PocketLedgerTauri/{v}",
        v = env!("CARGO_PKG_VERSION")
    )
}


// ---------------------------------------------------------------- commands: tab strip

fn strip_window(webview: &Webview) -> String {
    tabs::win_of_strip(webview.label())
}

#[tauri::command]
async fn tab_strip_action(app: AppHandle, webview: Webview, action: String, index: Option<usize>) -> Result<serde_json::Value, String> {
    let win = strip_window(&webview);
    if action != "refresh" {
        app.state::<AppCtx>().trace.log("PL-TAB", "strip_action", &json!({ "action": action, "index": index, "window": win }).to_string());
    }
    match action.as_str() {
        "switch" => tabs::switch_to(&app, &win, index.ok_or("missing index")?),
        "close" => tabs::close_at(&app, &win, index.ok_or("missing index")?),
        "new" => {
            tabs::open_tab(&app, &win, None).await?;
        }
        "refresh" => tabs::push_strip(&app, &win),
        _ => return Err("unknown action".into()),
    }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn tab_reload_active(app: AppHandle, webview: Webview) -> serde_json::Value {
    json!({ "ok": tabs::reload_active(&app, &strip_window(&webview), false) })
}

#[tauri::command]
async fn win_chrome_action(app: AppHandle, webview: Webview, action: String) -> Result<(), String> {
    let win = app.get_window(&strip_window(&webview)).ok_or("no window")?;
    match action.as_str() {
        "minimize" => win.minimize().map_err(|e| e.to_string()),
        "maximize-toggle" => {
            if win.is_maximized().unwrap_or(false) {
                win.unmaximize().map_err(|e| e.to_string())
            } else {
                win.maximize().map_err(|e| e.to_string())
            }
        }
        "close" => win.close().map_err(|e| e.to_string()),
        _ => Err("unknown action".into()),
    }
}

#[tauri::command]
async fn win_start_drag(app: AppHandle, webview: Webview) -> Result<(), String> {
    let win = app.get_window(&strip_window(&webview)).ok_or("no window")?;
    win.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
async fn win_show_app_menu(app: AppHandle, webview: Webview) -> Result<(), String> {
    let wl = strip_window(&webview);
    let win = app.get_window(&wl).ok_or("no window")?;
    tabs::set_focused(&app, &wl);
    let menu = build_app_menu(&app, &wl).map_err(|e| e.to_string())?;
    win.popup_menu_at(&menu, LogicalPosition::new(4.0, tabs::STRIP_HEIGHT)).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- commands: content tabs (shim)

fn tab_window(app: &AppHandle, webview: &Webview) -> Option<String> {
    tabs::window_of_tab(app, webview.label()).or_else(|| tabs::focused_window(app))
}

#[tauri::command]
async fn pl_open_url_in_new_tab(app: AppHandle, webview: Webview, url: String) -> serde_json::Value {
    let url = url.trim().to_string();
    if url.is_empty() {
        return json!({ "ok": false, "error": "missing-url" });
    }
    let ctx = app.state::<AppCtx>();
    ctx.trace.log("PL-GATE-TRACE", "open_gate_new_tab", &json!({ "url": url }).to_string());
    let Some(win) = tab_window(&app, &webview) else { return json!({ "ok": false, "error": "no-window" }) };
    match tabs::open_tab(&app, &win, Some(url.clone())).await {
        Ok(_) => json!({ "ok": true }),
        Err(e) => {
            ctx.trace.log("PL-GATE-TRACE", "open_gate_new_tab_failed", &json!({ "url": url, "error": e }).to_string());
            json!({ "ok": false, "error": e })
        }
    }
}

/// "Login with Google" (src/lib/pocketbaseData/pbClient.ts `pocketBaseGoogleSignIn`): Google sign-in page
/// system browser me kholta hai (Google WebView ke andar login block karta hai). Least privilege: sirf
/// `https://accounts.google.com/` URLs; baaki sab mana. Permission sirf local app-content ko (LOCAL_ONLY_PERMS).
#[tauri::command]
fn pl_open_external_auth(url: String) -> serde_json::Value {
    let url = url.trim().to_string();
    if !url.starts_with("https://accounts.google.com/") {
        return json!({ "ok": false, "error": "url-not-allowed" });
    }
    if !cfg!(windows) {
        return json!({ "ok": false, "error": "unsupported" });
    }
    native::open_external(&url);
    json!({ "ok": true })
}

#[tauri::command]
fn pl_tab_sync_done(app: AppHandle) {
    // Electron strip `pl-tab-strip-sync-done-ack` ko handle nahi karta tha (no-op parity).
    let _ = app;
}

#[tauri::command]
fn pl_device_display_info() -> String {
    device::display_label()
}

#[tauri::command]
fn pl_trace_log(app: AppHandle, tag: String, event: String, detail: Option<String>) {
    app.state::<AppCtx>().trace.log(&tag, &event, detail.as_deref().unwrap_or(""));
}

#[tauri::command]
fn pl_trace_get_logs(app: AppHandle, limit: Option<usize>) -> Vec<trace::TraceEntry> {
    app.state::<AppCtx>().trace.recent(limit.unwrap_or(200))
}

#[tauri::command]
fn pl_trace_get_log_file_path(app: AppHandle) -> String {
    app.state::<AppCtx>().trace.file_path()
}

#[tauri::command]
async fn pl_shortcut(app: AppHandle, webview: Webview, action: String) -> Result<(), String> {
    let win = tab_window(&app, &webview);
    run_action(&app, win, &action).await;
    Ok(())
}

#[tauri::command]
fn pl_broadcast_db_bump(app: AppHandle, company_id: String, collection: String, source: Option<String>, immediate: Option<bool>) {
    let company_id = company_id.trim().to_string();
    let collection = collection.trim().to_string();
    if company_id.is_empty() || collection.is_empty() {
        return;
    }
    let detail = json!({
        "companyId": company_id,
        "collection": collection,
        "immediate": immediate.unwrap_or(true),
        "source": source.unwrap_or_else(|| "local_write".into()),
    });
    app.state::<AppCtx>().trace.log("PL-LIVE-CHANGE", "ipc_browser_db_bump", &detail.to_string());
    let js = format!(
        "(function(){{try{{if(typeof window.__plInvalidateBrowserDbCache==='function')window.__plInvalidateBrowserDbCache();}}catch(e){{}}try{{window.dispatchEvent(new CustomEvent('pocket-ledger-browser-db-bump',{{detail:{detail}}}));}}catch(e){{}}}})()"
    );
    tabs::eval_all_tabs(&app, &js);
}

#[tauri::command]
fn pl_broadcast_gate_snapshot(app: AppHandle, snapshot: serde_json::Value) {
    if !snapshot.get("gates").map(|g| g.is_array()).unwrap_or(false) {
        return;
    }
    let js = format!(
        "(function(){{try{{var snap={snapshot};if(typeof window.__plApplyGateStoreSnapshot==='function'){{window.__plApplyGateStoreSnapshot(snap);}}else{{window.dispatchEvent(new Event('pl-gate-changed'));}}}}catch(e){{}}}})()"
    );
    tabs::eval_all_tabs(&app, &js);
}

// ---------------------------------------------------------------- menu + shortcuts

fn build_app_menu(app: &AppHandle, win: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let mode = tabs::get_print_mode(app, win);
    let refresh = Submenu::with_items(
        app,
        "Refresh",
        true,
        &[
            &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(app, "force_reload", "Force Reload", true, Some("CmdOrCtrl+Shift+R"))?,
        ],
    )?;
    let print_scale = Submenu::with_items(
        app,
        "Print Scale",
        true,
        &[
            &CheckMenuItem::with_id(app, "print_scale_actual", "Actual Size", true, mode == tabs::PrintMode::Actual, None::<&str>)?,
            &CheckMenuItem::with_id(app, "print_scale_fit_width", "Fit to Width", true, mode == tabs::PrintMode::FitWidth, None::<&str>)?,
            &CheckMenuItem::with_id(app, "print_scale_fit_page", "Fit to Page", true, mode == tabs::PrintMode::FitPage, None::<&str>)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new_tab", "New Tab", true, Some("CmdOrCtrl+T"))?,
            &MenuItem::with_id(app, "new_window", "New Window", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "close_tab", "Close Tab", true, Some("CmdOrCtrl+W"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "print", "Print", true, Some("CmdOrCtrl+P"))?,
            &print_scale,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
        ],
    )?;
    let devtools = MenuItem::with_id(app, "toggle_devtools", "Toggle Developer Tools", cfg!(debug_assertions), Some("CmdOrCtrl+Shift+I"))?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "toggle_quick_actions", "Toggle quick actions ribbon", true, Some("CmdOrCtrl+Shift+H"))?,
            &PredefinedMenuItem::separator(app)?,
            &devtools,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "zoom_reset", "Actual Size", true, Some("CmdOrCtrl+0"))?,
            &MenuItem::with_id(app, "zoom_in", "Zoom In", true, Some("CmdOrCtrl+Plus"))?,
            &MenuItem::with_id(app, "zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "next_tab", "Next Tab", true, Some("CmdOrCtrl+Tab"))?,
            &MenuItem::with_id(app, "prev_tab", "Previous Tab", true, Some("CmdOrCtrl+Shift+Tab"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "toggle_fullscreen", "Toggle Full Screen", true, Some("F11"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &MenuItem::with_id(app, "minimize", "Minimize", true, None::<&str>)?,
            &MenuItem::with_id(app, "close_window", "Close", true, None::<&str>)?,
        ],
    )?;
    Menu::with_items(app, &[&refresh, &file, &edit, &view, &window])
}

async fn run_action(app: &AppHandle, win: Option<String>, action: &str) {
    // tray + app-level actions (window ki zaroorat nahi)
    match action {
        "new_window" => {
            if let Err(e) = tabs::create_window(app).await {
                app.state::<AppCtx>().trace.log("PL-TAB", "new_window_failed", &e);
            }
            return;
        }
        "tray_open" => return focus_or_open_window(app).await,
        "tray_stop" | "tray_retry" => {
            if let Some(sc) = app.state::<AppCtx>().sidecar.get().cloned() {
                let op = if action == "tray_stop" { "stop" } else { "trayRetry" };
                let _ = sc.ctl(op, json!({}), Duration::from_secs(30)).await;
            }
            return;
        }
        "tray_quit" => {
            let app = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || quit_app(&app)).await;
            return;
        }
        _ => {}
    }
    let Some(win) = win.or_else(|| tabs::focused_window(app)) else { return };
    let w = app.get_window(&win);
    let active_wv = || tabs::active_label(app, &win).and_then(|l| app.get_webview(&l));
    match action {
        "new_tab" => {
            let _ = tabs::open_tab(app, &win, None).await;
        }
        "close_tab" => tabs::close_active(app, &win),
        "next_tab" => tabs::cycle(app, &win, 1),
        "prev_tab" => tabs::cycle(app, &win, -1),
        "reload" => {
            tabs::reload_active(app, &win, false);
        }
        "force_reload" => {
            tabs::reload_active(app, &win, true);
        }
        "print" => tabs::print_active(app, &win),
        "print_scale_actual" => tabs::set_print_mode(app, &win, tabs::PrintMode::Actual),
        "print_scale_fit_width" => tabs::set_print_mode(app, &win, tabs::PrintMode::FitWidth),
        "print_scale_fit_page" => tabs::set_print_mode(app, &win, tabs::PrintMode::FitPage),
        "toggle_quick_actions" => {
            if let Some(wv) = active_wv() {
                let _ = wv.eval("(function(){try{var k='pl-desktop-header-quick-actions-collapsed';if(localStorage.getItem(k)==='1')localStorage.removeItem(k);else localStorage.setItem(k,'1');window.dispatchEvent(new Event('pl-desktop-quick-actions-toggle'));}catch(e){}})();");
            }
        }
        "toggle_devtools" => {
            #[cfg(debug_assertions)]
            if let Some(wv) = active_wv() {
                if wv.is_devtools_open() {
                    wv.close_devtools();
                } else {
                    wv.open_devtools();
                }
            }
        }
        "zoom_reset" => tabs::adjust_zoom(app, &win, None),
        "zoom_in" => tabs::adjust_zoom(app, &win, Some(0.1)),
        "zoom_out" => tabs::adjust_zoom(app, &win, Some(-0.1)),
        "toggle_fullscreen" => {
            if let Some(w) = w {
                let fs = w.is_fullscreen().unwrap_or(false);
                let _ = w.set_fullscreen(!fs);
            }
        }
        "minimize" => {
            if let Some(w) = w {
                let _ = w.minimize();
            }
        }
        "close_window" => {
            if let Some(w) = w {
                let _ = w.close();
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------- self-test (debug only)

fn selftest_log(app: &AppHandle, step: &str, extra: serde_json::Value) {
    let t = app.state::<tabs::Tabs>();
    let snap = {
        let g = t.0.lock().unwrap();
        g.wins
            .iter()
            .map(|(k, w)| (k.clone(), json!({ "count": w.tabs.len(), "active": w.active, "labels": w.tabs.iter().map(|e| e.label.clone()).collect::<Vec<_>>() })))
            .collect::<serde_json::Map<_, _>>()
    };
    let s = json!({ "step": step, "wins": snap, "extra": extra }).to_string();
    println!("PL_SELFTEST {s}");
    app.state::<AppCtx>().trace.log("PL-SELFTEST", step, &s);
}

async fn run_selftest(app: AppHandle) {
    let wait = |ms: u64| tauri::async_runtime::spawn_blocking(move || std::thread::sleep(Duration::from_millis(ms)));
    let main = tabs::MAIN_WINDOW;
    let _ = wait(7000).await;
    selftest_log(&app, "initial", json!({}));
    let r = tabs::open_tab(&app, main, None).await;
    let _ = wait(4000).await;
    selftest_log(&app, "after_new_tab", json!({ "result": format!("{r:?}") }));
    tabs::switch_to(&app, main, 0);
    let _ = wait(1000).await;
    tabs::cycle(&app, main, 1);
    let _ = wait(1000).await;
    selftest_log(&app, "after_cycle", json!({}));
    tabs::close_active(&app, main);
    let _ = wait(1500).await;
    selftest_log(&app, "after_close_active", json!({}));
    let r = tabs::create_window(&app).await;
    let _ = wait(4000).await;
    selftest_log(&app, "after_new_window", json!({ "result": format!("{r:?}") }));
    if let Ok(w2) = r {
        if let Some(w) = app.get_window(&w2) {
            let _ = w.close();
        }
        let _ = wait(1500).await;
        selftest_log(&app, "after_close_window2", json!({}));
    }
    let ok = tabs::reload_active(&app, main, true);
    let _ = wait(3000).await;
    selftest_log(&app, "after_force_reload", json!({ "ok": ok }));
    selftest_log(&app, "done", json!({}));
    if dev_flag("PL_TAURI_SELFTEST_EXIT") {
        let _ = wait(1000).await;
        quit_app(&app);
    }
}

// ---------------------------------------------------------------- setup

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let started = Instant::now();
    let handle = app.handle().clone();
    let app_data = app.path().app_data_dir()?;
    let local_data = app.path().app_local_data_dir()?;
    std::fs::create_dir_all(&app_data)?;
    let trace = trace::TraceLog::new(Some(app_data.clone()));

    // 1) first-run migration (purana Electron folder read-only)
    let mig = migrate::run_first_run(&app_data, &local_data);
    trace.log("PL-MIGRATE", &format!("migration_{}", mig.status), &mig.detail.to_string());
    let mig2 = migrate::run_v2(&app_data);
    trace.log("PL-MIGRATE", &format!("migration_v2_{}", mig2.status), &mig2.detail.to_string());
    let mig3 = migrate::run_upgrade_cache(&app_data, &local_data, p2::dev_or_packaged("PL_TAURI_AS_PACKAGED"));
    trace.log("PL-MIGRATE", &format!("upgrade_cache_{}", mig3.status), &mig3.detail.to_string());

    // 2) state pehle (sidecar events/rpc turant aa sakte hain)
    let selftest = dev_flag("PL_TAURI_SELFTEST");
    app.manage(tabs::Tabs::default());
    app.manage(AppCtx {
        app_ui_port: AtomicU16::new(0),
        entry: Mutex::new((String::new(), String::new())),
        boot_session_id: uuid::Uuid::new_v4().to_string(),
        user_agent: build_user_agent(),
        selftest,
        trace_verbose: dev_flag("PL_TRACE_VERBOSE"),
        started,
        first_load_done: AtomicBool::new(false),
        quitting: AtomicBool::new(false),
        trace,
        sidecar: OnceLock::new(),
        content_ports: Mutex::new(HashSet::new()),
    });

    // 3) Go sidecar (app UI server + PL server + LAN sharing; Firebase proxy nahi (501))
    let root = resolve_static_root(&handle).ok_or("static out/ folder not found (run `npm run build:static`)")?;
    let h_msg = handle.clone();
    let (sc, ready) = sidecar::spawn(&root, &app_data, &app_data.join("logs"), move |m| bridge::on_inbound(&h_msg, m))?;
    let ctx = handle.state::<AppCtx>();
    let _ = ctx.sidecar.set(sc.clone());
    *ctx.entry.lock().unwrap() = (ready.entry_url.clone(), ready.entry_error.clone());
    ctx.trace.log(
        "PL-SERVER",
        "app_ui_listening",
        &json!({ "port": ready.app_ui_port, "root": root.display().to_string(), "runtime": "tauri-sidecar", "entryError": ready.entry_error }).to_string(),
    );
    if let Ok(v) = sc.ctl_blocking("clientToken", json!({}), Duration::from_secs(5)) {
        auth::set_client_token(v.get("token").and_then(|t| t.as_str()).unwrap_or(""));
    }
    if ready.app_ui_port != 0 {
        on_app_ui_port_changed(&handle, ready.app_ui_port);
    }
    if let Some(o) = auth::origin_of(&ready.entry_url) {
        auth::allow_remote_origin(&handle, &o);
    }
    let _ = sc.ctl_blocking("emitState", json!({}), Duration::from_secs(5));
    native::start_power_resume_watch(handle.clone());

    // 4) pehli window (async — WebView2 deadlock se bachne ke liye)
    let h3 = handle.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = tabs::create_window(&h3).await {
            h3.state::<AppCtx>().trace.log("PL-TAB", "open_failed", &e);
        }
        if selftest {
            run_selftest(h3).await;
        }
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { focus_or_open_window(&app).await });
        }))
        .on_menu_event(|app, event| {
            let app = app.clone();
            let id = event.id().as_ref().to_string();
            tauri::async_runtime::spawn(async move { run_action(&app, None, &id).await });
        })
        .invoke_handler(tauri::generate_handler![
            tab_strip_action,
            tab_reload_active,
            win_chrome_action,
            win_show_app_menu,
            win_start_drag,
            pl_open_url_in_new_tab,
            pl_open_external_auth,
            pl_tab_sync_done,
            pl_device_display_info,
            pl_trace_log,
            pl_trace_get_logs,
            pl_trace_get_log_file_path,
            pl_shortcut,
            pl_broadcast_db_bump,
            pl_broadcast_gate_snapshot,
            p2::pl_pick_directory,
            p2::pl_backup_write,
            p2::pl_backup_list,
            p2::pl_backup_read,
            p2::pl_att_write,
            p2::pl_att_write_binary,
            p2::pl_att_read,
            p2::pl_att_delete,
            p2::pl_att_exists,
            p2::pl_att_stat_sizes,
            p2::pl_local_server,
            p2::pl_bridge_upsert,
            p2::pl_update_download,
            p2::pl_set_remote_auth,
            p2::pl_print_done,
            bridge::pl_bridge_result,
        ])
        .setup(setup)
        .build(tauri::generate_context!())
        .expect("error while building Pocket Ledger")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                // hidden bridge / tray ke saath bhi: app sirf quit_app se band hota hai
                if code.is_none() && !app.state::<AppCtx>().quitting.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
            tauri::RunEvent::Exit => {
                native::set_power_block(false);
                if let Some(ctx) = app.try_state::<AppCtx>() {
                    if let Some(sc) = ctx.sidecar.get() {
                        sc.shutdown();
                    }
                }
            }
            _ => {}
        });
}
