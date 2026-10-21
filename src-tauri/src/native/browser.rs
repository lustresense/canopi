//! Agent-owned browser surfaces: one isolated WebView2 profile per
//! session+agent, opened as a dedicated Tauri webview window with its own
//! user-data directory (cookies/storage never shared between agents).
//!
//! Control surface: navigate / state / read / act(click,type,scroll,press) /
//! screenshot / close / clear-data. Reads and screenshots go through the real
//! WebView2 surface (`ExecuteScript` results and `CapturePreview` compositor
//! PNGs) — never DOM re-renders, never fabricated output, never external
//! Chrome. Ownership is enforced in the backend: every operation recomputes the
//! surface label from the caller's session+agent and refuses mismatches.
use std::{collections::HashMap, future::Future, sync::Arc};

use base64::{engine::general_purpose::STANDARD, Engine};
use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::webview2::{self, png_dims};
use crate::{app_data_root, owned_root, valid_key};

pub const MAX_URL_LEN: usize = 2048;
pub const MAX_SELECTOR_LEN: usize = 1024;
pub const MAX_TEXT_LEN: usize = 64 * 1024;
const MAX_TITLE_LEN: usize = 4096;
const MAX_TEXT_READ: usize = 200_000;
const MAX_HTML_READ: usize = 1_000_000;
const MAX_INTERACTIVE_ELEMENTS: usize = 500;
const MAX_SCROLL_PIXELS: i64 = 10_000;

#[derive(Default)]
pub struct BrowserManager {
    surfaces: Arc<Mutex<HashMap<String, Arc<BrowserSurface>>>>,
}

/// Only Send/Sync data here: WebView2 COM pointers never leave the UI thread
/// (see `webview2`), so the surface keeps just the window handle.
pub struct BrowserSurface {
    session_key: String,
    agent_id: String,
    #[allow(dead_code)]
    label: String,
    window: WebviewWindow,
}

pub fn safe_browser_url(value: &str) -> Result<tauri::Url, String> {
    if value.is_empty() || value.len() > MAX_URL_LEN {
        return Err("Browser URL is out of bounds".into());
    }
    let url = tauri::Url::parse(value).map_err(|_| "Invalid browser URL".to_string())?;
    let host = url.host_str().ok_or("Browser URL needs a hostname")?;
    let local = host == "localhost" || host == "127.0.0.1" || host == "[::1]";
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("Only HTTPS or loopback HTTP allowed".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URL credentials are forbidden".into());
    }
    Ok(url)
}

/// Policy predicate installed inside each surface so in-page navigations
/// (link clicks, redirects, script-initiated) obey the same rules. The inert
/// `about:blank` document is permitted (it is the pre-navigation placeholder
/// and carries no network/host surface); everything else must be a validated
/// https/loopback-http URL.
pub fn url_allowed(value: &str) -> bool {
    value == "about:blank" || safe_browser_url(value).is_ok()
}

pub fn browser_label(sid: &str, aid: &str) -> Result<String, String> {
    if !valid_key(sid) || !valid_key(aid) {
        return Err("Invalid browser owner".into());
    }
    Ok(format!("browser_{sid}_{aid}"))
}

/// Profile dir for an owned surface. Both components are `valid_key`-checked
/// (no separators, no dots), so the path can never escape the app-owned root.
pub fn profile_dir(
    root: &std::path::Path,
    sid: &str,
    aid: &str,
) -> Result<std::path::PathBuf, String> {
    if !valid_key(sid) || !valid_key(aid) {
        return Err("Invalid browser owner".into());
    }
    Ok(root.join("browser-profiles").join(sid).join(aid))
}

fn validate_selector(selector: &str) -> Result<(), String> {
    if selector.is_empty() || selector.len() > MAX_SELECTOR_LEN {
        return Err("Selector is out of bounds".into());
    }
    if selector.chars().any(|c| c.is_control()) {
        return Err("Selector contains control characters".into());
    }
    Ok(())
}

