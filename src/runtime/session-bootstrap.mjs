/**
 * Session bootstrap and deterministic model selection for canoPi.
 * Ensures models are discovered and explicitly bound before user prompts dispatch.
 */

/**
 * Discovers models and ensures a deterministic model is bound before prompts run.
 * If currentModel is missing and catalog is non-empty, sets models[0].
 */
export async function ensureSessionModel({
  sendRpc,
  currentModel,
  refreshModels,
  refreshState,
  refreshThinkingLevels,
  setModel
}) {
  const models = await refreshModels();
  if (!models || models.length === 0) {
    return { ok: false, reason: 'empty_catalog', models: [] };
  }

  let activeModel = currentModel;
  if (!activeModel) {
    const first = models[0];
    const mid = first.id || first.modelId;
    if (!first.provider || !mid) {
      return { ok: false, reason: 'invalid_model_descriptor', models };
    }
    await sendRpc({ type: 'set_model', provider: first.provider, modelId: mid });
    activeModel = { provider: first.provider, modelId: mid };
    if (setModel) setModel(activeModel);
    if (refreshState) await refreshState();
    if (refreshThinkingLevels) await refreshThinkingLevels();
  }

  return { ok: true, model: activeModel, models };
}

/**
 * Session start lifecycle state machine.
 * Enforces that model selection strictly precedes prompt dispatch,
 * and that failure to select a model halts prompt execution.
 */
export async function executeSessionStart({
  sessionId,
  text,
  startRuntime,
  bootSession,
  getActiveModel,
  pushUserMessage,
  sendPrompt,
  onSetupRequired,
  onError
}) {
  try {
    await startRuntime(sessionId);
    const models = await bootSession(sessionId);
    const activeModel = getActiveModel ? getActiveModel(sessionId) : null;
    if (!models || !models.length || !activeModel) {
      if (onSetupRequired) onSetupRequired();
      return { status: 'model_setup_required' };
    }
    if (pushUserMessage) pushUserMessage(sessionId, text);
    if (sendPrompt) await sendPrompt(sessionId, text);
    return { status: 'prompt_sent', model: activeModel };
  } catch (err) {
    if (onError) onError(err);
    return { status: 'error', error: err };
  }
}

