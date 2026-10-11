//! Real OS terminal lifecycle: one ConPTY (Windows) / PTY (other OS) per
//! session+terminal, rooted at the session project folder.
//!
//! Output is forwarded verbatim as base64 byte chunks (ANSI sequences are never
//! interpreted or rewritten here; the frontend renderer owns that), input is
//! bounded UTF-8/byte passthrough, Ctrl+C is forwarded as the real 0x03
//! in-band interrupt that ConPTY translates into a CTRL_C_EVENT for the shell
//! process group. Every terminal has a bounded scrollback ring used only for
//! reattach replay. Child exit is captured from a real `child.wait()` and the
//! terminal is always removed from the registry when its reader thread ends,
//! so a naturally exited shell never blocks reopening its id.
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering},
        Arc,
    },
};

use parking_lot::Mutex;
use portable_pty::{
    native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize,
};
use serde_json::{json, Value};

use crate::valid_key;

pub const SCROLLBACK_CAP_BYTES: usize = 256 * 1024;
pub const MAX_WRITE_BYTES: usize = 64 * 1024;
pub const DEFAULT_ROWS: u16 = 24;
pub const DEFAULT_COLS: u16 = 80;
const MIN_ROWS: u16 = 2;
const MAX_ROWS: u16 = 300;
const MIN_COLS: u16 = 10;
const MAX_COLS: u16 = 500;
const MAX_TERMINALS_PER_SESSION: usize = 8;
const MAX_TERMINALS_TOTAL: usize = 32;
const EXIT_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(50);
const MAX_SHELL_PATH: usize = 1024;
const MAX_PROJECT_PATH: usize = 2048;

/// Events emitted by the terminal subsystem. The production sink bridges these
/// to Tauri events; tests capture them directly.
pub trait TerminalSink: Send + Sync + 'static {
    fn on_data(&self, session_key: &str, terminal_id: &str, seq: u64, data: Vec<u8>, replay: bool);
    fn on_exit(&self, session_key: &str, terminal_id: &str, exit_code: Option<i32>);
}

type Registry = Arc<Mutex<HashMap<String, HashMap<String, Arc<Terminal>>>>>;

#[derive(Default)]
pub struct TerminalManager {
    registry: Registry,
}

struct Terminal {
    session_key: String,
    terminal_id: String,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    child: Mutex<Option<Box<dyn PtyChild + Send + Sync>>>,
    rows: AtomicU16,
    cols: AtomicU16,
    next_seq: AtomicU64,
    scrollback: Mutex<Scrollback>,
    exited: AtomicBool,
}

/// Bounded FIFO byte ring. Oldest bytes are dropped once the cap is hit and the
/// dropped total is kept so the frontend can detect scrollback loss.
#[derive(Default)]
struct Scrollback {
    bytes: VecDeque<u8>,
    dropped: u64,
}

impl Scrollback {
    fn push(&mut self, chunk: &[u8]) {
        let keep = chunk.len().min(SCROLLBACK_CAP_BYTES);
        let trimmed = (chunk.len() - keep) as u64;
        if trimmed > 0 {
            self.dropped += trimmed;
        }
        self.bytes.extend(chunk[chunk.len() - keep..].iter().copied());
        while self.bytes.len() > SCROLLBACK_CAP_BYTES {
            self.bytes.pop_front();
            self.dropped += 1;
        }
    }
    fn snapshot(&self) -> Vec<u8> {
        self.bytes.iter().copied().collect()
    }
    fn len(&self) -> usize {
        self.bytes.len()
    }
}

fn term_key(sid: &str, tid: &str) -> Result<String, String> {
    if !valid_key(sid) || !valid_key(tid) {
        return Err("Invalid terminal owner or ID".into());
    }
    Ok(format!("{sid}/{tid}"))
}

fn validate_size(rows: u16, cols: u16) -> Result<(), String> {
    if rows < MIN_ROWS || rows > MAX_ROWS || cols < MIN_COLS || cols > MAX_COLS {
        return Err("Invalid PTY dimensions".into());
    }
    Ok(())
}

fn resolve_cwd(project_path: &str) -> Result<PathBuf, String> {
    if project_path.is_empty() || project_path.len() > MAX_PROJECT_PATH {
        return Err("Terminal working directory path is out of bounds".into());
    }
    let cwd = de_verbatim(
        PathBuf::from(project_path)
            .canonicalize()
            .map_err(|e| format!("Terminal working directory unavailable: {e}"))?,
    );
    if !cwd.is_dir() {
        return Err("Terminal working directory is not a folder".into());
    }
    Ok(cwd)
}

