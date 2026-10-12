//! Direct WebView2 control for the per-agent browser surfaces.
//!
//! Tauri's public `eval` API is fire-and-forget, which cannot implement real
//! read/screenshot parity. On Windows we therefore talk to the exact
//! `ICoreWebView2` instance behind each owned Tauri webview: script evaluation
//! with real results (`ExecuteScript`), genuine surface captures
//! (`CapturePreview` renders the actual WebView2 compositor output to PNG —
//! never a DOM re-render or placeholder), plus navigation/popup/permission
//! policy hooks.
//!
//! Threading: WebView2 COM interfaces are not `Send`, so no COM pointer ever
use std::time::Duration;

pub use imp::{capture_png, exec, install_policy_hooks};

pub const MAX_CAPTURE_BYTES: usize = 24 * 1024 * 1024;
const EXEC_TIMEOUT: Duration = Duration::from_secs(15);
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(20);

#[cfg(windows)]
mod imp {
    use super::{CAPTURE_TIMEOUT, EXEC_TIMEOUT, MAX_CAPTURE_BYTES};
    use std::sync::Arc;
    use tokio::sync::oneshot;

    use parking_lot::Mutex;
    use tauri::WebviewWindow;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{
        CapturePreviewCompletedHandler, ExecuteScriptCompletedHandler,
        NavigationStartingEventHandler, NewWindowRequestedEventHandler,
        PermissionRequestedEventHandler,
    };
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    use windows::Win32::System::Com::{
        CoTaskMemFree, IStream, STATFLAG_DEFAULT, STATSTG, STREAM_SEEK_SET,
    };

