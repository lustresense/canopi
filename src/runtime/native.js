/** Actual native Windows ConPTY (via portable-pty) and per-agent WebView2 windows.
 * Nothing in this module produces fake terminal/browser data.
 * Native browser windows are interactive for the user, not a claim of OMP
 * `tab.run`/computer-tool parity.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { inDesktop } from './omp.js';

const requireDesktop = () => { if (!inDesktop()) throw new Error('Only available in canoPi Desktop'); };
export async function createTerminal(sessionKey, terminalId, projectPath) {
  requireDesktop();
  return invoke('pty_open',{sessionKey,terminalId,projectPath});
}
export async function writeTerminal(sessionKey, terminalId, data) {
  requireDesktop(); return invoke('pty_write',{sessionKey,terminalId,data});
}
export async function resizeTerminal(sessionKey, terminalId, rows, cols) {
  requireDesktop(); return invoke('pty_resize',{sessionKey,terminalId,rows,cols});
}
export async function closeTerminal(sessionKey, terminalId) {
  requireDesktop(); return invoke('pty_close',{sessionKey,terminalId});
}
export async function watchTerminal(onChunk, onExit) {
  requireDesktop();
  const un1=await listen('cnp-pty-data',({payload})=>onChunk(payload));
  try {
    const un2=await listen('cnp-pty-exit',({payload})=>onExit(payload));
    return ()=>{un1();un2();};
  }catch(e){un1();throw e;}
}
export async function openAgentBrowser(sessionKey,agentId,url) {
  requireDesktop();return invoke('browser_open',{sessionKey,agentId,url});
}
export async function closeAgentBrowser(sessionKey,agentId) {
  requireDesktop();return invoke('browser_close',{sessionKey,agentId});
}

/** Explicit one-file import, never imports auth DB or overwrites existing config. */
export async function previewOmpModels() {
  requireDesktop();return invoke('provider_import_preview');
}
export async function importOmpModels(filename) {
  requireDesktop();return invoke('provider_import_models',{filename});
}
