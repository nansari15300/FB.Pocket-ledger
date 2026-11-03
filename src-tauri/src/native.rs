//! Windows-only native pieces (WebView2 COM + Win32), sab least-privilege:
//! - PL server request headers (Electron `installPlServerRequestHeaders`) — WebView2 `WebResourceRequested`
//! - Right-click menu (Electron `attachAppContentContextMenu`) — WebView2 `ContextMenuRequested`
//! - Force reload bypassing cache — CDP `Page.reload {ignoreCache:true}`
//! - Backup folder picker (IFileOpenDialog), external link open (ShellExecuteW, sirf http/https)
//! - Power save blocker (SetThreadExecutionState), autostart (HKCU Run)
use tauri::{AppHandle, Webview};

#[cfg(windows)]
mod imp {
    use super::*;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::*;
    use windows::core::{Interface, BOOL, HSTRING, PWSTR};

    fn take(p: PWSTR) -> String {
        webview2_com::take_pwstr(p)
    }

    pub fn attach_content_hooks(app: &AppHandle, wv: &Webview) {
        let app = app.clone();
        let _ = wv.with_webview(move |pw| unsafe {
            let Ok(core) = pw.controller().CoreWebView2() else { return };
            let env = pw.environment();
            // 1) PL server headers
            let mut token = 0i64;
            if core.AddWebResourceRequestedFilter(&HSTRING::from("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL).is_ok() {
                let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let req = args.Request()?;
                    let mut uri = PWSTR::null();
                    req.Uri(&mut uri)?;
                    let uri = take(uri);
                    if let Some(hdrs) = crate::auth::headers_for(&uri) {
                        let h = req.Headers()?;
                        for (k, v) in hdrs {
                            let _ = h.SetHeader(&HSTRING::from(k), &HSTRING::from(v.as_str()));
                        }
                    }
                    Ok(())
                }));
                let _ = core.add_WebResourceRequested(&handler, &mut token);
            }
            // 2) context menu (WebView2 1.0.1000+ = ICoreWebView2_11)
            if let (Ok(core11), Ok(env9)) = (core.cast::<ICoreWebView2_11>(), env.cast::<ICoreWebView2Environment9>()) {
                let app2 = app.clone();
                let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let _ = build_context_menu(&env9, &args, &app2);
                    Ok(())
                }));
                let mut t2 = 0i64;
                let _ = core11.add_ContextMenuRequested(&handler, &mut t2);
            }
        });
    }

    unsafe fn build_context_menu(
        env9: &ICoreWebView2Environment9,
        args: &ICoreWebView2ContextMenuRequestedEventArgs,
        _app: &AppHandle,
    ) -> windows::core::Result<()> {
        let items = args.MenuItems()?;
        let mut n = 0u32;
        items.Count(&mut n)?;
        let mut by_name: Vec<(String, ICoreWebView2ContextMenuItem)> = vec![];
        for i in 0..n {
            let it = items.GetValueAtIndex(i)?;
            let mut name = PWSTR::null();
            it.Name(&mut name)?;
            by_name.push((take(name), it));
        }
        for _ in 0..n {
            items.RemoveValueAtIndex(0)?;
        }
        // link target?
        let mut link = String::new();
        if let Ok(target) = args.ContextMenuTarget() {
            let mut has = BOOL::default();
            if target.HasLinkUri(&mut has).is_ok() && has.as_bool() {
                let mut u = PWSTR::null();
                if target.LinkUri(&mut u).is_ok() {
                    link = take(u);
                }
            }
        }
        let link_ok = link.starts_with("http://") || link.starts_with("https://");
        let inspect = cfg!(debug_assertions);
        // Electron order: Back, Forward, Reload | Open Link in Browser | Cut, Copy, Paste | Select All | Inspect
        let groups: Vec<Vec<&str>> = vec![
            vec!["back", "forward", "reload"],
            vec!["__open_link__"],
            vec!["cut", "copy", "paste"],
            vec!["selectAll"],
            if inspect { vec!["inspectElement"] } else { vec![] },
        ];
        let mut idx = 0u32;
        let mut need_sep = false;
        for g in groups {
            let mut added_any = false;
            for name in g {
                let item = if name == "__open_link__" {
                    if !link_ok {
                        continue;
                    }
                    let it = env9.CreateContextMenuItem(
                        &HSTRING::from("Open Link in Browser"),
                        None::<&windows::Win32::System::Com::IStream>,
                        COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
                    )?;
                    let url = link.clone();
                    let h = CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                        open_external(&url);
                        Ok(())
                    }));
                    let mut tk = 0i64;
                    it.add_CustomItemSelected(&h, &mut tk)?;
                    it
                } else {
                    match by_name.iter().find(|(n, _)| n == name) {
                        Some((_, it)) => it.clone(),
                        None => continue,
                    }
                };
                if need_sep && !added_any {
                    if let Ok(sep) = env9.CreateContextMenuItem(
                        &HSTRING::from(""),
                        None::<&windows::Win32::System::Com::IStream>,
                        COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
                    ) {
                        items.InsertValueAtIndex(idx, &sep)?;
                        idx += 1;
                    }
                }
                items.InsertValueAtIndex(idx, &item)?;
                idx += 1;
                added_any = true;
            }
            if added_any {
                need_sep = true;
            }
        }
        Ok(())
    }

    pub fn reload_ignoring_cache(wv: &Webview) -> bool {
        wv.with_webview(|pw| unsafe {
            if let Ok(core) = pw.controller().CoreWebView2() {
                let h = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
                let _ = core.CallDevToolsProtocolMethod(
                    &HSTRING::from("Page.reload"),
                    &HSTRING::from("{\"ignoreCache\":true}"),
                    &h,
                );
            }
        })
        .is_ok()
    }

    /// Hidden bridge webview ko throttle/suspend se bachao (Electron `backgroundThrottling:false`).
    pub fn keep_rendering(wv: &Webview) {
        let _ = wv.with_webview(|pw| unsafe {
            let _ = pw.controller().SetIsVisible(true);
        });
    }

    pub fn open_external(url: &str) {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return;
        }
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        unsafe {
            let _ = ShellExecuteW(None, &HSTRING::from("open"), &HSTRING::from(url), None, None, SW_SHOWNORMAL);
        }
    }

    /// Folder picker (Electron `showOpenDialog openDirectory`). Alag STA thread par.
    pub fn pick_directory(owner: isize) -> std::result::Result<Option<String>, String> {
        std::thread::spawn(move || unsafe {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::System::Com::*;
            use windows::Win32::UI::Shell::*;
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let r = (|| -> windows::core::Result<Option<String>> {
                let dlg: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
                let opts = dlg.GetOptions()?;
                dlg.SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST)?;
                let owner = if owner != 0 { Some(HWND(owner as *mut core::ffi::c_void)) } else { None };
                if let Err(e) = dlg.Show(owner) {
                    // HRESULT_FROM_WIN32(ERROR_CANCELLED)
                    if e.code().0 as u32 == 0x800704C7 {
                        return Ok(None);
                    }
                    return Err(e);
                }
                let item = dlg.GetResult()?;
                let p = item.GetDisplayName(SIGDN_FILESYSPATH)?;
                let s = p.to_string().unwrap_or_default();
                CoTaskMemFree(Some(p.0 as *const core::ffi::c_void));
                Ok(Some(s))
            })();
            CoUninitialize();
            r.map_err(|e| e.message().to_string())
        })
        .join()
        .map_err(|_| "picker thread panicked".to_string())?
    }
}