fn validate_text(text: &str) -> Result<(), String> {
    if text.len() > MAX_TEXT_LEN {
        return Err("Text input is too large".into());
    }
    Ok(())
}

/// JSON-quote a string for safe embedding inside a JS source literal.
fn js_str(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn surface_for(
    app: &tauri::AppHandle,
    manager: &BrowserManager,
    sid: &str,
    aid: &str,
) -> Result<Arc<BrowserSurface>, String> {
    let label = browser_label(sid, aid)?;
    let surface = manager
        .surfaces
        .lock()
        .get(&label)
        .cloned()
        .ok_or("No browser surface for this session agent")?;
    if surface.session_key != sid || surface.agent_id != aid {
        return Err("Browser surface ownership mismatch".into());
    }
    // Self-heal: a surface whose window was closed externally is unregistered.
    if app.get_webview_window(&label).is_none() {
        manager.surfaces.lock().remove(&label);
        return Err("Browser surface is closed".into());
    }
    Ok(surface)
}

/// Runs a JS snippet that yields a JSON-encoded string and decodes the real
/// `ExecuteScript` result.
async fn eval_json_string(surface: &BrowserSurface, js: String) -> Result<Value, String> {
    let raw = webview2::exec(surface.window.clone(), js).await?;
    serde_json::from_str::<Value>(&raw).map_err(|_| "Unexpected page result".to_string())
}

/// Same, requiring the page snippet to answer the literal string `ok`.
async fn eval_expect_ok(surface: &BrowserSurface, js: String) -> Result<(), String> {
    let value = eval_json_string(surface, js).await?;
    match value.as_str() {
        Some("ok") => Ok(()),
        Some(other) => Err(format!("Page rejected action: {other}")),
        None => Err("Unexpected page result".into()),
    }
}
/// Policy-before-navigation orchestration: installs hooks, on error closes and
/// returns Err without navigating; on success runs navigate. Used by open()
/// and tests so failure path is single source of truth.
async fn policy_before_navigation<FInstall, FClose, FNavigate, E>(
    install: FInstall,
    mut close: FClose,
    navigate: FNavigate,
) -> Result<(), String>
where
    FInstall: Future<Output = Result<(), String>>,
    FClose: FnMut() -> Result<(), E>,
    FNavigate: FnOnce() -> Result<(), String>,
    E: std::fmt::Debug,
{
    if let Err(e) = install.await {
        let _ = close();
        return Err(format!("Browser policy hooks failed: {e}"));
    }
    if let Err(e) = navigate() {
        let _ = close();
        return Err(e);
    }
    Ok(())
}

pub async fn open(
    app: tauri::AppHandle,
    manager: &BrowserManager,
    sid: &str,
    aid: &str,
    url: &str,
) -> Result<Value, String> {
    let label = browser_label(sid, aid)?;
    let url = safe_browser_url(url)?;
    // Reuse a live surface, or heal a stale map entry left behind when the
    // user closed the window out-of-band (aux close) without unregistering.
    if let Some(existing) = manager.surfaces.lock().get(&label).cloned() {
        if app.get_webview_window(&label).is_some() {
            existing.window.navigate(url).map_err(|e| e.to_string())?;
            existing.window.set_focus().map_err(|e| e.to_string())?;
            return Ok(json!({"label": label, "opened": false, "reused": true}));
        }
        // Stale: the window is gone but the map still references it. Drop the
        // entry and fall through to create a fresh, correctly-hooked surface.
        manager.surfaces.lock().remove(&label);
    }
    let root = app_data_root(&app)?;
    owned_root(&root, ".canopi-owner")?;
    let browser_dir = profile_dir(&root, sid, aid)?;
    std::fs::create_dir_all(&browser_dir).map_err(|e| e.to_string())?;
    // Per-agent WebView2 user-data directories isolate cookies and storage on
    // Windows. macOS profile isolation would need dataStoreIdentifier instead.
    // Open inert about:blank first so no real navigation happens before the
    // policy hooks are installed (a redirect on a direct initial load would
    // otherwise evade the NavigationStarting cancel check). Hooks go in
    // before any real URL is loaded; fail closed if they cannot be installed.
    WebviewWindowBuilder::new(
        &app,
        label.clone(),
        WebviewUrl::External(
            tauri::Url::parse("about:blank")
                .map_err(|e| format!("Blank surface failed: {e}"))?,
        ),
    )
        .title(format!("canoPi · {aid} browser"))
        .inner_size(1120.0, 780.0)
        .data_directory(browser_dir.clone())
        .build()
        .map_err(|e| format!("Native browser failed: {e}"))?;
    let Some(window) = app.get_webview_window(&label) else {
        return Err("Browser window failed to register".into());
    };
    let policy: Arc<dyn Fn(&str) -> bool + Send + Sync> = Arc::new(url_allowed);
    let window_clone = window.clone();
    let install_fut = webview2::install_policy_hooks(window_clone, policy);
    policy_before_navigation(
        install_fut,
        || window.close().map_err(|e| format!("close failed: {e}")),
        || window.navigate(url).map_err(|e| format!("Initial navigation failed: {e}")), 
    ).await?;
    let surface = Arc::new(BrowserSurface {
        session_key: sid.to_string(),
        agent_id: aid.to_string(),
        label: label.clone(),
        window,
    });
    manager.surfaces.lock().insert(label.clone(), surface);
    Ok(json!({
        "label": label,
        "opened": true,
        "profile": browser_dir.to_string_lossy(),
        "capabilities": ["navigate","state","read","click","type","scroll","press","screenshot","reload","clearData"],
    }))
}

pub fn close(manager: &BrowserManager, sid: &str, aid: &str) -> Result<bool, String> {
    let label = browser_label(sid, aid)?;
    let surface = manager.surfaces.lock().remove(&label);
    match surface {
        Some(surface) => {
            surface.window.close().map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

pub fn close_session(manager: &BrowserManager, sid: &str) -> usize {
    let labels: Vec<String> = manager
        .surfaces
        .lock()
        .iter()
        .filter(|(_, s)| s.session_key == sid)
        .map(|(l, _)| l.clone())
        .collect();
    let mut closed = 0;
    for label in labels {
        if let Some(surface) = manager.surfaces.lock().remove(&label) {
            let _ = surface.window.close();
            closed += 1;
        }
    }
    closed
}

pub fn close_all(manager: &BrowserManager) -> usize {
    let labels: Vec<String> = manager.surfaces.lock().keys().cloned().collect();
    let mut closed = 0;
    for label in labels {
        if let Some(surface) = manager.surfaces.lock().remove(&label) {
            let _ = surface.window.close();
            closed += 1;
        }
    }
    closed
}

pub async fn navigate(
    app: tauri::AppHandle,
    manager: &BrowserManager,
    sid: &str,
    aid: &str,
    url: &str,
) -> Result<(), String> {
    let surface = surface_for(&app, manager, sid, aid)?;
    let url = safe_browser_url(url)?;
    surface.window.navigate(url).map_err(|e| e.to_string())?;
    surface.window.set_focus().map_err(|e| e.to_string())
}

pub async fn reload(
    app: tauri::AppHandle,
    manager: &BrowserManager,
    sid: &str,
    aid: &str,
) -> Result<(), String> {
    let surface = surface_for(&app, manager, sid, aid)?;
    eval_expect_ok(&surface, "location.reload();'ok'".to_string()).await
}

pub async fn state(
    app: tauri::AppHandle,
    manager: &BrowserManager,
    sid: &str,
    aid: &str,
) -> Result<Value, String> {
    let surface = surface_for(&app, manager, sid, aid)?;
    let js = format!(
        "JSON.stringify({{url:location.href.slice(0,{MAX_URL_LEN}),title:document.title.slice(0,{MAX_TITLE_LEN}),ready:document.readyState}})"
    );
    eval_json_string(&surface, js).await
}

pub async fn read(
    app: tauri::AppHandle,
    manager: &BrowserManager,
    sid: &str,
    aid: &str,
    kind: &str,
) -> Result<Value, String> {
    let surface = surface_for(&app, manager, sid, aid)?;
    let js = match kind {
        "title" => format!("JSON.stringify(document.title.slice(0,{MAX_TITLE_LEN}))"),
        "url" => format!("JSON.stringify(location.href.slice(0,{MAX_URL_LEN}))"),
        "text" => format!(
            "JSON.stringify(document.body?document.body.innerText.slice(0,{MAX_TEXT_READ}):'\')"
        ),
        "html" => format!(
            "JSON.stringify(document.documentElement?document.documentElement.outerHTML.slice(0,{MAX_HTML_READ}):'\')"
        ),
        "interactive" => interactive_snapshot_js(),
        _ => return Err("Unsupported browser read kind".into()),
    };
    eval_json_string(&surface, js).await
}

/// Bounded accessibility-ish snapshot: visible interactive elements with a
/// reusable CSS path per element, so `act click` can target snapshot ids.
fn interactive_snapshot_js() -> String {
    format!(
        r#"JSON.stringify((()=>{{
  const cap={MAX_INTERACTIVE_ELEMENTS};
  const path=(el)=>{{const p=[];while(el&&el.nodeType===1&&p.length<8){{let s=el.tagName.toLowerCase();if(el.id){{s+='#'+CSS.escape(el.id);p.unshift(s);break;}}let i=1,n=el;while(n=n.previousElementSibling){{if(n.tagName===el.tagName)i++;}}s+=`:nth-of-type(${{i}})`;p.unshift(s);el=el.parentElement;}}return p.join('>');}};
  const out=[];
  for(const el of document.querySelectorAll('a,button,input,textarea,select,summary,[role],[tabindex],[onclick]')){{
    if(out.length>=cap)break;
    const r=el.getBoundingClientRect();
    if(r.width===0&&r.height===0)continue;
    out.push({{selector:path(el),tag:el.tagName.toLowerCase(),role:el.getAttribute('role')||null,text:((el.innerText||el.value||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'').trim()).slice(0,120),href:el.href||null}});
  }}
  return JSON.stringify(out);
}})())"#
    )
}

