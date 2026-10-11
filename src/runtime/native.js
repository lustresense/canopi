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

/* Extended terminal surface (registered by Main in invoke_handler). */
export async function listTerminals(sessionKey) {
  requireDesktop(); return invoke('pty_list',{sessionKey});
}
export async function signalTerminal(sessionKey, terminalId, kind) {
  requireDesktop(); return invoke('pty_signal',{sessionKey,terminalId,kind});
}
export async function closeSessionTerminals(sessionKey) {
  requireDesktop(); return invoke('pty_close_session',{sessionKey});
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

/* Agent-owned browser surface beyond open/close. */
export async function navigateAgentBrowser(sessionKey, agentId, url) {
  requireDesktop(); return invoke('browser_navigate',{sessionKey,agentId,url});
}
export async function reloadAgentBrowser(sessionKey, agentId) {
  requireDesktop(); return invoke('browser_reload',{sessionKey,agentId});
}
export async function agentBrowserState(sessionKey, agentId) {
  requireDesktop(); return invoke('browser_state',{sessionKey,agentId});
}
export async function readAgentBrowser(sessionKey, agentId, kind) {
  requireDesktop(); return invoke('browser_read',{sessionKey,agentId,kind});
}
export async function actAgentBrowser(sessionKey, agentId, op) {
  requireDesktop(); return invoke('browser_act',{sessionKey,agentId,op});
}
export async function screenshotAgentBrowser(sessionKey, agentId) {
  requireDesktop(); return invoke('browser_screenshot',{sessionKey,agentId});
}
export async function clearAgentBrowserData(sessionKey, agentId) {
  requireDesktop(); return invoke('browser_clear_data',{sessionKey,agentId});
}

/** Explicit one-file import, never imports auth DB or overwrites existing config. */
export async function previewOmpModels() {
  requireDesktop();return invoke('provider_import_preview');
}
export async function importOmpModels(filename) {
  requireDesktop();return invoke('provider_import_models',{filename});
}

/** Provider API key persistence and configuration status in isolated canoPi profile. */
export async function getProviderStatus() {
  requireDesktop(); return invoke('provider_status');
}
export async function saveProviderKey(provider, apiKey, baseUrl, api, modelId) {
  requireDesktop(); return invoke('provider_save_key', { provider, apiKey, baseUrl, api, modelId });
}

/** Data root diagnostics and safe recovery for unowned/legacy canoPi roots. */
export async function dataRootStatus() {
  requireDesktop(); return invoke('data_root_status');
}
export async function recoverDataRoot() {
  requireDesktop(); return invoke('recover_data_root');
}
