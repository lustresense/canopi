/** Native capability bridge: agent-owned WebView2 windows and profile management.
 * Native browser windows are interactive for the user, not a claim of OMP
 * `tab.run`/computer-tool parity.
 */
import { invoke } from '@tauri-apps/api/core';
import { inDesktop } from './omp.js';

const requireDesktop = () => { if (!inDesktop()) throw new Error('Only available in canoPi Desktop'); };

export async function windowMinimize() {
  requireDesktop(); return invoke('window_minimize');
}
export async function windowMaximize() {
  requireDesktop(); return invoke('window_maximize');
}
export async function windowClose() {
  requireDesktop(); return invoke('window_close');
}
export async function windowStartDragging() {
  requireDesktop(); return invoke('window_start_dragging');
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
export async function importOmpModels(filename, selectedProviderIds) {
  requireDesktop();return invoke('provider_import_models',{filename, selectedProviderIds});
}

/** Provider endpoint trust management and import preview. */
export async function validateProviderBaseUrl(url) {
  requireDesktop(); return invoke('provider_validate_base_url', { url });
}
export async function trustProviderEndpoint(scheme, host, port, note) {
  requireDesktop(); return invoke('provider_trust_endpoint', { scheme, host, port, note });
}
export async function revokeProviderEndpointTrust(scheme, host, port) {
  requireDesktop(); return invoke('provider_revoke_endpoint_trust', { scheme, host, port });
}
export async function listTrustedProviderEndpoints() {
  requireDesktop(); return invoke('provider_list_trusted_endpoints');
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

/** Open an external http(s) URL with the OS handler (OAuth sign-in links). */
export async function openExternalUrl(url) {
  requireDesktop(); return invoke('open_external_url', { url });
}

/** Native provider login for OAuth flows (PKCE, browser, device code). */
export async function runProviderLogin(providerId, authMethod) {
  requireDesktop(); return invoke('login', { providerId, authMethod });
}

