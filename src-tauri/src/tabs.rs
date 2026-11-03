//! Multi-window tab strip (Electron BrowserView model) — Tauri multiwebview se.
//! Har window: upar `tabstrip[-k]` webview (36px), neeche active `tab-<n>` webview; baaki tabs hidden.
//! Window labels: `main`, `main-2`, ... (Ctrl+N). Tab labels globally unique (`tab-<n>`).
//! Hidden server data bridge: alag hidden window `tab-bridge` (Electron `serverDataBridgeWindow`).
//! NOTE: Tabs mutex pakad kar kabhi webview API call nahi karte (WebView2 deadlock se bachao).
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::window::WindowBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Rect, WebviewUrl, WindowEvent};

use crate::AppCtx;

pub const MAIN_WINDOW: &str = "main";
pub const BRIDGE_LABEL: &str = "tab-bridge";
pub const STRIP_HEIGHT: f64 = 36.0;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PrintMode {
    Actual,
    FitWidth,
    FitPage,
}

impl PrintMode {
    pub fn scale(self) -> f64 {
        match self {
            PrintMode::Actual => 1.0,
            PrintMode::FitWidth => 0.9,
            PrintMode::FitPage => 0.8,
        }
    }
}

#[derive(Clone)]
pub struct TabEntry {
    pub label: String,
    pub title: String,
    pub url_label: String,
    pub zoom: f64,
}

pub struct WinTabs {
    pub tabs: Vec<TabEntry>,
    pub active: Option<usize>,
    pub maximized: bool,
    pub print_mode: PrintMode,
}

impl Default for WinTabs {
    fn default() -> Self {
        WinTabs { tabs: vec![], active: None, maximized: false, print_mode: PrintMode::FitPage }
    }
}

#[derive(Default)]
pub struct TabsInner {
    pub wins: HashMap<String, WinTabs>,
    pub next_id: u64,
    pub next_win: u64,
    pub last_focused: String,
    /// webview label -> page loading? (Go `candidates` ke liye)
    pub loading: HashMap<String, bool>,
    /// print ke dauran temporary zoom: label -> original zoom
    pub print_restore: HashMap<String, f64>,
}

#[derive(Default)]
pub struct Tabs(pub Mutex<TabsInner>);

pub fn strip_label(win: &str) -> String {
    match win.strip_prefix("main-") {
        Some(k) => format!("tabstrip-{k}"),
        None => "tabstrip".to_string(),
    }
}

pub fn win_of_strip(strip: &str) -> String {
    match strip.strip_prefix("tabstrip-") {
        Some(k) => format!("main-{k}"),
        None => MAIN_WINDOW.to_string(),
    }
}

fn url_label(url: &tauri::Url) -> String {
    let host = match url.host_str() {
        Some("127.0.0.1") => "localhost".to_string(),
        Some(h) => h.to_string(),
        None => return String::new(),
    };
    match url.port() {
        Some(p) if p != 80 && p != 443 => format!("{host}:{p}"),
        _ => host,
    }
}

fn with_tabs<R>(app: &AppHandle, f: impl FnOnce(&mut TabsInner) -> R) -> R {
    let t = app.state::<Tabs>();
    let mut g = t.0.lock().unwrap();
    f(&mut g)
}

/// Kis window me yeh tab hai.
pub fn window_of_tab(app: &AppHandle, label: &str) -> Option<String> {
    with_tabs(app, |g| g.wins.iter().find(|(_, w)| w.tabs.iter().any(|e| e.label == label)).map(|(k, _)| k.clone()))
}

/// Menu / shortcut ke liye: last focused app window (fallback: koi bhi).
pub fn focused_window(app: &AppHandle) -> Option<String> {
    let (last, any) = with_tabs(app, |g| (g.last_focused.clone(), g.wins.keys().next().cloned()));
    if !last.is_empty() && app.get_window(&last).is_some() {
        return Some(last);
    }
    any
}

pub fn set_focused(app: &AppHandle, win: &str) {
    with_tabs(app, |g| g.last_focused = win.to_string());
}

pub fn window_labels(app: &AppHandle) -> Vec<String> {
    with_tabs(app, |g| g.wins.keys().cloned().collect())
}

/// Window ka logical content size (w, h).
pub fn content_size(app: &AppHandle, win: &str) -> Option<(f64, f64)> {
    let win = app.get_window(win)?;
    let scale = win.scale_factor().ok()?;
    let size = win.inner_size().ok()?.to_logical::<f64>(scale);
    Some((size.width, size.height))
}

