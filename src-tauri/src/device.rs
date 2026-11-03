//! `pl-device-display-info`: Electron `${os.hostname()} (Windows ${os.release()})` jaisa label.
//! Same string zaroori hai — Firestore multi-device list me device identity isi se dikhti hai.
use std::sync::OnceLock;

#[cfg(windows)]
fn hostname() -> String {
    use windows_sys::Win32::System::SystemInformation::{ComputerNameDnsHostname, GetComputerNameExW};
    let mut buf = [0u16; 256];
    let mut len: u32 = buf.len() as u32;
    let ok = unsafe { GetComputerNameExW(ComputerNameDnsHostname, buf.as_mut_ptr(), &mut len) };
    if ok != 0 && len > 0 {
        return String::from_utf16_lossy(&buf[..len as usize]);
    }
    std::env::var("COMPUTERNAME").unwrap_or_default()
}

#[cfg(windows)]
fn os_release() -> String {
    use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;
    let mut info: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    let status = unsafe { RtlGetVersion(&mut info) };
    if status == 0 {
        format!("{}.{}.{}", info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber)
    } else {
        String::new()
    }
}

#[cfg(not(windows))]
fn hostname() -> String {
    std::env::var("HOSTNAME").unwrap_or_default()
}
#[cfg(not(windows))]
fn os_release() -> String {
    String::new()
}

pub fn display_label() -> String {
    static LABEL: OnceLock<String> = OnceLock::new();
    LABEL
        .get_or_init(|| {
            let host = hostname().trim().to_string();
            let host = if host.is_empty() { "PC".to_string() } else { host };
            let os = if cfg!(windows) { "Windows" } else { std::env::consts::OS };
            let rel = os_release();
            let part = if rel.is_empty() { os.to_string() } else { format!("{os} {rel}") };
            format!("{host} ({part})").split_whitespace().collect::<Vec<_>>().join(" ")
        })
        .clone()
}
