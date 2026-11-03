//! First-run data copy: Electron `%APPDATA%\pocket-ledger-electron` -> Tauri ka naya data folder.
//! Purana folder sirf PADHA jaata hai — kabhi modify/delete nahi hota.
use serde_json::{json, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const MARKER_FILE: &str = "migration-from-electron.json";

const CONFIG_FILES: &[&str] = &[
    "pl-local-server-config.json",
    "pl-local-app-client-token.json",
    "pl-server-access-tokens.json",
    "pl-electron-static-port.json",
    "pl-shareable-companies-snapshot.json",
];

/// Chromium profile dirs jo copy hoti hain (origin `http_localhost_<port>` same rahe to data dikhta hai).
const PROFILE_DIRS: &[&str] = &["IndexedDB", "Local Storage"];

pub fn electron_user_data_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("pocket-ledger-electron"))
}

/// Electron chal raha ho to LevelDB `LOCK` file open hoti hai -> exclusive (share_mode 0) read open fail.
#[cfg(windows)]
fn is_file_in_use(p: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    if !p.exists() {
        return false;
    }
    fs::OpenOptions::new().read(true).share_mode(0).open(p).is_err()
}
#[cfg(not(windows))]
fn is_file_in_use(_p: &Path) -> bool {
    false
}

fn copy_dir_recursive(src: &Path, dst: &Path, files: &mut u64, bytes: &mut u64) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let name = entry.file_name();
        let from = entry.path();
        let to = dst.join(&name);
        if ft.is_dir() {
            copy_dir_recursive(&from, &to, files, bytes)?;
        } else if ft.is_file() {
            // LevelDB LOCK file copy nahi karte — naya process khud banata hai.
            if name.to_string_lossy().eq_ignore_ascii_case("LOCK") {
                continue;
            }
            *bytes += fs::copy(&from, &to)?;
            *files += 1;
        }
    }
    Ok(())
}

pub struct MigrationOutcome {
    pub status: String,
    pub detail: serde_json::Value,
}

/// `app_data`: `%APPDATA%\com.pocketledger.desktop`, `webview_root`: `%LOCALAPPDATA%\com.pocketledger.desktop`.
pub fn run_first_run(app_data: &Path, webview_root: &Path) -> MigrationOutcome {
    let marker = app_data.join(MARKER_FILE);
    if marker.exists() {
        return MigrationOutcome { status: "already-done".into(), detail: json!({}) };
    }
    let _ = fs::create_dir_all(app_data);
    let write_marker = |status: &str, detail: &serde_json::Value| {
        let body = json!({
            "status": status,
            "atUnixMs": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            "appVersion": env!("CARGO_PKG_VERSION"),
            "detail": detail,
        });
        let _ = fs::write(&marker, serde_json::to_vec_pretty(&body).unwrap_or_default());
    };

    let Some(src) = electron_user_data_dir().filter(|p| p.is_dir()) else {
        let d = json!({ "reason": "no electron data folder" });
        write_marker("no-source", &d);
        return MigrationOutcome { status: "no-source".into(), detail: d };
    };

    // Electron chal raha hai? -> is baar skip (marker nahi likhte, agli launch par phir try).
    let lock_candidates = [
        src.join("Local Storage").join("leveldb").join("LOCK"),
        src.join("IndexedDB").join("http_localhost_3000.indexeddb.leveldb").join("LOCK"),
    ];
    if lock_candidates.iter().any(|p| is_file_in_use(p)) {
        return MigrationOutcome {
            status: "deferred-electron-running".into(),
            detail: json!({ "source": src.display().to_string() }),
        };
    }

    let profile_dst = webview_root.join("EBWebView").join("Default");
    let mut copied: Vec<serde_json::Value> = vec![];
    let mut skipped: Vec<serde_json::Value> = vec![];
    let mut errors: Vec<serde_json::Value> = vec![];

    for dir in PROFILE_DIRS {
        let from = src.join(dir);
        let to = profile_dst.join(dir);
        if !from.is_dir() {
            skipped.push(json!({ "item": dir, "reason": "missing in source" }));
            continue;
        }
        if to.exists() {
            skipped.push(json!({ "item": dir, "reason": "destination exists (Tauri already used)" }));
            continue;
        }
        let (mut files, mut bytes) = (0u64, 0u64);
        match copy_dir_recursive(&from, &to, &mut files, &mut bytes) {
            Ok(()) => copied.push(json!({ "item": dir, "files": files, "bytes": bytes })),
            Err(e) => {
                errors.push(json!({ "item": dir, "error": e.to_string() }));
                // aadha-adhura copy hata do (sirf NAYE folder se) taaki agli launch me phir try ho.
                let _ = fs::remove_dir_all(&to);
            }
        }
    }

    for name in CONFIG_FILES {
        let from = src.join(name);
        let to = app_data.join(name);
        if !from.is_file() {
            continue;
        }
        if to.exists() {
            skipped.push(json!({ "item": name, "reason": "destination exists" }));
            continue;
        }
        match fs::copy(&from, &to) {
            Ok(b) => copied.push(json!({ "item": name, "bytes": b })),
            Err(e) => errors.push(json!({ "item": name, "error": e.to_string() })),
        }
    }

    let detail = json!({
        "source": src.display().to_string(),
        "profileDestination": profile_dst.display().to_string(),
        "copied": copied,
        "skipped": skipped,
        "errors": errors,
        "notCopied": ["Cookies (WebView2/Electron ki alag DPAPI encryption key; app login IndexedDB/Local Storage me hai)", "Session Storage (per-tab, Electron me bhi restart par khatam)"],
    });
    let status = if errors.is_empty() { "done" } else { "partial" };
    if errors.is_empty() {
        write_marker(status, &detail);
    }
    MigrationOutcome { status: status.into(), detail }
}

