//! `electron/plTraceLog.js` jaisa trace log: memory (500) + `pl-trace.log` (2 MB rotate -> .1).
use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_MEMORY: usize = 500;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Serialize)]
pub struct TraceEntry {
    pub ts: String,
    pub tag: String,
    pub event: String,
    pub detail: String,
}

pub struct TraceLog {
    memory: Mutex<VecDeque<TraceEntry>>,
    file: Option<PathBuf>,
}

fn iso_now() -> String {
    // UTC ISO-8601 (Electron `new Date().toISOString()` jaisa), bina chrono dependency ke.
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs() as i64;
    let ms = d.subsec_millis();
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let dd = doy - (153 * mp + 2) / 5 + 1;
    let mm = if mp < 10 { mp + 3 } else { mp - 9 };
    let yy = if mm <= 2 { y + 1 } else { y };
    format!("{yy:04}-{mm:02}-{dd:02}T{h:02}:{m:02}:{s:02}.{ms:03}Z")
}

impl TraceLog {
    pub fn new(dir: Option<PathBuf>) -> Self {
        let file = dir.and_then(|d| {
            fs::create_dir_all(&d).ok()?;
            Some(d.join("pl-trace.log"))
        });
        Self { memory: Mutex::new(VecDeque::with_capacity(64)), file }
    }

    pub fn log(&self, tag: &str, event: &str, detail: &str) {
        let entry = TraceEntry {
            ts: iso_now(),
            tag: if tag.is_empty() { "PL-TRACE".into() } else { tag.chars().take(80).collect() },
            event: event.chars().take(200).collect(),
            detail: detail.chars().take(16_000).collect(),
        };
        let line = if entry.detail.is_empty() {
            format!("[{}] [{}] {}\n", entry.ts, entry.tag, entry.event)
        } else {
            format!("[{}] [{}] {} {}\n", entry.ts, entry.tag, entry.event, entry.detail)
        };
        if cfg!(debug_assertions) {
            eprint!("{line}");
        }
        if let Ok(mut m) = self.memory.lock() {
            m.push_back(entry);
            while m.len() > MAX_MEMORY {
                m.pop_front();
            }
        }
        if let Some(path) = &self.file {
            if let Ok(meta) = fs::metadata(path) {
                if meta.len() > MAX_FILE_BYTES {
                    let _ = fs::rename(path, path.with_extension("log.1"));
                }
            }
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
                let _ = f.write_all(line.as_bytes());
            }
        }
    }

    pub fn recent(&self, limit: usize) -> Vec<TraceEntry> {
        let n = limit.clamp(1, MAX_MEMORY);
        let m = self.memory.lock().map(|m| m.clone()).unwrap_or_default();
        let skip = m.len().saturating_sub(n);
        m.into_iter().skip(skip).collect()
    }

    pub fn file_path(&self) -> String {
        self.file.as_ref().map(|p| p.display().to_string()).unwrap_or_default()
    }
}
