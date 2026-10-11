/* canoPi native bridge. Never executes a global omp binary and never simulates replies. */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

const generations = new Map();
export const getSessionGeneration = sessionKey => generations.get(sessionKey);
export const inDesktop = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
export async function pickProject() {
  if (!inDesktop()) throw new Error('Open project requires the canoPi desktop app');
  return await open({ directory: true, multiple: false, title: 'Open a project folder' });
}
export async function runtimeInfo() {
  if (!inDesktop()) return { available: false, error: 'Tauri runtime unavailable. This browser is only a UI preview.' };
  return invoke('runtime_info');
}
export async function startRuntime(sessionKey, projectPath) {
  if (!inDesktop()) throw new Error('Tauri runtime unavailable');
  const result = await invoke('rpc_start', { sessionKey, projectPath });
  if (Number.isSafeInteger(result?.generation)) generations.set(sessionKey, result.generation);
  return result;
}
export async function sendRpc(sessionKey, command) {
  if (!inDesktop()) throw new Error('Tauri runtime unavailable');
  const response = await invoke('rpc_send', { sessionKey, command, expectedGeneration: generations.get(sessionKey) ?? null });
  if (!response?.success) throw new Error(response?.error || 'OMP rejected the command');
  return response.data ?? null;
}
export async function answerUi(sessionKey, response) {
  return invoke('rpc_ui_reply', { sessionKey, response, expectedGeneration: generations.get(sessionKey) ?? null });
}
export async function watchFrames(onFrame) {
  if (!inDesktop()) return () => {};
  return listen('cnp-frame', e => {
    const packet = e.payload;
    const current = generations.get(packet?.sessionKey);
    if (current == null || packet?.generation !== current) return;
    onFrame(packet);
  });
}
export async function stopRuntime(sessionKey) {
  if (!inDesktop()) return;
  const result = await invoke('rpc_stop', { sessionKey });
  generations.delete(sessionKey);
  return result;
}

export { textFromMessage, normalizeTodos, normalizeWorkers } from './projection.mjs';