fn tab_rect(w: f64, h: f64) -> Rect {
    Rect {
        position: LogicalPosition::new(0.0, STRIP_HEIGHT).into(),
        size: LogicalSize::new(w.max(1.0), (h - STRIP_HEIGHT).max(1.0)).into(),
    }
}

/// Resize par strip + active tab bounds.
pub fn layout(app: &AppHandle, win: &str, w: f64, h: f64) {
    if w < 1.0 || h < 1.0 {
        return; // minimized
    }
    if let Some(strip) = app.get_webview(&strip_label(win)) {
        let _ = strip.set_bounds(Rect {
            position: LogicalPosition::new(0.0, 0.0).into(),
            size: LogicalSize::new(w, STRIP_HEIGHT).into(),
        });
    }
    if let Some(label) = active_label(app, win) {
        if let Some(wv) = app.get_webview(&label) {
            let _ = wv.set_bounds(tab_rect(w, h));
        }
    }
}

/// Strip ko current tab list bhejo (Electron `pushTabStripState`).
pub fn push_strip(app: &AppHandle, win: &str) {
    let Some(payload) = with_tabs(app, |g| {
        let w = g.wins.get(win)?;
        let tabs: Vec<_> = w
            .tabs
            .iter()
            .enumerate()
            .map(|(i, e)| {
                json!({
                    "title": if e.title.trim().is_empty() { format!("Tab {}", i + 1) } else { e.title.clone() },
                    "urlLabel": e.url_label,
                    "index": i,
                    "active": Some(i) == w.active,
                })
            })
            .collect();
        let n = tabs.len();
        let active_url = w.active.and_then(|i| w.tabs.get(i)).map(|e| e.url_label.clone()).unwrap_or_default();
        let mut title_bar = if n > 1 { format!("Pocket Ledger ({n} tabs)") } else { "Pocket Ledger".to_string() };
        if !active_url.is_empty() {
            title_bar = format!("{title_bar} — {active_url}");
        }
        Some(json!({ "tabs": tabs, "titleBarLabel": title_bar, "activeUrlLabel": active_url }))
    }) else {
        return;
    };
    if let Some(w) = app.get_window(win) {
        let n = payload["tabs"].as_array().map(|a| a.len()).unwrap_or(0);
        let t = if n > 1 { format!("Pocket Ledger ({n} tabs)") } else { "Pocket Ledger".to_string() };
        let _ = w.set_title(&t);
    }
    if let Some(strip) = app.get_webview(&strip_label(win)) {
        let _ = strip.eval(format!("window.__plTabStripPush&&window.__plTabStripPush('tabs',{payload})"));
    }
}

pub fn push_max_state(app: &AppHandle, win: &str, maximized: bool) {
    if let Some(strip) = app.get_webview(&strip_label(win)) {
        let _ = strip.eval(format!(
            "window.__plTabStripPush&&window.__plTabStripPush('max',{{\"maximized\":{maximized}}})"
        ));
    }
}

pub fn active_label(app: &AppHandle, win: &str) -> Option<String> {
    with_tabs(app, |g| {
        let w = g.wins.get(win)?;
        w.active.and_then(|i| w.tabs.get(i)).map(|e| e.label.clone())
    })
}

/// Saari windows ki saari tabs.
pub fn all_labels(app: &AppHandle) -> Vec<String> {
    with_tabs(app, |g| g.wins.values().flat_map(|w| w.tabs.iter().map(|e| e.label.clone())).collect())
}

pub fn set_loading(app: &AppHandle, label: &str, loading: bool) {
    with_tabs(app, |g| {
        g.loading.insert(label.to_string(), loading);
    });
}

pub fn is_loading(app: &AppHandle, label: &str) -> bool {
    with_tabs(app, |g| g.loading.get(label).copied().unwrap_or(true))
}

pub fn get_print_mode(app: &AppHandle, win: &str) -> PrintMode {
    with_tabs(app, |g| g.wins.get(win).map(|w| w.print_mode).unwrap_or(PrintMode::FitPage))
}

pub fn set_print_mode(app: &AppHandle, win: &str, mode: PrintMode) {
    with_tabs(app, |g| {
        if let Some(w) = g.wins.get_mut(win) {
            w.print_mode = mode;
        }
    });
}