// ---------------------------------------------------------------- v2: attachments

pub const MARKER_FILE_V2: &str = "migration-from-electron-v2.json";

/// Attachment folders (P2). Alag marker — v1 pehle ho chuka ho tab bhi chalta hai.
const DATA_DIRS: &[&str] = &["PocketLedgerData", "pl-attachments"];

/// Electron `PocketLedgerData` + legacy `pl-attachments` -> Tauri app data (sirf copy; purana folder read-only).
/// Destination pehle se ho to sirf missing files copy hoti hain (kuch overwrite nahi).
pub fn run_v2(app_data: &Path) -> MigrationOutcome {
    let marker = app_data.join(MARKER_FILE_V2);
    if marker.exists() {
        return MigrationOutcome { status: "already-done".into(), detail: json!({}) };
    }
    let _ = fs::create_dir_all(app_data);
    let Some(src) = electron_user_data_dir().filter(|p| p.is_dir()) else {
        let d = json!({ "reason": "no electron data folder" });
        let _ = fs::write(&marker, serde_json::to_vec_pretty(&json!({ "status": "no-source", "detail": d })).unwrap_or_default());
        return MigrationOutcome { status: "no-source".into(), detail: d };
    };
    let mut copied = vec![];
    let mut errors = vec![];
    for dir in DATA_DIRS {
        let from = src.join(dir);
        if !from.is_dir() {
            continue;
        }
        let (mut files, mut bytes, mut kept) = (0u64, 0u64, 0u64);
        match copy_missing(&from, &app_data.join(dir), &mut files, &mut bytes, &mut kept) {
            Ok(()) => copied.push(json!({ "item": dir, "files": files, "bytes": bytes, "alreadyPresent": kept })),
            Err(e) => errors.push(json!({ "item": dir, "error": e.to_string() })),
        }
    }
    let status = if errors.is_empty() { "done" } else { "partial" };
    let detail = json!({ "source": src.display().to_string(), "copied": copied, "errors": errors });
    if errors.is_empty() {
        let body = json!({
            "status": status,
            "atUnixMs": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            "appVersion": env!("CARGO_PKG_VERSION"),
            "detail": detail,
        });
        let _ = fs::write(&marker, serde_json::to_vec_pretty(&body).unwrap_or_default());
    }
    MigrationOutcome { status: status.into(), detail }
}

fn copy_missing(src: &Path, dst: &Path, files: &mut u64, bytes: &mut u64, kept: &mut u64) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        if ft.is_symlink() {
            continue;
        }
        let to = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_missing(&entry.path(), &to, files, bytes, kept)?;
        } else if ft.is_file() {
            if to.exists() {
                *kept += 1;
                continue;
            }
            *bytes += fs::copy(entry.path(), &to)?;
            *files += 1;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- packaged upgrade cache (Electron appUpgradeCache.js)

pub const VERSION_MARKER: &str = "pl-packaged-app-version.json";

const DISK_CACHE_DIR_NAMES: &[&str] = &[
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "Service Worker",
    "blob_storage",
];

fn file_fingerprint(p: &Path) -> String {
    match fs::metadata(p) {
        Ok(m) => {
            let mt = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0);
            format!("{}:{}:{}", p.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(), m.len(), mt)
        }
        Err(_) => String::new(),
    }
}

