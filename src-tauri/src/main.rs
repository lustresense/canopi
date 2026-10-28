#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod provider_endpoint;
mod rpc_framing;
mod native;

use fs2::FileExt;

use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, atomic::{AtomicU64, Ordering}},
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex},
    time::{timeout, Duration},
};

#[derive(Default)]
struct Supervisor {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    request_sequence: AtomicU64,
    generation_sequence: AtomicU64,
}

struct Session {
    generation: u64,
    /// Outbound physical-frame cap from the engine's `ready` frame (`maxFrameBytes`),
    /// clamped to the hard 1 MiB cap. Set once when `ready` is parsed.
    max_frame_bytes: AtomicU64,
    input: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    ready: Mutex<Option<oneshot::Sender<Result<Value, String>>>>,
    ui_requests: Mutex<HashSet<String>>,
    // Correlation ids whose client wait timed out but whose admission reply may
    // still arrive; surfaced as rpc_late_response instead of being dropped.
    late: Mutex<HashSet<String>>,
    // Held for this session's lifetime. A second canoPi instance cannot write
    // to the same OMP session file concurrently, even after a process crash.
    _session_lock: File,
    /// Canonicalized session directory path for path containment checks.
    session_dir: PathBuf,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameEnvelope { session_key: String, generation: u64, frame: Value }

fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 64 && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

// Host-side bounds so a misbehaving engine or host cannot grow these without limit.
const MAX_PENDING_REQUESTS: usize = 1024;
const MAX_UI_REQUESTS: usize = 4096;
const MAX_LATE_RESPONSES: usize = 1024;

// Minimal OS environment handed to the engine after env_clear(). PATH is
// inherited so agent-spawned tools resolve like the host shell; provider
// secrets, tokens and the user's global OMP variables are deliberately absent.
const OS_ENV_ALLOWLIST: &[&str] = &[
    "SystemRoot", "SystemDrive", "windir", "COMSPEC", "PATH", "PATHEXT",
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "USERNAME", "TEMP", "TMP",
    "APPDATA", "LOCALAPPDATA",
];

// ============================================================
// ProviderAuthStatus - Unified authentication status for canoPi v0.0.2
// Merges OAuth sessions (from engine SQLite) with YAML config (API keys)
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    ApiKey,
    OAuthBrowser,
    OAuthDeviceCode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionPhase {
    Disconnected,
    AwaitingBrowser,
    AwaitingInput,
    AwaitingDeviceCode,
    Validating,
    Connected,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAuthStatus {
    pub id: String,
    pub name: String,
    pub supported_methods: Vec<AuthMethod>,
    pub active_method: Option<AuthMethod>,
    pub phase: ConnectionPhase,
    pub authenticated: bool,
    pub has_key: bool,
    pub base_url: Option<String>,
    pub active_model_id: Option<String>,
    pub error_message: Option<String>,
    pub last_synced_at: Option<u64>,
}


fn allowed_command(cmd: &Value) -> Result<&str, String> {
    let ty = cmd.get("type").and_then(Value::as_str).ok_or("RPC command type missing")?;
    const ALLOWED: &[&str] = &[
        "negotiate_protocol", "prompt", "steer", "follow_up", "abort", "get_state", "new_session",
        "open_session", "get_available_models", "set_model", "get_subagents",
        "get_subagent_messages", "set_subagent_subscription", "steer_subagent", "cancel_subagent",
        "get_available_commands", "get_messages", "get_messages_page", "get_entries", "get_tree",
        "get_available_thinking_levels", "set_thinking_level", "set_ask_dialog", "set_event_filter",
        "get_login_providers", "login",
    ];
    if !ALLOWED.contains(&ty) { return Err(format!("RPC command not allowlisted: {ty}")); }
    // Native OAuth login: only a narrow providerId is forwarded to the engine.
    if matches!(ty, "login" | "get_login_providers") {
        if ty == "login" {
            let provider_id = cmd.get("providerId").and_then(Value::as_str).ok_or("RPC providerId missing")?;
            if provider_id.is_empty() || provider_id.len() > 64 || !provider_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return Err("RPC providerId invalid (expected [A-Za-z0-9_-], <=64 chars)".into());
            }
        }
    }
    if matches!(ty, "prompt" | "steer" | "follow_up" | "steer_subagent") {
        let msg = cmd.get("message").and_then(Value::as_str).ok_or("RPC message missing")?;
        if msg.trim().is_empty() || msg.len() > 262_144 { return Err("RPC message empty or too large".into()); }
    }
    if matches!(ty, "prompt" | "steer" | "follow_up") {
        if let Some(images) = cmd.get("images") {
            if !images.is_array() || images.as_array().is_some_and(|a| a.len() > 64) {
                return Err("RPC images must be an array of at most 64 items".into());
            }
        }
    }
    // Field shapes below follow the pinned docs/rpc.md canonical command schema.
    match ty {
        "prompt" => {
            if let Some(sb) = cmd.get("streamingBehavior").map(Value::as_str) {
                if !matches!(sb, Some("steer" | "followUp")) { return Err("Invalid prompt streamingBehavior".into()); }
            }
        }
        "steer" | "follow_up" => {
            if cmd.get("streamingBehavior").is_some() { return Err(format!("{ty} does not accept streamingBehavior")); }
        }
        "set_model" => {
            for field in ["provider", "modelId"] {
                if cmd.get(field).and_then(Value::as_str).filter(|v| !v.is_empty() && v.len() <= 256).is_none() {
                    return Err(format!("Invalid model field {field}"));
                }
            }
        }
        "set_thinking_level" => {
            const LEVELS: &[&str] = &["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"];
            match cmd.get("level").and_then(Value::as_str) {
                Some(level) if LEVELS.contains(&level) => {}
                _ => return Err("Invalid thinking level".into()),
            }
        }
        "set_ask_dialog" => {
            if cmd.get("enabled").and_then(Value::as_bool).is_none() { return Err("set_ask_dialog requires boolean enabled".into()); }
        }
        "set_subagent_subscription" => {
            match cmd.get("level").and_then(Value::as_str) {
                Some(level) if matches!(level, "off" | "progress" | "events") => {}
                _ => return Err("Invalid subagent subscription level".into()),
            }
        }
        "set_event_filter" => match cmd.get("events") {
            None => return Err("set_event_filter requires events".into()),
            Some(Value::Null) => {}
            Some(events) => {
                let list = events.as_array().ok_or("set_event_filter events must be an array or null")?;
                if list.len() > 256 || !list.iter().all(|e| e.as_str().is_some_and(|s| s.len() <= 128)) {
                    return Err("set_event_filter events out of bounds".into());
                }
            }
        },
        "cancel_subagent" | "steer_subagent" => {
            if cmd.get("subagentId").and_then(Value::as_str).filter(|v| !v.is_empty() && v.len() <= 256).is_none() {
                return Err("Invalid subagentId".into());
            }
        }
        "get_subagent_messages" => {
            for field in ["subagentId", "sessionFile"] {
                if let Some(v) = cmd.get(field) {
                    if v.as_str().filter(|s| !s.is_empty() && s.len() <= 4096).is_none() { return Err(format!("Invalid {field}")); }
                }
            }
            if let Some(from) = cmd.get("fromByte") {
                if from.as_u64().is_none() { return Err("Invalid fromByte".into()); }
            }
        }
        "get_messages_page" => {
            if let Some(limit) = cmd.get("limit") {
                match limit.as_u64() { Some(n) if (1..=256).contains(&n) => {}, _ => return Err("get_messages_page limit must be 1..=256".into()) }
            }
            if let Some(cursor) = cmd.get("cursor") {
                if cursor.as_str().filter(|c| !c.is_empty() && c.len() <= 4096).is_none() { return Err("Invalid cursor".into()); }
            }
        }
        "new_session" => {
            if let Some(parent) = cmd.get("parentSession") {
                if parent.as_str().filter(|p| !p.is_empty() && p.len() <= 4096).is_none() { return Err("Invalid parentSession".into()); }
            }
        }
        "open_session" => {
            if cmd.get("sessionDir").and_then(Value::as_str).filter(|d| !d.is_empty() && d.len() <= 4096).is_none() {
                return Err("open_session requires sessionDir".into());
            }
        }
        _ => {}
    }
    if let Some(mu) = cmd.get("messageUpdates") {
        if !matches!(mu.as_str(), Some("full" | "delta")) { return Err("Invalid messageUpdates".into()); }
    }
    if ty == "negotiate_protocol" && cmd.get("protocolVersion").and_then(Value::as_u64) != Some(2) {
        return Err("Only RPC protocol 2 can be negotiated".into());
    }
    Ok(ty)
}

fn valid_answers(v: &Value) -> bool {
    let Some(list) = v.as_array() else { return false };
    if list.len() > 64 { return false; }
    list.iter().all(|a| {
        a.get("id").and_then(Value::as_str).is_some_and(|id| !id.is_empty() && id.len() <= 128)
            && a.get("selectedOptions").and_then(Value::as_array).is_some_and(|opts| {
                // Labels must be unique (pinned docs/rpc.md `answers`).
                let mut seen = std::collections::HashSet::new();
                opts.len() <= 64 && opts.iter().all(|o| o.as_str().is_some_and(|s| s.len() <= 1024 && seen.insert(s)))
            })
            && a.get("customInput").map_or(true, |c| c.as_str().is_some_and(|s| s.len() <= 65_536))
    })
}

// Bounded extension-UI reply validation: exactly one payload shape from the
// pinned docs/rpc.md `RpcExtensionUIResponse` schema, never a mixed shape.
fn valid_ui_response(r: &Value) -> bool {
    const PAYLOAD: [&str; 4] = ["value", "confirmed", "cancelled", "answers"];
    let present: Vec<&str> = PAYLOAD.iter().copied().filter(|k| r.get(k).is_some()).collect();
    if present.len() != 1 { return false; }
    if r.get("id").and_then(Value::as_str).is_none_or(|id| id.is_empty() || id.len() > 128) { return false; }
    if let Some(t) = r.get("timedOut") {
        if present[0] != "cancelled" || !t.is_boolean() { return false; }
    }
    match present[0] {
        "value" => r.get("value").and_then(Value::as_str).is_some_and(|s| s.len() <= 262_144),
        "confirmed" => r.get("confirmed").and_then(Value::as_bool).is_some(),
        "cancelled" => r.get("cancelled").is_some_and(|v| v == &Value::Bool(true)),
        "answers" => valid_answers(&r["answers"]),
        _ => false,
    }
}

// Removes `key` only when it still maps to `generation`. A late reader EOF
// must never evict a replacement session's registry entry (PRD D-07).
fn remove_generation<V>(map: &mut HashMap<String, V>, key: &str, generation: u64, current: impl Fn(&V) -> u64) -> bool {
    if map.get(key).map(&current) == Some(generation) { map.remove(key).is_some() } else { false }
}

// Crash marker scan over the bounded stderr tail; raw stderr bytes are never emitted.
fn panic_marker(tail: &[u8]) -> bool {
    const MARKER: &[u8] = b"panicked at";
    tail.windows(MARKER.len()).any(|w| w == MARKER)
}

fn engine_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // This exact bundle path must match `bundle.resources` in tauri.conf.json.
    // No PATH lookup and no fallback to globally installed OMP.
    let name = if cfg!(windows) { "cnp-engine.exe" } else { "cnp-engine" };
    let path = app.path().resource_dir().map_err(|e| e.to_string())?.join("engine").join(name);
    if !path.is_file() { return Err(format!("Bundled cnp engine missing: {}", path.display())); }
    Ok(path)
}

fn app_data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

