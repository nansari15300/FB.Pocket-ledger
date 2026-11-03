//! P2 shim commands: Backup folder, Attachments, LocalServer config/tokens, Bridge upsert, Update download,
//! remote gate auth, print done. Electron `main.js` handlers ki exact semantics (return shapes same).
use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig, STANDARD};
use base64::engine::DecodePaddingMode;
use base64::{alphabet, Engine};
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, Webview};

use crate::{tabs, AppCtx};

fn err(e: impl ToString) -> Value {
    json!({ "ok": false, "error": e.to_string() })
}

/// Node `Buffer.from(s,'base64')` jaisa lenient decode (whitespace / url-safe / padding optional).
fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    const LENIENT: GeneralPurpose = GeneralPurpose::new(
        &alphabet::STANDARD,
        GeneralPurposeConfig::new()
            .with_decode_padding_mode(DecodePaddingMode::Indifferent)
            .with_decode_allow_trailing_bits(true),
    );
    let clean: String = s
        .chars()
        .filter_map(|c| match c {
            '-' => Some('+'),
            '_' => Some('/'),
            c if c.is_ascii_alphanumeric() || c == '+' || c == '/' => Some(c),
            _ => None, // '=' + whitespace + invalid chars Node bhi ignore karta hai
        })
        .collect();
    LENIENT.decode(clean.as_bytes()).map_err(|e| e.to_string())
}

pub fn dev_or_packaged(name: &str) -> bool {
    !cfg!(debug_assertions) || std::env::var(name).map(|v| v == "1").unwrap_or(false)
}

fn user_data(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_default()
}

// ---------------------------------------------------------------- backup folder

#[tauri::command]
pub async fn pl_pick_directory(webview: Webview) -> Value {
    let owner = webview.window().hwnd().map(|h| h.0 as isize).unwrap_or(0);
    match tauri::async_runtime::spawn_blocking(move || crate::native::pick_directory(owner)).await {
        Ok(Ok(Some(p))) => json!({ "ok": true, "path": p }),
        Ok(Ok(None)) => json!({ "ok": false, "cancelled": true }),
        Ok(Err(e)) => err(e),
        Err(e) => err(e),
    }
}

fn is_plbp(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".plbp")
}

#[tauri::command]
pub async fn pl_backup_write(dir_path: Option<String>, file_name: Option<String>, base64: Option<String>, relative_subdir: Option<String>) -> Value {
    let dir = dir_path.unwrap_or_default().trim().to_string();
    let b64 = base64.unwrap_or_default();
    let raw_name = file_name.unwrap_or_default();
    let raw_name = raw_name.trim();
    let name = Path::new(if raw_name.is_empty() { "backup.plbp" } else { raw_name })
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    if dir.is_empty() || name.is_empty() || b64.is_empty() {
        return err("missing-args");
    }
    // Tauri hardening: backup folder me sirf .plbp likh sakte hain.
    if !is_plbp(&name) {
        return err("invalid-file-type");
    }
    let mut target = PathBuf::from(&dir);
    for seg in relative_subdir.unwrap_or_default().split(['/', '\\']).map(str::trim).filter(|s| !s.is_empty()) {
        if seg == ".." || seg == "." {
            return err("invalid-path");
        }
        target.push(seg);
    }
    let r = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let bytes = b64_decode(&b64)?;
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        std::fs::write(target.join(name), bytes).map_err(|e| e.to_string())
    })
    .await;
    match r {
        Ok(Ok(())) => json!({ "ok": true }),
        Ok(Err(e)) => err(e),
        Err(e) => err(e),
    }
}

fn walk_plbp(root: &Path, dir: &Path, out: &mut Vec<(String, String)>, depth: usize) {
    if depth > 32 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let p = e.path();
        if ft.is_dir() {
            walk_plbp(root, &p, out, depth + 1);
        } else if ft.is_file() {
            let name = e.file_name().to_string_lossy().to_string();
            if is_plbp(&name) {
                let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
                out.push((name, rel));
            }
        }
    }
}

#[tauri::command]
pub async fn pl_backup_list(dir_path: Option<String>) -> Value {
    let dir = dir_path.unwrap_or_default().trim().to_string();
    if dir.is_empty() {
        return err("missing-dir");
    }
    let r = tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&dir);
        if !root.is_dir() {
            return Err(format!("ENOENT: no such file or directory, scandir '{dir}'"));
        }
        let mut out = vec![];
        walk_plbp(&root, &root, &mut out, 0);
        // Electron: b.relativePath.localeCompare(a.relativePath) (descending)
        out.sort_by(|a, b| b.1.to_lowercase().cmp(&a.1.to_lowercase()).then(b.1.cmp(&a.1)));
        Ok(out)
    })
    .await;
    match r {
        Ok(Ok(files)) => json!({ "ok": true, "files": files.into_iter().map(|(n, r)| json!({ "name": n, "relativePath": r })).collect::<Vec<_>>() }),
        Ok(Err(e)) => err(e),
        Err(e) => err(e),
    }
}

