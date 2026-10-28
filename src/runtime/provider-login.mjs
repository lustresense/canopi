/* Native OAuth login flow for canoPi providers.
 *
 * Pure module: no DOM access, no direct Tauri imports — every side effect is
 * injected so the flow can be unit-tested with mocks. Wire contract (OMP
 * `rpc-mode.ts`): `login {providerId}` is long-running (main.rs timeout 600s);
 * while it is in flight the engine emits `open_url` then `input` frames that
 * reach the host through the existing `extension_ui_request` listener. The host
 * answers `input` via `rpc_ui_reply`. `login`/`get_login_providers` are
 * allowlisted in src-tauri/src/main.rs.
 */

/** Ask the engine which providers support native login and their auth state. */
export async function fetchLoginProviders(sendRpc) {
  if (typeof sendRpc !== 'function') throw new Error('fetchLoginProviders requires sendRpc');
  const data = await sendRpc({ type: 'get_login_providers' });
  const list = Array.isArray(data) ? data : (data?.providers || []);
  return list
    .filter(p => p && p.id)
    .map(p => ({
      id: String(p.id),
      name: String(p.name || p.id),
      available: p.available !== false,
      authenticated: Boolean(p.authenticated),
    }));
}

/**
 * Handle one extension UI frame during a login attempt. Returns true when the
 * frame was consumed (`open_url` / `input`), false otherwise.
 *
 * - `open_url`: open the URL in the system browser (invoke open_external_url).
 * - `input`: non-secret prompt (paste-redirect URL) answered via answerInput.
 */
export function handleLoginFrame(frame, ctx = {}) {
  const method = frame && frame.method;
  if (method === 'open_url') {
    const url = String(frame.launchUrl || frame.url || '');
    if (ctx.onOpenUrl) ctx.onOpenUrl({ url });
    if (url && typeof ctx.openUrl === 'function') {
      Promise.resolve(ctx.openUrl(url)).catch(err => {
        if (ctx.toast) ctx.toast('Could not open sign-in link: ' + String(err?.message || err));
      });
    }
    return true;
  }
  if (method === 'input') {
    const id = String(frame.id || '');
    const prompt = String(frame.prompt || frame.text || 'Paste the sign-in URL from your browser.');
    if (ctx.onInput) ctx.onInput({ id, prompt });
    if (typeof ctx.answerInput === 'function' && id) {
      Promise.resolve(ctx.answerInput({ id, prompt })).catch(err => {
        if (ctx.toast) ctx.toast('Sign-in reply failed: ' + String(err?.message || err));
      });
    }
    return true;
  }
  return false;
}

/**
 * Run one native OAuth login and refresh UI state afterwards.
 *
 * `onFrame` is invoked with every frame observed while `login` is in flight
 * (open_url, input, …). Returning the unsubscribe function lets the caller stop
 * observing once the login promise settles.
 *
 * @param {object} deps
 * @param {string} deps.providerId                provider to log in (required).
 * @param {(cmd:object)=>Promise<any>} deps.sendRpc   send an RPC command.
 * @param {(url:string)=>Promise<any>} deps.openUrl   open an external URL (browser).
 * @param {(p:{id:string,prompt:string})=>Promise<any>} [deps.answerInput] reply to `input`.
 * @param {()=>Promise<any>} [deps.refreshStatus]   refresh provider status.
 * @param {()=>Promise<any>} [deps.refreshModels]   refresh the model catalog.
 * @param {(msg:string)=>void} [deps.toast]         surface a user-visible message.
 * @param {()=>(()=>void)} [deps.observeFrames]     subscribe to frames; returns unsubscribe.
 * @param {(m:object)=>void} [deps.onFrame]         observe frames during login.
 * @returns {Promise<{ok:boolean, data?:any, error?:string}>}
 */
export async function runProviderLogin({
  providerId,
  sendRpc,
  openUrl,
  answerInput,
  refreshStatus,
  refreshModels,
  toast,
  observeFrames,
  onFrame,
}) {
  const fail = (error) => { if (toast) toast(String(error)); return { ok: false, error: String(error) }; };
  if (!providerId) return fail('runProviderLogin requires providerId');
  if (typeof sendRpc !== 'function') return fail('runProviderLogin requires sendRpc');
  if (typeof openUrl !== 'function') return fail('runProviderLogin requires openUrl');

  const ctx = { openUrl, answerInput, toast };
  let unsubscribe = null;
  if (typeof observeFrames === 'function') {
    try { unsubscribe = observeFrames(frame => { if (onFrame) onFrame(frame); handleLoginFrame(frame, ctx); }); }
    catch { /* observation is best-effort; login still proceeds */ }
  }
  try {
    const data = await sendRpc({ type: 'login', providerId });
    if (refreshStatus) { try { await refreshStatus(); } catch { /* non-fatal */ } }
    if (refreshModels) { try { await refreshModels(); } catch { /* non-fatal */ } }
    if (toast) toast('Signed in to ' + providerId + '.');
    return { ok: true, data };
  } catch (e) {
    return fail('Sign-in failed: ' + String(e?.message || e));
  } finally {
    if (typeof unsubscribe === 'function') { try { unsubscribe(); } catch { /* ignore */ } }
  }
}
