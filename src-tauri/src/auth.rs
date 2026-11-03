//! PL server request headers + remote-origin IPC capability.
//! Electron parity: `isPlServerRequest` + `installPlServerRequestHeaders` + `remoteGateAuthByOrigin`.
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{OnceLock, RwLock};
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager};

const PL_CLIENT_HEADER: &str = "x-pocket-ledger-app";
const PL_ACCESS_HEADER: &str = "x-pocket-ledger-access";
const PL_MARKER_HEADER: &str = "x-pocket-ledger-client";
const PL_MARKER_VALUE: &str = "pocket-ledger-electron";

#[derive(Default)]
struct AuthState {
    app_ui_port: u16,
    sharing_port: u16,
    remote_origin: String,
    client_token: String,
    access_token: String,
    gate: HashMap<String, String>,
    allowed_origins: HashSet<String>,
}

fn st() -> &'static RwLock<AuthState> {
    static S: OnceLock<RwLock<AuthState>> = OnceLock::new();
    S.get_or_init(|| RwLock::new(AuthState::default()))
}

pub fn origin_of(url: &str) -> Option<String> {
    let u = tauri::Url::parse(url).ok()?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return None;
    }
    Some(u.origin().ascii_serialization())
}

/// Electron `normalizeRemoteServerUrl` -> origin.
pub fn normalize_remote(url: &str) -> Option<String> {
    let s = url.trim();
    if s.is_empty() {
        return None;
    }
    let full = if s.contains("://") { s.to_string() } else { format!("http://{s}") };
    let u = tauri::Url::parse(&full).ok()?;
    u.host_str().filter(|h| !h.is_empty())?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return None;
    }
    Some(u.origin().ascii_serialization())
}

pub fn set_client_token(t: &str) {
    st().write().unwrap().client_token = t.to_string();
}

/// Go `state` event se.
pub fn update_from_state(v: &Value) {
    let mut s = st().write().unwrap();
    s.app_ui_port = v.get("appUiPort").and_then(|p| p.as_u64()).unwrap_or(0) as u16;
    s.sharing_port = v.get("sharingPort").and_then(|p| p.as_u64()).unwrap_or(0) as u16;
    s.remote_origin = v.get("remoteBase").and_then(|p| p.as_str()).and_then(normalize_remote).unwrap_or_default();
    s.access_token = v.get("clientAccessToken").and_then(|p| p.as_str()).unwrap_or("").trim().to_string();
}

pub fn set_app_ui_port(p: u16) {
    st().write().unwrap().app_ui_port = p;
}

pub fn remote_origin() -> String {
    st().read().unwrap().remote_origin.clone()
}

pub fn set_gate(origin: &str, token: &str) {
    let mut s = st().write().unwrap();
    if token.is_empty() {
        s.gate.remove(origin);
    } else {
        s.gate.insert(origin.to_string(), token.to_string());
    }
}

fn is_private_v4(h: &str) -> bool {
    let p: Vec<&str> = h.split('.').collect();
    if p.len() != 4 || p.iter().any(|x| x.is_empty() || x.len() > 3 || !x.bytes().all(|b| b.is_ascii_digit())) {
        return false;
    }
    true // Electron: 10/8, 192.168/16, 172.16/12 aur public dotted IPv4 — sab sirf PL ports par
}

/// `isPlServerRequest` -> headers jo lagane hain.
pub fn headers_for(uri: &str) -> Option<Vec<(&'static str, String)>> {
    if !(uri.starts_with("http://") || uri.starts_with("https://")) {
        return None;
    }
    let u = tauri::Url::parse(uri).ok()?;
    let origin = u.origin().ascii_serialization();
    let s = st().read().unwrap();
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    let port = u.port_or_known_default().unwrap_or(0);
    let mut hit = s.gate.contains_key(&origin);
    if !hit && port != 0 && (port == s.app_ui_port || port == s.sharing_port) {
        hit = host == "localhost" || host == "127.0.0.1" || host == "[::1]" || is_private_v4(&host);
    }
    if !hit && !s.remote_origin.is_empty() && origin == s.remote_origin {
        hit = true;
    }
    if !hit {
        return None;
    }
    let mut out = vec![(PL_MARKER_HEADER, PL_MARKER_VALUE.to_string())];
    if !s.client_token.is_empty() {
        out.push((PL_CLIENT_HEADER, s.client_token.clone()));
    }
    let tok = s.gate.get(&origin).cloned().unwrap_or_else(|| s.access_token.clone());
    if !tok.is_empty() {
        out.push((PL_ACCESS_HEADER, tok));
    }
    Some(out)
}

/// Remote PL server (Gate connect / client role) page ko *kam* IPC: tabs, trace, gate events.
/// Backup / attachments / local server / update yahan nahi.
pub fn allow_remote_origin(app: &AppHandle, origin: &str) {
    if origin.is_empty() {
        return;
    }
    let local = {
        let s = st().read().unwrap();
        s.app_ui_port != 0
            && (origin == format!("http://localhost:{}", s.app_ui_port) || origin == format!("http://127.0.0.1:{}", s.app_ui_port))
    };
    if local {
        return;
    }
    {
        let mut s = st().write().unwrap();
        if !s.allowed_origins.insert(origin.to_string()) {
            return;
        }
    }
    let id = format!("remote-content-{}", st().read().unwrap().allowed_origins.len());
    let mut cap = CapabilityBuilder::new(id).remote(format!("{origin}/*")).local(false).webview("tab-*");
    for p in REMOTE_PERMS {
        cap = cap.permission(*p);
    }
    if let Err(e) = app.add_capability(cap) {
        if let Some(ctx) = app.try_state::<crate::AppCtx>() {
            ctx.trace.log("PL-GATE-TRACE", "remote_capability_failed", &e.to_string());
        }
    }
}

pub const REMOTE_PERMS: &[&str] = &[
    "allow-pl-open-url-in-new-tab",
    "allow-pl-tab-sync-done",
    "allow-pl-device-display-info",
    "allow-pl-trace-log",
    "allow-pl-trace-get-logs",
    "allow-pl-trace-get-log-file-path",
    "allow-pl-shortcut",
    "allow-pl-broadcast-db-bump",
    "allow-pl-broadcast-gate-snapshot",
    "allow-pl-set-remote-auth",
    "allow-pl-print-done",
];