/// `canonicalize()` yields `\\?\`-prefixed paths on Windows; console shells
/// (cmd.exe among them) reject those as UNC and silently fall back to
/// `C:\Windows`. Convert back to the plain drive/UNC form for child processes.
fn de_verbatim(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest.to_string());
        }
    }
    path
}
/// Shell choice: explicit validated absolute path > `CANOPI_SHELL` >
/// OS default (`ComSpec` on Windows, `SHELL` elsewhere). Unvalidated strings
/// are never resolved through `PATH`.
fn resolve_shell(explicit: Option<&str>) -> Result<String, String> {
    let candidate: Option<String> = if let Some(s) = explicit {
        if s.is_empty() || s.len() > MAX_SHELL_PATH {
            return Err("Shell path is out of bounds".into());
        }
        let p = PathBuf::from(s);
        if !p.is_absolute() {
            return Err("Shell path must be absolute".into());
        }
        if !p.is_file() {
            return Err("Shell executable not found".into());
        }
        Some(s.to_string())
    } else {
        std::env::var("CANOPI_SHELL")
            .ok()
            .filter(|s| !s.is_empty() && s.len() <= MAX_SHELL_PATH)
    };
    if let Some(s) = candidate {
        return Ok(s);
    }
    #[cfg(windows)]
    {
        Ok(std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string()))
    }
    #[cfg(not(windows))]
    {
        Ok(std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()))
    }
}

impl TerminalManager {
    fn get(&self, sid: &str, tid: &str) -> Option<Arc<Terminal>> {
        self.registry.lock().get(sid)?.get(tid).cloned()
    }

    fn total_count(&self) -> usize {
        self.registry.lock().values().map(|t| t.len()).sum()
    }

    fn session_count(&self, sid: &str) -> usize {
        self.registry.lock().get(sid).map(|t| t.len()).unwrap_or(0)
    }

    /// Inserts, re-checking under the lock so two racing opens of the same id
    /// never both win (the loser has not spawned a shell at that point).
    fn insert(&self, sid: String, tid: String, term: Arc<Terminal>) -> Result<(), String> {
        let mut registry = self.registry.lock();
        let terms = registry.entry(sid).or_default();
        if terms.contains_key(&tid) {
            return Err("Terminal creation already in progress".into());
        }
        terms.insert(tid, term);
        Ok(())
    }

    fn remove(&self, sid: &str, tid: &str) -> Option<Arc<Terminal>> {
        let mut registry = self.registry.lock();
        let term = registry.get_mut(sid)?.remove(tid)?;
        if registry.get(sid).map(|t| t.is_empty()).unwrap_or(false) {
            registry.remove(sid);
        }
        Some(term)
    }
}

pub struct TerminalOpen {
    pub session_key: String,
    pub terminal_id: String,
    pub project_path: String,
    pub shell: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
}