/// Content webview ka init script: boot info + shim.
pub fn init_script(ctx: &AppCtx, bridge: bool) -> String {
    let boot = json!({
        "bootSessionId": ctx.boot_session_id,
        "tabInstanceId": format!("pl_tab_{}", uuid::Uuid::new_v4()),
        "selftest": ctx.selftest && !bridge,
        "traceVerbose": ctx.trace_verbose,
        "appVersion": env!("CARGO_PKG_VERSION"),
        "runtime": "tauri",
        "bridge": bridge,
    });
    format!(
        "try{{Object.defineProperty(window,'__PL_TAURI_BOOT__',{{value:Object.freeze({boot})}});}}catch(_){{}}\n{}",
        crate::SHIM_JS
    )
}

/// Nayi window (Electron `createWindow`): frameless + strip + pehli tab. Async context se hi call karein.
pub async fn create_window(app: &AppHandle) -> Result<String, String> {
    let win_label = with_tabs(app, |g| {
        let label = if !g.wins.contains_key(MAIN_WINDOW) && app.get_window(MAIN_WINDOW).is_none() {
            MAIN_WINDOW.to_string()
        } else {
            g.next_win += 1;
            format!("main-{}", g.next_win + 1)
        };
        g.wins.insert(label.clone(), WinTabs::default());
        label
    });
    let window = WindowBuilder::new(app, &win_label)
        .title("Pocket Ledger")
        .inner_size(1280.0, 800.0)
        .min_inner_size(640.0, 400.0)
        .decorations(false)
        .center()
        .build()
        .map_err(|e| {
            with_tabs(app, |g| g.wins.remove(&win_label));
            format!("window: {e}")
        })?;
    let (w, _h) = content_size(app, &win_label).unwrap_or((1280.0, 800.0));
    window
        .add_child(
            WebviewBuilder::new(strip_label(&win_label), WebviewUrl::App("index.html".into())).zoom_hotkeys_enabled(false),
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(w, STRIP_HEIGHT),
        )
        .map_err(|e| format!("strip: {e}"))?;

    let h2 = app.clone();
    let wl = win_label.clone();
    window.on_window_event(move |ev| match ev {
        WindowEvent::Resized(size) => {
            if let Some(win) = h2.get_window(&wl) {
                let scale = win.scale_factor().unwrap_or(1.0);
                let l = size.to_logical::<f64>(scale);
                layout(&h2, &wl, l.width, l.height);
                let maximized = win.is_maximized().unwrap_or(false);
                let changed = with_tabs(&h2, |g| match g.wins.get_mut(&wl) {
                    Some(w) => {
                        let c = w.maximized != maximized;
                        w.maximized = maximized;
                        c
                    }
                    None => false,
                });
                if changed {
                    push_max_state(&h2, &wl, maximized);
                }
            }
        }
        WindowEvent::Focused(true) => {
            set_focused(&h2, &wl);
            notify_live_sync_resume(&h2, "window_focus");
        }
        WindowEvent::CloseRequested { api, .. } => {
            if crate::on_window_close_requested(&h2, &wl) {
                api.prevent_close();
            }
        }
        WindowEvent::Destroyed => {
            let labels = with_tabs(&h2, |g| {
                let l: Vec<String> = g.wins.remove(&wl).map(|w| w.tabs.into_iter().map(|e| e.label).collect()).unwrap_or_default();
                for x in &l {
                    g.loading.remove(x);
                }
                l
            });
            drop(labels);
            crate::on_window_destroyed(&h2, &wl);
        }
        _ => {}
    });
    set_focused(app, &win_label);
    open_tab(app, &win_label, None).await?;
    Ok(win_label)
}