pub async fn act(
    app: tauri::AppHandle,
    manager: &BrowserManager,
    sid: &str,
    aid: &str,
    op: Value,
) -> Result<(), String> {
    let surface = surface_for(&app, manager, sid, aid)?;
    let kind = op
        .get("type")
        .and_then(Value::as_str)
        .ok_or("Action type required")?;
    let js = match kind {
        "click" => {
            let selector = op
                .get("selector")
                .and_then(Value::as_str)
                .ok_or("Selector required")?;
            validate_selector(selector)?;
            format!(
                "(()=>{{const el=document.querySelector({s});if(!el)return 'no match';el.scrollIntoView({{block:'center'}});el.click();return 'ok';}})()",
                s = js_str(selector)
            )
        }
        "type" => {
            let selector = op
                .get("selector")
                .and_then(Value::as_str)
                .ok_or("Selector required")?;
            let text = op.get("text").and_then(Value::as_str).ok_or("Text required")?;
            validate_selector(selector)?;
            validate_text(text)?;
            format!(
                r#"(()=>{{const el=document.querySelector({s});if(!el)return 'no match';el.focus();const v={t};const proto=(el instanceof HTMLTextAreaElement)?HTMLTextAreaElement.prototype:(el instanceof HTMLInputElement)?HTMLInputElement.prototype:null;if(proto){{const set=Object.getOwnPropertyDescriptor(proto,'value').set;set.call(el,v);}}else{{el.textContent=v;}}el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));return 'ok';}})()"#,
                s = js_str(selector),
                t = js_str(text)
            )
        }
        "scroll" => {
            let dx = op.get("dx").and_then(Value::as_i64).unwrap_or(0);
            let dy = op.get("dy").and_then(Value::as_i64).unwrap_or(0);
            if !(-MAX_SCROLL_PIXELS..=MAX_SCROLL_PIXELS).contains(&dx)
                || !(-MAX_SCROLL_PIXELS..=MAX_SCROLL_PIXELS).contains(&dy)
            {
                return Err("Scroll distance out of bounds".into());
            }
            format!("window.scrollBy({dx},{dy});'ok'")
        }
        "press" => {
            let key = op.get("key").and_then(Value::as_str).ok_or("Key required")?;
            const ALLOWED: [&str; 13] = [
                "Enter",
                "Escape",
                "Tab",
                "Backspace",
                "Delete",
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
                "PageUp",
                "PageDown",
                "Home",
                "End",
            ];
            if !ALLOWED.contains(&key) {
                return Err("Key not in allowlist".into());
            }
            format!(
                r#"(()=>{{const t=document.activeElement||document.body;for(const ty of ['keydown','keyup']){{t.dispatchEvent(new KeyboardEvent(ty,{{key:{k},bubbles:true,cancelable:true}}));}}return 'ok';}})()"#,
                k = js_str(key)
            )
        }
        _ => return Err("Unsupported browser action".into()),
    };
    eval_expect_ok(&surface, js).await
}