fn packaged_build_fingerprint() -> String {
    match std::env::current_exe() {
        Ok(exe) => {
            let fp = file_fingerprint(&exe);
            if fp.is_empty() {
                "unknown-build".into()
            } else {
                fp
            }
        }
        Err(_) => "unknown-build".into(),
    }
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Packaged EXE/build बदले तो WebView2 disk cache साफ़। IndexedDB / Local Storage / Cookies नहीं छूते।
/// webview spawn से पहले चलाना। packaged=false (debug) पर no-op, जब तक `PL_TAURI_AS_PACKAGED=1` न हो।
pub fn run_upgrade_cache(app_data: &Path, webview_root: &Path, packaged: bool) -> MigrationOutcome {
    if !packaged {
        return MigrationOutcome {
            status: "dev-skip".into(),
            detail: json!({ "reason": "not packaged" }),
        };
    }
    let _ = fs::create_dir_all(app_data);
    let version = env!("CARGO_PKG_VERSION").to_string();
    let build_fp = packaged_build_fingerprint();
    let marker = app_data.join(VERSION_MARKER);
    let (previous, previous_fp) = match fs::read_to_string(&marker).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
        Some(v) => (
            v.get("version").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            v.get("buildFingerprint").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        ),
        None => (String::new(), String::new()),
    };
    if !previous.is_empty() && previous == version && previous_fp == build_fp {
        return MigrationOutcome {
            status: "unchanged".into(),
            detail: json!({ "version": version, "buildFingerprint": build_fp }),
        };
    }
    let profile = webview_root.join("EBWebView").join("Default");
    let mut removed = vec![];
    let mut errors = vec![];
    for name in DISK_CACHE_DIR_NAMES {
        for root in [&profile, app_data] {
            let p = root.join(name);
            if !p.exists() {
                continue;
            }
            match fs::remove_dir_all(&p) {
                Ok(()) => removed.push(json!({ "item": *name, "path": p.display().to_string() })),
                Err(e) => errors.push(json!({ "item": *name, "path": p.display().to_string(), "error": e.to_string() })),
            }
        }
    }
    let status = if errors.is_empty() { "purged" } else { "partial" };
    let detail = json!({
        "version": version,
        "previousVersion": previous,
        "buildFingerprint": build_fp,
        "previousBuildFingerprint": previous_fp,
        "removed": removed,
        "errors": errors,
    });
    let body = json!({
        "status": status,
        "version": version,
        "buildFingerprint": build_fp,
        "previousVersion": if previous.is_empty() { Value::Null } else { json!(previous) },
        "previousBuildFingerprint": if previous_fp.is_empty() { Value::Null } else { json!(previous_fp) },
        "refreshedAtUnixMs": now_unix_ms(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "detail": detail,
    });
    let _ = fs::write(&marker, serde_json::to_vec_pretty(&body).unwrap_or_default());
    MigrationOutcome { status: status.into(), detail }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_case(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("pl-mig-{}-{}-{}", name, std::process::id(), now_unix_ms()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn upgrade_cache_skips_in_dev() {
        let td = temp_case("dev");
        let r = run_upgrade_cache(&td, &td, false);
        assert_eq!(r.status, "dev-skip");
        assert!(!td.join(VERSION_MARKER).exists());
        let _ = fs::remove_dir_all(&td);
    }

    #[test]
    fn upgrade_cache_purges_cache_keeps_indexeddb() {
        let td = temp_case("purge");
        let profile = td.join("EBWebView").join("Default");
        fs::create_dir_all(profile.join("Cache").join("x")).unwrap();
        fs::write(profile.join("Cache").join("x").join("f"), b"1").unwrap();
        fs::create_dir_all(profile.join("IndexedDB")).unwrap();
        fs::write(profile.join("IndexedDB").join("keep"), b"k").unwrap();
        fs::create_dir_all(profile.join("Local Storage")).unwrap();
        fs::write(profile.join("Local Storage").join("keep"), b"ls").unwrap();

        let r = run_upgrade_cache(&td, &td, true);
        assert_eq!(r.status, "purged");
        assert!(!profile.join("Cache").exists());
        assert_eq!(fs::read(profile.join("IndexedDB").join("keep")).unwrap(), b"k");
        assert_eq!(fs::read(profile.join("Local Storage").join("keep")).unwrap(), b"ls");
        assert!(td.join(VERSION_MARKER).is_file());

        let r2 = run_upgrade_cache(&td, &td, true);
        assert_eq!(r2.status, "unchanged");
        let _ = fs::remove_dir_all(&td);
    }

    #[test]
    fn copy_missing_does_not_overwrite() {
        let td = temp_case("copy");
        let src = td.join("src");
        let dst = td.join("dst");
        fs::create_dir_all(src.join("a")).unwrap();
        fs::write(src.join("a").join("one.txt"), b"new").unwrap();
        fs::write(src.join("a").join("two.txt"), b"two").unwrap();
        fs::create_dir_all(dst.join("a")).unwrap();
        fs::write(dst.join("a").join("one.txt"), b"old").unwrap();
        let (mut files, mut bytes, mut kept) = (0u64, 0u64, 0u64);
        copy_missing(&src, &dst, &mut files, &mut bytes, &mut kept).unwrap();
        assert_eq!(fs::read(dst.join("a").join("one.txt")).unwrap(), b"old");
        assert_eq!(fs::read(dst.join("a").join("two.txt")).unwrap(), b"two");
        assert_eq!(files, 1);
        assert_eq!(kept, 1);
        let _ = fs::remove_dir_all(&td);
    }
}