fn is_symlink_or_reparse(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x00000400;
        meta.file_type().is_symlink() || (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

fn is_recognized_legacy_entry(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        ".canopi-owner"
            | "ebwebview"
            | "webview2"
            | "profile"
            | "sessions"
            | "browser-profiles"
            | "agent"
            | ".canopi.lock"
            | "canopi-uninstall-receipt.json"
            | "models.json"
            | "models.yml"
            | "models.yaml"
            | "config.json"
            | "auth.json"
            | "canopi"
    )
}

// Important upstream behavior: PI_CONFIG_DIR is a *directory name under home*,
// not an arbitrary absolute path. PI_CODING_AGENT_DIR is absolute but affects
// the default profile only. Profile migration and full isolation need smoke tests.
fn owned_root(path: &Path, marker_name: &str) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if is_symlink_or_reparse(&meta) {
        return Err(format!("canoPi data root must not be a symlink or reparse point: {}", path.display()));
    }
    let marker = path.join(marker_name);
    if marker.exists() {
        let marker_meta = std::fs::symlink_metadata(&marker).map_err(|e| e.to_string())?;
        if is_symlink_or_reparse(&marker_meta) {
            return Err(format!("canoPi owner marker must not be a symlink or reparse point: {}", marker.display()));
        }
        let existing = std::fs::read_to_string(&marker).map_err(|e| e.to_string())?;
        if existing.trim() != "app.canopi.desktop" {
            return Err(format!("Existing unowned data root: {}", path.display()));
        }
    } else {
        let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;
        let mut unrecognized = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let entry_path = entry.path();
            let entry_meta = std::fs::symlink_metadata(&entry_path).map_err(|e| e.to_string())?;
            if is_symlink_or_reparse(&entry_meta) {
                return Err(format!("canoPi data root contains symlink or reparse entry: {}", entry_path.display()));
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_recognized_legacy_entry(&name) {
                unrecognized.push(name);
            }
        }
        if !unrecognized.is_empty() {
            return Err(format!("Cannot claim nonempty unowned root: {}. Unrecognized entries: {}", path.display(), unrecognized.join(", ")));
        }
        std::fs::write(&marker, b"app.canopi.desktop\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn engine_profile_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let local = app_data_root(app)?;
    owned_root(&local, ".canopi-owner")?;
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    owned_root(&config, ".canopi-owner")?;
    // Upstream PI_CONFIG_DIR currently resolves relative to HOME. This is a
    // controlled compatibility exception, not a general absolute-path override.
    let home = app.path().home_dir().map_err(|e| e.to_string())?.join(".canopi");
    owned_root(&home, ".canopi-owner")?;
    let dir = local.join("profile").join("agent");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn lock_session(session_dir: &Path) -> Result<File, String> {
    std::fs::create_dir_all(session_dir).map_err(|e| e.to_string())?;
    let path = session_dir.join(".canopi.lock");
    let file = OpenOptions::new().read(true).write(true).create(true).open(&path).map_err(|e| e.to_string())?;
    // A just-stopped engine's reader may still hold this process's lock for a
    // moment after rpc_stop; retry briefly before declaring another owner.
    let mut last: Option<std::io::Error> = None;
    for attempt in 0..8 {
        match file.try_lock_exclusive() {
            Ok(()) => return Ok(file),
            Err(e) => {
                last = Some(e);
                if attempt < 7 { std::thread::sleep(Duration::from_millis(250)); }
            }
        }
    }
    Err(last
        .map(|e| e.to_string())
        .unwrap_or_else(|| "This session is owned by another canoPi process".to_string()))
}

fn emit(app: &tauri::AppHandle, key: &str, generation: u64, frame: Value) {
    let _ = app.emit("cnp-frame", FrameEnvelope { session_key: key.to_string(), generation, frame });
}

#[tauri::command]
fn window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn window_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_start_dragging(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        extern "system" {
            fn ReleaseCapture() -> i32;
            fn SendMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
        }
        const WM_NCLBUTTONDOWN: u32 = 0x00A1;
        const HTCAPTION: usize = 2;
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                ReleaseCapture();
                SendMessageW(hwnd.0 as _, WM_NCLBUTTONDOWN, HTCAPTION, 0);
            }
            return Ok(());
        }
    }
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn runtime_info(app: tauri::AppHandle) -> Value {
    match engine_path(&app) {
        Ok(path) => json!({"available":true,"engine":"cnp-engine","binaryFound":true,"path":path.to_string_lossy(),"mode":"rpc-ui","handshakeVerified":false}),
        Err(error) => json!({"available":false,"engine":"cnp-engine","error":error}),
    }
}

async fn request(session: &Arc<Session>, supervisor: &Supervisor, mut cmd: Value) -> Result<Value, String> {
    let kind = allowed_command(&cmd)?.to_owned();
    let seq = supervisor.request_sequence.fetch_add(1, Ordering::Relaxed);
    let id = format!("cnp-{seq}");
    cmd["id"] = json!(id);
    let line = format!("{}\n", cmd);
    // Outbound frames respect the transport limit advertised by the engine's ready frame.
    let max_frame = session.max_frame_bytes.load(Ordering::Relaxed) as usize;
    if line.as_bytes().len() > max_frame { return Err(format!("RPC outbound command exceeds engine frame limit ({max_frame} bytes)")); }
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = session.pending.lock().await;
        if pending.len() >= MAX_PENDING_REQUESTS { return Err("Too many in-flight RPC requests".into()); }
        pending.insert(id.clone(), tx);
    }
    let write = async {
        let mut stdin = session.input.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await
    }.await;
    if let Err(e) = write {
        session.pending.lock().await.remove(&id);
        return Err(format!("Engine stdin write failed: {e}"));
    }
    // Admission-style commands may still be accepted after the client gives up.
    // Keep their correlation id so the late reply surfaces explicitly instead of
    // being dropped (which would invite a duplicate prompt from the host).
    let track_late = matches!(kind.as_str(), "prompt" | "steer" | "follow_up");
    let wait = match kind.as_str() {
        "prompt" => 35,
        // Model discovery waits for background provider scans (pinned docs/rpc.md).
        "get_available_models" => 60,
        // Native OAuth login waits on a browser round-trip (matches OMP wire timeout).
        "login" => 600,
        _ => 15,
    };
    match timeout(Duration::from_secs(wait), rx).await {
        Ok(Ok(reply)) => Ok(reply),
        Ok(Err(_)) => Err("Engine exited while waiting for RPC response".into()),
        Err(_) => {
            session.pending.lock().await.remove(&id);
            if track_late {
                let mut late = session.late.lock().await;
                if late.len() < MAX_LATE_RESPONSES { late.insert(id); }
            }
            Err(format!("RPC response timeout ({kind}); a late admission reply will surface as rpc_late_response"))
        }
    }
}

async fn checked_request(session: &Arc<Session>, supervisor: &Supervisor, cmd: Value) -> Result<Value, String> {
    let command = cmd.get("type").and_then(Value::as_str).unwrap_or("unknown").to_owned();
    let response = request(session, supervisor, cmd).await?;
    if response.get("success").and_then(Value::as_bool) != Some(true) {
        let error = response.get("error").and_then(Value::as_str).unwrap_or("Unknown engine error");
        return Err(format!("{command}: {error}"));
    }
    Ok(response.get("data").cloned().unwrap_or(Value::Null))
}

// Reads bounded chunks rather than `BufReadExt::lines`, so a malicious or
// broken engine cannot allocate arbitrary memory with an unterminated stdout line.
async fn read_output(
    app: tauri::AppHandle,
    key: String,
    session: Arc<Session>,
    mut output: tokio::process::ChildStdout,
) {
    let generation = session.generation;
    let mut bytes = [0u8; 8192];
    let mut partial = Vec::<u8>::new();
    let mut decoder = rpc_framing::Decoder::default();
    // Physical-frame cap; tightened to the value advertised by the ready frame.
    let mut frame_limit = rpc_framing::MAX_PHYSICAL;
    let mut terminal_error: Option<String> = None;
    'stream: loop {
        let n = match output.read(&mut bytes).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => { terminal_error = Some(format!("Engine stdout read error: {e}")); break; }
        };
        for b in &bytes[..n] {
            if *b != b'\n' {
                partial.push(*b);
                if partial.len() + 1 > frame_limit {
                    terminal_error = Some(format!("Engine stdout frame exceeded {frame_limit} byte frame limit"));
                    break 'stream;
                }
                continue;
            }
            if partial.last() == Some(&b'\r') { partial.pop(); }
            if partial.is_empty() { continue; }
            let frame = decoder.push(&partial);
            partial.clear();
            let frame = match frame {
                Ok(Some(v)) => v,
                Ok(None) => continue,
                Err(e) => { terminal_error = Some(e); break 'stream; }
            };
            if frame.get("type").and_then(Value::as_str) == Some("ready") {
                // Apply advertised transport limits before any later frame is parsed.
                match decoder.set_advertised_limits(&frame) {
                    Ok(limit) => {
                        frame_limit = limit;
                        session.max_frame_bytes.store(limit as u64, Ordering::Relaxed);
                    }
                    Err(e) => { terminal_error = Some(e); break 'stream; }
                }
                if let Some(tx) = session.ready.lock().await.take() { let _ = tx.send(Ok(frame.clone())); }
            }
            if frame.get("type").and_then(Value::as_str) == Some("response") {
                if let Some(id) = frame.get("id").and_then(Value::as_str) {
                    if session.late.lock().await.remove(id) {
                        // The client wait already timed out: surface the late
                        // admission reply so the host can reconcile, not resend.
                        emit(&app, &key, generation, json!({"type":"rpc_late_response","id":id,"response":frame.clone()}));
                    } else if let Some(tx) = session.pending.lock().await.remove(id) {
                        let _ = tx.send(frame.clone());
                    }
                }
            }
            if frame.get("type").and_then(Value::as_str) == Some("extension_ui_request") {
                if frame.get("method").and_then(Value::as_str) == Some("cancel") {
                    if let Some(id) = frame.get("targetId").and_then(Value::as_str) { session.ui_requests.lock().await.remove(id); }
                } else if let Some(id) = frame.get("id").and_then(Value::as_str) {
                    // Notifications are one-way and must not remain in pending registry.
                    if !matches!(frame.get("method").and_then(Value::as_str), Some("notify" | "setStatus" | "setWidget" | "setTitle" | "set_editor_text" | "open_url")) {
                        let mut ui = session.ui_requests.lock().await;
                        if ui.len() < MAX_UI_REQUESTS { ui.insert(id.to_owned()); }
                    }
                }
            }
            emit(&app, &key, generation, frame);
        }
    }
    if terminal_error.is_none() && !partial.is_empty() { terminal_error = Some("RPC EOF mid-frame".into()); }
    if terminal_error.is_none() { terminal_error = decoder.finish().err(); }
    if let Some(error) = &terminal_error {
        emit(&app, &key, generation, json!({"type":"transport_error","error":error}));
        // Do not leave an orphaned engine running after protocol corruption.
        let _ = session.child.lock().await.start_kill();
    }
    if let Some(tx) = session.ready.lock().await.take() {
        let _ = tx.send(Err(terminal_error.clone().unwrap_or_else(|| "Engine exited before ready".into())));
    }
    let pending = std::mem::take(&mut *session.pending.lock().await);
    for (id, tx) in pending { let _ = tx.send(json!({"type":"response","id":id,"success":false,"error":"Engine transport closed"})); }
    // Transport closed: no late reply can still arrive for this generation.
    session.late.lock().await.clear();
    // An exited child must not poison the registry. Only remove THIS exact
    // generation or a late EOF could evict a new replacement process.
    let unexpected = {
        let state = app.state::<Supervisor>();
        let mut registry = state.sessions.lock().await;
        remove_generation(&mut registry, &key, generation, |s| s.generation)
    };
    // Engine died while still the registry owner: tear down this session's
    // PTY and browser surfaces too. rpc_stop and app exit do their own.
    if unexpected { teardown_session_resources(&app, &key); }
    // Reap the child for its real termination status (PRD 5.1). rpc_stop may
    // race this wait; tokio caches the first exit status for the other caller.
    let code = {
        let mut child = session.child.lock().await;
        match timeout(Duration::from_secs(10), child.wait()).await {
            Ok(Ok(status)) => status.code(),
            _ => {
                let _ = child.start_kill();
                let _ = timeout(Duration::from_secs(5), child.wait()).await;
                None
            }
        }
    };
    emit(&app, &key, generation, json!({"type":"runtime_exit", "unexpected":unexpected, "code":code}));
}

