//! Go sidecar (`desktop-sidecar/`) spawn + line protocol (v0.2).
//!
//! Go -> Rust (stdout): `PL_SIDECAR_READY {...}` (ek baar), phir `PLMSG {json}` lines:
//!   {t:"rpc", id, op, args}   — Go ko webview kaam chahiye (eval / candidates / bridgeOpen / broadcast)
//!   {t:"ctlres", id, result}  — hamari `ctl` request ka jawab
//!   {t:"event", op, payload}  — state / updateProgress
//! Rust -> Go (stdin): {t:"rpcres", id, result} | {t:"ctl", id, op, args}
//! stdin band (Rust process gaya) => Go khud exit.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub enum Inbound {
    Rpc { id: Value, op: String, args: Value },
    Event { op: String, payload: Value },
}

pub struct Ready {
    pub app_ui_port: u16,
    pub entry_url: String,
    pub entry_error: String,
}

pub struct Sidecar {
    stdin: Mutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    next: AtomicU64,
    child: Mutex<Option<Child>>,
}

fn sidecar_exe() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let name = if cfg!(windows) { "pl-sidecar.exe" } else { "pl-sidecar" };
    let p = dir.join(name);
    p.exists().then_some(p)
}

impl Sidecar {
    fn write_line(&self, v: &Value) -> bool {
        let mut line = v.to_string();
        line.push('\n');
        let mut g = self.stdin.lock().unwrap();
        match g.as_mut() {
            Some(s) => s.write_all(line.as_bytes()).and_then(|_| s.flush()).is_ok(),
            None => false,
        }
    }

    /// Go ki rpc request ka jawab.
    pub fn reply(&self, id: &Value, result: Value) {
        self.write_line(&json!({ "t": "rpcres", "id": id, "result": result }));
    }

    /// Blocking ctl call (async code se `ctl_async` use karein).
    pub fn ctl_blocking(&self, op: &str, args: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if !self.write_line(&json!({ "t": "ctl", "id": id, "op": op, "args": args })) {
            self.pending.lock().unwrap().remove(&id);
            return Err("sidecar_unavailable".into());
        }
        let r = rx.recv_timeout(timeout);
        self.pending.lock().unwrap().remove(&id);
        r.map_err(|_| "sidecar_timeout".to_string())
    }

    pub async fn ctl(self: &Arc<Self>, op: &str, args: Value, timeout: Duration) -> Result<Value, String> {
        let me = self.clone();
        let op = op.to_string();
        tauri::async_runtime::spawn_blocking(move || me.ctl_blocking(&op, args, timeout))
            .await
            .map_err(|e| e.to_string())?
    }

    /// stdin band => Go graceful exit; 1.5s baad bhi zinda ho to kill.
    pub fn shutdown(&self) {
        self.stdin.lock().unwrap().take();
        if let Some(mut c) = self.child.lock().unwrap().take() {
            for _ in 0..15 {
                if let Ok(Some(_)) = c.try_wait() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = c.kill();
        }
    }
}

pub fn spawn(
    root: &Path,
    user_data: &Path,
    log_dir: &Path,
    on_msg: impl Fn(Inbound) + Send + 'static,
) -> Result<(Arc<Sidecar>, Ready), String> {
    let exe = sidecar_exe().ok_or("pl-sidecar binary missing next to app exe")?;
    let mut cmd = Command::new(&exe);
    cmd.arg("--root")
        .arg(root)
        .arg("--user-data")
        .arg(user_data)
        .arg("--app-version")
        .arg(env!("CARGO_PKG_VERSION"))
        .arg("--rpc")
        .arg("--exit-on-stdin-eof")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| format!("spawn sidecar: {e}"))?;

    // stderr -> logs/sidecar.log (1 MB se bada ho to naya shuru)
    if let Some(mut err) = child.stderr.take() {
        let _ = std::fs::create_dir_all(log_dir);
        let log_path = log_dir.join("sidecar.log");
        std::thread::spawn(move || {
            if std::fs::metadata(&log_path).map(|m| m.len() > 1_048_576).unwrap_or(false) {
                let _ = std::fs::remove_file(&log_path);
            }
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&log_path).ok();
            let mut buf = [0u8; 4096];
            while let Ok(n) = err.read(&mut buf) {
                if n == 0 {
                    break;
                }
                if let Some(f) = f.as_mut() {
                    let _ = f.write_all(&buf[..n]);
                }
            }
        });
    }

    let stdout = child.stdout.take().ok_or("sidecar stdout missing")?;
    let stdin = child.stdin.take();
    let sc = Arc::new(Sidecar {
        stdin: Mutex::new(stdin),
        pending: Mutex::new(HashMap::new()),
        next: AtomicU64::new(0),
        child: Mutex::new(Some(child)),
    });

    let (tx, rx) = mpsc::channel::<Result<Ready, String>>();
    let sc_reader = sc.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::with_capacity(1 << 20, stdout);
        let mut line = String::new();
        let mut sent = false;
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let l = line.trim_end();
                    if let Some(body) = l.strip_prefix("PLMSG ") {
                        let Ok(v) = serde_json::from_str::<Value>(body) else { continue };
                        match v.get("t").and_then(|t| t.as_str()).unwrap_or("") {
                            "ctlres" => {
                                let id = v.get("id").and_then(|i| i.as_u64()).unwrap_or(0);
                                if let Some(tx) = sc_reader.pending.lock().unwrap().remove(&id) {
                                    let _ = tx.send(v.get("result").cloned().unwrap_or(Value::Null));
                                }
                            }
                            "rpc" => on_msg(Inbound::Rpc {
                                id: v.get("id").cloned().unwrap_or(Value::Null),
                                op: v.get("op").and_then(|o| o.as_str()).unwrap_or("").to_string(),
                                args: v.get("args").cloned().unwrap_or(Value::Null),
                            }),
                            "event" => on_msg(Inbound::Event {
                                op: v.get("op").and_then(|o| o.as_str()).unwrap_or("").to_string(),
                                payload: v.get("payload").cloned().unwrap_or(Value::Null),
                            }),
                            _ => {}
                        }
                    } else if !sent {
                        if let Some(js) = l.strip_prefix("PL_SIDECAR_READY ") {
                            let r = serde_json::from_str::<Value>(js).map_err(|e| e.to_string()).map(|v| Ready {
                                app_ui_port: v.get("appUiPort").and_then(|p| p.as_u64()).unwrap_or(0) as u16,
                                entry_url: v.get("entryUrl").and_then(|p| p.as_str()).unwrap_or("").to_string(),
                                entry_error: v.get("entryError").and_then(|p| p.as_str()).unwrap_or("").to_string(),
                            });
                            let _ = tx.send(r);
                            sent = true;
                        }
                    }
                }
            }
        }
        if !sent {
            let _ = tx.send(Err("sidecar exited before ready".into()));
        }
    });

    match rx.recv_timeout(Duration::from_secs(20)) {
        Ok(Ok(ready)) => Ok((sc, ready)),
        Ok(Err(e)) => {
            sc.shutdown();
            Err(e)
        }
        Err(_) => {
            sc.shutdown();
            Err("sidecar ready timeout".into())
        }
    }
}