    /// Runs `js` in the page and returns the real `ExecuteScript` result
    /// (JSON-encoded string). Script exceptions surface as errors because the
    /// completion callback reports the failing HRESULT.
    pub async fn exec(window: WebviewWindow, js: String) -> Result<String, String> {
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
        let tx = Arc::new(Mutex::new(Some(tx)));
        let tx_inner = tx.clone();
        let worker = window.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = worker.with_webview(move |pw| {
                let core = match unsafe { pw.controller().CoreWebView2() } {
                    Ok(core) => core,
                    Err(e) => {
                        if let Some(tx) = tx.lock().take() {
                            let _ = tx.send(Err(format!("WebView2 core unavailable: {e}")));
                        }
                        return;
                    }
                };
                let handler = ExecuteScriptCompletedHandler::create(Box::new(
                    move |hr: ::windows::core::Result<()>, result: String| {
                        if let Some(tx) = tx_inner.lock().take() {
                            let _ = tx.send(
                                hr.map(|()| result).map_err(|e| format!("script failed: {e}")),
                            );
                        }
                        Ok(())
                    },
                ));
                let wide: Vec<u16> = js.encode_utf16().chain(std::iter::once(0)).collect();
                if let Err(e) = unsafe { core.ExecuteScript(PCWSTR(wide.as_ptr()), &handler) } {
                    if let Some(tx) = tx.lock().take() {
                        let _ = tx.send(Err(format!("ExecuteScript rejected: {e}")));
                    }
                }
            });
        })
        .await
        .map_err(|e| format!("WebView2 dispatch task failed: {e}"))?;
        match tokio::time::timeout(EXEC_TIMEOUT, rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err("script result channel closed".into()),
            Err(_) => Err("script execution timed out".into()),
        }
    }

    /// Real compositor capture of the WebView2 surface as PNG bytes.
    pub async fn capture_png(window: WebviewWindow) -> Result<Vec<u8>, String> {
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
        let tx = Arc::new(Mutex::new(Some(tx)));
        let tx_inner = tx.clone();
        let worker = window.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = worker.with_webview(move |pw| {
                let core = match unsafe { pw.controller().CoreWebView2() } {
                    Ok(core) => core,
                    Err(e) => {
                        if let Some(tx) = tx.lock().take() {
                            let _ = tx.send(Err(format!("WebView2 core unavailable: {e}")));
                        }
                        return;
                    }
                };
                let stream: IStream = match unsafe { CreateStreamOnHGlobal(HGLOBAL::default(), true) }
                {
                    Ok(stream) => stream,
                    Err(e) => {
                        if let Some(tx) = tx.lock().take() {
                            let _ = tx.send(Err(format!("capture buffer failed: {e}")));
                        }
                        return;
                    }
                };
                let stream_for_handler = stream.clone();
                let handler = CapturePreviewCompletedHandler::create(Box::new(
                    move |hr: ::windows::core::Result<()>| {
                        if let Some(tx) = tx_inner.lock().take() {
                            let _ = tx.send(match hr {
                                Ok(()) => read_stream(&stream_for_handler, MAX_CAPTURE_BYTES),
                                Err(e) => Err(format!("CapturePreview failed: {e}")),
                            });
                        }
                        Ok(())
                    },
                ));
                if let Err(e) = unsafe {
                    core.CapturePreview(
                        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                        &stream,
                        &handler,
                    )
                } {
                    if let Some(tx) = tx.lock().take() {
                        let _ = tx.send(Err(format!("CapturePreview rejected: {e}")));
                    }
                }
            });
        })
        .await
        .map_err(|e| format!("WebView2 dispatch task failed: {e}"))?;
        match tokio::time::timeout(CAPTURE_TIMEOUT, rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err("capture result channel closed".into()),
            Err(_) => Err("surface capture timed out".into()),
        }
    }

    fn read_stream(stream: &IStream, cap: usize) -> Result<Vec<u8>, String> {
        let mut stat: STATSTG = unsafe { std::mem::zeroed() };
        unsafe { stream.Stat(&mut stat, STATFLAG_DEFAULT) }
            .map_err(|e| format!("capture stat failed: {e}"))?;
        let len = stat.cbSize as usize;
        if len == 0 || len > cap {
            return Err(format!("capture size {len} is out of bounds"));
        }
        unsafe { stream.Seek(0, STREAM_SEEK_SET, None) }
            .map_err(|e| format!("capture rewind failed: {e}"))?;
        let mut buf = vec![0u8; len];
        let mut read = 0u32;
        unsafe {
            stream.Read(
                buf.as_mut_ptr() as *mut _,
                len as u32,
                Some(&mut read as *mut u32),
            )
        }
        .ok()
        .map_err(|e| format!("capture read failed: {e}"))?;
        buf.truncate(read as usize);
        Ok(buf)
    }

    fn read_pwstr(f: impl FnOnce(*mut PWSTR) -> ::windows::core::Result<()>) -> String {
        let mut pw = PWSTR::null();
        if f(&mut pw).is_err() || pw.is_null() {
            return String::new();
        }
        let s = unsafe { pw.to_string() }.unwrap_or_default();
        unsafe { CoTaskMemFree(Some(pw.as_ptr() as *const _)) };
        s
    }


    /// Production sequencing seam: first failed registration stops setup.
    pub(super) fn run_registration_sequence<F1, F2, F3, E>(step1: F1, step2: F2, step3: F3) -> Result<(), String>
    where
        F1: FnOnce() -> Result<(), E>,
        F2: FnOnce() -> Result<(), E>,
        F3: FnOnce() -> Result<(), E>,
        E: std::fmt::Debug,
    {
        step1().map_err(|e| format!("add_NavigationStarting failed: {e:?}"))?;
        step2().map_err(|e| format!("add_NewWindowRequested failed: {e:?}"))?;
        step3().map_err(|e| format!("add_PermissionRequested failed: {e:?}"))?;
        Ok(())
    }

    pub async fn install_policy_hooks(
        window: WebviewWindow,
        policy: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    ) -> Result<(), String> {
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
        let worker = window.clone();
        let nav_policy = policy.clone();
        let join = tauri::async_runtime::spawn_blocking(move || {
            worker.with_webview(move |pw| {
                let core = match unsafe { pw.controller().CoreWebView2() } {
                    Ok(core) => core,
                    Err(e) => {
                        let _ = tx.send(Err(format!("WebView2 core unavailable: {e}")));
                        return;
                    }
                };
                let res = run_registration_sequence(
                    || {
                        let nav = NavigationStartingEventHandler::create(Box::new(
                            move |_sender, args: Option<ICoreWebView2NavigationStartingEventArgs>| {
                                if let Some(args) = args {
                                    let uri = read_pwstr(|pw| unsafe { args.Uri(pw) });
                                    if !uri.is_empty() && !nav_policy(&uri) {
                                        let _ = unsafe { args.SetCancel(true) };
                                    }
                                }
                                Ok(())
                            },
                        ));
                        let mut token = 0i64;
                        unsafe { core.add_NavigationStarting(&nav, &mut token) }
                    },
                    || {
                        let popups = NewWindowRequestedEventHandler::create(Box::new(
                            move |_sender, args: Option<ICoreWebView2NewWindowRequestedEventArgs>| {
                                if let Some(args) = args {
                                    let _ = unsafe { args.SetHandled(true) };
                                }
                                Ok(())
                            },
                        ));
                        let mut token = 0i64;
                        unsafe { core.add_NewWindowRequested(&popups, &mut token) }
                    },
                    || {
                        let perms = PermissionRequestedEventHandler::create(Box::new(
                            move |_sender, args: Option<ICoreWebView2PermissionRequestedEventArgs>| {
                                if let Some(args) = args {
                                    let _ = unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY) };
                                }
                                Ok(())
                            },
                        ));
                        let mut token = 0i64;
                        unsafe { core.add_PermissionRequested(&perms, &mut token) }
                    },
                );
                let _ = tx.send(res);
            }).map_err(|e| format!("WebView2 with_webview failed: {e}"))
        });
        // Wait for dispatch task to complete or timeout
        match tokio::time::timeout(std::time::Duration::from_secs(10), join).await {
            Ok(Ok(res)) => res?,
            Ok(Err(e)) => return Err(format!("WebView2 with_webview failed: {e}")),
            Err(_) => return Err("install_policy_hooks: dispatch timeout".into()),
        }
        // Then wait for registration result
        match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(e)) => Err(format!("WebView2 registration channel error: {e}")),
            Err(_) => Err("install_policy_hooks: registration timeout".into()),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::sync::Arc;

    use tauri::WebviewWindow;

    /// Non-Windows placeholder: canoPi v1 ships Windows only. macOS would need
    /// a WKWebView bridge and Linux a WebKitGTK bridge; neither pretends parity
    /// here.
    pub async fn exec(_window: WebviewWindow, _js: String) -> Result<String, String> {
        Err("WebView2 browser control is Windows-only in this build".into())
    }

    pub async fn capture_png(_window: WebviewWindow) -> Result<Vec<u8>, String> {
        Err("WebView2 browser control is Windows-only in this build".into())
    }

    pub async fn install_policy_hooks(
        _window: WebviewWindow,
        _policy: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    ) -> Result<(), String> {
        Err("WebView2 browser control is Windows-only in this build".into())
    }

    #[cfg(test)]
    pub(super) fn run_registration_sequence<F1, F2, F3, E>(step1: F1, step2: F2, step3: F3) -> Result<(), String>
    where
        F1: FnOnce() -> Result<(), E>,
        F2: FnOnce() -> Result<(), E>,
        F3: FnOnce() -> Result<(), E>,
        E: std::fmt::Debug,
    {
        step1().map_err(|e| format!("add_NavigationStarting failed: {e:?}"))?;
        step2().map_err(|e| format!("add_NewWindowRequested failed: {e:?}"))?;
        step3().map_err(|e| format!("add_PermissionRequested failed: {e:?}"))?;
        Ok(())
    }
}