#[tauri::command]
pub async fn pl_backup_read(dir_path: Option<String>, file_name: Option<String>, as_binary: Option<bool>) -> Value {
    let dir = dir_path.unwrap_or_default().trim().to_string();
    let rel = file_name.unwrap_or_default().trim().replace('\\', "/");
    if dir.is_empty() || rel.is_empty() {
        return err("missing-args");
    }
    let segs: Vec<String> = rel.split('/').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
    if segs.is_empty() || segs.iter().any(|s| *s == ".." || *s == ".") {
        return err("invalid-path");
    }
    if !is_plbp(&segs[segs.len() - 1]) {
        return err("invalid-file-type");
    }
    let as_binary = as_binary.unwrap_or(false);
    let r = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let root = PathBuf::from(&dir);
        let mut p = root.clone();
        for s in &segs {
            p.push(s);
        }
        if p.components().any(|c| matches!(c, Component::ParentDir)) || !p.starts_with(&root) {
            return Err("invalid-path".into());
        }
        let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
        Ok(if as_binary {
            json!({ "ok": true, "base64": STANDARD.encode(bytes) })
        } else {
            json!({ "ok": true, "text": String::from_utf8_lossy(&bytes) })
        })
    })
    .await;
    match r {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => err(e),
        Err(e) => err(e),
    }
}

// ---------------------------------------------------------------- attachments

fn safe_rel(rel: &str) -> Option<String> {
    let s = rel.replace('\\', "/");
    let s = s.trim_start_matches('/').trim().to_string();
    if s.is_empty() || s.contains("..") || s.contains(':') {
        return None;
    }
    Some(s)
}

fn att_roots(app: &AppHandle) -> (PathBuf, PathBuf) {
    let ud = user_data(app);
    (ud.join("PocketLedgerData"), ud.join("pl-attachments"))
}

fn join_rel(root: &Path, rel: &str) -> PathBuf {
    let mut p = root.to_path_buf();
    for s in rel.split('/').filter(|s| !s.is_empty()) {
        p.push(s);
    }
    p
}

fn att_write_bytes(app: &AppHandle, rel: &str, bytes: &[u8]) -> Result<(), String> {
    let rel = safe_rel(rel).ok_or("invalid-path")?;
    let p = join_rel(&att_roots(app).0, &rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pl_att_write(app: AppHandle, relative_path: Option<String>, base64: Option<String>) -> Value {
    let rel = relative_path.unwrap_or_default();
    let b64 = base64.unwrap_or_default();
    if rel.trim().is_empty() || b64.is_empty() {
        return err("missing-args");
    }
    let r = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let bytes = b64_decode(&b64)?;
        att_write_bytes(&app, &rel, &bytes)
    })
    .await;
    match r {
        Ok(Ok(())) => json!({ "ok": true }),
        Ok(Err(e)) => err(e),
        Err(e) => err(e),
    }
}

/// Raw binary body (ArrayBuffer) — path header `x-pl-path` (encodeURIComponent).
#[tauri::command]
pub async fn pl_att_write_binary(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Value, String> {
    let rel = request
        .headers()
        .get("x-pl-path")
        .and_then(|v| v.to_str().ok())
        .map(|s| percent_decode(s))
        .unwrap_or_default();
    let bytes: Vec<u8> = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.clone(),
        tauri::ipc::InvokeBody::Json(v) => match v {
            Value::Array(a) => a.iter().map(|x| x.as_u64().unwrap_or(0) as u8).collect(),
            Value::Object(o) => o
                .get("data")
                .and_then(|d| d.as_array())
                .map(|a| a.iter().map(|x| x.as_u64().unwrap_or(0) as u8).collect())
                .unwrap_or_default(),
            _ => vec![],
        },
    };
    if rel.trim().is_empty() {
        return Ok(err("missing-args"));
    }
    if bytes.is_empty() {
        return Ok(err("empty-buffer"));
    }
    let n = bytes.len();
    let r = tauri::async_runtime::spawn_blocking(move || att_write_bytes(&app, &rel, &bytes)).await;
    Ok(match r {
        Ok(Ok(())) => json!({ "ok": true, "bytes": n }),
        Ok(Err(e)) => err(e),
        Err(e) => err(e),
    })
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() + 0 && i + 2 <= b.len() - 1 {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn find_att(app: &AppHandle, rel: &str) -> Option<PathBuf> {
    let (a, b) = att_roots(app);
    [join_rel(&a, rel), join_rel(&b, rel)].into_iter().find(|p| p.is_file())
}

#[tauri::command]
pub async fn pl_att_read(app: AppHandle, relative_path: Option<String>) -> Value {
    let Some(rel) = safe_rel(&relative_path.unwrap_or_default()) else { return err("missing-path") };
    let r = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let p = find_att(&app, &rel).ok_or("not-found")?;
        let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
        Ok(json!({ "ok": true, "base64": STANDARD.encode(bytes) }))
    })
    .await;
    match r {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => err(e),
        Err(e) => err(e),
    }
}

