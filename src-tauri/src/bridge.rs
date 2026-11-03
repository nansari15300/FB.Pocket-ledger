//! Go sidecar `rpc` ops (webview kaam) + `event` handling.
//! Electron parity: `executeJavaScriptWithTimeout`, `getBridgeCandidates`, `ensureServerDataBridgeWindow`,
//! broadcast to all webContents.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::{AppHandle, Manager, WebviewUrl};

use crate::sidecar::{Inbound, Sidecar};
use crate::tabs;
use crate::AppCtx;

fn pending() -> &'static Mutex<HashMap<String, mpsc::Sender<Value>>> {
    static P: OnceLock<Mutex<HashMap<String, mpsc::Sender<Value>>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Content webview se eval result (nonce-guarded).
#[tauri::command]
pub fn pl_bridge_result(nonce: String, ok: bool, value: Option<Value>, undef: Option<bool>) {
    if let Some(tx) = pending().lock().unwrap().remove(&nonce) {
        let _ = tx.send(json!({ "ok": ok, "value": value.unwrap_or(Value::Null), "undef": undef.unwrap_or(false) }));
    }
}

async fn wait_sidecar(app: &AppHandle) -> Option<Arc<Sidecar>> {
    for _ in 0..400 {
        if let Some(sc) = app.state::<AppCtx>().sidecar.get() {
            return Some(sc.clone());
        }
        sleep(50).await;
    }
    None
}

pub async fn sleep(ms: u64) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(Duration::from_millis(ms))).await;
}

pub fn on_inbound(app: &AppHandle, msg: Inbound) {
    match msg {
        Inbound::Rpc { id, op, args } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let result = handle_rpc(&app, &op, &args).await;
                if let Some(sc) = wait_sidecar(&app).await {
                    sc.reply(&id, result);
                }
            });
        }
        Inbound::Event { op, payload } => match op.as_str() {
            "state" => {
                crate::auth::update_from_state(&payload);
                crate::tray::on_state(app, &payload);
            }
            "updateProgress" => {
                let js = format!("window.__plTauriEmit&&window.__plTauriEmit('update-progress',{payload})");
                for l in tabs::all_labels(app) {
                    if let Some(wv) = app.get_webview(&l) {
                        let _ = wv.eval(js.clone());
                    }
                }
            }
            _ => {}
        },
    }
}

fn candidate(app: &AppHandle, label: &str) -> Option<Value> {
    let wv = app.get_webview(label)?;
    let url = wv.url().map(|u| u.to_string()).unwrap_or_default();
    Some(json!({ "id": label, "url": url, "loading": tabs::is_loading(app, label), "bridge": label == tabs::BRIDGE_LABEL }))
}

async fn handle_rpc(app: &AppHandle, op: &str, args: &Value) -> Value {
    match op {
        "candidates" => {
            let mut out: Vec<Value> = tabs::all_labels(app).iter().filter_map(|l| candidate(app, l)).collect();
            if let Some(b) = candidate(app, tabs::BRIDGE_LABEL) {
                out.push(b);
            }
            Value::Array(out)
        }
        "eval" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let script = args.get("script").and_then(|v| v.as_str()).unwrap_or("");
            let timeout = args.get("timeoutMs").and_then(|v| v.as_u64()).unwrap_or(15000).clamp(100, 120_000);
            eval_with_result(app, id, script, timeout).await
        }
        "bridgeOpen" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let navigate = args.get("navigate").and_then(|v| v.as_bool()).unwrap_or(false);
            match bridge_open(app, url, navigate).await {
                Ok(v) => v,
                Err(e) => json!({ "error": e }),
            }
        }
        "broadcast" => {
            let script = args.get("script").and_then(|v| v.as_str()).unwrap_or("");
            tabs::eval_all_tabs(app, script);
            json!({ "ok": true })
        }
        _ => json!({ "ok": false, "error": "unknown_rpc" }),
    }
}

pub async fn eval_with_result(app: &AppHandle, label: &str, script: &str, timeout_ms: u64) -> Value {
    let Some(wv) = app.get_webview(label) else { return json!({ "ok": false, "undef": true }) };
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let (tx, rx) = mpsc::channel();
    pending().lock().unwrap().insert(nonce.clone(), tx);
    let wrapped = format!(
        "(async()=>{{let __v,__e=null;try{{__v=await (\n{script}\n);}}catch(e){{__e=String(e&&e.message||e)}};try{{window.__TAURI_INTERNALS__.invoke('pl_bridge_result',{{nonce:{n},ok:__e===null,value:(__v===undefined?null:__v),undef:__v===undefined}})}}catch(_){{}}}})()",
        n = json!(nonce)
    );
    if wv.eval(wrapped).is_err() {
        pending().lock().unwrap().remove(&nonce);
        return json!({ "ok": false, "undef": true });
    }
    let r = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_millis(timeout_ms))).await;
    pending().lock().unwrap().remove(&nonce);
    match r {
        Ok(Ok(v)) => v,
        _ => json!({ "ok": false, "undef": true, "error": "timeout" }),
    }
}

async fn wait_loaded(app: &AppHandle, label: &str, max: Duration) {
    let t = Instant::now();
    sleep(150).await;
    while t.elapsed() < max && tabs::is_loading(app, label) {
        sleep(150).await;
    }
}

/// Electron hidden `serverDataBridgeWindow` (show:false, backgroundThrottling:false).
async fn bridge_open(app: &AppHandle, url: &str, navigate: bool) -> Result<Value, String> {
    let parsed = tauri::Url::parse(url).map_err(|e| e.to_string())?;
    if !matches!(parsed.host_str(), Some("localhost") | Some("127.0.0.1")) || parsed.scheme() != "http" {
        return Err("bridge url must be loopback".into());
    }
    let label = tabs::BRIDGE_LABEL;
    if app.get_webview(label).is_none() {
        let ctx = app.state::<AppCtx>();
        let app_load = app.clone();
        tabs::set_loading(app, label, true);
        let w = WebviewWindowBuilder::new(app, label, WebviewUrl::External(parsed.clone()))
            .title("Pocket Ledger bridge")
            .visible(false)
            .skip_taskbar(true)
            .inner_size(640.0, 480.0)
            .initialization_script(tabs::init_script(&ctx, true))
            .user_agent(&ctx.user_agent)
            .on_navigation(|u| matches!(u.scheme(), "http" | "https" | "about" | "blob" | "data"))
            .on_page_load(move |wv, p| {
                tabs::set_loading(&app_load, wv.label(), p.event() == PageLoadEvent::Started);
            })
            .build()
            .map_err(|e| e.to_string())?;
        if let Some(wv) = app.get_webview(label) {
            crate::native::attach_content_hooks(app, &wv);
            crate::native::keep_rendering(&wv);
        }
        drop(w);
        wait_loaded(app, label, Duration::from_secs(30)).await;
    } else if navigate {
        if let Some(wv) = app.get_webview(label) {
            tabs::set_loading(app, label, true);
            let _ = wv.navigate(parsed);
            wait_loaded(app, label, Duration::from_secs(30)).await;
        }
    }
    candidate(app, label).ok_or_else(|| "bridge missing".to_string())
}