pub fn open_terminal(
    manager: &TerminalManager,
    sink: Arc<dyn TerminalSink>,
    opts: TerminalOpen,
) -> Result<Value, String> {
    let sid = opts.session_key.clone();
    let tid = opts.terminal_id.clone();
    term_key(&sid, &tid)?;
    let cwd = resolve_cwd(&opts.project_path)?;
    let rows = opts.rows.unwrap_or(DEFAULT_ROWS);
    let cols = opts.cols.unwrap_or(DEFAULT_COLS);
    validate_size(rows, cols)?;
    let shell = resolve_shell(opts.shell.as_deref())?;

    if let Some(existing) = manager.get(&sid, &tid) {
        if existing.exited.load(Ordering::SeqCst) {
            return Err("Terminal has exited; wait for the exit event before reopening".into());
        }
        // Reattach: replay the bounded scrollback as one replacement chunk so a
        // fresh renderer can rebuild its buffer without duplicating history.
        let snapshot = existing.scrollback.lock().snapshot();
        sink.on_data(&sid, &tid, 0, snapshot, true);
        return Ok(json!({
            "terminalId": tid,
            "alreadyOpen": true,
            "rows": existing.rows.load(Ordering::SeqCst),
            "cols": existing.cols.load(Ordering::SeqCst),
        }));
    }
    if manager.session_count(&sid) >= MAX_TERMINALS_PER_SESSION {
        return Err("Session terminal limit reached".into());
    }
    if manager.total_count() >= MAX_TERMINALS_TOTAL {
        return Err("Global terminal limit reached".into());
    }

    let system = native_pty_system();
    let pair = system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd);
    cmd.env("CANOPI_SESSION", &sid);
    cmd.env("CANOPI_TERMINAL", &tid);
    cmd.env("CANOPI_PROJECT_DIR", cwd.to_string_lossy().as_ref().to_string());
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Shell failed to start: {e}"))?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let term = Arc::new(Terminal {
        session_key: sid.clone(),
        terminal_id: tid.clone(),
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(Some(pair.master)),
        child: Mutex::new(Some(child)),
        rows: AtomicU16::new(rows),
        cols: AtomicU16::new(cols),
        next_seq: AtomicU64::new(0),
        scrollback: Mutex::new(Scrollback::default()),
        exited: AtomicBool::new(false),
    });
    manager.insert(sid.clone(), tid.clone(), term.clone())?;

    let registry = manager.registry.clone();
    std::thread::spawn({
        let term = term.clone();
        let sink = sink.clone();
        move || run_reader(term, reader, sink)
    });
    std::thread::spawn(move || run_reaper(registry, term, sink));
    Ok(json!({
        "terminalId": tid,
        "alreadyOpen": false,
        "shell": shell,
        "cwd": cwd.to_string_lossy(),
        "rows": rows,
        "cols": cols,
    }))
}

/// Minimal terminal-peer behavior: conhost queries the cursor position
/// (Device Status Report `ESC[6n`) during startup, and real terminal
/// emulators answer it. Without the reply the console pipeline stalls and
/// produced output (including echo) never reaches the PTY reader. The reply
/// reports the logical viewport size, exactly like xterm-style peers do.
fn reply_to_cursor_queries(term: &Terminal, chunk: &[u8]) {
    if !chunk.windows(4).any(|window| window == b"\x1b[6n") {
        return;
    }
    let rows = term.rows.load(Ordering::SeqCst);
    let cols = term.cols.load(Ordering::SeqCst);
    let reply = format!("\x1b[{rows};{cols}R");
    if let Some(writer) = term.writer.lock().as_mut() {
        let _ = writer.write_all(reply.as_bytes());
        let _ = writer.flush();
    }
}

/// Output thread: streams PTY output chunks until the pipe closes. Exit
/// handling belongs to the reaper: on Windows the ConPTY pipe stays open
/// after the shell exits (conhost lives while handles are held), so EOF on
/// the reader would never arrive on its own.
fn run_reader(term: Arc<Terminal>, mut reader: Box<dyn Read + Send>, sink: Arc<dyn TerminalSink>) {
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let chunk = &buf[..n];
                term.scrollback.lock().push(chunk);
                reply_to_cursor_queries(&term, chunk);
                let seq = term.next_seq.fetch_add(1, Ordering::SeqCst);
                sink.on_data(&term.session_key, &term.terminal_id, seq, chunk.to_vec(), false);
            }
        }
    }
}

/// Exit thread: polls the real child status (`try_wait`) and, once the shell
/// exits (naturally, via Ctrl+C kill, or `exit`), frees the writer/master so
/// the reader unblocks, reaps the registry entry (natural exits included) and
/// emits exactly one exit event carrying the real exit code.
fn run_reaper(registry: Registry, term: Arc<Terminal>, sink: Arc<dyn TerminalSink>) {
    let exit_code: Option<i32> = loop {
        std::thread::sleep(EXIT_POLL_INTERVAL);
        let polled = {
            let mut guard = term.child.lock();
            match guard.as_mut() {
                Some(child) => {
                    child.try_wait().ok().flatten().map(|status| status.exit_code() as i32)
                }
                // Defensive: the child handle is gone (explicit close raced
                // us); report the exit without a status.
                None => break None,
            }
        };
        if let Some(code) = polled {
            break Some(code);
        }
    };
    term.exited.store(true, Ordering::SeqCst);
    *term.writer.lock() = None;
    *term.master.lock() = None;
    // Guard against a reopen of the same terminal id racing this reaper: only
    // remove the registry entry if it still points at THIS terminal instance.
    // If a newer terminal now owns the id, leave it alone and suppress the
    // stale instance's exit event so the live terminal is not torn down.
    let should_emit = {
        let mut map = registry.lock();
        match map.get_mut(&term.session_key).and_then(|t| t.get(&term.terminal_id)) {
            Some(current) if Arc::ptr_eq(current, &term) => {
                let terms = map.get_mut(&term.session_key).expect("session present");
                terms.remove(&term.terminal_id);
                if terms.is_empty() {
                    map.remove(&term.session_key);
                }
                true
            }
            // Already unregistered (e.g. pty_close removed it): still surface
            // the exit so explicit close produces exactly one exit event.
            None => true,
            // A different terminal now owns this id: stale, do not emit.
            Some(_) => false,
        }
    };
    if should_emit {
        sink.on_exit(&term.session_key, &term.terminal_id, exit_code);
    }
}