#[tauri::command]
pub async fn pl_att_delete(app: AppHandle, relative_path: Option<String>) -> Value {
    let Some(rel) = safe_rel(&relative_path.unwrap_or_default()) else { return err("missing-path") };
    let r = tauri::async_runtime::spawn_blocking(move || {
        let (a, b) = att_roots(&app);
        for root in [a, b] {
            let p = join_rel(&root, &rel);
            if p.is_file() {
                let _ = std::fs::remove_file(p);
            }
        }
    })
    .await;
    match r {
        Ok(()) => json!({ "ok": true }),
        Err(e) => err(e),
    }
}

#[tauri::command]
pub async fn pl_att_exists(app: AppHandle, relative_path: Option<String>) -> Value {
    let Some(rel) = safe_rel(&relative_path.unwrap_or_default()) else { return json!({ "ok": false, "exists": false }) };
    let exists = tauri::async_runtime::spawn_blocking(move || {
        let (a, b) = att_roots(&app);
        join_rel(&a, &rel).exists() || join_rel(&b, &rel).exists()
    })
    .await
    .unwrap_or(false);
    json!({ "ok": true, "exists": exists })
}

#[tauri::command]
pub async fn pl_att_stat_sizes(app: AppHandle, relative_paths: Option<Vec<Value>>) -> Value {
    let list: Vec<String> = relative_paths.unwrap_or_default().into_iter().take(1000).map(|v| v.as_str().unwrap_or("").to_string()).collect();
    let r = tauri::async_runtime::spawn_blocking(move || {
        let (a, b) = att_roots(&app);
        list.iter()
            .map(|rel| match safe_rel(rel) {
                None => Value::Null,
                Some(rel) => [join_rel(&a, &rel), join_rel(&b, &rel)]
                    .iter()
                    .find_map(|p| std::fs::metadata(p).ok().filter(|m| m.is_file()).map(|m| json!(m.len())))
                    .unwrap_or(Value::Null),
            })
            .collect::<Vec<_>>()
    })
    .await;
    match r {
        Ok(sizes) => json!({ "ok": true, "sizes": sizes }),
        Err(e) => err(e),
    }
}

// ---------------------------------------------------------------- local server (Go sidecar ctl)

async fn ctl(app: &AppHandle, op: &str, args: Value, timeout: Duration) -> Result<Value, String> {
    let sc = app.state::<AppCtx>().sidecar.get().cloned().ok_or("sidecar_unavailable")?;
    sc.ctl(op, args, timeout).await
}

fn apply_autostart(app: &AppHandle, partial: &Value) {
    if let Some(b) = partial.get("autoStartOnBoot").and_then(|v| v.as_bool()) {
        if dev_or_packaged("PL_TAURI_AS_PACKAGED") {
            let ok = crate::native::set_autostart(b);
            app.state::<AppCtx>().trace.log("PL-SERVER", "login_item_settings", &json!({ "openAtLogin": b, "ok": ok }).to_string());
        }
    }
}

#[tauri::command]
pub async fn pl_local_server(app: AppHandle, op: String, args: Option<Value>) -> Result<Value, String> {
    let args = args.unwrap_or(Value::Null);
    let t = Duration::from_secs(30);
    let (cop, cargs) = match op.as_str() {
        "getStatus" => ("status", json!({})),
        "getConfig" => ("getConfig", json!({})),
        "setConfig" => ("setConfig", json!({ "partial": args.get("partial").cloned().unwrap_or(json!({})) })),
        "start" => ("start", json!({})),
        "stop" => ("stop", json!({})),
        "restart" => ("restart", json!({ "partial": args.get("partial").cloned().unwrap_or(Value::Null) })),
        "listAccessTokens" => ("listTokens", json!({})),
        "createAccessToken" => ("createToken", json!({ "input": args.get("input").cloned().unwrap_or(json!({})) })),
        "updateAccessToken" => ("updateToken", json!({ "id": args.get("id").cloned().unwrap_or(json!("")), "input": args.get("input").cloned().unwrap_or(json!({})) })),
        "getAccessTokenSecret" => ("getTokenSecret", json!({ "id": args.get("id").cloned().unwrap_or(json!("")) })),
        "rotateAccessToken" => ("rotateToken", json!({ "id": args.get("id").cloned().unwrap_or(json!("")), "input": args.get("input").cloned().unwrap_or(json!({})) })),
        "revokeAccessToken" => ("revokeToken", json!({ "id": args.get("id").cloned().unwrap_or(json!("")) })),
        "saveShareableCompaniesSnapshot" => ("saveSnapshot", json!({ "companies": args.get("companies").cloned().unwrap_or(json!([])) })),
        _ => return Err("unknown local server op".into()),
    };
    let mut res = ctl(&app, cop, cargs.clone(), t).await?;
    match op.as_str() {
        "setConfig" | "restart" => apply_autostart(&app, cargs.get("partial").unwrap_or(&Value::Null)),
        "start" => {
            if res.get("throw").and_then(|v| v.as_bool()).unwrap_or(false) {
                return Err(res.get("error").and_then(|v| v.as_str()).unwrap_or("start failed").to_string());
            }
        }
        _ => {}
    }
    if op == "restart" {
        if let Some(p) = res.get("reloadPort").and_then(|v| v.as_u64()).filter(|p| *p > 0) {
            let p = p as u16;
            crate::on_app_ui_port_changed(&app, p);
            if dev_or_packaged("PL_TAURI_AS_PACKAGED") {
                tabs::reload_all_on_port(&app, p);
            }
        }
        if let Some(o) = res.as_object_mut() {
            o.remove("reloadPort");
        }
    }
    Ok(res)
}

