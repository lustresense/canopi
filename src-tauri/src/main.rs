#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

fn allowed_command(cmd: &Value) -> Result<&str, String> {
    let ty = cmd.get("type").and_then(Value::as_str).ok_or("RPC command type missing")?;
    const ALLOWED: &[&str] = &[
        "negotiate_protocol", "prompt", "steer", "follow_up", "abort", "get_state", "new_session",
        "open_session", "get_available_models", "set_model", "get_subagents",
        "get_subagent_messages", "set_subagent_subscription", "steer_subagent", "cancel_subagent",
        "get_available_commands", "get_messages", "get_messages_page", "get_entries", "get_tree",
        "get_available_thinking_levels", "set_thinking_level", "set_ask_dialog", "set_event_filter",
    ];
    if !ALLOWED.contains(&ty) { return Err(format!("RPC command not allowlisted: {ty}")); }
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

// Important upstream behavior: PI_CONFIG_DIR is a *directory name under home*,
// not an arbitrary absolute path. PI_CODING_AGENT_DIR is absolute but affects
// the default profile only. Profile migration and full isolation need smoke tests.
fn owned_root(path: &Path, marker_name: &str) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() { return Err("canoPi data root must not be a symlink".into()); }
    let marker = path.join(marker_name);
    if marker.exists() {
        let existing = std::fs::read_to_string(&marker).map_err(|e| e.to_string())?;
        if existing.trim() != "app.canopi.desktop" { return Err(format!("Existing unowned data root: {}", path.display())); }
    } else {
        // Refuse to claim an existing directory that contains unknown files.
        // Markers are set before creating any managed child paths.
        if std::fs::read_dir(path).map_err(|e| e.to_string())?.next().is_some() {
            return Err(format!("Cannot claim nonempty unowned root: {}", path.display()));
        }
        std::fs::write(marker, b"app.canopi.desktop\n").map_err(|e| e.to_string())?;
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
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
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

// Session teardown closes the host-side PTY and browser surfaces owned by a
// session. Both close helpers are idempotent, so rpc_stop and the reader EOF
// path may run them in either order.
fn teardown_session_resources(app: &tauri::AppHandle, session_key: &str) {
    let terms = app.state::<native::TerminalManager>();
    native::close_session_terminals(&terms, session_key);
    native::close_session_browsers(session_key);
}

#[tauri::command]
async fn rpc_stop(app: tauri::AppHandle, state: tauri::State<'_, Supervisor>, session_key: String) -> Result<(), String> {
    if let Some(session) = state.sessions.lock().await.remove(&session_key) {
        stop_engine(session).await?;
    }
    // Session teardown: PTYs and browser surfaces belong to the session, not
    // to this engine process; close them even if the engine was already gone.
    teardown_session_resources(&app, &session_key);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Supervisor::default())
        .manage(native::TerminalManager::default())
        .invoke_handler(tauri::generate_handler![runtime_info, rpc_start, rpc_send, rpc_ui_reply, rpc_stop, native::pty_open, native::pty_write, native::pty_resize, native::pty_close, native::pty_signal, native::pty_list, native::pty_close_session, native::browser_open, native::browser_close, native::browser_navigate, native::browser_reload, native::browser_state, native::browser_read, native::browser_act, native::browser_screenshot, native::browser_clear_data, provider_import_preview, provider_import_models])
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
                    let terms = app.state::<native::TerminalManager>();
                    native::close_all_terminals(&terms);
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
}

/// Narrow opt-in provider-definition import. Never copy OMP's auth SQLite DB,
/// sessions or extensions. The source is read-only and remains user-owned.
#[tauri::command]
fn provider_import_preview(app: tauri::AppHandle) -> Result<Value, String> {
    let source = app.path().home_dir().map_err(|e|e.to_string())?.join(".omp").join("agent");
    let names = ["models.yml", "models.yaml", "models.json"];
    let files = names.iter().filter(|name| {
        let p=source.join(name);
        std::fs::symlink_metadata(&p).map(|m|m.is_file() && !m.file_type().is_symlink() && m.len()<=1_048_576).unwrap_or(false)
    }).map(|x|x.to_string()).collect::<Vec<_>>();
    Ok(json!({"available":!files.is_empty(),"files":files,
        "scope":"Provider model definitions only. Credentials stored in agent.db are never imported."}))
}

#[tauri::command]
fn provider_import_models(app: tauri::AppHandle, filename: String) -> Result<Value,String> {
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
    // Only the native provider file is copied. No symlinks, no overwrite, no
    // processing of secrets in the GUI, and never any access to ~/.omp/agent.db.
    let to=engine_profile_dir(&app)?.join(&filename);
    let mut file=OpenOptions::new().write(true).create_new(true).open(&to)
        .map_err(|_|"canoPi models file already exists; import is non-overwriting".to_string())?;
    use std::io::Write as _;
    file.write_all(&data).map_err(|e|e.to_string())?;
    file.sync_all().map_err(|e|e.to_string())?;
    Ok(json!({"imported":filename,"scope":"models-only","restartRequired":true}))
}