/// Nayi tab (Electron `openNewTab`). Windows par async context se hi call karein (WebView2 deadlock).
pub async fn open_tab(app: &AppHandle, win_label: &str, url: Option<String>) -> Result<String, String> {
    let ctx = app.state::<AppCtx>();
    let target = match url {
        Some(u) => u,
        None => ctx.entry_url().map_err(|e| {
            crate::show_entry_error(app, &e);
            e
        })?,
    };
    let parsed = tauri::Url::parse(&target).map_err(|e| format!("bad url: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("only http/https urls allowed".into());
    }
    let win = app.get_window(win_label).ok_or("no window")?;
    let label = with_tabs(app, |g| {
        g.next_id += 1;
        format!("tab-{}", g.next_id)
    });

    let app_title = app.clone();
    let app_load = app.clone();
    let wl = win_label.to_string();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed.clone()))
        .initialization_script(init_script(&ctx, false))
        .user_agent(&ctx.user_agent)
        .zoom_hotkeys_enabled(true)
        .on_navigation(|u| matches!(u.scheme(), "http" | "https" | "about" | "blob" | "data"))
        .on_document_title_changed(move |wv, title| {
            let win = with_tabs(&app_title, |g| {
                for (k, w) in g.wins.iter_mut() {
                    if let Some(e) = w.tabs.iter_mut().find(|e| e.label == wv.label()) {
                        e.title = title;
                        return Some(k.clone());
                    }
                }
                None
            });
            if let Some(win) = win {
                push_strip(&app_title, &win);
            }
        })
        .on_page_load(move |wv, payload| {
            let label = wv.label().to_string();
            if payload.event() == PageLoadEvent::Started {
                set_loading(&app_load, &label, true);
                return;
            }
            set_loading(&app_load, &label, false);
            let lbl = url_label(payload.url());
            let win = with_tabs(&app_load, |g| {
                for (k, w) in g.wins.iter_mut() {
                    if let Some(e) = w.tabs.iter_mut().find(|e| e.label == label) {
                        e.url_label = lbl;
                        return Some(k.clone());
                    }
                }
                None
            });
            let ctx = app_load.state::<AppCtx>();
            if !ctx.first_load_done.swap(true, Ordering::SeqCst) {
                let ms = ctx.started.elapsed().as_millis();
                ctx.trace.log("PL-MAIN", "app_ready", &format!("{{\"firstPageLoadMs\":{ms},\"runtime\":\"tauri\"}}"));
                println!("PL_STARTUP_FIRST_PAGE_LOAD_MS {ms}");
            }
            if let Some(win) = win {
                push_strip(&app_load, &win);
            }
        });

    set_loading(app, &label, true);
    let (w, h) = content_size(app, win_label).unwrap_or((1280.0, 800.0));
    let wv = win
        .add_child(
            builder,
            LogicalPosition::new(0.0, STRIP_HEIGHT),
            LogicalSize::new(w.max(1.0), (h - STRIP_HEIGHT).max(1.0)),
        )
        .map_err(|e| format!("add_child: {e}"))?;
    crate::native::attach_content_hooks(app, &wv);

    let index = with_tabs(app, |g| {
        let w = g.wins.entry(wl.clone()).or_default();
        w.tabs.push(TabEntry { label: label.clone(), title: String::new(), url_label: url_label(&parsed), zoom: 1.0 });
        w.tabs.len() - 1
    });
    ctx.trace.log("PL-TAB", "opened", &json!({ "url": target, "label": label, "window": win_label }).to_string());
    switch_to(app, win_label, index);
    Ok(label)
}

/// Electron `switchToTab`: naya dikhao, purana chhupao.
pub fn switch_to(app: &AppHandle, win: &str, index: usize) {
    let Some((show, hide)) = with_tabs(app, |g| {
        let w = g.wins.get_mut(win)?;
        if index >= w.tabs.len() {
            return None;
        }
        w.active = Some(index);
        let show = w.tabs[index].label.clone();
        let hide: Vec<String> = w.tabs.iter().enumerate().filter(|(i, _)| *i != index).map(|(_, e)| e.label.clone()).collect();
        Some((show, hide))
    }) else {
        return;
    };
    if let Some(wv) = app.get_webview(&show) {
        if let Some((w, h)) = content_size(app, win) {
            let _ = wv.set_bounds(tab_rect(w, h));
        }
        let _ = wv.show();
        let _ = wv.set_focus();
    }
    for l in hide {
        if let Some(wv) = app.get_webview(&l) {
            let _ = wv.hide();
        }
    }
    push_strip(app, win);
}

/// Electron `closeTabAt` (Chrome jaisa neighbour select). Aakhri tab band = window band.
pub fn close_at(app: &AppHandle, win: &str, index: usize) {
    let Some((removed, next)) = with_tabs(app, |g| {
        let w = g.wins.get_mut(win)?;
        if index >= w.tabs.len() {
            return None;
        }
        let old_active = w.active.unwrap_or(0);
        let removed = w.tabs.remove(index);
        let next = if w.tabs.is_empty() {
            None
        } else if old_active == index {
            Some(index.min(w.tabs.len() - 1))
        } else if index < old_active {
            Some(old_active - 1)
        } else {
            Some(old_active)
        };
        w.active = next;
        g.loading.remove(&removed.label);
        Some((removed, next))
    }) else {
        return;
    };
    match next {
        Some(i) => switch_to(app, win, i),
        None => {
            if let Some(w) = app.get_window(win) {
                let _ = w.close();
            }
        }
    }
    if let Some(wv) = app.get_webview(&removed.label) {
        let _ = wv.close();
    }
    app.state::<AppCtx>().trace.log("PL-TAB", "closed", &json!({ "label": removed.label }).to_string());
}