/// Real compositor screenshot of the owned WebView2 surface (PNG via
/// `CapturePreview`). Size and PNG structure are validated before returning.
pub async fn screenshot(
    app: tauri::AppHandle,
    manager: &BrowserManager,
    sid: &str,
    aid: &str,
) -> Result<Value, String> {
    let surface = surface_for(&app, manager, sid, aid)?;
    let png = webview2::capture_png(surface.window.clone()).await?;
    let (width, height) = png_dims(&png).ok_or("Surface capture did not produce a valid PNG")?;
    Ok(json!({
        "format": "png",
        "method": "webview2-capture-preview",
        "width": width,
        "height": height,
        "byteCount": png.len(),
        "dataBase64": STANDARD.encode(&png),
    }))
}

/// Deletes the isolated profile of a closed surface. Refuses while the surface
/// is open and never leaves the app-owned browser-profiles root.
pub fn clear_data(
    app: &tauri::AppHandle,
    manager: &BrowserManager,
    sid: &str,
    aid: &str,
) -> Result<Value, String> {
    let label = browser_label(sid, aid)?;
    if manager.surfaces.lock().contains_key(&label) || app.get_webview_window(&label).is_some() {
        return Err("Close the browser surface before clearing its data".into());
    }
    let root = app_data_root(app)?;
    let dir = profile_dir(&root, sid, aid)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Owned root unavailable: {e}"))?;
    let canonical_dir = dir
        .canonicalize()
        .map_err(|_| "No browser profile data to clear".to_string())?;
    if !canonical_dir.starts_with(&canonical_root) {
        return Err("Refusing to clear data outside the app-owned root".into());
    }
    let meta = std::fs::symlink_metadata(&canonical_dir).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Refusing to clear a non-owned profile path".into());
    }
    std::fs::remove_dir_all(&canonical_dir).map_err(|e| format!("Profile clear failed: {e}"))?;
    Ok(json!({"cleared": true, "path": canonical_dir.to_string_lossy()}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_policy_accepts_https_and_loopback_only() {
        assert!(safe_browser_url("https://example.com/path?q=1").is_ok());
        assert!(safe_browser_url("http://localhost:8080/").is_ok());
        assert!(safe_browser_url("http://127.0.0.1/").is_ok());
        assert!(safe_browser_url("http://example.com/").is_err());
        assert!(safe_browser_url("file:///C:/Windows/System32/config/sam").is_err());
        assert!(safe_browser_url("javascript:alert(1)").is_err());
        assert!(safe_browser_url("data:text/html,<script>x</script>").is_err());
        assert!(safe_browser_url("https://user:pass@example.com/").is_err());
        assert!(safe_browser_url("https://example.com/").unwrap().host_str().is_some());
        assert!(safe_browser_url("").is_err());
        assert!(safe_browser_url(&format!("https://example.com/{}", "a".repeat(MAX_URL_LEN))).is_err());
        assert!(url_allowed("https://ok.example/"));
        assert!(!url_allowed("ftp://files.example/"));
    }

    #[test]
    fn owner_labels_reject_traversal() {
        assert!(browser_label("s1", "a1").is_ok());
        assert!(browser_label("../s1", "a1").is_err());
        assert!(browser_label("s1", "a1/../../b").is_err());
    }

    #[test]
    fn profile_paths_stay_under_root() {
        let root = std::path::Path::new("C:\\canopi-data");
        let dir = profile_dir(root, "sessA", "agentB").unwrap();
        assert!(dir.starts_with(root));
        assert!(dir.ends_with("browser-profiles\\sessA\\agentB")
            || dir.ends_with("browser-profiles/sessA/agentB"));
        assert!(profile_dir(root, "../evil", "a").is_err());
    }

    #[test]
    fn selector_and_text_bounds() {
        assert!(validate_selector("#app > div:nth-of-type(2)").is_ok());
        assert!(validate_selector("").is_err());
        assert!(validate_selector(&"a".repeat(MAX_SELECTOR_LEN + 1)).is_err());
        assert!(validate_selector("div\nonclick").is_err());
        assert!(validate_text(&"x".repeat(MAX_TEXT_LEN)).is_ok());
        assert!(validate_text(&"x".repeat(MAX_TEXT_LEN + 1)).is_err());
    }

    #[test]
    fn js_strings_are_json_quoted() {
        assert_eq!(js_str("a\"b"), "\"a\\\"b\"");
        assert_eq!(js_str("</script>"), "\"</script>\"");
    }

    /// policy_before_navigation: install failure closes, zero navigate.
    #[test]
    fn policy_before_navigation_install_fail_closes_no_navigate() {
        let mut close_count = 0;
        let mut nav_count = 0;
        let install = async { Err::<(), String>("hook registration failed".into()) };
        let close = || { close_count += 1; Ok::<(), String>(()) };
        let navigate = || { nav_count += 1; Ok(()) };
        let rt = tokio::runtime::Runtime::new().unwrap();
        let res = rt.block_on(policy_before_navigation(install, close, navigate));
        assert!(res.as_ref().err().unwrap().contains("Browser policy hooks failed: hook registration failed"));
        assert_eq!(close_count, 1, "close must be called on install failure");
        assert_eq!(nav_count, 0, "navigate must NOT be called on install failure");
    }

    /// policy_before_navigation: install success runs navigate, no close.
    #[test]
    fn policy_before_navigation_install_success_navigates_no_close() {
        let mut close_count = 0;
        let mut nav_count = 0;
        let install = async { Ok(()) };
        let close = || { close_count += 1; Ok::<(), String>(()) };
        let navigate = || { nav_count += 1; Ok(()) };
        let rt = tokio::runtime::Runtime::new().unwrap();
        let res = rt.block_on(policy_before_navigation(install, close, navigate));
        assert!(res.is_ok());
        assert_eq!(close_count, 0, "close must NOT be called on success");
        assert_eq!(nav_count, 1, "navigate must be called exactly once on success");
    }

    /// Failed initial navigation retires the newly created surface too.
    #[test]
    fn policy_before_navigation_navigate_fail_returns_err() {
        let mut close_count = 0;
        let mut nav_count = 0;
        let install = async { Ok(()) };
        let close = || { close_count += 1; Ok::<(), String>(()) };
        let navigate = || { nav_count += 1; Err("navigation failed".into()) };
        let rt = tokio::runtime::Runtime::new().unwrap();
        let res = rt.block_on(policy_before_navigation(install, close, navigate));
        assert_eq!(res.as_ref().err().unwrap(), "navigation failed");
        assert_eq!(close_count, 1, "close must retire a surface whose initial navigation fails");
        assert_eq!(nav_count, 1, "navigate attempted once");
    }
}