pub fn write_terminal(
    manager: &TerminalManager,
    sid: &str,
    tid: &str,
    data: &str,
) -> Result<(), String> {
    term_key(sid, tid)?;
    if data.len() > MAX_WRITE_BYTES {
        return Err("Terminal write too large".into());
    }
    let term = manager.get(sid, tid).ok_or("Unknown terminal")?;
    if term.session_key != sid {
        return Err("Wrong terminal owner".into());
    }
    if term.exited.load(Ordering::SeqCst) {
        return Err("Terminal has exited".into());
    }
    let mut guard = term.writer.lock();
    let writer = guard.as_mut().ok_or("Terminal is closed")?;
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

/// Forwards terminal control keys. `interrupt` writes the real in-band Ctrl+C
/// byte (ConPTY delivers CTRL_C_EVENT to the shell's process group); `eof`
/// writes the Ctrl+D byte. No synthetic process signals are fabricated.
pub fn signal_terminal(
    manager: &TerminalManager,
    sid: &str,
    tid: &str,
    kind: &str,
) -> Result<(), String> {
    let byte: u8 = match kind {
        "interrupt" => 0x03,
        "eof" => 0x04,
        _ => return Err("Unsupported terminal signal".into()),
    };
    write_terminal(manager, sid, tid, &String::from_utf8_lossy(&[byte]))
}

pub fn resize_terminal(
    manager: &TerminalManager,
    sid: &str,
    tid: &str,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    term_key(sid, tid)?;
    validate_size(rows, cols)?;
    let term = manager.get(sid, tid).ok_or("Unknown terminal")?;
    if term.exited.load(Ordering::SeqCst) {
        return Err("Terminal has exited".into());
    }
    {
        let guard = term.master.lock();
        let master = guard.as_ref().ok_or("Terminal is closed")?;
        master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    term.rows.store(rows, Ordering::SeqCst);
    term.cols.store(cols, Ordering::SeqCst);
    Ok(())
}

/// Idempotent close: unregisters first, then terminates the child and drops
/// the writer/master so the reader thread unblocks and emits the exit event.
pub fn close_terminal(manager: &TerminalManager, sid: &str, tid: &str) -> Result<bool, String> {
    term_key(sid, tid)?;
    let Some(term) = manager.remove(sid, tid) else {
        return Ok(false);
    };
    term.exited.store(true, Ordering::SeqCst);
    if let Some(mut child) = term.child.lock().take() {
        let _ = child.kill();
    }
    *term.writer.lock() = None;
    *term.master.lock() = None;
    Ok(true)
}

pub fn close_session_terminals(manager: &TerminalManager, sid: &str) -> usize {
    let ids: Vec<String> = manager
        .registry
        .lock()
        .get(sid)
        .map(|t| t.keys().cloned().collect())
        .unwrap_or_default();
    let mut closed = 0;
    for tid in ids {
        if close_terminal(manager, sid, &tid).unwrap_or(false) {
            closed += 1;
        }
    }
    closed
}

pub fn close_all_terminals(manager: &TerminalManager) -> usize {
    let keys: Vec<(String, String)> = manager
        .registry
        .lock()
        .iter()
        .flat_map(|(sid, terms)| terms.keys().map(move |tid| (sid.clone(), tid.clone())))
        .collect();
    let mut closed = 0;
    for (sid, tid) in keys {
        if close_terminal(manager, &sid, &tid).unwrap_or(false) {
            closed += 1;
        }
    }
    closed
}

pub fn list_terminals(manager: &TerminalManager, sid: &str) -> Result<Vec<Value>, String> {
    if !valid_key(sid) {
        return Err("Invalid session key".into());
    }
    let snapshot: Vec<Arc<Terminal>> = manager
        .registry
        .lock()
        .get(sid)
        .map(|terms| terms.values().cloned().collect())
        .unwrap_or_default();
    Ok(snapshot
        .into_iter()
        .map(|t| {
            let (scrollback, dropped) = {
                let sb = t.scrollback.lock();
                (sb.len() as u64, sb.dropped)
            };
            json!({
                "terminalId": t.terminal_id,
                "alive": !t.exited.load(Ordering::SeqCst),
                "rows": t.rows.load(Ordering::SeqCst),
                "cols": t.cols.load(Ordering::SeqCst),
                "scrollbackBytes": scrollback,
                "scrollbackDroppedBytes": dropped,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    struct ChannelSink {
        tx: mpsc::Sender<(String, String, Option<i32>)>,
    }
    impl TerminalSink for ChannelSink {
        fn on_data(&self, _s: &str, _t: &str, _seq: u64, _data: Vec<u8>, _replay: bool) {}
        fn on_exit(&self, s: &str, t: &str, code: Option<i32>) {
            let _ = self.tx.send((s.to_string(), t.to_string(), code));
        }
    }

    #[test]
    fn scrollback_is_bounded_and_counts_drops() {
        let mut sb = Scrollback::default();
        sb.push(&vec![b'a'; SCROLLBACK_CAP_BYTES + 10]);
        assert_eq!(sb.len(), SCROLLBACK_CAP_BYTES);
        assert_eq!(sb.dropped, 10);
        sb.push(b"tail");
        assert_eq!(sb.len(), SCROLLBACK_CAP_BYTES);
        let snap = sb.snapshot();
        assert!(snap.ends_with(b"tail"));
    }

    #[test]
    fn terminal_keys_reject_path_escapes() {
        assert!(term_key("s1", "t1").is_ok());
        assert!(term_key("../evil", "t1").is_err());
        assert!(term_key("s1", "a/b").is_err());
        assert!(term_key("", "t1").is_err());
    }

    #[test]
    fn size_bounds_are_enforced() {
        assert!(validate_size(24, 80).is_ok());
        assert!(validate_size(1, 80).is_err());
        assert!(validate_size(24, 9).is_err());
        assert!(validate_size(301, 80).is_err());
        assert!(validate_size(24, 501).is_err());
    }

    #[test]
    fn shell_resolution_rejects_unvalidated_paths() {
        assert!(resolve_shell(Some("not-absolute")).is_err());
        assert!(resolve_shell(Some("Z:\\definitely\\not\\a\\shell-xyz.exe")).is_err());
        // Default resolution always yields a non-empty candidate.
        assert!(!resolve_shell(None).unwrap().is_empty());
    }

    #[test]
    fn project_path_bounds_are_enforced() {
        assert!(resolve_cwd("").is_err());
        assert!(resolve_cwd(&"x".repeat(MAX_PROJECT_PATH + 1)).is_err());
        assert!(resolve_cwd("Z:\\definitely\\missing\\folder").is_err());
    }

    /// Real ConPTY lifecycle: open rooted at a temp dir, stream output, resize,
    /// forward Ctrl+C, exit with a real code, registry cleanup, reopen same id.
    #[cfg(windows)]
    #[test]
    fn pty_lifecycle_streams_resize_interrupts_and_reaps() {
        let manager = TerminalManager::default();
        let (tx, rx) = mpsc::channel();
        let sink: Arc<dyn TerminalSink> = Arc::new(ChannelSink { tx });
        let cwd = std::env::temp_dir().canonicalize().unwrap();
        let shell = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
        let open = open_terminal(
            &manager,
            sink.clone(),
            TerminalOpen {
                session_key: "sess1".into(),
                terminal_id: "term1".into(),
                project_path: cwd.to_string_lossy().into(),
                shell: Some(shell),
                rows: Some(30),
                cols: Some(120),
            },
        )
        .expect("pty open");
        assert_eq!(open["alreadyOpen"], false);

        // Reattach of a live terminal replays scrollback and does not spawn a shell.
        let again = open_terminal(
            &manager,
            sink.clone(),
            TerminalOpen {
                session_key: "sess1".into(),
                terminal_id: "term1".into(),
                project_path: cwd.to_string_lossy().into(),
                shell: None,
                rows: None,
                cols: None,
            },
        )
        .expect("reattach");
        assert_eq!(again["alreadyOpen"], true);

        write_terminal(&manager, "sess1", "term1", "echo canopi-marker-42\r").expect("write");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            {
                let term = manager.get("sess1", "term1").expect("registered");
                let snapshot = term.scrollback.lock().snapshot();
                if snapshot.windows(b"canopi-marker-42".len()).any(|w| w == b"canopi-marker-42") {
                    break;
                }
            }
            if std::time::Instant::now() >= deadline {
                let term = manager.get("sess1", "term1").expect("registered");
                let snap = term.scrollback.lock().snapshot();
                panic!(
                    "marker never arrived; scrollback {} bytes: {:?}",
                    snap.len(),
                    String::from_utf8_lossy(&snap[..snap.len().min(400)])
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        resize_terminal(&manager, "sess1", "term1", 40, 132).expect("resize");
        {
            let term = manager.get("sess1", "term1").unwrap();
            assert_eq!(term.rows.load(Ordering::SeqCst), 40);
            assert_eq!(term.cols.load(Ordering::SeqCst), 132);
        }

        // Ctrl+C forward: cancel the current line; the shell must survive it.
        signal_terminal(&manager, "sess1", "term1", "interrupt").expect("ctrl-c");
        signal_terminal(&manager, "sess1", "term1", "bogus").unwrap_err();

        write_terminal(&manager, "sess1", "term1", "exit 7\r").expect("exit write");
        let (s, t, code) = match rx.recv_timeout(std::time::Duration::from_secs(30)) {
            Ok(event) => event,
            Err(e) => {
                let info = match manager.get("sess1", "term1") {
                    Some(term) => {
                        let sb = term.scrollback.lock().snapshot();
                        let tail = &sb[sb.len().saturating_sub(300)..];
                        format!(
                            "still registered; exited={}; scrollback tail: {:?}",
                            term.exited.load(Ordering::SeqCst),
                            String::from_utf8_lossy(tail)
                        )
                    }
                    None => "unregistered (reaped) but no exit event".to_string(),
                };
                panic!("exit event: {e}; {info}");
            }
        };
        assert_eq!(s, "sess1");
        assert_eq!(t, "term1");
        assert_eq!(code, Some(7), "expected real cmd.exe exit code 7");

        assert!(list_terminals(&manager, "sess1").unwrap().is_empty(), "registry must reap");
        // Same id can be opened again after natural exit.
        let reopen = open_terminal(
            &manager,
            sink,
            TerminalOpen {
                session_key: "sess1".into(),
                terminal_id: "term1".into(),
                project_path: cwd.to_string_lossy().into(),
                shell: Some(std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into())),
                rows: None,
                cols: None,
            },
        )
        .expect("reopen after exit");
        assert_eq!(reopen["alreadyOpen"], false);
        close_terminal(&manager, "sess1", "term1").unwrap();
        assert!(manager.get("sess1", "term1").is_none());
    }

    /// Explicit close path: kill terminates the child, reader emits one exit
    /// event and the id is immediately reusable.
    #[cfg(windows)]
    #[test]
    fn pty_close_is_idempotent_and_frees_the_id() {
        let manager = TerminalManager::default();
        let (tx, rx) = mpsc::channel();
        let sink: Arc<dyn TerminalSink> = Arc::new(ChannelSink { tx });
        let cwd = std::env::temp_dir().canonicalize().unwrap();
        let shell = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
        open_terminal(
            &manager,
            sink,
            TerminalOpen {
                session_key: "sess2".into(),
                terminal_id: "termA".into(),
                project_path: cwd.to_string_lossy().into(),
                shell: Some(shell),
                rows: None,
                cols: None,
            },
        )
        .expect("open");
        assert!(close_terminal(&manager, "sess2", "termA").unwrap());
        assert!(close_terminal(&manager, "sess2", "termA").is_ok(), "second close is a no-op");
        let (_s, _t, _code) = rx.recv_timeout(std::time::Duration::from_secs(30)).expect("exit");
        assert!(list_terminals(&manager, "sess2").unwrap().is_empty());
    }
}