#[cfg(windows)]
pub use imp::{attach_content_hooks, keep_rendering, open_external, pick_directory, reload_ignoring_cache};

#[cfg(not(windows))]
pub fn attach_content_hooks(_app: &AppHandle, _wv: &Webview) {}
#[cfg(not(windows))]
pub fn reload_ignoring_cache(wv: &Webview) -> bool {
    wv.reload().is_ok()
}
#[cfg(not(windows))]
pub fn keep_rendering(_wv: &Webview) {}
#[cfg(not(windows))]
pub fn open_external(_url: &str) {}
#[cfg(not(windows))]
pub fn pick_directory(_owner: isize) -> Result<Option<String>, String> {
    Err("unsupported".into())
}

// ---------------------------------------------------------------- power save blocker

use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};

static POWER_TX: OnceLock<Mutex<mpsc::Sender<bool>>> = OnceLock::new();

/// Electron `powerSaveBlocker.start('prevent-display-sleep')` jaisa. Ek dedicated thread state hold karta hai.
pub fn set_power_block(on: bool) {
    let tx = POWER_TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<bool>();
        std::thread::spawn(move || {
            let mut cur = false;
            while let Ok(v) = rx.recv() {
                if v == cur {
                    continue;
                }
                cur = v;
                #[cfg(windows)]
                unsafe {
                    use windows_sys::Win32::System::Power::*;
                    if v {
                        SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
                    } else {
                        SetThreadExecutionState(ES_CONTINUOUS);
                    }
                }
            }
        });
        Mutex::new(tx)
    });
    let _ = tx.lock().unwrap().send(on);
}