/// Parses width/height from a real PNG's IHDR chunk; `None` when the bytes are
/// not a PNG (surfaces capture failures honestly instead of guessing).
pub fn png_dims(png: &[u8]) -> Option<(u32, u32)> {
    if png.len() < 24 || &png[..8] != b"\x89PNG\r\n\x1a\n" || &png[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
    let height = u32::from_be_bytes([png[20], png[21], png[22], png[23]]);
    Some((width, height))
}

#[cfg(test)]
mod tests {
    use super::{png_dims, imp::run_registration_sequence};

    /// PNG structural check on synthetic bytes: proves the parser used for
    /// real captures validates signature and dimensions (no GUI needed).
    #[test]
    fn png_dimensions_parse() {
        let mut png = vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&1920u32.to_be_bytes());
        png.extend_from_slice(&1080u32.to_be_bytes());
        assert_eq!(png_dims(&png), Some((1920, 1080)));
        assert_eq!(png_dims(b"not a png"), None);
    }

    #[test]
    fn registration_failure_stops_later_handlers() {
        use std::cell::Cell;
        for failure in 0..3 {
            let calls=Cell::new(0);
            let step=|index| { calls.set(calls.get()+1); if index==failure { Err("registration failed") } else { Ok(()) } };
            let result = run_registration_sequence(|| step(0), || step(1), || step(2));
            assert!(result.is_err());
            assert_eq!(calls.get(), failure + 1);
            let err = result.unwrap_err();
            match failure {
                0 => assert!(err.contains("add_NavigationStarting failed")),
                1 => assert!(err.contains("add_NewWindowRequested failed")),
                2 => assert!(err.contains("add_PermissionRequested failed")),
                _ => unreachable!(),
            }
        }
        let calls=Cell::new(0);
        let step=|| { calls.set(calls.get()+1); Ok::<(), &str>(()) };
        assert_eq!(run_registration_sequence(step,step,step),Ok(()));
        assert_eq!(calls.get(),3);
    }
}
