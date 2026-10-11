//! Native opt-in browser surfaces and real PTY terminals. These are desktop
//! facilities, not emulated tool output and not a substitute for OMP's browser
//! automation protocol. Remote webviews never receive main-window IPC rights.
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize, PtySystem};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Mutex;

use crate::{app_data_root, owned_root, valid_key};

#[derive(Default)]
pub struct TerminalManager {
    terminals: Mutex<HashMap<String, Arc<Terminal>>>,
}

struct Terminal {
    owner: String,
    writer: StdMutex<Box<dyn Write + Send>>,
    master: StdMutex<Box<dyn MasterPty + Send>>,
    child: StdMutex<Box<dyn PtyChild + Send + Sync>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalFrame {
    session_key: String,
    terminal_id: String,
    data_base64: String,
}

fn term_key(sid: &str, tid: &str) -> Result<String, String> {
    if !valid_key(sid) || !valid_key(tid) { return Err("Invalid terminal owner or ID".into()); }
    Ok(format!("{sid}/{tid}"))
}

#[tauri::command]
pub async fn pty_open(app: tauri::AppHandle, state: tauri::State<'_, TerminalManager>,
    session_key: String, terminal_id: String, project_path: String) -> Result<Value, String> {
    let key = term_key(&session_key, &terminal_id)?;
    if state.terminals.lock().await.contains_key(&key) { return Ok(json!({"terminalId":terminal_id,"alreadyOpen":true})); }
    let cwd = PathBuf::from(&project_path).canonicalize().map_err(|e|e.to_string())?;
    if !cwd.is_dir() { return Err("Terminal working directory is not a folder".into()); }
    let system = native_pty_system();
    let pair = system.openpty(PtySize { rows:24, cols:80, pixel_width:0, pixel_height:0 }).map_err(|e|e.to_string())?;
    let mut cmd = CommandBuilder::new(if cfg!(windows) { "powershell.exe" } else { "/bin/sh" });
    cmd.cwd(&cwd);
    let child = pair.slave.spawn_command(cmd).map_err(|e|e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e|e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e|e.to_string())?;
    let term = Arc::new(Terminal { owner:session_key.clone(), writer:StdMutex::new(writer),
        master:StdMutex::new(pair.master), child:StdMutex::new(child) });
    {
        let mut registry = state.terminals.lock().await;
        if registry.contains_key(&key) { return Err("Terminal creation already in progress".into()); }
        registry.insert(key, term);
    }
    std::thread::spawn(move || {
        let mut reader=reader;
        let mut buf=[0u8;8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app.emit("cnp-pty-data", TerminalFrame {
                        session_key:session_key.clone(), terminal_id:terminal_id.clone(),
                        data_base64:STANDARD.encode(&buf[..n]),
                    });
                }
            }
        }
        let _ = app.emit("cnp-pty-exit", json!({"sessionKey":session_key,"terminalId":terminal_id}));
    });
    Ok(json!({"terminalId":terminal_id,"alreadyOpen":false}))
}

#[tauri::command]
pub async fn pty_write(state: tauri::State<'_, TerminalManager>, session_key:String,
    terminal_id:String, data:String) -> Result<(),String> {
    let key=term_key(&session_key,&terminal_id)?;
    if data.as_bytes().len()>65536 { return Err("Terminal write too large".into()); }
    let term=state.terminals.lock().await.get(&key).cloned().ok_or("Unknown terminal")?;
    if term.owner!=session_key { return Err("Wrong terminal owner".into()); }
    let mut writer=term.writer.lock().map_err(|e|e.to_string())?;
    writer.write_all(data.as_bytes()).map_err(|e|e.to_string())?;
    writer.flush().map_err(|e|e.to_string())
}

#[tauri::command]
pub async fn pty_resize(state: tauri::State<'_, TerminalManager>, session_key:String,
    terminal_id:String, rows:u16, cols:u16) -> Result<(),String> {
    let key=term_key(&session_key,&terminal_id)?;
    if rows<2||rows>300||cols<10||cols>500 {return Err("Invalid PTY dimensions".into());}
    let term=state.terminals.lock().await.get(&key).cloned().ok_or("Unknown terminal")?;
    term.master.lock().map_err(|e|e.to_string())?
        .resize(PtySize {rows,cols,pixel_width:0,pixel_height:0}).map_err(|e|e.to_string())
}

#[tauri::command]
pub async fn pty_close(state: tauri::State<'_, TerminalManager>,session_key:String,terminal_id:String)->Result<(),String>{
    let key=term_key(&session_key,&terminal_id)?;
    if let Some(t)=state.terminals.lock().await.remove(&key) {
        t.child.lock().map_err(|e|e.to_string())?.kill().map_err(|e|e.to_string())?;
    }
    Ok(())
}

pub async fn close_all_terminals(state:&TerminalManager){
    let all:Vec<_> = state.terminals.lock().await.drain().map(|(_,t)|t).collect();
    for t in all { if let Ok(mut c)=t.child.lock(){ let _=c.kill(); } }
}

fn safe_browser_url(value:&str)->Result<tauri::Url,String>{
    if value.len()>2048 { return Err("Browser URL too long".into()); }
    let url=tauri::Url::parse(value).map_err(|_|"Invalid browser URL")?;
    let host=url.host_str().ok_or("Browser URL needs a hostname")?;
    let local = host == "localhost" || host == "127.0.0.1" || host == "[::1]";
    if url.scheme()!="https" && !(url.scheme()=="http" && local){return Err("Only HTTPS or loopback HTTP allowed".into());}
    if !url.username().is_empty() || url.password().is_some(){ return Err("URL credentials are forbidden".into()); }
    Ok(url)
}

fn browser_label(sid:&str,aid:&str)->Result<String,String>{
    if !valid_key(sid)||!valid_key(aid){return Err("Invalid browser owner".into());}
    Ok(format!("browser_{sid}_{aid}"))
}

#[tauri::command]
pub async fn browser_open(app:tauri::AppHandle,session_key:String,agent_id:String,url:String)->Result<Value,String>{
    let label=browser_label(&session_key,&agent_id)?;
    let url=safe_browser_url(&url)?;
    if let Some(existing)=app.get_webview_window(&label){
        existing.navigate(url).map_err(|e|e.to_string())?;
        existing.set_focus().map_err(|e|e.to_string())?;
        return Ok(json!({"label":label,"opened":true}));
    }
    let root=app_data_root(&app)?;
    owned_root(&root,".canopi-owner")?;
    let browser_dir=root.join("browser-profiles").join(&session_key).join(&agent_id);
    std::fs::create_dir_all(&browser_dir).map_err(|e|e.to_string())?;
    // Per-agent WebView2 user-data directories isolate cookies and storage on Windows.
    // macOS profile isolation needs a separate dataStoreIdentifier implementation.
    WebviewWindowBuilder::new(&app,label.clone(),WebviewUrl::External(url))
        .title(format!("canoPi · {agent_id} browser"))
        .inner_size(1120.0,780.0)
        .data_directory(browser_dir)
        .build().map_err(|e|format!("Native browser failed: {e}"))?;
    Ok(json!({"label":label,"opened":true}))
}

#[tauri::command]
pub async fn browser_close(app:tauri::AppHandle,session_key:String,agent_id:String)->Result<(),String>{
    let label=browser_label(&session_key,&agent_id)?;
    if let Some(w)=app.get_webview_window(&label){w.close().map_err(|e|e.to_string())?;}
    Ok(())
}