#[tauri::command]
pub async fn pl_bridge_upsert(app: AppHandle, payload: Value) -> Value {
    ctl(&app, "bridgeUpsert", json!({ "payload": payload }), Duration::from_secs(60)).await.unwrap_or_else(err)
}

// ---------------------------------------------------------------- update download + install

#[tauri::command]
pub async fn pl_update_download(app: AppHandle, url: Option<String>, version: Option<String>) -> Value {
    if !dev_or_packaged("PL_TAURI_AS_PACKAGED") {
        return err("Updates install only from the packaged EXE.");
    }
    let url = url.unwrap_or_default().trim().to_string();
    let version = version.unwrap_or_default().trim().to_string();
    if url.is_empty() || version.is_empty() {
        return err("Missing update URL or version.");
    }
    let r = match ctl(&app, "updateDownload", json!({ "url": url, "version": version }), Duration::from_secs(30 * 60)).await {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    if !r.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        return r;
    }
    let path = r.get("installerPath").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let ud = user_data(&app).join("pl-release-updates");
    let p = PathBuf::from(&path);
    if !p.starts_with(&ud) || !p.is_file() {
        return err("installer path rejected");
    }
    if let Err(e) = std::process::Command::new(&p).spawn() {
        return err(e);
    }
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        crate::quit_app(&app2);
    });
    json!({ "ok": true })
}

// ---------------------------------------------------------------- remote gate auth + print

#[tauri::command]
pub fn pl_set_remote_auth(app: AppHandle, url: Option<String>, token: Option<String>) -> Value {
    let Some(origin) = crate::auth::normalize_remote(&url.unwrap_or_default()) else { return json!({ "ok": false }) };
    let token = token.unwrap_or_default().trim().to_string();
    crate::auth::set_gate(&origin, &token);
    crate::auth::allow_remote_origin(&app, &origin);
    app.state::<AppCtx>().trace.log(
        "PL-GATE-TRACE",
        "set_remote_gate_auth",
        &json!({ "origin": origin, "hasToken": !token.is_empty() }).to_string(),
    );
    json!({ "ok": true, "origin": origin })
}

#[tauri::command]
pub fn pl_print_done(app: AppHandle, webview: Webview) {
    tabs::print_done(&app, webview.label());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_only_plbp() {
        assert!(is_plbp("backup.plbp"));
        assert!(is_plbp("Backup.PLBP"));
        assert!(!is_plbp("backup.txt"));
        assert!(!is_plbp("backup.plbp.exe"));
        assert!(!is_plbp("plbp"));
    }

    #[test]
    fn att_path_rejects_traversal() {
        assert!(safe_rel("ok/path.jpg").is_some());
        assert!(safe_rel("/leading/slash.png").is_some());
        assert!(safe_rel("../secret").is_none());
        assert!(safe_rel("a/../../b").is_none());
        assert!(safe_rel("C:/abs").is_none());
        assert!(safe_rel("").is_none());
        assert!(safe_rel("   ").is_none());
    }

    #[test]
    fn b64_matches_node_lenient() {
        assert_eq!(b64_decode("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(b64_decode("aGVsbG8").unwrap(), b"hello");
        assert_eq!(b64_decode(" aGVs\nbG8= ").unwrap(), b"hello");
        let url_safe = STANDARD.encode(b"hello??").replace('+', "-").replace('/', "_");
        assert_eq!(b64_decode(&url_safe).unwrap(), b"hello??");
    }
}