// ---------------------------------------------------------------- autostart (HKCU Run)

pub const AUTOSTART_VALUE: &str = "Pocket Ledger Tauri";

/// Electron `setLoginItemSettings({openAtLogin})` jaisa — sirf current user, apne naam ki value.
pub fn set_autostart(enable: bool) -> bool {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Registry::*;
        let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let key = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
        let name = wide(AUTOSTART_VALUE);
        if enable {
            let Ok(exe) = std::env::current_exe() else { return false };
            let val = wide(&format!("\"{}\"", exe.display()));
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                REG_SZ,
                val.as_ptr() as *const core::ffi::c_void,
                (val.len() * 2) as u32,
            ) == 0
        } else {
            let r = RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr());
            r == 0 || r == 2 // ERROR_FILE_NOT_FOUND = already off
        }
    }
    #[cfg(not(windows))]
    {
        let _ = enable;
        false
    }
}

// ---------------------------------------------------------------- system resume (Electron powerMonitor.on("resume"))

#[cfg(windows)]
mod power_resume {
    use std::sync::OnceLock;
    use tauri::AppHandle;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassExW, TranslateMessage,
        HWND_MESSAGE, MSG, WM_POWERBROADCAST, WNDCLASSEXW,
    };

    const PBT_APMRESUMESUSPEND: u32 = 0x0007;
    const PBT_APMRESUMEAUTOMATIC: u32 = 0x0012;

    static APP: OnceLock<AppHandle> = OnceLock::new();

    unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: usize, lparam: isize) -> isize {
        if msg == WM_POWERBROADCAST {
            let ev = wparam as u32;
            if ev == PBT_APMRESUMEAUTOMATIC || ev == PBT_APMRESUMESUSPEND {
                if let Some(app) = APP.get() {
                    crate::on_system_resume(app);
                }
            }
            return 1;
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    pub fn start(app: AppHandle) {
        let _ = APP.set(app);
        let _ = std::thread::Builder::new().name("pl-power-resume".into()).spawn(|| unsafe {
            let class: Vec<u16> = "PLTauriPowerResume\0".encode_utf16().collect();
            let hinst = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: 0,
                lpfnWndProc: Some(wndproc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: hinst,
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: std::ptr::null_mut(),
                lpszMenuName: std::ptr::null(),
                lpszClassName: class.as_ptr(),
                hIconSm: std::ptr::null_mut(),
            };
            RegisterClassExW(&wc);
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                std::ptr::null_mut(),
                hinst,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return;
            }
            let mut msg = std::mem::zeroed::<MSG>();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }
}

/// Sleep/hibernate के बाद Electron `powerMonitor resume` जैसा: live-sync + sharing वापस।
pub fn start_power_resume_watch(app: AppHandle) {
    #[cfg(windows)]
    power_resume::start(app);
    #[cfg(not(windows))]
    let _ = app;
}
