//! Native capability slice: real ConPTY terminals and agent-owned WebView2
//! browser surfaces.
//!
//! Audit notes (v0.3 → v1.0):
//! - The old reader thread never reaped naturally exited shells, so a dead
//!   terminal kept its id forever (`alreadyOpen: true`) and exit events carried
//!   no real status. Both are fixed: exit codes come from `child.wait()` and
//!   the registry entry is always removed when the reader ends.
//! - Racing opens of the same id could spawn an orphan shell; the registry is
//!   now re-checked before any process is spawned and insert is atomic.
//! - `pty_close` is idempotent; explicit close and natural exit both surface
//!   exactly one exit event (from the reader thread).
//! - Browser surfaces are registered per session+agent with isolated WebView2
//!   profiles and a real control bridge (navigate/state/read/act/screenshot);
//!   ownership, URL policy, popup and permission policy are enforced in the
//!   backend, not by disabled UI. No external Chrome is ever launched and
//!   screenshots are genuine `CapturePreview` compositor captures.
use std::sync::LazyLock;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use tauri::Emitter;

pub mod browser;
pub mod terminal;
mod webview2;

use browser::BrowserManager;
use terminal::{TerminalOpen, TerminalSink};

pub use terminal::{close_session_terminals, TerminalManager};

/// App-exit teardown: closes every remaining terminal of every session.
pub fn close_all_terminals(state: &TerminalManager) -> usize {
    terminal::close_all_terminals(state)
}

/// Production terminal event sink: bridges terminal lifecycle to Tauri events
/// consumed by the frontend terminal dock.
struct AppSink {
    app: tauri::AppHandle,
}

impl TerminalSink for AppSink {
    fn on_data(&self, session_key: &str, terminal_id: &str, seq: u64, data: Vec<u8>, replay: bool) {
        let _ = self.app.emit(
            "cnp-pty-data",
            json!({
                "sessionKey": session_key,
                "terminalId": terminal_id,
                "seq": seq,
                "replay": replay,
                "dataBase64": STANDARD.encode(&data),
            }),
        );
    }
    fn on_exit(&self, session_key: &str, terminal_id: &str, exit_code: Option<i32>) {
        let _ = self.app.emit(
            "cnp-pty-exit",
            json!({
                "sessionKey": session_key,
                "terminalId": terminal_id,
                // Real child exit status (e.g. 7, or 0xC000013A for Ctrl+C on
                // Windows) captured from `child.wait()`; null only when the
                // process could not be waited on.
                "exitCode": exit_code,
            }),
        );
    }
}

fn app_sink(app: &tauri::AppHandle) -> std::sync::Arc<dyn TerminalSink> {
    std::sync::Arc::new(AppSink { app: app.clone() })
}

static BROWSERS: LazyLock<BrowserManager> = LazyLock::new(BrowserManager::default);

fn browsers() -> &'static BrowserManager {
    &BROWSERS
}

// ---------------------------------------------------------------------------
// Terminal commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn pty_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, TerminalManager>,
    session_key: String,
    terminal_id: String,
    project_path: String,
    shell: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<Value, String> {
    terminal::open_terminal(
        &state,
        app_sink(&app),
        TerminalOpen { session_key, terminal_id, project_path, shell, rows, cols },
    )
}

#[tauri::command]
pub async fn pty_write(
    state: tauri::State<'_, TerminalManager>,
    session_key: String,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    terminal::write_terminal(&state, &session_key, &terminal_id, &data)
}

#[tauri::command]
pub async fn pty_resize(
    state: tauri::State<'_, TerminalManager>,
    session_key: String,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    terminal::resize_terminal(&state, &session_key, &terminal_id, rows, cols)
}

#[tauri::command]
pub async fn pty_close(
    state: tauri::State<'_, TerminalManager>,
    session_key: String,
    terminal_id: String,
) -> Result<(), String> {
    terminal::close_terminal(&state, &session_key, &terminal_id).map(|_| ())
}

/// Forwards `interrupt` (real Ctrl+C byte) or `eof` (Ctrl+D byte) to a live
/// terminal owned by the session.
#[tauri::command]
pub async fn pty_signal(
    state: tauri::State<'_, TerminalManager>,
    session_key: String,
    terminal_id: String,
    kind: String,
) -> Result<(), String> {
    terminal::signal_terminal(&state, &session_key, &terminal_id, &kind)
}

/// Live terminals of one session (ids, liveness, size, scrollback accounting).
#[tauri::command]
pub async fn pty_list(
    state: tauri::State<'_, TerminalManager>,
    session_key: String,
) -> Result<Value, String> {
    let terminals = terminal::list_terminals(&state, &session_key)?;
    Ok(json!({ "sessionKey": session_key, "terminals": terminals }))
}

/// Session teardown: closes every terminal owned by `session_key`.
#[tauri::command]
pub async fn pty_close_session(
    state: tauri::State<'_, TerminalManager>,
    session_key: String,
) -> Result<Value, String> {
    let closed = terminal::close_session_terminals(&state, &session_key);
    Ok(json!({ "sessionKey": session_key, "closed": closed }))
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