pub fn close_active(app: &AppHandle, win: &str) {
    let active = with_tabs(app, |g| g.wins.get(win).and_then(|w| w.active));
    match active {
        Some(i) => close_at(app, win, i),
        None => {
            if let Some(w) = app.get_window(win) {
                let _ = w.close();
            }
        }
    }
}

pub fn cycle(app: &AppHandle, win: &str, delta: isize) {
    let Some(target) = with_tabs(app, |g| {
        let w = g.wins.get(win)?;
        let n = w.tabs.len() as isize;
        if n <= 1 {
            return None;
        }
        let cur = w.active.unwrap_or(0) as isize;
        Some((((cur + delta) % n + n) % n) as usize)
    }) else {
        return;
    };
    switch_to(app, win, target);
}

pub fn reload_active(app: &AppHandle, win: &str, ignore_cache: bool) -> bool {
    let Some(label) = active_label(app, win) else { return false };
    let Some(wv) = app.get_webview(&label) else { return false };
    if ignore_cache {
        // Electron `reloadIgnoringCache`: WebView2 CDP `Page.reload {ignoreCache:true}`.
        crate::native::reload_ignoring_cache(&wv)
    } else {
        wv.reload().is_ok()
    }
}

pub fn adjust_zoom(app: &AppHandle, win: &str, delta: Option<f64>) {
    let Some(label) = active_label(app, win) else { return };
    let Some(z) = with_tabs(app, |g| {
        let w = g.wins.get_mut(win)?;
        let e = w.tabs.iter_mut().find(|e| e.label == label)?;
        e.zoom = match delta {
            Some(d) => (e.zoom + d).clamp(0.25, 3.0),
            None => 1.0,
        };
        Some(e.zoom)
    }) else {
        return;
    };
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.set_zoom(z);
    }
}

/// Electron `printCurrentTab`: print mode ka temporary zoom, dialog band (`afterprint`) par wapas.
pub fn print_active(app: &AppHandle, win: &str) {
    let Some(label) = active_label(app, win) else { return };
    let mode = get_print_mode(app, win);
    let original = with_tabs(app, |g| {
        let z = g.wins.get(win).and_then(|w| w.tabs.iter().find(|e| e.label == label)).map(|e| e.zoom).unwrap_or(1.0);
        g.print_restore.insert(label.clone(), z);
        z
    });
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.set_zoom(mode.scale());
        // shim `afterprint` -> pl_print_done (zoom restore). Fallback: 10 min baad restore.
        let _ = wv.eval("setTimeout(function(){try{window.print()}catch(_){}},60)");
        let app2 = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(600));
            print_done(&app2, &label);
        });
        let _ = original;
    }
}

pub fn print_done(app: &AppHandle, label: &str) {
    if let Some(z) = with_tabs(app, |g| g.print_restore.remove(label)) {
        if let Some(wv) = app.get_webview(label) {
            let _ = wv.set_zoom(z);
        }
    }
}

/// Saari tabs + hidden bridge.
pub fn eval_all_tabs(app: &AppHandle, js: &str) {
    let mut labels = all_labels(app);
    labels.push(BRIDGE_LABEL.to_string());
    for l in labels {
        if let Some(wv) = app.get_webview(&l) {
            let _ = wv.eval(js.to_string());
        }
    }
}

/// Window focus/restore par saari tabs ko `pocket-ledger-electron-resume` (Electron `notifyLiveSyncResume`).
pub fn notify_live_sync_resume(app: &AppHandle, reason: &str) {
    let js = format!(
        "window.__plTauriEmit&&window.__plTauriEmit('live-sync-resume',{})",
        json!({ "reason": reason })
    );
    for l in all_labels(app) {
        if let Some(wv) = app.get_webview(&l) {
            let _ = wv.eval(js.clone());
        }
    }
}

/// Port badla (restart): har tab ko naye port par, path/query same.
pub fn reload_all_on_port(app: &AppHandle, port: u16) {
    for l in all_labels(app).into_iter().chain(std::iter::once(BRIDGE_LABEL.to_string())) {
        if let Some(wv) = app.get_webview(&l) {
            if let Ok(mut u) = wv.url() {
                if matches!(u.host_str(), Some("localhost") | Some("127.0.0.1")) {
                    let _ = u.set_port(Some(port));
                    let _ = wv.navigate(u);
                }
            }
        }
    }
}
