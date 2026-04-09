export function createChatManager({
  elements,
  state,
  samplingPreset,
  visualTokenBudgets,
  defaultVisualTokenBudget,
  stripThinkingContent,
  shouldUseThinkingMode,
  isWebSearchEnabled,
  getClientContext,
  getActiveSession,
  persistState,
  updateSessionTitle,
  setSessionTitleStatus,
  renderMessages,
  addMessage,
  updateMessage,
  setStreamingMode,
}) {
  let contextUsageTimer = null;
  let contextUsageRequestId = 0;
  const titleRequestIds = new Map();
  const titleRequestsInFlight = new Set();

  function estimateTextTokens(text = '') {
    const source = String(text || '').trim();

    if (!source) {
      return 0;
    }

    const cjkMatches = source.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || [];
    const nonCjkSource = source.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, '');
    const compactLatinLike = nonCjkSource.replace(/\s+/g, '');

    return cjkMatches.length + Math.ceil(compactLatinLike.length / 4);
  }

  function applyContextUsage(promptEvalCount, historyMode = 'immediate') {
    const activeSession = getActiveSession();

    if (!activeSession || !Number.isFinite(promptEvalCount)) {
      return;
    }

    activeSession.contextUsage = Math.max(0, Number(promptEvalCount));
    persistState({ historyMode });
  }

  function applyGenerationSpeed(evalCount, evalDuration, historyMode = 'immediate', approximate = false) {
    const activeSession = getActiveSession();

    if (!activeSession) {
      return;
    }

    if (!Number.isFinite(evalCount) || !Number.isFinite(evalDuration) || evalCount <= 0 || evalDuration <= 0) {
      return;
    }

    activeSession.generationSpeed = (Number(evalCount) * 1_000_000_000) / Number(evalDuration);
    activeSession.generationSpeedApproximate = approximate;
    persistState({ historyMode });
  }

  function buildOptions() {
    const rawTemperature = Number(elements.temperatureInput.value);
    const temperature = Number.isFinite(rawTemperature)
      ? Math.max(0, Math.min(2, rawTemperature))
      : samplingPreset.temperature;
    elements.temperatureInput.value = String(temperature);
    const rawBudget = Number(elements.visualTokenBudgetInput?.value);
    const visualTokenBudget = visualTokenBudgets.includes(rawBudget) ? rawBudget : defaultVisualTokenBudget;

    return {
      temperature,
      top_p: samplingPreset.top_p,
      top_k: samplingPreset.top_k,
      num_ctx: Number(elements.contextInput.value || 8192),
      visual_token_budget: visualTokenBudget,
    };
  }

  function modelReady() {
    return elements.modelInput.value.trim().length > 0;
  }

  function visibleMessages() {
    return state.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map(({ role, content, images }) => ({
        role,
        content,
        ...(Array.isArray(images) && images.length
          ? { images: images.map((image) => image.data).filter(Boolean) }
          : {}),
      }));
  }

  function getConversationMessages() {
    return visibleMessages();
  }

  function parseStreamingChunkBuffer(buffer, onChunk) {
    const lines = buffer.split('\n');
    const tail = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      onChunk(JSON.parse(trimmed));
    }

    return tail;
  }

  function mergeWebSearchPatch(currentWebSearch, patch) {
    const current = currentWebSearch && typeof currentWebSearch === 'object'
      ? currentWebSearch
      : {
        enabled: false,
        query: '',
        status: 'idle',
        compactedChars: 0,
        activityLabel: '',
        error: '',
        visits: [],
        sources: [],
      };

    return {
      ...current,
      ...patch,
      visits: Array.isArray(patch?.visits) ? patch.visits : current.visits,
      sources: Array.isArray(patch?.sources) ? patch.sources : current.sources,
    };
  }

  function updateWebSearchState(messageIndex, patch, options = {}) {
    const currentWebSearch = state.messages[messageIndex]?.webSearch;

    updateMessage(messageIndex, {
      webSearch: mergeWebSearchPatch(currentWebSearch, patch),
    }, options);
  }

  function upsertWebVisit(visits = [], event) {
    const nextVisits = Array.isArray(visits) ? visits.map((visit) => ({ ...visit })) : [];
    const visitIndex = nextVisits.findIndex((visit) => (
      (event.url && visit.url === event.url)
      || (event.domain && visit.domain === event.domain && visit.index === event.index)
      || (Number.isFinite(event.index) && visit.index === event.index)
    ));
    const nextVisit = {
      index: Number.isFinite(event.index) ? Number(event.index) : nextVisits.length + 1,
      status: typeof event.status === 'string' ? event.status : 'loading',
      domain: event.domain || '',
      title: event.title || '',
      url: event.url || '',
    };

    if (visitIndex === -1) {
      nextVisits.push(nextVisit);
    } else {
      nextVisits[visitIndex] = {
        ...nextVisits[visitIndex],
        ...nextVisit,
      };
    }

    return nextVisits.sort((left, right) => left.index - right.index);
  }

  function applyWebEvent(messageIndex, event) {
    const currentWebSearch = state.messages[messageIndex]?.webSearch || null;

    if (event.phase === 'searching') {
      updateWebSearchState(messageIndex, {
        enabled: true,
        query: event.query || currentWebSearch?.query || '',
        status: 'searching',
        activityLabel: event.label || 'Searching the web',
        error: '',
      }, { historyMode: 'none' });
      return;
    }

    if (event.phase === 'visiting') {
      const visits = upsertWebVisit(currentWebSearch?.visits, event);
      updateWebSearchState(messageIndex, {
        enabled: true,
        status: 'visiting',
        activityLabel: event.label || `Visiting ${event.domain || 'source'}`,
        visits,
        error: event.status === 'error' ? (event.error || currentWebSearch?.error || '') : '',
      }, { historyMode: 'none' });
      return;
    }

    if (event.phase === 'ready') {
      updateWebSearchState(messageIndex, {
        enabled: true,
        query: event.query || currentWebSearch?.query || '',
        status: 'ready',
        compactedChars: Number.isFinite(event.compactedChars) ? Number(event.compactedChars) : 0,
        activityLabel: event.label || 'Web sources compacted',
        sources: Array.isArray(event.sources) ? event.sources : currentWebSearch?.sources || [],
        error: '',
      }, { historyMode: 'none' });
    }
  }

  async function measureCurrentConversationContextUsage({ historyMode = 'immediate' } = {}) {
    if (contextUsageTimer) {
      window.clearTimeout(contextUsageTimer);
      contextUsageTimer = null;
    }

    const activeSession = getActiveSession();

    if (!activeSession) {
      return null;
    }

    if (!modelReady()) {
      return null;
    }

    const conversation = getConversationMessages();
    const clientContext = getClientContext();

    if (!conversation.length) {
      applyContextUsage(0, historyMode);
      return 0;
    }

    const requestId = ++contextUsageRequestId;

    try {
      const response = await fetch('/api/context-usage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: elements.modelInput.value.trim(),
          messages: conversation,
          systemPrompt: elements.systemPromptInput.value.trim(),
          thinkingMode: shouldUseThinkingMode(),
          clientContext,
          options: buildOptions(),
        }),
      });

      const payload = await response.json().catch(() => ({ ok: false }));

      if (requestId !== contextUsageRequestId) {
        return null;
      }

      if (!response.ok || !payload.ok || !Number.isFinite(payload.prompt_eval_count)) {
        throw new Error(payload.error || 'Could not measure context usage.');
      }

      applyContextUsage(payload.prompt_eval_count, historyMode);
      return payload.prompt_eval_count;
    } catch (error) {
      console.error('Unable to measure exact context usage.', error);
      return null;
    }
  }

  function scheduleContextUsageMeasurement(delayMs = 250, historyMode = 'debounced') {
    if (contextUsageTimer) {
      window.clearTimeout(contextUsageTimer);
    }

    contextUsageTimer = window.setTimeout(() => {
      contextUsageTimer = null;
      void measureCurrentConversationContextUsage({ historyMode });
    }, delayMs);
  }

  function sanitizeSessionTitle(title) {
    const firstLine = String(title || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || '';

    return firstLine
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
      .trim();
  }

  function getFirstUserPrompt(session) {
    return session?.messages?.find((message) => message.role === 'user')?.content?.trim() || '';
  }

  function needsGeneratedTitle(session) {
    const firstUserPrompt = getFirstUserPrompt(session);

    if (!firstUserPrompt) {
      return false;
    }

    const normalizedPrompt = firstUserPrompt.replace(/\s+/g, ' ').trim();
    const currentTitle = session?.title?.trim() || 'New chat';
    const normalizedCurrentTitle = currentTitle.replace(/\s+/g, ' ').trim();

    if (normalizedCurrentTitle === 'New chat') {
      return true;
    }

    if (normalizedPrompt.length <= normalizedCurrentTitle.length) {
      return false;
    }

    return normalizedPrompt.startsWith(normalizedCurrentTitle);
  }

  async function generateSessionTitle(sessionId, prompt) {
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    const sourcePrompt = String(prompt || '').trim();

    if (!session || !needsGeneratedTitle(session) || !sourcePrompt || !modelReady() || titleRequestsInFlight.has(sessionId)) {
      return;
    }

    const requestId = (titleRequestIds.get(sessionId) || 0) + 1;
    titleRequestIds.set(sessionId, requestId);
    titleRequestsInFlight.add(sessionId);
    setSessionTitleStatus(sessionId, 'generating', '', { renderHistory: true });

    try {
      const response = await fetch('/api/chat-title', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: elements.modelInput.value.trim(),
          prompt: sourcePrompt,
        }),
      });

      const payload = await response.json().catch(() => ({ ok: false }));

      if (titleRequestIds.get(sessionId) !== requestId) {
        return;
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Could not summarize chat title.');
      }

      const nextTitle = sanitizeSessionTitle(payload.title);
      const latestSession = state.sessions.find((candidate) => candidate.id === sessionId);

      if (!latestSession) {
        return;
      }

      if (!needsGeneratedTitle(latestSession) || !nextTitle) {
        setSessionTitleStatus(sessionId, 'idle', '', { renderHistory: true });
        return;
      }

      updateSessionTitle(sessionId, nextTitle, {
        historyMode: 'immediate',
        touchTimestamp: false,
      });
      setSessionTitleStatus(sessionId, 'idle', '', { renderHistory: true });
    } catch (error) {
      setSessionTitleStatus(sessionId, 'error', 'Title update failed', { renderHistory: true });
      console.error('Unable to summarize chat title.', error);
    } finally {
      titleRequestsInFlight.delete(sessionId);
      if (titleRequestIds.get(sessionId) === requestId) {
        titleRequestIds.delete(sessionId);
      }
    }
  }

  function maybeGenerateSessionTitle(session = getActiveSession()) {
    if (!session || !needsGeneratedTitle(session) || titleRequestsInFlight.has(session.id)) {
      return;
    }

    const firstUserPrompt = getFirstUserPrompt(session);

    if (!firstUserPrompt) {
      return;
    }

    void generateSessionTitle(session.id, firstUserPrompt);
  }

  async function sendPrompt(prompt, attachments = []) {
    if (!modelReady()) {
      addMessage('error', 'Choose a model before sending a prompt.');
      return;
    }

    const modelName = elements.modelInput.value.trim();
    const requestThinkingEnabled = shouldUseThinkingMode();
    const requestSystemPrompt = elements.systemPromptInput.value.trim();
    const requestStartedAt = performance.now();
    const activeSession = getActiveSession();
    const shouldGenerateTitle = Boolean(
      activeSession
      && activeSession.title === 'New chat'
      && state.messages.filter((message) => message.role === 'user').length === 0
      && String(prompt || '').trim(),
    );
    const titleSessionId = activeSession?.id || null;
    const titlePrompt = String(prompt || '').trim();
    const requestWebSearchEnabled = isWebSearchEnabled() && Boolean(titlePrompt);

    addMessage('user', prompt, {
      images: attachments,
    }, { historyMode: 'immediate' });
    const conversation = getConversationMessages();
    const clientContext = getClientContext();
    const assistantIndex = state.messages.push({
      role: 'assistant',
      model: modelName,
      requestThinkingEnabled,
      requestWebSearchEnabled,
      requestSystemPrompt,
      content: '',
      streaming: true,
      thoughtExpanded: requestThinkingEnabled,
      webSearch: requestWebSearchEnabled
        ? {
          enabled: true,
          query: titlePrompt,
          status: 'searching',
          compactedChars: 0,
          activityLabel: `Searching the web for "${titlePrompt || 'your prompt'}"`,
          error: '',
          visits: [],
          sources: [],
        }
        : null,
    }) - 1;
    persistState({ historyMode: 'none' });
    renderMessages();

    const requestBody = {
      model: modelName,
      messages: conversation,
      systemPrompt: requestSystemPrompt,
      thinkingMode: requestThinkingEnabled,
      clientContext,
      options: buildOptions(),
      webSearch: requestWebSearchEnabled,
      webSearchQuery: titlePrompt,
    };

    state.abortController = new AbortController();
    setStreamingMode(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: state.abortController.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({ error: 'Request failed.' }));
        throw new Error(payload.error || 'Request failed.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullReply = '';
      let fullThought = '';
      let receivedGenerationStats = false;

      const consumeChunk = (chunk) => {
        if (chunk?.type === 'web') {
          applyWebEvent(assistantIndex, chunk);
          return;
        }

        if (chunk?.type === 'error') {
          throw new Error(chunk.error || 'Request failed.');
        }

        const delta = chunk.message?.content || '';
        const thinkingDelta = chunk.message?.thinking || '';

        if (delta) {
          fullReply += delta;
        }

        if (thinkingDelta) {
          fullThought += thinkingDelta;
        }

        if (!(delta || thinkingDelta || chunk.done)) {
          return;
        }

        const { content, thought } = stripThinkingContent(fullReply);
        const nextThought = fullThought || thought || null;
        const nextContent = content || (chunk.done ? 'No content returned.' : '');
        const evalCount = Number.isFinite(chunk.eval_count) ? Number(chunk.eval_count) : null;
        const evalDuration = Number.isFinite(chunk.eval_duration) ? Number(chunk.eval_duration) : null;

        if (chunk.done && evalCount !== null && evalDuration !== null) {
          receivedGenerationStats = true;
          applyGenerationSpeed(evalCount, evalDuration, 'none');
        }

        updateMessage(assistantIndex, {
          content: nextContent,
          rawContent: fullReply,
          thought: nextThought,
          streaming: !chunk.done,
        }, { historyMode: chunk.done ? 'immediate' : 'none' });
      };

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        buffer = parseStreamingChunkBuffer(buffer, consumeChunk);
      }

      if (buffer.trim()) {
        consumeChunk(JSON.parse(buffer.trim()));
      }

      if (!receivedGenerationStats) {
        const { content, thought } = stripThinkingContent(fullReply);
        const estimatedTokens = estimateTextTokens(content);
        const elapsedNs = Math.max(1, Math.round((performance.now() - requestStartedAt) * 1_000_000));

        if (estimatedTokens > 0) {
          applyGenerationSpeed(estimatedTokens, elapsedNs, 'none', true);
        }

        updateMessage(assistantIndex, {
          content: content || 'No content returned.',
          rawContent: fullReply,
          thought: fullThought || thought || null,
          streaming: false,
        }, { historyMode: 'immediate' });
      }
    } catch (error) {
      const wasAbort = error.name === 'AbortError';
      updateMessage(assistantIndex, {
        role: 'error',
        content: wasAbort ? 'Generation stopped.' : error.message,
        streaming: false,
        webSearch: requestWebSearchEnabled
          ? mergeWebSearchPatch(state.messages[assistantIndex]?.webSearch, {
            status: wasAbort ? 'idle' : 'error',
            error: wasAbort ? '' : error.message,
          })
          : null,
      }, { historyMode: 'immediate' });
    } finally {
      state.abortController = null;
      setStreamingMode(false);
      await measureCurrentConversationContextUsage({ historyMode: 'immediate' });
      if (shouldGenerateTitle && titleSessionId && titlePrompt) {
        maybeGenerateSessionTitle(state.sessions.find((session) => session.id === titleSessionId));
      }
    }
  }

  function stopStreaming() {
    state.abortController?.abort();
  }

  return {
    buildOptions,
    modelReady,
    visibleMessages,
    getConversationMessages,
    measureCurrentConversationContextUsage,
    maybeGenerateSessionTitle,
    scheduleContextUsageMeasurement,
    sendPrompt,
    stopStreaming,
  };
}
