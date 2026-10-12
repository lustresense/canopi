//! Native capability slice: agent-owned WebView2 browser surfaces.
//!
//! Audit notes (v0.3 → v1.0):
//! - Browser surfaces are registered per session+agent with isolated WebView2
//!   profiles and a real control bridge (navigate/state/read/act/screenshot);
//!   ownership, URL policy, popup and permission policy are enforced in the
//!   backend, not by disabled UI. No external Chrome is ever launched and
//!   screenshots are genuine `CapturePreview` compositor captures.
use std::sync::LazyLock;

use serde_json::{json, Value};

pub mod browser;
mod webview2;

use browser::BrowserManager;

static BROWSERS: LazyLock<BrowserManager> = LazyLock::new(BrowserManager::default);

fn browsers() -> &'static BrowserManager {
    &BROWSERS
}

// ---------------------------------------------------------------------------
// Browser commands (agent-owned WebView2 surfaces)
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn browser_open(
    app: tauri::AppHandle,
    session_key: String,
    agent_id: String,
    url: String,
) -> Result<Value, String> {
    browser::open(app, browsers(), &session_key, &agent_id, &url).await
}

#[tauri::command]
pub async fn browser_close(session_key: String, agent_id: String) -> Result<Value, String> {
    let closed = browser::close(browsers(), &session_key, &agent_id)?;
    Ok(json!({ "closed": closed }))
}

#[tauri::command]
pub async fn browser_navigate(
    app: tauri::AppHandle,
    session_key: String,
    agent_id: String,
    url: String,
) -> Result<(), String> {
    browser::navigate(app, browsers(), &session_key, &agent_id, &url).await
}

#[tauri::command]
pub async fn browser_reload(
    app: tauri::AppHandle,
    session_key: String,
    agent_id: String,
) -> Result<(), String> {
    browser::reload(app, browsers(), &session_key, &agent_id).await
}

/// `{url, title, ready}` read from the live page.
#[tauri::command]
pub async fn browser_state(
    app: tauri::AppHandle,
    session_key: String,
    agent_id: String,
) -> Result<Value, String> {
    browser::state(app, browsers(), &session_key, &agent_id).await
}

/// Page reads. `kind`: `title` | `url` | `text` | `html` | `interactive`.
/// All reads are bounded; `interactive` returns reusable CSS selectors.
#[tauri::command]
pub async fn browser_read(
    app: tauri::AppHandle,
    session_key: String,
    agent_id: String,
    kind: String,
) -> Result<Value, String> {
    browser::read(app, browsers(), &session_key, &agent_id, &kind).await
}

/// Page actions. `op` is one of:
/// `{type:"click",selector}`, `{type:"type",selector,text}`,
/// `{type:"scroll",dx,dy}`, `{type:"press",key}` (small key allowlist).
#[tauri::command]
pub async fn browser_act(
    app: tauri::AppHandle,
    session_key: String,
    agent_id: String,
    op: Value,
) -> Result<(), String> {
    browser::act(app, browsers(), &session_key, &agent_id, op).await
}

/// Real WebView2 compositor screenshot (PNG, base64) of the owned surface.
#[tauri::command]
pub async fn browser_screenshot(
    app: tauri::AppHandle,
    session_key: String,
    agent_id: String,
) -> Result<Value, String> {
    browser::screenshot(app, browsers(), &session_key, &agent_id).await
}

/// Deletes the isolated profile of a closed surface (explicit user/agent
/// action; refuses while the surface is open or outside the owned root).
#[tauri::command]
pub async fn browser_clear_data(
    app: tauri::AppHandle,
    session_key: String,
    agent_id: String,
) -> Result<Value, String> {
    browser::clear_data(&app, browsers(), &session_key, &agent_id)
}

// ---------------------------------------------------------------------------
// Teardown entry points (called by the app lifecycle in main.rs)
// ---------------------------------------------------------------------------

/// Closes every registered browser surface. Safe to call at app exit.
pub fn close_all_browsers() -> usize {
    browser::close_all(browsers())
}

/// Session teardown: closes every browser surface owned by `session_key`.
pub fn close_session_browsers(session_key: &str) -> usize {
    browser::close_session(browsers(), session_key)
}