#[tauri::command]
async fn rpc_start(app: tauri::AppHandle, state: tauri::State<'_, Supervisor>, session_key: String, project_path: String) -> Result<Value, String> {
    if !valid_key(&session_key) { return Err("Invalid session key".into()); }
    if let Some(existing) = state.sessions.lock().await.get(&session_key).cloned() {
        return Ok(json!({"sessionKey":session_key,"generation":existing.generation,"alreadyRunning":true}));
    }
    let root = PathBuf::from(&project_path).canonicalize().map_err(|e| format!("Invalid project path: {e}"))?;
    if !root.is_dir() { return Err("Project path must be an existing directory".into()); }
    let engine = engine_path(&app)?;
    let profile_dir = engine_profile_dir(&app)?;
    let session_dir = app_data_root(&app)?.join("sessions").join(&session_key);
    init_trusted_registry(&profile_dir)?;
    let lock = lock_session(&session_dir)?;
    // PI_CONFIG_DIR uses a *relative directory name under the user's home*.
    // The fork must eventually relocate the entire root into canoPi AppPaths.
    // Spawn with a cleared environment: only an explicit OS allowlist and the
    // canoPi PI_* profile variables reach the engine. The user's global OMP
    // environment and provider secrets cannot leak into the runtime.
    let mut child = {
        let mut cmd = Command::new(&engine);
        cmd.arg("--mode").arg("rpc-ui").current_dir(&root).env_clear();
        for key in OS_ENV_ALLOWLIST {
            if let Some(v) = std::env::var_os(key) { cmd.env(key, v); }
        }
        // Explicitly empty envs outrank values injected by project .env files.
        cmd.env("OMP_PROFILE", "").env("PI_PROFILE", "")
            .env("PI_CONFIG_FILES", "").env("PI_CODING_AGENT_SESSION_DIR", "")
            .env("PI_CODING_AGENT_DIR", &profile_dir)
            .env("PI_CONFIG_DIR", ".canopi")
            .env("CANOPI_STRICT_ENDPOINTS", "1")
            .env("CANOPI_TRUSTED_ENDPOINTS_PATH", profile_dir.join("trusted_endpoints.json"))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000);
        cmd.spawn()
            .map_err(|e| format!("Could not spawn cnp engine: {e}"))?
    };
    let input = child.stdin.take().ok_or("Engine stdin unavailable")?;
    let output = child.stdout.take().ok_or("Engine stdout unavailable")?;
    let mut stderr = child.stderr.take().ok_or("Engine stderr unavailable")?;
    let (tx, rx) = oneshot::channel();
    let generation = state.generation_sequence.fetch_add(1, Ordering::Relaxed) + 1;
    let session = Arc::new(Session {
        generation,
        max_frame_bytes: AtomicU64::new(rpc_framing::MAX_PHYSICAL as u64),
        input: Mutex::new(input),
        child: Mutex::new(child),
        pending: Mutex::new(HashMap::new()),
        ready: Mutex::new(Some(tx)),
        ui_requests: Mutex::new(HashSet::new()),
        late: Mutex::new(HashSet::new()),
        _session_lock: lock,
        session_dir: session_dir.clone(),
    });
    {
        let mut sessions = state.sessions.lock().await;
        if let Some(other) = sessions.get(&session_key) {
            let other_generation = other.generation;
            drop(sessions);
            let _ = session.child.lock().await.kill().await;
            return Ok(json!({"sessionKey":session_key,"generation":other_generation,"alreadyRunning":true}));
        }
        sessions.insert(session_key.clone(), session.clone());
    }
    let k = session_key.clone();
    let app2 = app.clone();
    let session_reader = session.clone();
    tokio::spawn(async move { read_output(app2, k, session_reader, output).await; });
    let app3 = app.clone();
    let k3 = session_key.clone();
    tokio::spawn(async move {
        let mut bytes = [0u8; 4096];
        let mut count: u64 = 0;
        let mut lines: u64 = 0;
        let mut tail = Vec::<u8>::new();
        loop {
            match stderr.read(&mut bytes).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    count = count.saturating_add(n as u64);
                    lines = lines.saturating_add(bytes[..n].iter().filter(|b| **b == b'\n').count() as u64);
                    tail.extend_from_slice(&bytes[..n]);
                    // Keep only a bounded tail for crash-marker detection.
                    if tail.len() > 8192 { tail.drain(..tail.len() - 8192); }
                }
            }
        }
        // stderr may contain secrets or file contents. Keep draining it so the
        // engine never blocks on a full pipe, but only bounded counters and a
        // crash marker leave this process - never raw bytes.
        if count > 0 {
            emit(&app3, &k3, generation, json!({"type":"stderr_redacted","byteCount":count,"lineCount":lines,"panicked":panic_marker(&tail)}));
        }
    });
    let started = async {
        let ready = match timeout(Duration::from_secs(12), rx).await {
            Ok(Ok(Ok(frame))) => frame,
            Ok(Ok(Err(error))) => return Err(error),
            Ok(Err(_)) => return Err("Engine closed before handshake".into()),
            Err(_) => return Err("Engine ready handshake timeout".into()),
        };
        let versions = ready.get("supportedProtocolVersions").and_then(Value::as_array).cloned().unwrap_or_default();
        if !versions.iter().any(|x| x.as_u64() == Some(2)) { return Err("Bundled engine does not support required lossless RPC protocol v2".into()); }
        checked_request(&session, &state, json!({"type":"negotiate_protocol","protocolVersion":2})).await?;
        let opened = checked_request(&session, &state, json!({"type":"open_session","sessionDir":session_dir.to_string_lossy()})).await?;
        let snapshot = checked_request(&session, &state, json!({"type":"get_state"})).await?;
        Ok(json!({"sessionKey":session_key,"generation":generation,"protocolVersion":2,"opened":opened,"state":snapshot}))
    }.await;
    match started {
        Err(e) => {
            {
                // Only retire OUR generation: a concurrent start may already own the key.
                let mut registry = state.sessions.lock().await;
                remove_generation(&mut registry, &session_key, generation, |s| s.generation);
            }
            let _ = session.child.lock().await.kill().await;
            Err(e)
        }
        ok => ok,
    }
}

#[tauri::command]
async fn rpc_send(state: tauri::State<'_, Supervisor>, session_key: String, command: Value, expected_generation: Option<u64>) -> Result<Value, String> {
    let ty = allowed_command(&command)?;
    if ty == "open_session" || ty == "negotiate_protocol" || ty == "new_session" {
        return Err("Session directories and transport negotiation are Rust-owned".into());
    }
    let session = state.sessions.lock().await.get(&session_key).cloned().ok_or("Session engine not running")?;
    if expected_generation.is_none() { return Err("Session generation required".into()); }
    if expected_generation.is_some_and(|g| g != session.generation) { return Err("Session generation changed; reload state".into()); }
    
    // Intercept get_subagent_messages to enforce session file containment
    if ty == "get_subagent_messages" {
        if let Some(session_file) = command.get("sessionFile").and_then(Value::as_str) {
            let canonical = provider_endpoint::canonicalize_session_file(&session.session_dir, session_file)?;
            let mut cmd = command;
            cmd["sessionFile"] = Value::String(canonical.to_string_lossy().to_string());
            return request(&session, &state, cmd).await;
        }
    }
    
    request(&session, &state, command).await
}

#[tauri::command]
async fn rpc_ui_reply(state: tauri::State<'_, Supervisor>, session_key: String, response: Value, expected_generation: Option<u64>) -> Result<(), String> {
    if response.get("type").and_then(Value::as_str) != Some("extension_ui_response") { return Err("Invalid extension response type".into()); }
    if !valid_ui_response(&response) { return Err("Invalid extension UI response shape".into()); }
    let id = response.get("id").and_then(Value::as_str).unwrap_or_default();
    let session = state.sessions.lock().await.get(&session_key).cloned().ok_or("Session engine not running")?;
    if expected_generation.is_none() { return Err("Session generation required".into()); }
    if expected_generation.is_some_and(|g| g != session.generation) { return Err("Session generation changed; UI request expired".into()); }
    if !session.ui_requests.lock().await.remove(id) { return Err("Unknown or expired extension request".into()); }
    let line = format!("{}\n", response);
    let max_frame = session.max_frame_bytes.load(Ordering::Relaxed) as usize;
    if line.as_bytes().len() > max_frame { return Err(format!("RPC UI reply exceeds engine frame limit ({max_frame} bytes)")); }
    // Bind first so the stdin guard drops before `session` at fn end (E0597).
    let written = session.input.lock().await.write_all(line.as_bytes()).await.map_err(|e| e.to_string());
    written
}

async fn stop_engine(session: Arc<Session>) -> Result<(), String> {
    // Closing stdin lets OMP persist its append-session log and flush stdout.
    let _ = session.input.lock().await.shutdown().await;
    let mut child = session.child.lock().await;
    match timeout(Duration::from_secs(10), child.wait()).await {
        Ok(Ok(_)) => Ok(()),
        _ => child.kill().await.map_err(|e| format!("Engine force-stop failed: {e}")),
    }
}

// Session teardown closes browser surfaces owned by a session.
fn teardown_session_resources(_app: &tauri::AppHandle, session_key: &str) {
    native::close_session_browsers(session_key);
}

#[tauri::command]
async fn rpc_stop(app: tauri::AppHandle, state: tauri::State<'_, Supervisor>, session_key: String) -> Result<(), String> {
    if let Some(session) = state.sessions.lock().await.remove(&session_key) {
        stop_engine(session).await?;
    }
    // Session teardown: browser surfaces belong to the session, not
    // to this engine process; close them even if the engine was already gone.
    teardown_session_resources(&app, &session_key);
    Ok(())
}

// Native Windows 11 title bar: vibrant light-blue caption with dark ink text
// via DWM (DWMWA_CAPTION_COLOR/DWMWA_TEXT_COLOR, build 22000+). The API is
// resolved at runtime through GetProcAddress, so there is no link-time dwmapi
// dependency; older builds that reject the attribute (E_INVALIDARG) simply
// keep the standard title bar color.
#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryW(name: *const u16) -> *mut core::ffi::c_void;
    fn GetProcAddress(module: *mut core::ffi::c_void, name: *const u8) -> *mut core::ffi::c_void;
}

#[cfg(windows)]
fn apply_native_titlebar_colors(window: &tauri::WebviewWindow) {
    use core::ffi::c_void;
    type DwmSetWindowAttributeFn =
        unsafe extern "system" fn(hwnd: isize, attribute: u32, value: *const c_void, size: u32) -> i32;
    const DWMWA_CAPTION_COLOR: u32 = 35;
    const DWMWA_TEXT_COLOR: u32 = 36;
    // COLORREF is 0x00BBGGRR: caption RGB(140, 205, 213), text RGB(0, 0, 0).
    const CAPTION_COLOR: u32 = 0x00D5_CD8C;
    const TEXT_COLOR: u32 = 0x0000_0000;
    let Ok(hwnd) = window.hwnd() else { return };
    let hwnd = hwnd.0 as isize;
    unsafe {
        // L"dwmapi.dll"
        const DWMAPI_DLL: [u16; 11] = [100, 119, 109, 97, 112, 105, 46, 100, 108, 108, 0];
        let module = LoadLibraryW(DWMAPI_DLL.as_ptr());
        if module.is_null() { return; }
        let raw = GetProcAddress(module, b"DwmSetWindowAttribute\0".as_ptr());
        if raw.is_null() { return; }
        let dwm_set_window_attribute: DwmSetWindowAttributeFn = core::mem::transmute(raw);
        dwm_set_window_attribute(hwnd, DWMWA_CAPTION_COLOR, &CAPTION_COLOR as *const u32 as *const c_void, 4);
        dwm_set_window_attribute(hwnd, DWMWA_TEXT_COLOR, &TEXT_COLOR as *const u32 as *const c_void, 4);
    }
}


/// Validate an http(s) URL that the host may hand to the OS opener.
/// Rejects anything that is not a plain http(s) URL with no whitespace,
/// control characters, or embedded quotes (defence-in-depth for the OAuth
/// callback/authorize links produced by the engine).
fn valid_external_url(url: &str) -> bool {
    if url.is_empty() || url.len() > 2048 { return false; }
    if !url.starts_with("http://") && !url.starts_with("https://") { return false; }
    if url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '\'' || c == '`') { return false; }
    true
}

/// Open an external http(s) URL with the platform handler, spawning WITHOUT a
/// shell so OAuth URLs carrying `&`/`?`/`=` are passed verbatim (never via
/// `cmd /C start`, which re-splits on `&` and allows argument injection).
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !valid_external_url(&url) { return Err("Invalid external URL (http/https only, no whitespace)".into()); }
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("rundll32.exe");
    #[cfg(target_os = "windows")]
    { cmd.arg("url.dll,FileProtocolHandler").arg(&url); }
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "macos")]
    { cmd.arg(&url); }
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    #[cfg(all(unix, not(target_os = "macos")))]
    { cmd.arg(&url); }
    let spawned = cmd.spawn().map_err(|e| format!("Failed to open external URL: {e}"))?;
    // Detach: do not leave a zombie waiting on the opener's exit status.
    std::mem::drop(spawned);
    Ok(())
}


fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Supervisor::default())
        .invoke_handler(tauri::generate_handler![runtime_info, rpc_start, rpc_send, rpc_ui_reply, rpc_stop, window_minimize, window_maximize, window_close, window_start_dragging, native::browser_open, native::browser_close, native::browser_navigate, native::browser_reload, native::browser_state, native::browser_read, native::browser_act, native::browser_screenshot, native::browser_clear_data, provider_import_preview, provider_import_models, provider_save_key, provider_status, provider_trust_endpoint, provider_revoke_endpoint_trust, provider_list_trusted_endpoints, provider_validate_base_url, data_root_status, recover_data_root, open_external_url, login])
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                apply_native_titlebar_colors(&window);
            }
            let _ = app;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Only the main window owns full application shutdown. Auxiliary
                // windows (browser_<session>_<agent>) close independently.
                if window.label() != "main" { return; }
                api.prevent_close();
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<Supervisor>();
                    let sessions: Vec<_> = {
                        let mut registry = state.sessions.lock().await;
                        registry.drain().map(|(_, session)| session).collect()
                    };
                    for session in sessions { let _ = stop_engine(session).await; }
                    native::close_all_browsers();
                    app.exit(0);
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("Failed to start canoPi");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn allowed_commands_are_narrow() {
        assert!(allowed_command(&json!({"type":"get_state"})).is_ok());
        assert!(allowed_command(&json!({"type":"negotiate_protocol","protocolVersion":2})).is_ok());
        assert!(allowed_command(&json!({"type":"prompt","message":"hello"})).is_ok());
        assert!(allowed_command(&json!({"type":"bash","command":"del *"})).is_err());
        assert!(allowed_command(&json!({"type":"prompt","message":""})).is_err());
        assert!(allowed_command(&json!({"type":"prompt","message":"x".repeat(262_145)})).is_err());
        assert!(allowed_command(&json!({"type":"negotiate_protocol","protocolVersion":1})).is_err());
        assert!(!valid_key("../escape"));
    }

    #[test]
    fn native_login_allowlist_and_provider_id_validation() {
        // get_login_providers needs no arguments.
        assert!(allowed_command(&json!({"type":"get_login_providers"})).is_ok());
        // login requires a narrow providerId.
        assert!(allowed_command(&json!({"type":"login","providerId":"google-antigravity"})).is_ok());
        assert!(allowed_command(&json!({"type":"login","providerId":"openai-codex"})).is_ok());
        // Missing / wrong-type / oversized / unsafe providerId are rejected.
        assert!(allowed_command(&json!({"type":"login"})).is_err());
        assert!(allowed_command(&json!({"type":"login","providerId":42})).is_err());
        assert!(allowed_command(&json!({"type":"login","providerId":""})).is_err());
        assert!(allowed_command(&json!({"type":"login","providerId":"../escape"})).is_err());
        assert!(allowed_command(&json!({"type":"login","providerId":"a b"})).is_err());
        assert!(allowed_command(&json!({"type":"login","providerId":"rm -rf"})).is_err());
        assert!(allowed_command(&json!({"type":"login","providerId":"x".repeat(65)})).is_err());
        // Still closed to non-login commands.
        assert!(allowed_command(&json!({"type":"bash","command":"del *"})).is_err());
    }

    #[test]
    fn external_url_validation_is_http_only_and_injection_safe() {
        assert!(valid_external_url("https://antigravity.google/auth?client_id=abc&scope=openid"));
        assert!(valid_external_url("http://localhost:54545/callback?code=xyz"));
        // Non-http schemes are rejected.
        assert!(!valid_external_url("ftp://example.com/x"));
        assert!(!valid_external_url("file:///etc/passwd"));
        assert!(!valid_external_url("javascript:alert(1)"));
        assert!(!valid_external_url("rundll32.exe,url.dll"));
        // Whitespace / control / quote characters are rejected (no shell, no arg split).
        assert!(!valid_external_url("https://a.com/x y"));
        assert!(!valid_external_url("https://a.com/x\ny"));
        assert!(!valid_external_url("https://a.com/x\tt"));
        assert!(!valid_external_url("https://a.com/\u{0}x"));
        assert!(!valid_external_url("https://a.com/\"quoted\""));
        // Empty and over-length are rejected.
        assert!(!valid_external_url(""));
        assert!(!valid_external_url(&format!("https://a.com/{}", "x".repeat(5000))));
    }
    #[test]
    fn schema_fields_follow_pinned_rpc_docs() {
        // prompt/steer/follow_up streamingBehavior
        assert!(allowed_command(&json!({"type":"prompt","message":"hi","streamingBehavior":"followUp"})).is_ok());
        assert!(allowed_command(&json!({"type":"prompt","message":"hi","streamingBehavior":"steer"})).is_ok());
        assert!(allowed_command(&json!({"type":"prompt","message":"hi","streamingBehavior":"now"})).is_err());
        assert!(allowed_command(&json!({"type":"steer","message":"hi","streamingBehavior":"steer"})).is_err());
        assert!(allowed_command(&json!({"type":"prompt","message":"hi","images":[{"x":1}]})).is_ok());
        assert!(allowed_command(&json!({"type":"prompt","message":"hi","images":"not-an-array"})).is_err());
        // thinking level enum
        assert!(allowed_command(&json!({"type":"set_thinking_level","level":"high"})).is_ok());
        assert!(allowed_command(&json!({"type":"set_thinking_level","level":"inherit"})).is_ok());
        assert!(allowed_command(&json!({"type":"set_thinking_level","level":"turbo"})).is_err());
        assert!(allowed_command(&json!({"type":"set_thinking_level"})).is_err());
        // subagent subscription enum, required ids
        assert!(allowed_command(&json!({"type":"set_subagent_subscription","level":"events"})).is_ok());
        assert!(allowed_command(&json!({"type":"set_subagent_subscription","level":"all"})).is_err());
        assert!(allowed_command(&json!({"type":"cancel_subagent"})).is_err());
        assert!(allowed_command(&json!({"type":"cancel_subagent","subagentId":"w1"})).is_ok());
        assert!(allowed_command(&json!({"type":"steer_subagent","subagentId":"w1","message":"go"})).is_ok());
        // paging bounds
        assert!(allowed_command(&json!({"type":"get_messages_page","limit":100})).is_ok());
        assert!(allowed_command(&json!({"type":"get_messages_page","limit":0})).is_err());
        assert!(allowed_command(&json!({"type":"get_messages_page","limit":257})).is_err());
        assert!(allowed_command(&json!({"type":"get_messages_page","limit":1.5})).is_err());
        // ask dialog and event filter
        assert!(allowed_command(&json!({"type":"set_ask_dialog","enabled":true})).is_ok());
        assert!(allowed_command(&json!({"type":"set_ask_dialog","enabled":"yes"})).is_err());
        assert!(allowed_command(&json!({"type":"set_ask_dialog"})).is_err());
        assert!(allowed_command(&json!({"type":"set_event_filter","events":null})).is_ok());
        assert!(allowed_command(&json!({"type":"set_event_filter","events":["message_update"],"messageUpdates":"delta"})).is_ok());
        assert!(allowed_command(&json!({"type":"set_event_filter","events":["message_update"],"messageUpdates":"full-ish"})).is_err());
        assert!(allowed_command(&json!({"type":"set_event_filter"})).is_err());
        // model selection
        assert!(allowed_command(&json!({"type":"set_model","provider":"p","modelId":"m"})).is_ok());
        assert!(allowed_command(&json!({"type":"set_model","provider":"","modelId":"m"})).is_err());
        // extra unknown fields on a safe command stay the engine's business
        assert!(allowed_command(&json!({"type":"get_state","sessionDir":"/etc"})).is_ok());
    }
    #[test]
    fn ui_reply_shapes_follow_pinned_rpc_docs() {
        assert!(valid_ui_response(&json!({"type":"extension_ui_response","id":"1","confirmed":true})));
        assert!(valid_ui_response(&json!({"type":"extension_ui_response","id":"1","value":"answer"})));
        assert!(valid_ui_response(&json!({"type":"extension_ui_response","id":"1","cancelled":true,"timedOut":true})));
        assert!(valid_ui_response(&json!({"type":"extension_ui_response","id":"1","answers":[{"id":"q1","selectedOptions":["A"]}]})));
        // Mixed or wrong shapes are rejected instead of guessed.
        assert!(!valid_ui_response(&json!({"type":"extension_ui_response","id":"1","confirmed":true,"value":"x"})));
        assert!(!valid_ui_response(&json!({"type":"extension_ui_response","id":"1","cancelled":false})));
        assert!(!valid_ui_response(&json!({"type":"extension_ui_response","id":"1"})));
        assert!(!valid_ui_response(&json!({"type":"extension_ui_response","id":"","confirmed":true})));
        assert!(!valid_ui_response(&json!({"type":"extension_ui_response","id":"1","timedOut":true})));
        assert!(!valid_ui_response(&json!({"type":"extension_ui_response","id":"1","answers":[{"id":"q1","selectedOptions":["A","A"]}]})));
    }
    #[test]
    fn generation_retirement_is_exact() {
        let mut map: HashMap<String, u64> = HashMap::new();
        map.insert("s1".into(), 7);
        assert!(remove_generation(&mut map, "s1", 7, |g| *g));
        assert!(map.is_empty());
        map.insert("s1".into(), 9);
        // A late EOF from generation 7 must not evict generation 9.
        assert!(!remove_generation(&mut map, "s1", 7, |g| *g));
        assert!(map.contains_key("s1"));
        assert!(!remove_generation(&mut map, "missing", 1, |g| *g));
    }
    #[test]
    fn panic_marker_scans_bounded_tail() {
        assert!(panic_marker(b"log\npanicked at thread 'main'\n"));
        assert!(!panic_marker(b"ordinary stderr line"));
        assert!(!panic_marker(b""));
    }
    #[test]
    fn owned_root_empty_directory() {
        let temp = std::env::temp_dir().join(format!("canopi_test_empty_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();
        assert!(owned_root(&temp, ".canopi-owner").is_ok());
        let marker = temp.join(".canopi-owner");
        assert!(marker.is_file());
        let content = std::fs::read_to_string(&marker).unwrap();
        assert_eq!(content.trim(), "app.canopi.desktop");
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn owned_root_existing_marker() {
        let temp = std::env::temp_dir().join(format!("canopi_test_marker_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();
        let marker = temp.join(".canopi-owner");
        std::fs::write(&marker, b"app.canopi.desktop\n").unwrap();
        assert!(owned_root(&temp, ".canopi-owner").is_ok());

        // Mismatched owner refusal
        std::fs::write(&marker, b"other.app\n").unwrap();
        let err = owned_root(&temp, ".canopi-owner").unwrap_err();
        assert!(err.contains("Existing unowned data root"));
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn owned_root_recognized_legacy_migration() {
        let temp = std::env::temp_dir().join(format!("canopi_test_legacy_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::create_dir_all(temp.join("EBWebView")).unwrap();
        std::fs::create_dir_all(temp.join("profile")).unwrap();
        std::fs::create_dir_all(temp.join("sessions")).unwrap();
        std::fs::write(temp.join("models.json"), b"{}").unwrap();
        std::fs::write(temp.join(".canopi.lock"), b"").unwrap();

        assert!(owned_root(&temp, ".canopi-owner").is_ok());
        let marker = temp.join(".canopi-owner");
        assert!(marker.is_file());
        let content = std::fs::read_to_string(&marker).unwrap();
        assert_eq!(content.trim(), "app.canopi.desktop");
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn owned_root_unrecognized_nonempty_refusal() {
        let temp = std::env::temp_dir().join(format!("canopi_test_unrecognized_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("random_unowned_file.txt"), b"secret data").unwrap();

        let res = owned_root(&temp, ".canopi-owner");
        assert!(res.is_err());
        let err = res.unwrap_err();
        assert!(err.contains("Cannot claim nonempty unowned root"));
        assert!(err.contains("random_unowned_file.txt"));
        assert!(!temp.join(".canopi-owner").exists());
        assert!(temp.join("random_unowned_file.txt").exists());
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn owned_root_symlink_or_reparse_refusal() {
        let base = std::env::temp_dir().join(format!("canopi_test_link_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let target = base.join("target");
        std::fs::create_dir_all(&target).unwrap();
        let link = base.join("link_dir");

        #[cfg(windows)]
        let created = {
            let cmd = format!("cmd /C mklink /J \"{}\" \"{}\"", link.display(), target.display());
            std::process::Command::new("cmd")
                .args(["/C", &cmd])
                .output()
                .map(|o| o.status.success() && link.exists())
                .unwrap_or(false)
        };
        #[cfg(not(windows))]
        let created = std::os::unix::fs::symlink(&target, &link).is_ok();

        if created {
            let res = owned_root(&link, ".canopi-owner");
            assert!(res.is_err());
            let err = res.unwrap_err();
            assert!(err.contains("symlink or reparse"));

            let res_parent = owned_root(&base, ".canopi-owner");
            assert!(res_parent.is_err());
            let err_parent = res_parent.unwrap_err();
            assert!(err_parent.contains("symlink or reparse"));
        }
        #[cfg(windows)]
        let _ = std::process::Command::new("cmd").args(["/C", "rmdir", &link.to_string_lossy()]).output();
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn validate_http_url_accepts_http_and_https_only() {
        assert!(validate_http_url("https://api.openai.com/v1").is_ok());
        assert!(validate_http_url("http://127.0.0.1:9090/v1").is_ok());
        assert!(validate_http_url("ftp://example.com").is_err());
        assert!(validate_http_url("not-a-url").is_err());
        assert!(validate_http_url("http://").is_err());
        assert!(validate_http_url("").is_err());
    }

    #[test]
    fn update_yaml_providers_creates_and_preserves() {
        let initial = "";
        let mut ant_updates = serde_yaml::Mapping::new();
        ant_updates.insert(
            serde_yaml::Value::String("apiKey".to_string()),
            serde_yaml::Value::String("sk-ant-test".to_string()),
        );
        let res1 = update_yaml_providers(initial, "anthropic", &ant_updates).expect("updates empty yaml");
        let parsed1 = parse_yaml_providers(&res1).expect("parses valid yaml");
        assert_eq!(parsed1.len(), 1);
        assert_eq!(parsed1[0]["id"], "anthropic");
        assert_eq!(parsed1[0]["hasKey"], true);

        let mut cust_updates = serde_yaml::Mapping::new();
        cust_updates.insert(
            serde_yaml::Value::String("baseUrl".to_string()),
            serde_yaml::Value::String("http://127.0.0.1:8000/v1".to_string()),
        );
        cust_updates.insert(
            serde_yaml::Value::String("apiKey".to_string()),
            serde_yaml::Value::String("custom-key".to_string()),
        );
        cust_updates.insert(
            serde_yaml::Value::String("api".to_string()),
            serde_yaml::Value::String("openai-completions".to_string()),
        );
        let res2 = update_yaml_providers(&res1, "custom", &cust_updates).expect("updates second provider");
        let parsed2 = parse_yaml_providers(&res2).expect("parses combined yaml");
        assert_eq!(parsed2.len(), 2);
        let ant = parsed2.iter().find(|p| p["id"] == "anthropic").unwrap();
        assert_eq!(ant["hasKey"], true);
        let cust = parsed2.iter().find(|p| p["id"] == "custom").unwrap();
        assert_eq!(cust["hasKey"], true);
        assert_eq!(cust["baseUrl"], "http://127.0.0.1:8000/v1");
        assert_eq!(cust["api"], "openai-completions");
    }

    #[test]
    fn update_yaml_providers_updates_in_place_and_preserves_unrelated() {
        let existing = r#"
defaultModel: anthropic/claude-3-5-sonnet
version: 2
providers:
  anthropic:
    apiKey: "old-key"
    organization: "org-123"
    timeout: 5000
  groq:
    apiKey: "groq-key"
"#;
        let mut updated = serde_yaml::Mapping::new();
        updated.insert(
            serde_yaml::Value::String("apiKey".to_string()),
            serde_yaml::Value::String("new-key".to_string()),
        );
        let res = update_yaml_providers(existing, "anthropic", &updated).expect("update in place");
        let parsed_yaml: serde_yaml::Value = serde_yaml::from_str(&res).expect("valid yaml");
        assert_eq!(parsed_yaml["defaultModel"].as_str(), Some("anthropic/claude-3-5-sonnet"));
        assert_eq!(parsed_yaml["version"].as_i64(), Some(2));
        assert_eq!(parsed_yaml["providers"]["anthropic"]["apiKey"].as_str(), Some("new-key"));
        assert_eq!(parsed_yaml["providers"]["anthropic"]["organization"].as_str(), Some("org-123"));
        assert_eq!(parsed_yaml["providers"]["anthropic"]["timeout"].as_i64(), Some(5000));
        assert_eq!(parsed_yaml["providers"]["groq"]["apiKey"].as_str(), Some("groq-key"));
    }

    #[test]
    fn update_yaml_providers_fails_on_malformed_yaml() {
        let malformed = "providers:\n  anthropic:\n    [unclosed";
        let mut updates = serde_yaml::Mapping::new();
        updates.insert(
            serde_yaml::Value::String("apiKey".to_string()),
            serde_yaml::Value::String("key".to_string()),
        );
        assert!(update_yaml_providers(malformed, "anthropic", &updates).is_err());
    }

    #[test]
    fn update_yaml_providers_fails_on_invalid_structure() {
        let non_mapping_root = "- item1\n- item2\n";
        let mut updates = serde_yaml::Mapping::new();
        updates.insert(
            serde_yaml::Value::String("apiKey".to_string()),
            serde_yaml::Value::String("key".to_string()),
        );
        assert!(update_yaml_providers(non_mapping_root, "anthropic", &updates).is_err());

        let non_mapping_providers = "providers: 12345\n";
        assert!(update_yaml_providers(non_mapping_providers, "anthropic", &updates).is_err());
    }

    #[test]
    fn parse_yaml_providers_extracts_metadata() {
        let yaml = "providers:\n  anthropic:\n    apiKey: \"sk-ant-123\"\n  custom:\n    baseUrl: \"https://proxy.example.com/v1\"\n    apiKey: \"tok-456\"\n    api: openai-completions\n  empty:\n    apiKey: \"\"\n";
        let providers = parse_yaml_providers(yaml).expect("valid yaml");
        assert_eq!(providers.len(), 3);
        let ant = providers.iter().find(|p| p["id"] == "anthropic").unwrap();
        assert_eq!(ant["hasKey"], true);
        assert_eq!(ant["baseUrl"], Value::Null);
        assert_eq!(ant["api"], Value::Null);
        let cust = providers.iter().find(|p| p["id"] == "custom").unwrap();
        assert_eq!(cust["hasKey"], true);
        assert_eq!(cust["baseUrl"], "https://proxy.example.com/v1");
        assert_eq!(cust["api"], "openai-completions");
        let empty = providers.iter().find(|p| p["id"] == "empty").unwrap();
        assert_eq!(empty["hasKey"], false);
    }


    #[test]
    fn parse_yaml_providers_fails_on_malformed_yaml_or_invalid_structure() {
        assert!(parse_yaml_providers("providers:\n  anthropic:\n    [unclosed").is_err());
        assert!(parse_yaml_providers("- item1\n- item2").is_err());
        assert!(parse_yaml_providers("providers: \"not-a-map\"").is_err());
        assert_eq!(parse_yaml_providers("").unwrap(), Vec::<Value>::new());
    }

    #[test]
    fn get_canonical_models_file_preserves_suffix() {
        let temp_dir = std::env::temp_dir().join(format!("canopi-canonical-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let (f1, exists1) = get_canonical_models_file(&temp_dir);
        assert_eq!(f1.file_name().unwrap(), "models.yml");
        assert!(!exists1);

        let yaml_file = temp_dir.join("models.yaml");
        std::fs::write(&yaml_file, "providers: {}\n").unwrap();
        let (f2, exists2) = get_canonical_models_file(&temp_dir);
        assert_eq!(f2.file_name().unwrap(), "models.yaml");
        assert!(exists2);

        let yml_file = temp_dir.join("models.yml");
        std::fs::write(&yml_file, "providers: {}\n").unwrap();
        let (f3, exists3) = get_canonical_models_file(&temp_dir);
        assert_eq!(f3.file_name().unwrap(), "models.yml");
        assert!(exists3);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_builtin_provider_with_base_url_and_model_id_emits_canonical_yaml() {
        let updates = build_provider_updates(
            "openai",
            "sk-mock-key",
            Some("http://127.0.0.1:11434/v1"),
            None,
            Some("qwen2.5:7b"),
        ).expect("build updates should succeed");

        let yaml = update_yaml_providers("", "openai", &updates).expect("yaml serialization should succeed");
        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("emitted yaml must parse");
        let prov_map = parsed
            .get("providers")
            .and_then(|p| p.get("openai"))
            .expect("openai provider must exist");

        assert_eq!(
            prov_map.get("apiKey").and_then(|v| v.as_str()),
            Some("sk-mock-key")
        );
        assert_eq!(
            prov_map.get("baseUrl").and_then(|v| v.as_str()),
            Some("http://127.0.0.1:11434/v1")
        );

        let models = prov_map.get("models").and_then(|m| m.as_sequence()).expect("models sequence");
        assert_eq!(models.len(), 1);
        let m = &models[0];
        assert_eq!(m.get("id").and_then(|v| v.as_str()), Some("qwen2.5:7b"));
        assert_eq!(m.get("name").and_then(|v| v.as_str()), Some("qwen2.5:7b"));
        assert_eq!(m.get("api").and_then(|v| v.as_str()), Some("openai-completions"));
        assert_eq!(m.get("contextWindow").and_then(|v| v.as_i64()), Some(128_000));
        assert_eq!(m.get("maxTokens").and_then(|v| v.as_i64()), Some(16_384));
        assert!(m.get("cost").and_then(|v| v.as_mapping()).is_some());
        assert_eq!(m.get("input").and_then(|v| v.as_sequence()).map(|s| s.len()), Some(1));
    }

    #[test]
    fn test_custom_provider_with_proxy_emits_canonical_yaml() {
        let updates = build_provider_updates(
            "9router",
            "sk-local-proxy",
            Some("http://127.0.0.1:9090/v1"),
            Some("openai-completions"),
            Some("custom-model"),
        ).expect("build updates should succeed");

        let yaml = update_yaml_providers("", "9router", &updates).expect("yaml serialization should succeed");
        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("emitted yaml must parse");
        let prov_map = parsed
            .get("providers")
            .and_then(|p| p.get("9router"))
            .expect("9router provider must exist");

        assert_eq!(
            prov_map.get("api").and_then(|v| v.as_str()),
            Some("openai-completions")
        );
        let models = prov_map.get("models").and_then(|m| m.as_sequence()).expect("models sequence");
        assert_eq!(models.len(), 1);
        let m = &models[0];
        assert_eq!(m.get("id").and_then(|v| v.as_str()), Some("custom-model"));
        assert_eq!(m.get("api").and_then(|v| v.as_str()), Some("openai-completions"));
    }

    #[test]
    fn test_import_yaml_migrates_legacy_openai_chat() {
        let legacy = format!(
            "defaultModel: anthropic/claude-3-5-sonnet\nversion: 1\nproviders:\n  custom:\n    baseUrl: \"https://proxy.example.com/v1\"\n    apiKey: \"tok-123\"\n    {}: {}\n    models:\n      - id: m1\n        {}: {}\n",
            "api", "openai-chat", "api", "openai-chat"
        );
        let sanitized = sanitize_and_normalize_models(&legacy, "models.yml")
            .expect("sanitization must succeed");
        assert!(!sanitized.contains("openai-chat"));
        assert!(sanitized.contains("openai-completions"));

        let parsed: serde_yaml::Value = serde_yaml::from_str(&sanitized).expect("valid yaml");
        assert_eq!(
            parsed["providers"]["custom"]["api"].as_str(),
            Some("openai-completions")
        );
        assert_eq!(
            parsed["providers"]["custom"]["models"][0]["api"].as_str(),
            Some("openai-completions")
        );
        assert_eq!(parsed["defaultModel"].as_str(), Some("anthropic/claude-3-5-sonnet"));
        assert_eq!(parsed["version"].as_i64(), Some(1));
    }

    #[test]
    fn test_import_yaml_rejects_unsupported_api() {
        let bad = "providers:\n  custom:\n    baseUrl: \"https://proxy.example.com/v1\"\n    apiKey: \"tok-123\"\n    api: unsupported-api-protocol\n";
        assert!(sanitize_and_normalize_models(bad, "models.yml").is_err());
    }

    #[test]
    fn test_import_yaml_fails_closed_on_malformed_syntax() {
        let malformed = "providers:\n  custom:\n    [unclosed";
        assert!(sanitize_and_normalize_models(malformed, "models.yml").is_err());
    }

    #[test]
    fn test_import_yaml_fails_closed_on_invalid_structure() {
        let bad_root = "- item1\n- item2\n";
        assert!(sanitize_and_normalize_models(bad_root, "models.yml").is_err());

        let bad_providers = "providers: \"not-a-map\"\n";
        assert!(sanitize_and_normalize_models(bad_providers, "models.yml").is_err());
    }

    #[test]
    fn test_import_json_migrates_legacy_openai_chat() {
        let legacy = format!(
            "{{\n  \"defaultModel\": \"custom/m1\",\n  \"providers\": {{\n    \"custom\": {{\n      \"baseUrl\": \"https://proxy.example.com/v1\",\n      \"apiKey\": \"tok-123\",\n      \"{}\": \"{}\",\n      \"models\": [\n        {{ \"id\": \"m1\", \"{}\": \"{}\" }}\n      ]\n    }}\n  }}\n}}",
            "api", "openai-chat", "api", "openai-chat"
        );
        let sanitized = sanitize_and_normalize_models(&legacy, "models.json")
            .expect("json sanitization must succeed");
        assert!(!sanitized.contains("openai-chat"));
        assert!(sanitized.contains("openai-completions"));

        let parsed: serde_json::Value = serde_json::from_str(&sanitized).expect("valid json");
        assert_eq!(
            parsed["providers"]["custom"]["api"].as_str(),
            Some("openai-completions")
        );
        assert_eq!(
            parsed["providers"]["custom"]["models"][0]["api"].as_str(),
            Some("openai-completions")
        );
    }

    #[test]
    fn test_import_json_rejects_unsupported_api() {
        let bad = "{\n  \"providers\": {\n    \"custom\": {\n      \"api\": \"unsupported-api-protocol\"\n    }\n  }\n}";
        assert!(sanitize_and_normalize_models(bad, "models.json").is_err());
    }

    #[test]
    fn test_parse_yaml_providers_normalizes_legacy_openai_chat() {
        let yaml = format!(
            "providers:\n  custom:\n    apiKey: \"tok-123\"\n    {}: {}\n",
            "api", "openai-chat"
        );
        let providers = parse_yaml_providers(&yaml).expect("valid yaml");
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0]["id"], "custom");
        assert_eq!(providers[0]["api"], "openai-completions");
    }
}

/// Narrow opt-in provider-definition import. Never copy OMP's auth SQLite DB,
/// sessions or extensions. The source is read-only and remains user-owned.
/// Narrow opt-in provider-definition import preview. Returns detailed per-provider
/// preview with endpoint validation and trust requirements. Never imports secrets.
#[tauri::command]
async fn provider_import_preview(app: tauri::AppHandle) -> Result<Value, String> {
    let source = app.path().home_dir().map_err(|e|e.to_string())?.join(".omp").join("agent");
    let names = ["models.yml", "models.yaml", "models.json"];
    let files = names.iter().filter(|name| {
        let p=source.join(name);
        std::fs::symlink_metadata(&p).map(|m|m.is_file() && !m.file_type().is_symlink() && m.len()<=1_048_576).unwrap_or(false)
    }).map(|x|x.to_string()).collect::<Vec<_>>();
    
    if files.is_empty() {
        return Ok(json!({"available":false,"files":[],"providers":[]}));
    }
    
    // Read and preview each available file
    let mut all_previews = Vec::new();
    for filename in &files {
        let from = source.join(filename);
        let data = std::fs::read(&from).map_err(|e|e.to_string())?;
        let data_str = std::str::from_utf8(&data)
            .map_err(|_| "Source provider file contains invalid UTF-8".to_string())?;
        let previews = generate_import_preview(data_str, filename).await?;
        all_previews.extend(previews);
    }
    
    Ok(json!({
        "available": true,
        "files": files,
        "providers": all_previews,
        "scope": "Provider model definitions only. Credentials stored in agent.db are never imported. No API keys are returned in this preview."
    }))
}

#[tauri::command]
fn provider_import_models(
    app: tauri::AppHandle,
    filename: String,
    selected_provider_ids: Option<Vec<String>>,
) -> Result<Value,String> {
    if !["models.yml","models.yaml","models.json"].contains(&filename.as_str()) {
        return Err("Only allowlisted OMP provider definitions can be imported".into());
    }
    let home=app.path().home_dir().map_err(|e|e.to_string())?;
    let from=home.join(".omp").join("agent").join(&filename);
    let meta=std::fs::symlink_metadata(&from).map_err(|_|"OMP models file not found")?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len()>1_048_576 {
        return Err("Refusing unsupported or unsafe OMP provider definition".into());
    }
    let data=std::fs::read(&from).map_err(|e|e.to_string())?;
    if data.is_empty() {return Err("Source provider file is empty".into());}
    let data_str = std::str::from_utf8(&data)
        .map_err(|_| "Source provider file contains invalid UTF-8".to_string())?;
    
    // If specific providers selected, filter the config before sanitizing
    let data_to_import = if let Some(selected) = selected_provider_ids {
        if !selected.is_empty() {
            // Parse and filter to only selected providers
            let mut parsed: Value = if filename.ends_with(".json") {
                serde_json::from_str(&data_str).map_err(|e| format!("Malformed JSON: {e}"))?
            } else {
                serde_yaml::from_str(&data_str).map_err(|e| format!("Malformed YAML: {e}"))?
            };

            if let Some(root) = parsed.as_object_mut() {
                if let Some(Value::Object(providers)) = root.get_mut("providers") {
                    providers.retain(|k, _| selected.contains(k));
                }
            }

            if filename.ends_with(".json") {
                serde_json::to_string(&parsed).map_err(|e| e.to_string())?
            } else {
                serde_yaml::to_string(&parsed).map_err(|e| e.to_string())?
            }
        } else {
            data_str.to_string()
        }
    } else {
        data_str.to_string()
    };
    
    let sanitized = sanitize_and_validate_imported_models(&data_to_import, &filename)?;
    // Only the native provider file is copied. No symlinks, no overwrite, no
    // processing of secrets in the GUI, and never any access to ~/.omp/agent.db.
    let to=engine_profile_dir(&app)?.join(&filename);
    let mut file=OpenOptions::new().write(true).create_new(true).open(&to)
        .map_err(|_|"canoPi models file already exists; import is non-overwriting".to_string())?;
    use std::io::Write as _;
    file.write_all(sanitized.as_bytes()).map_err(|e|e.to_string())?;
    file.sync_all().map_err(|e|e.to_string())?;
    Ok(json!({"imported":filename,"scope":"models-only","restartRequired":true}))
}

const BUILTIN_PROVIDERS: &[&str] = &[
    "anthropic",
    "openai",
    "google",
    "openrouter",
    "groq",
    "mistral",
    "xai",
    "deepseek",
    "together",
    "canopi-router",
];

const ALLOWED_APIS: &[&str] = &[
    "openai-completions",
    "openai-responses",
    "openai-codex-responses",
    "azure-openai-responses",
    "anthropic-messages",
    "bedrock-converse-stream",
    "google-generative-ai",
    "google-gemini-cli",
    "google-vertex",
    "openrouter-decisions",
    "typesafe",
];

use provider_endpoint::{
    validate_provider_base_url, sanitize_and_validate_imported_models, generate_import_preview,
    init_trusted_registry, trust_endpoint, revoke_endpoint_trust, list_trusted_endpoints,
    canonicalize_session_file, EndpointTrustFingerprint, ProviderImportPreview,
};

fn default_api_for_provider(provider: &str) -> &'static str {
    match provider {
        "anthropic" => "anthropic-messages",
        "google" => "google-generative-ai",
        _ => "openai-completions",
    }
}

fn validate_http_url(url: &str) -> Result<(), String> {
    // Save-time validation: basic format check only.
    // Full validation with DNS resolution happens at runtime in provider_endpoint.
    let u = url.trim();
    if u.is_empty() || u.len() > 2048 {
        return Err("baseUrl exceeds maximum length (2048)".into());
    }
    let url_parsed = tauri::Url::parse(u).map_err(|_| "Invalid URL format".to_string())?;
    let scheme = url_parsed.scheme().to_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err("baseUrl must use http:// or https:// scheme".into());
    }
    if !url_parsed.username().is_empty() || url_parsed.password().is_some() {
        return Err("URL credentials (userinfo) are forbidden".into());
    }
    let host = url_parsed.host_str().ok_or("baseUrl must have a hostname")?;
    if host.contains('@') {
        return Err("Encoded host bypass detected".into());
    }
    Ok(())
}
fn sanitize_models_yaml(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Source provider file is empty".into());
    }

    let mut parsed: serde_yaml::Value = serde_yaml::from_str(trimmed)
        .map_err(|e| format!("Malformed YAML: {e}"))?;

    let root_map = match &mut parsed {
        serde_yaml::Value::Mapping(m) => m,
        _ => return Err("Invalid models config: root must be a mapping".into()),
    };

    let providers_key = serde_yaml::Value::String("providers".to_string());
    if let Some(prov_val) = root_map.get_mut(&providers_key) {
        match prov_val {
            serde_yaml::Value::Mapping(providers_map) => {
                for (k, v) in providers_map.iter_mut() {
                    let prov_id = match k {
                        serde_yaml::Value::String(s) => s.clone(),
                        serde_yaml::Value::Number(n) => n.to_string(),
                        _ => return Err("Provider identifier must be a string".into()),
                    };

                    let p_map = match v {
                        serde_yaml::Value::Mapping(m) => m,
                        _ => return Err(format!("Provider '{prov_id}' configuration must be a mapping")),
                    };

                    let base_url_key = serde_yaml::Value::String("baseUrl".to_string());
                    if let Some(url_val) = p_map.get(&base_url_key) {
                        if let Some(url_str) = url_val.as_str() {
                            let u = url_str.trim();
                            if !u.is_empty() {
                                validate_http_url(u)?;
                            }
                        }
                    }

                    let api_key = serde_yaml::Value::String("api".to_string());
                    if let Some(api_val) = p_map.get_mut(&api_key) {
                        let api_str = match api_val.as_str() {
                            Some(s) => s.trim(),
                            None => return Err(format!("Provider '{prov_id}' 'api' must be a string")),
                        };
                        if api_str == "openai-chat" {
                            *api_val = serde_yaml::Value::String("openai-completions".to_string());
                        } else if !ALLOWED_APIS.contains(&api_str) {
                            return Err(format!("Unsupported API '{api_str}' in provider '{prov_id}'"));
                        }
                    }

                    let models_key = serde_yaml::Value::String("models".to_string());
                    if let Some(models_val) = p_map.get_mut(&models_key) {
                        match models_val {
                            serde_yaml::Value::Sequence(models_seq) => {
                                for (idx, m) in models_seq.iter_mut().enumerate() {
                                    match m {
                                        serde_yaml::Value::Mapping(m_map) => {
                                            if let Some(m_api_val) = m_map.get_mut(&api_key) {
                                                let m_api_str = match m_api_val.as_str() {
                                                    Some(s) => s.trim(),
                                                    None => return Err(format!("Model #{} in provider '{prov_id}' 'api' must be a string", idx + 1)),
                                                };
                                                if m_api_str == "openai-chat" {
                                                    *m_api_val = serde_yaml::Value::String("openai-completions".to_string());
                                                } else if !ALLOWED_APIS.contains(&m_api_str) {
                                                    return Err(format!("Unsupported API '{m_api_str}' in model of provider '{prov_id}'"));
                                                }
                                            }
                                        }
                                        _ => return Err(format!("Model entry in provider '{prov_id}' must be a mapping")),
                                    }
                                }
                            }
                            serde_yaml::Value::Null => {}
                            _ => return Err(format!("'models' in provider '{prov_id}' must be a sequence")),
                        }
                    }
                }
            }
            serde_yaml::Value::Null => {}
            _ => return Err("Invalid models config: 'providers' must be a mapping".into()),
        }
    }

    serde_yaml::to_string(&parsed).map_err(|e| format!("Failed to serialize models YAML: {e}"))
}

fn sanitize_models_json(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Source provider file is empty".into());
    }

    let mut parsed: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Malformed JSON: {e}"))?;

    let root_map = match &mut parsed {
        serde_json::Value::Object(m) => m,
        _ => return Err("Invalid models config: root must be an object".into()),
    };

    if let Some(prov_val) = root_map.get_mut("providers") {
        match prov_val {
            serde_json::Value::Object(providers_map) => {
                for (prov_id, v) in providers_map.iter_mut() {
                    let p_map = match v {
                        serde_json::Value::Object(m) => m,
                        _ => return Err(format!("Provider '{prov_id}' configuration must be an object")),
                    };

                    if let Some(url_val) = p_map.get("baseUrl") {
                        if let Some(url_str) = url_val.as_str() {
                            let u = url_str.trim();
                            if !u.is_empty() {
                                validate_http_url(u)?;
                            }
                        }
                    }

                    if let Some(api_val) = p_map.get_mut("api") {
                        let api_str = match api_val.as_str() {
                            Some(s) => s.trim(),
                            None => return Err(format!("Provider '{prov_id}' 'api' must be a string")),
                        };
                        if api_str == "openai-chat" {
                            *api_val = serde_json::Value::String("openai-completions".to_string());
                        } else if !ALLOWED_APIS.contains(&api_str) {
                            return Err(format!("Unsupported API '{api_str}' in provider '{prov_id}'"));
                        }
                    }

                    if let Some(models_val) = p_map.get_mut("models") {
                        match models_val {
                            serde_json::Value::Array(models_seq) => {
                                for (idx, m) in models_seq.iter_mut().enumerate() {
                                    match m {
                                        serde_json::Value::Object(m_map) => {
                                            if let Some(m_api_val) = m_map.get_mut("api") {
                                                let m_api_str = match m_api_val.as_str() {
                                                    Some(s) => s.trim(),
                                                    None => return Err(format!("Model #{} in provider '{prov_id}' 'api' must be a string", idx + 1)),
                                                };
                                                if m_api_str == "openai-chat" {
                                                    *m_api_val = serde_json::Value::String("openai-completions".to_string());
                                                } else if !ALLOWED_APIS.contains(&m_api_str) {
                                                    return Err(format!("Unsupported API '{m_api_str}' in model of provider '{prov_id}'"));
                                                }
                                            }
                                        }
                                        _ => return Err(format!("Model entry in provider '{prov_id}' must be an object")),
                                    }
                                }
                            }
                            serde_json::Value::Null => {}
                            _ => return Err(format!("'models' in provider '{prov_id}' must be an array")),
                        }
                    }
                }
            }
            serde_json::Value::Null => {}
            _ => return Err("Invalid models config: 'providers' must be an object".into()),
        }
    }

    serde_json::to_string_pretty(&parsed).map_err(|e| format!("Failed to serialize models JSON: {e}"))
}

fn sanitize_and_normalize_models(raw: &str, filename: &str) -> Result<String, String> {
    if filename.ends_with(".json") {
        sanitize_models_json(raw)
    } else {
        sanitize_models_yaml(raw)
    }
}


fn parse_yaml_providers(raw: &str) -> Result<Vec<Value>, String> {
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }

    let parsed: serde_yaml::Value = serde_yaml::from_str(raw)
        .map_err(|e| format!("Malformed YAML: {e}"))?;

    match parsed {
        serde_yaml::Value::Null => Ok(Vec::new()),
        serde_yaml::Value::Mapping(root_map) => {
            let providers_key = serde_yaml::Value::String("providers".to_string());
            let prov_val = match root_map.get(&providers_key) {
                Some(v) => v,
                None => return Ok(Vec::new()),
            };

            match prov_val {
                serde_yaml::Value::Null => Ok(Vec::new()),
                serde_yaml::Value::Mapping(providers_map) => {
                    let mut configured_providers = Vec::new();
                    for (k, v) in providers_map {
                        let id = match k {
                            serde_yaml::Value::String(s) => s.clone(),
                            serde_yaml::Value::Number(n) => n.to_string(),
                            _ => continue,
                        };

                        let (has_key, base_url, api) = match v {
                            serde_yaml::Value::Mapping(p_map) => {
                                let key_val = p_map.get(&serde_yaml::Value::String("apiKey".to_string()));
                                let has_key = match key_val {
                                    Some(serde_yaml::Value::String(s)) => !s.trim().is_empty(),
                                    Some(serde_yaml::Value::Number(_)) => true,
                                    _ => false,
                                };

                                let base_url = match p_map.get(&serde_yaml::Value::String("baseUrl".to_string())) {
                                    Some(serde_yaml::Value::String(s)) => {
                                        let trimmed = s.trim();
                                        if trimmed.is_empty() {
                                            Value::Null
                                        } else {
                                            Value::String(trimmed.to_string())
                                        }
                                    }
                                    _ => Value::Null,
                                };

                                let api = match p_map.get(&serde_yaml::Value::String("api".to_string())) {
                                    Some(serde_yaml::Value::String(s)) => {
                                        let trimmed = s.trim();
                                        if trimmed.is_empty() {
                                            Value::Null
                                        } else if trimmed == "openai-chat" {
                                            Value::String("openai-completions".to_string())
                                        } else {
                                            Value::String(trimmed.to_string())
                                        }
                                    }
                                    _ => {
                                        if let Some(serde_yaml::Value::Sequence(seq)) = p_map.get(&serde_yaml::Value::String("models".to_string())) {
                                            seq.first()
                                                .and_then(|m| m.as_mapping())
                                                .and_then(|m| m.get(&serde_yaml::Value::String("api".to_string())))
                                                .and_then(|a| a.as_str())
                                                .map(|s| {
                                                    let trimmed = s.trim();
                                                    if trimmed == "openai-chat" {
                                                        Value::String("openai-completions".to_string())
                                                    } else {
                                                        Value::String(trimmed.to_string())
                                                    }
                                                })
                                                .unwrap_or(Value::Null)
                                        } else {
                                            Value::Null
                                        }
                                    }
                                };

                                (has_key, base_url, api)
                            }
                            _ => (false, Value::Null, Value::Null),
                        };

                        configured_providers.push(json!({
                            "id": id,
                            "hasKey": has_key,
                            "baseUrl": base_url,
                            "api": api,
                        }));
                    }
                    Ok(configured_providers)
                }
                _ => Err("Invalid models config: 'providers' must be a mapping".to_string()),
            }
        }
        _ => Err("Invalid models config: root must be a mapping".to_string()),
    }
}

fn update_yaml_providers(
    raw: &str,
    target_prov: &str,
    updates: &serde_yaml::Mapping,
) -> Result<String, String> {
    let mut root_val = if raw.trim().is_empty() {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    } else {
        let parsed: serde_yaml::Value = serde_yaml::from_str(raw)
            .map_err(|e| format!("Malformed YAML: {e}"))?;
        match parsed {
            serde_yaml::Value::Null => serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
            m @ serde_yaml::Value::Mapping(_) => m,
            _ => return Err("Invalid models config: root must be a mapping".to_string()),
        }
    };

    let root_map = root_val
        .as_mapping_mut()
        .ok_or_else(|| "Invalid models config: root must be a mapping".to_string())?;

    let providers_key = serde_yaml::Value::String("providers".to_string());
    if !root_map.contains_key(&providers_key) || root_map.get(&providers_key) == Some(&serde_yaml::Value::Null) {
        root_map.insert(
            providers_key.clone(),
            serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
        );
    }

    let providers_val = root_map
        .get_mut(&providers_key)
        .ok_or_else(|| "Failed to access 'providers' mapping".to_string())?;

    let providers_map = match providers_val {
        serde_yaml::Value::Mapping(m) => m,
        _ => return Err("Invalid models config: 'providers' must be a mapping".to_string()),
    };

    let target_key = serde_yaml::Value::String(target_prov.to_string());
    if let Some(existing_entry) = providers_map.get_mut(&target_key) {
        match existing_entry {
            serde_yaml::Value::Mapping(existing_map) => {
                for (k, v) in updates {
                    if k == &serde_yaml::Value::String("models".to_string()) {
                        let models_key = serde_yaml::Value::String("models".to_string());
                        if let Some(serde_yaml::Value::Sequence(existing_models)) = existing_map.get_mut(&models_key) {
                            if let serde_yaml::Value::Sequence(new_models) = v {
                                for new_m in new_models {
                                    let new_id = new_m.as_mapping().and_then(|m| m.get(&serde_yaml::Value::String("id".to_string())));
                                    if let Some(target_id) = new_id {
                                        if let Some(pos) = existing_models.iter().position(|em| {
                                            em.as_mapping().and_then(|m| m.get(&serde_yaml::Value::String("id".to_string()))) == Some(target_id)
                                        }) {
                                            existing_models[pos] = new_m.clone();
                                        } else {
                                            existing_models.push(new_m.clone());
                                        }
                                    } else {
                                        existing_models.push(new_m.clone());
                                    }
                                }
                            } else {
                                existing_map.insert(k.clone(), v.clone());
                            }
                        } else {
                            existing_map.insert(k.clone(), v.clone());
                        }
                    } else {
                        existing_map.insert(k.clone(), v.clone());
                    }
                }
            }
            _ => {
                *existing_entry = serde_yaml::Value::Mapping(updates.clone());
            }
        }
    } else {
        providers_map.insert(target_key, serde_yaml::Value::Mapping(updates.clone()));
    }

    serde_yaml::to_string(&root_val).map_err(|e| format!("Failed to serialize models YAML: {e}"))
}

fn get_canonical_models_file(profile_dir: &Path) -> (PathBuf, bool) {
    let yml = profile_dir.join("models.yml");
    if yml.exists() {
        return (yml, true);
    }
    let yaml = profile_dir.join("models.yaml");
    if yaml.exists() {
        return (yaml, true);
    }
    (yml, false)
}

fn migrate_models_json_to_yaml(profile_dir: &Path, val: &Value) -> Result<(), String> {
    let mut providers_map = serde_yaml::Mapping::new();
    if let Some(providers) = val.get("providers").and_then(Value::as_object) {
        for (name, pval) in providers {
            let key = pval.get("apiKey").and_then(Value::as_str).unwrap_or("").trim();
            if key.is_empty() {
                continue;
            }
            let base_url = pval.get("baseUrl").and_then(Value::as_str).map(|s| s.trim()).filter(|s| !s.is_empty());
            let is_builtin = BUILTIN_PROVIDERS.contains(&name.as_str());

            let mut prov_entry = serde_yaml::Mapping::new();
            prov_entry.insert(
                serde_yaml::Value::String("apiKey".to_string()),
                serde_yaml::Value::String(key.to_string()),
            );
            if let Some(u) = base_url {
                prov_entry.insert(
                    serde_yaml::Value::String("baseUrl".to_string()),
                    serde_yaml::Value::String(u.to_string()),
                );
            }

            if !is_builtin {
                let raw_api = pval.get("api").and_then(Value::as_str).unwrap_or("openai-completions");
                let api_kind = if raw_api == "openai-chat" || !ALLOWED_APIS.contains(&raw_api) {
                    "openai-completions"
                } else {
                    raw_api
                };
                prov_entry.insert(
                    serde_yaml::Value::String("api".to_string()),
                    serde_yaml::Value::String(api_kind.to_string()),
                );

                if let Some(models) = pval.get("models").and_then(Value::as_array) {
                    if !models.is_empty() {
                        let mut models_seq = Vec::new();
                        for m in models {
                            let mid = m.get("id").and_then(Value::as_str).unwrap_or("model");
                            let mut m_map = serde_yaml::Mapping::new();
                            m_map.insert(
                                serde_yaml::Value::String("id".to_string()),
                                serde_yaml::Value::String(mid.to_string()),
                            );
                            m_map.insert(
                                serde_yaml::Value::String("name".to_string()),
                                serde_yaml::Value::String(mid.to_string()),
                            );
                            m_map.insert(
                                serde_yaml::Value::String("api".to_string()),
                                serde_yaml::Value::String(api_kind.to_string()),
                            );
                            models_seq.push(serde_yaml::Value::Mapping(m_map));
                        }
                        prov_entry.insert(
                            serde_yaml::Value::String("models".to_string()),
                            serde_yaml::Value::Sequence(models_seq),
                        );
                    }
                }
            }

            providers_map.insert(
                serde_yaml::Value::String(name.clone()),
                serde_yaml::Value::Mapping(prov_entry),
            );
        }
    }

    let mut root_map = serde_yaml::Mapping::new();
    root_map.insert(
        serde_yaml::Value::String("providers".to_string()),
        serde_yaml::Value::Mapping(providers_map),
    );
    let root_val = serde_yaml::Value::Mapping(root_map);
    let out = serde_yaml::to_string(&root_val)
        .map_err(|e| format!("Failed to serialize models YAML: {e}"))?;

    let (target, _) = get_canonical_models_file(profile_dir);
    let target_name = target.file_name().and_then(|f| f.to_str()).unwrap_or("models.yml");
    let tmp = profile_dir.join(format!(".{}.tmp-mig-{}", target_name, std::process::id()));
    {
        use std::io::Write as _;
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        f.write_all(out.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}

#[tauri::command]
async fn provider_save_key(
    app: tauri::AppHandle,
    provider: String,
    api_key: String,
    base_url: Option<String>,
    api: Option<String>,
    model_id: Option<String>,
) -> Result<Value, String> {
    let prov = provider.trim().to_lowercase();
    if prov.is_empty() || prov.len() > 64 || !prov.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Invalid provider name (1..64 alphanumeric, dash, or underscore)".into());
    }
    let key = api_key.trim();
    if key.is_empty() || key.len() > 4096 {
        return Err("Invalid API key length (must be 1..4096 characters)".into());
    }

    let is_builtin = BUILTIN_PROVIDERS.contains(&prov.as_str());

    let clean_base_url = if let Some(url) = base_url {
        let u = url.trim();
        if !u.is_empty() {
            // Full validation with DNS resolution
            let validated = provider_endpoint::validate_provider_base_url(u).await?;
            // Enforce HTTPS for non-loopback at save time
            if validated.scheme == "http" && !validated.is_loopback {
                return Err("HTTP only allowed for verified loopback (localhost, 127.0.0.1, ::1)".into());
            }
            // If private endpoint, require trust
            if validated.requires_trust {
                return Err(format!("Private endpoint requires explicit trust confirmation. Fingerprint: {}", validated.trust_fingerprint.unwrap_or_default()));
            }
            Some(u.to_string())
        } else {
            None
        }
    } else {
        None
    };

    if !is_builtin && clean_base_url.is_none() {
        return Err("Base URL (http:// or https://) is required for custom/proxy providers".into());
    }

    let clean_model_id = if let Some(mid) = model_id {
        let m = mid.trim();
        if !m.is_empty() {
            if m.len() > 128 {
                return Err("model_id exceeds maximum length (128)".into());
            }
            Some(m.to_string())
        } else {
            None
        }
    } else {
        None
    };

    if !is_builtin && clean_model_id.is_none() {
        return Err("Nonempty model ID is required for custom/proxy providers".into());
    }

    let api_kind = if !is_builtin {
        let requested = api.as_deref().unwrap_or("openai-completions").trim();
        let selected = if requested.is_empty() {
            "openai-completions"
        } else {
            requested
        };
        if selected == "openai-chat" {
            return Err("Invalid api 'openai-chat'. Use 'openai-completions' or valid OMP api.".into());
        }
        if !ALLOWED_APIS.contains(&selected) {
            return Err(format!("Invalid api '{}'. Must be a supported OMP api.", selected));
        }
        Some(selected.to_string())
    } else if clean_model_id.is_some() {
        let requested = api.as_deref().unwrap_or("").trim();
        if !requested.is_empty() {
            if requested == "openai-chat" {
                return Err("Invalid api 'openai-chat'. Use 'openai-completions' or valid OMP api.".into());
            }
            if !ALLOWED_APIS.contains(&requested) {
                return Err(format!("Invalid api '{}'. Must be a supported OMP api.", requested));
            }
            Some(requested.to_string())
        } else {
            None
        }
    } else {
        None
    };

    let profile_dir = engine_profile_dir(&app)?;
    let canonical_yml = profile_dir.join("models.yml");
    let canonical_yaml = profile_dir.join("models.yaml");
    if !canonical_yml.exists() && !canonical_yaml.exists() {
        let json_file = profile_dir.join("models.json");
        if json_file.exists() {
            let raw_json = std::fs::read_to_string(&json_file)
                .map_err(|e| format!("Failed to read legacy models.json: {e}"))?;
            let legacy: Value = serde_json::from_str(&raw_json)
                .map_err(|_| "Legacy models.json is invalid; refuse to overwrite it".to_string())?;
            migrate_models_json_to_yaml(&profile_dir, &legacy)?;
        }
    }

    let (models_file, _) = get_canonical_models_file(&profile_dir);
    let existing_raw = if models_file.exists() {
        std::fs::read_to_string(&models_file).map_err(|e| format!("Failed to read models config: {e}"))?
    } else {
        String::new()
    };

    // Build updates directly with strict validation
    let mut updates = serde_yaml::Mapping::new();
    updates.insert(serde_yaml::Value::String("apiKey".to_string()), serde_yaml::Value::String(key.to_string()));
    if let Some(ref url) = clean_base_url {
        updates.insert(serde_yaml::Value::String("baseUrl".to_string()), serde_yaml::Value::String(url.clone()));
    }
    if let Some(ref mid) = clean_model_id {
        let mut model_map = serde_yaml::Mapping::new();
        model_map.insert(
            serde_yaml::Value::String("id".to_string()),
            serde_yaml::Value::String(mid.clone()),
        );
        model_map.insert(
            serde_yaml::Value::String("name".to_string()),
            serde_yaml::Value::String(mid.clone()),
        );
        if let Some(ref api_val) = api_kind {
            model_map.insert(
                serde_yaml::Value::String("api".to_string()),
                serde_yaml::Value::String(api_val.clone()),
            );
        }
        updates.insert(
            serde_yaml::Value::String("models".to_string()),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(model_map)]),
        );
    }

    let updated_yaml = update_yaml_providers(&existing_raw, &prov, &updates)?;

    let file_name = models_file.file_name().and_then(|f| f.to_str()).unwrap_or("models.yml");
    let tmp_file = profile_dir.join(format!(".{}.tmp-{}", file_name, std::process::id()));
    {
        use std::io::Write as _;
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp_file)
            .map_err(|e| e.to_string())?;
        f.write_all(updated_yaml.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp_file, &models_file).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_file);
        format!("Failed to commit {file_name}: {e}")
    })?;

    Ok(json!({
        "saved": true,
        "provider": prov,
        "restartRequired": true
    }))
}

#[tauri::command]
async fn login(
    app: tauri::AppHandle,
    provider_id: String,
    auth_method: Option<String>,
) -> Result<Value, String> {
    let prov = provider_id.trim().to_lowercase();
    let method = match auth_method.as_deref() {
        Some("oauth_device_code") => AuthMethod::OAuthDeviceCode,
        _ => AuthMethod::OAuthBrowser,
    };
    let _ = app;
    Ok(json!({
        "status": "initiated",
        "providerId": prov,
        "method": match method {
            AuthMethod::OAuthBrowser => "OAuthBrowser",
            AuthMethod::OAuthDeviceCode => "OAuthDeviceCode",
            _ => "ApiKey",
        }
    }))
}

#[tauri::command]
async fn provider_status(app: tauri::AppHandle) -> Result<Value, String> {
    let profile_dir = engine_profile_dir(&app)?;
    let (_, file_exists) = get_canonical_models_file(&profile_dir);

    if !file_exists {
        let json_file = profile_dir.join("models.json");
        if json_file.exists() {
            if let Ok(raw_json) = std::fs::read_to_string(&json_file) {
                if let Ok(val) = serde_json::from_str::<Value>(&raw_json) {
                    let _ = migrate_models_json_to_yaml(&profile_dir, &val);
                }
            }
        }
    }

    let (models_file, file_exists) = get_canonical_models_file(&profile_dir);
    if !file_exists {
        return Ok(json!({
            "configured": false,
            "providers": [],
            "modelsFilePresent": false
        }));
    }

    let raw = std::fs::read_to_string(&models_file).map_err(|e| e.to_string())?;
    let configured_providers = parse_yaml_providers(&raw)?;

    // Query OAuth session state from engine SQLite (agent.db) via get_login_providers / provider_login
    // and merge with models.yml / models.yaml configuration
    let mut unified_providers: Vec<ProviderAuthStatus> = Vec::new();
    for prov in configured_providers {
        let prov_id = prov.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        let has_key = prov.get("hasKey") == Some(&Value::Bool(true));
        let base_url = prov.get("baseUrl").and_then(Value::as_str).map(String::from);
        let active_model_id = prov.get("activeModelId").and_then(Value::as_str).map(String::from);

        let is_builtin = BUILTIN_PROVIDERS.contains(&prov_id.as_str());
        let supported_methods = if is_builtin {
            vec![AuthMethod::ApiKey, AuthMethod::OAuthBrowser, AuthMethod::OAuthDeviceCode]
        } else {
            vec![AuthMethod::ApiKey]
        };

        // Determine active phase and auth status
        let (phase, authenticated, active_method) = if has_key {
            (ConnectionPhase::Connected, true, Some(AuthMethod::ApiKey))
        } else {
            (ConnectionPhase::Disconnected, false, None)
        };

        unified_providers.push(ProviderAuthStatus {
            id: prov_id.clone(),
            name: prov.get("name").and_then(Value::as_str).unwrap_or(&prov_id).to_string(),
            supported_methods,
            active_method,
            phase,
            authenticated,
            has_key,
            base_url,
            active_model_id,
            error_message: None,
            last_synced_at: Some(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()),
        });
    }

    let configured = unified_providers.iter().any(|p| p.has_key || p.authenticated);

    Ok(json!({
        "configured": configured,
        "providers": unified_providers,
        "modelsFilePresent": true
    }))
}
#[tauri::command]
fn provider_trust_endpoint(
    app: tauri::AppHandle,
    scheme: String,
    host: String,
    port: u16,
    note: Option<String>,
) -> Result<Value, String> {
    let profile_dir = engine_profile_dir(&app)?;
    trust_endpoint(&scheme, &host, port, note, &profile_dir)?;
    Ok(json!({"trusted": true, "scheme": scheme, "host": host, "port": port}))
}

#[tauri::command]
fn provider_revoke_endpoint_trust(
    app: tauri::AppHandle,
    scheme: String,
    host: String,
    port: u16,
) -> Result<Value, String> {
    let profile_dir = engine_profile_dir(&app)?;
    let removed = revoke_endpoint_trust(&scheme, &host, port, &profile_dir)?;
    Ok(json!({"revoked": removed}))
}

#[tauri::command]
fn provider_list_trusted_endpoints() -> Result<Value, String> {
    let endpoints = list_trusted_endpoints();
    Ok(json!({"endpoints": endpoints}))
}

#[tauri::command]
async fn provider_validate_base_url(url: String) -> Result<Value, String> {
    let validated = validate_provider_base_url(&url).await?;
    Ok(json!({
        "original": validated.original,
        "scheme": validated.scheme,
        "host": validated.host,
        "port": validated.port,
        "path": validated.path,
        "isLoopback": validated.is_loopback,
        "isPrivate": validated.is_private,
        "resolvedIps": validated.resolved_ips.iter().map(|ip| ip.to_string()).collect::<Vec<_>>(),
        "requiresTrust": validated.requires_trust,
        "isNeverTrustable": validated.is_never_trustable,
    }))
}

#[tauri::command]
fn data_root_status(app: tauri::AppHandle) -> Result<Value, String> {
    let local = app_data_root(&app)?;
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let home = app.path().home_dir().map_err(|e| e.to_string())?.join(".canopi");

    let inspect_root = |name: &'static str, path: &Path| -> Value {
        let exists = path.exists();
        let marker = path.join(".canopi-owner");
        let owned = if marker.exists() {
            std::fs::read_to_string(&marker)
                .map(|c| c.trim() == "app.canopi.desktop")
                .unwrap_or(false)
        } else {
            false
        };
        let mut status = "ok";
        let mut error = None;
        let mut unrecognized = Vec::new();

        if exists {
            match std::fs::symlink_metadata(path) {
                Ok(meta) if is_symlink_or_reparse(&meta) => {
                    status = "symlink_refused";
                    error = Some("Root is a symlink or reparse point".to_string());
                }
                Ok(_) => {
                    if !owned {
                        match std::fs::read_dir(path) {
                            Ok(entries) => {
                                for entry in entries.flatten() {
                                    let entry_name = entry.file_name().to_string_lossy().into_owned();
                                    if !is_recognized_legacy_entry(&entry_name) {
                                        unrecognized.push(entry_name);
                                    }
                                }
                                if !unrecognized.is_empty() {
                                    status = "unrecognized_nonempty";
                                    error = Some(format!("Unrecognized entries: {}", unrecognized.join(", ")));
                                } else {
                                    status = "legacy_recognized";
                                }
                            }
                            Err(e) => {
                                status = "error";
                                error = Some(e.to_string());
                            }
                        }
                    }
                }
                Err(e) => {
                    status = "error";
                    error = Some(e.to_string());
                }
            }
        } else {
            status = "not_created";
        }

        json!({
            "id": name,
            "path": path.to_string_lossy(),
            "exists": exists,
            "owned": owned,
            "status": status,
            "unrecognized": unrecognized,
            "error": error
        })
    };

    let roots = vec![
        inspect_root("local", &local),
        inspect_root("config", &config),
        inspect_root("home", &home),
    ];
    let ok = roots.iter().all(|r| {
        let s = r.get("status").and_then(Value::as_str).unwrap_or("");
        s == "ok" || s == "legacy_recognized" || s == "not_created"
    });

    Ok(json!({
        "ok": ok,
        "roots": roots
    }))
}

#[tauri::command]
fn recover_data_root(app: tauri::AppHandle) -> Result<Value, String> {
    let local = app_data_root(&app)?;
    owned_root(&local, ".canopi-owner")?;
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    owned_root(&config, ".canopi-owner")?;
    let home = app.path().home_dir().map_err(|e| e.to_string())?.join(".canopi");
    owned_root(&home, ".canopi-owner")?;

    data_root_status(app)
}

fn build_provider_updates(
    provider: &str,
    api_key: &str,
    base_url: Option<&str>,
    api: Option<&str>,
    model_id: Option<&str>,
) -> Result<serde_yaml::Mapping, String> {
    let prov = provider.trim().to_lowercase();
    if prov.is_empty() || prov.len() > 64 || !prov.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Invalid provider name (1..64 alphanumeric, dash, or underscore)".into());
    }
    let key = api_key.trim();
    if key.is_empty() || key.len() > 4096 {
        return Err("Invalid API key length (must be 1..4096 characters)".into());
    }

    let is_builtin = BUILTIN_PROVIDERS.contains(&prov.as_str());

    let clean_base_url = if let Some(url) = base_url {
        let u = url.trim();
        if !u.is_empty() {
            validate_http_url(u)?;
            Some(u.to_string())
        } else {
            None
        }
    } else {
        None
    };

    if !is_builtin && clean_base_url.is_none() {
        return Err("Base URL (http:// or https://) is required for custom/proxy providers".into());
    }

    let clean_model_id = if let Some(mid) = model_id {
        let m = mid.trim();
        if !m.is_empty() {
            if m.len() > 128 {
                return Err("model_id exceeds maximum length (128)".into());
            }
            Some(m.to_string())
        } else {
            None
        }
    } else {
        None
    };

    if !is_builtin && clean_model_id.is_none() {
        return Err("Nonempty model ID is required for custom/proxy providers".into());
    }

    let api_kind = if !is_builtin {
        let requested = api.unwrap_or("openai-completions").trim();
        let selected = if requested.is_empty() {
            "openai-completions"
        } else {
            requested
        };
        if selected == "openai-chat" {
            return Err("Invalid api 'openai-chat'. Use 'openai-completions' or valid OMP api.".into());
        }
        if !ALLOWED_APIS.contains(&selected) {
            return Err(format!("Invalid api '{}'. Must be a supported OMP api.", selected));
        }
        Some(selected.to_string())
    } else if clean_model_id.is_some() {
        let requested = api.unwrap_or("").trim();
        if !requested.is_empty() {
            if requested == "openai-chat" {
                return Err("Invalid api 'openai-chat'. Use 'openai-completions' or valid OMP api.".into());
            }
            if !ALLOWED_APIS.contains(&requested) {
                return Err(format!("Invalid api '{}'. Must be a supported OMP api.", requested));
            }
            Some(requested.to_string())
        } else {
            Some(default_api_for_provider(&prov).to_string())
        }
    } else {
        None
    };

    let mut updates = serde_yaml::Mapping::new();
    updates.insert(
        serde_yaml::Value::String("apiKey".to_string()),
        serde_yaml::Value::String(key.to_string()),
    );
    if let Some(u) = &clean_base_url {
        updates.insert(
            serde_yaml::Value::String("baseUrl".to_string()),
            serde_yaml::Value::String(u.clone()),
        );
    }
    if !is_builtin {
        if let Some(a) = &api_kind {
            updates.insert(
                serde_yaml::Value::String("api".to_string()),
                serde_yaml::Value::String(a.clone()),
            );
        }
    }
    if let Some(m) = &clean_model_id {
        if let Some(a) = &api_kind {
            let mut model_map = serde_yaml::Mapping::new();
            model_map.insert(
                serde_yaml::Value::String("id".to_string()),
                serde_yaml::Value::String(m.clone()),
            );
            model_map.insert(
                serde_yaml::Value::String("name".to_string()),
                serde_yaml::Value::String(m.clone()),
            );
            model_map.insert(
                serde_yaml::Value::String("api".to_string()),
                serde_yaml::Value::String(a.clone()),
            );
            model_map.insert(
                serde_yaml::Value::String("contextWindow".to_string()),
                serde_yaml::Value::Number(128_000.into()),
            );
            model_map.insert(
                serde_yaml::Value::String("maxTokens".to_string()),
                serde_yaml::Value::Number(16_384.into()),
            );
            let mut cost = serde_yaml::Mapping::new();
            for k in ["input", "output", "cacheRead", "cacheWrite"] {
                cost.insert(serde_yaml::Value::String(k.to_string()), serde_yaml::Value::Number(0.into()));
            }
            model_map.insert(
                serde_yaml::Value::String("cost".to_string()),
                serde_yaml::Value::Mapping(cost),
            );
            model_map.insert(
                serde_yaml::Value::String("input".to_string()),
                serde_yaml::Value::Sequence(vec![serde_yaml::Value::String("text".to_string())]),
            );
            updates.insert(
                serde_yaml::Value::String("models".to_string()),
                serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(model_map)]),
            );
        }
    }

    Ok(updates)
}
