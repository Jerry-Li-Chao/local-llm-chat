export function createModelContextController({
  elements,
  state,
  persistState,
  getActiveSession,
  maybeGenerateSessionTitle,
  measureCurrentConversationContextUsage,
}) {
  function setConnection(ok, detail) {
    elements.connectionStatus.textContent = ok ? 'Connected' : 'Offline';
    elements.connectionStatus.dataset.state = ok ? 'connected' : 'offline';
    elements.connectionDetail.textContent = detail;
  }

  function updateContextPill() {
    const activeSession = getActiveSession();
    const consumed = Math.max(0, Number(activeSession?.contextUsage) || 0);
    const generationSpeed = Number.isFinite(activeSession?.generationSpeed) ? Number(activeSession.generationSpeed) : null;
    const generationSpeedApproximate = Boolean(activeSession?.generationSpeedApproximate);
    const configuredLimit = Math.max(0, Number(elements.contextInput.value) || 0);
    const model = elements.modelInput.value.trim();
    const modelLimit = state.modelContextLimits.get(model);
    const limit = typeof modelLimit === 'number' && modelLimit > 0
      ? Math.min(modelLimit, configuredLimit || modelLimit)
      : configuredLimit;
    const suffix = limit > 0 ? ` / ${limit.toLocaleString()}` : '';

    if (elements.speedPill && elements.speedPillValue) {
      if (generationSpeed !== null) {
        elements.speedPill.hidden = false;
        elements.speedPillValue.textContent = `${generationSpeedApproximate ? '~' : ''}${generationSpeed.toFixed(1)} tok/s`;
      } else {
        elements.speedPill.hidden = true;
      }
    }

    elements.contextPill.textContent = `Context ${consumed.toLocaleString()}${suffix}`;
  }

  function getDeviceMemoryGiB() {
    const raw = Number(window.navigator?.deviceMemory);

    if (Number.isFinite(raw) && raw > 0) {
      return raw;
    }

    return null;
  }

  function getSelectedModelSizeGiB(model) {
    const selectedModel = state.models.find((candidate) => candidate.name === model);
    const rawSize = Number(selectedModel?.size);

    if (!Number.isFinite(rawSize) || rawSize <= 0) {
      return null;
    }

    return rawSize / (1024 ** 3);
  }

  function roundContextToStep(value, step = 512) {
    if (!Number.isFinite(value) || value <= 0) {
      return step;
    }

    return Math.max(step, Math.round(value / step) * step);
  }

  function getRecommendedContextLimit(model) {
    const maxContext = state.modelContextLimits.get(model);

    if (typeof maxContext !== 'number' || maxContext <= 0) {
      return null;
    }

    const deviceMemoryGiB = getDeviceMemoryGiB();
    const modelSizeGiB = getSelectedModelSizeGiB(model);
    let recommended = Math.min(maxContext, 32768);

    if (deviceMemoryGiB !== null) {
      if (deviceMemoryGiB <= 8) {
        recommended = Math.min(maxContext, 8192);
      } else if (deviceMemoryGiB <= 16) {
        recommended = Math.min(maxContext, 16384);
      } else if (deviceMemoryGiB <= 32) {
        recommended = Math.min(maxContext, 32768);
      } else if (deviceMemoryGiB <= 64) {
        recommended = Math.min(maxContext, 65536);
      } else {
        recommended = maxContext;
      }
    }

    if (deviceMemoryGiB !== null && modelSizeGiB !== null) {
      const memoryPressure = modelSizeGiB / deviceMemoryGiB;

      if (memoryPressure >= 0.7) {
        recommended = Math.min(recommended, 8192);
      } else if (memoryPressure >= 0.55) {
        recommended = Math.min(recommended, 16384);
      } else if (memoryPressure >= 0.35) {
        recommended = Math.min(recommended, 32768);
      }
    }

    return Math.min(maxContext, roundContextToStep(recommended));
  }

  function updateContextHint() {
    const model = elements.modelInput.value.trim();
    const maxContext = state.modelContextLimits.get(model);
    const recommendedContext = getRecommendedContextLimit(model);
    const deviceMemoryGiB = getDeviceMemoryGiB();

    if (!model) {
      elements.contextHint.textContent = 'Choose a model to see its max context.';
      updateContextPill();
      return;
    }

    if (typeof maxContext === 'number') {
      const displayedRecommendation = typeof recommendedContext === 'number' && recommendedContext > 0
        ? recommendedContext
        : maxContext;
      const memoryLabel = deviceMemoryGiB !== null
        ? `Browser memory estimate: ${deviceMemoryGiB.toLocaleString()} GB. `
        : 'Browser memory estimate: unavailable. ';
      elements.contextHint.textContent = `${memoryLabel}Recommended default: ${displayedRecommendation.toLocaleString()} tokens. Max for ${model}: ${maxContext.toLocaleString()}.`;
      updateContextPill();
      return;
    }

    elements.contextHint.textContent = `Checking max context for ${model}…`;
    updateContextPill();
  }

  function syncContextInputToRecommendation(model) {
    const maxContext = state.modelContextLimits.get(model);
    const recommendedContext = getRecommendedContextLimit(model);

    if (state.contextCustomized || typeof maxContext !== 'number' || maxContext <= 0) {
      return;
    }

    const nextValue = String(recommendedContext || maxContext);

    if (elements.contextInput.value !== nextValue) {
      elements.contextInput.value = nextValue;
      persistState();
    }
  }

  async function fetchModelInfo(model) {
    if (!model || state.modelContextLimits.has(model)) {
      syncContextInputToRecommendation(model);
      updateContextHint();
      return;
    }

    updateContextHint();

    try {
      const response = await fetch('/api/model-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model }),
      });

      const payload = await response.json();

      if (payload.ok && typeof payload.context_length === 'number') {
        state.modelContextLimits.set(model, payload.context_length);
      } else {
        state.modelContextLimits.set(model, null);
      }
    } catch (error) {
      state.modelContextLimits.set(model, null);
    }

    syncContextInputToRecommendation(model);
    updateContextHint();
  }

  function hydrateModelSuggestions() {
    const selectedValue = elements.modelInput.value.trim()
      || elements.modelInput.dataset.pendingValue?.trim()
      || getActiveSession()?.model
      || '';
    elements.modelInput.innerHTML = '';

    if (!state.models.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No models found';
      elements.modelInput.appendChild(option);
      return;
    }

    state.models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.name;
      option.textContent = model.name;
      elements.modelInput.appendChild(option);
    });

    const hasSelectedValue = state.models.some((model) => model.name === selectedValue);
    elements.modelInput.value = hasSelectedValue ? selectedValue : state.models[0].name;
    elements.modelInput.dataset.pendingValue = elements.modelInput.value;
    updateContextPill();

    if (elements.modelInput.value.trim()) {
      fetchModelInfo(elements.modelInput.value.trim());
    }
  }

  async function fetchStatus() {
    try {
      const response = await fetch('/api/status');
      const payload = await response.json();
      state.models = Array.isArray(payload.models) ? payload.models : [];
      hydrateModelSuggestions();

      if (payload.ok) {
        setConnection(true, `Connected to ${payload.baseUrl}\n${state.models.length} model${state.models.length === 1 ? '' : 's'} available.`);
        if (!elements.modelInput.value.trim() && state.models[0]?.name) {
          elements.modelInput.value = state.models[0].name;
          updateContextPill();
          persistState();
        }
        fetchModelInfo(elements.modelInput.value.trim());
        maybeGenerateSessionTitle(getActiveSession());
        void measureCurrentConversationContextUsage({ historyMode: 'immediate' });
      } else {
        setConnection(false, `Could not reach ${payload.baseUrl}. Start Ollama, then refresh.`);
      }
    } catch (error) {
      setConnection(false, 'Could not query the local chat server.');
    }
  }

  return {
    setConnection,
    updateContextPill,
    updateContextHint,
    fetchModelInfo,
    fetchStatus,
    hydrateModelSuggestions,
    getRecommendedContextLimit,
  };
}
