export function createChatManager({
  elements,
  state,
  samplingPreset,
  visualTokenBudgets,
  defaultVisualTokenBudget,
  stripThinkingContent,
  shouldUseThinkingMode,
  getSystemPromptContent,
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
    const messages = visibleMessages();
    const systemPrompt = getSystemPromptContent();

    if (!systemPrompt) {
      return messages;
    }

    return [{ role: 'system', content: systemPrompt }, ...messages];
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

    addMessage('user', prompt, {
      images: attachments,
    }, { historyMode: 'immediate' });
    const conversation = getConversationMessages();
    const assistantIndex = state.messages.push({
      role: 'assistant',
      model: modelName,
      requestThinkingEnabled,
      requestSystemPrompt,
      content: '',
      streaming: true,
      thoughtExpanded: requestThinkingEnabled,
    }) - 1;
    persistState({ historyMode: 'none' });
    renderMessages();

    const requestBody = {
      model: modelName,
      messages: conversation,
      options: buildOptions(),
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

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        buffer = parseStreamingChunkBuffer(buffer, (chunk) => {
          const delta = chunk.message?.content || '';
          const thinkingDelta = chunk.message?.thinking || '';

          if (delta) {
            fullReply += delta;
          }

          if (thinkingDelta) {
            fullThought += thinkingDelta;
          }

          if (delta || thinkingDelta || chunk.done) {
            const { content, thought } = stripThinkingContent(fullReply);
            const nextThought = fullThought || thought || null;
            const nextContent = content || (chunk.done ? 'No content returned.' : '');
            const evalCount = Number.isFinite(chunk.eval_count) ? Number(chunk.eval_count) : null;
            const evalDuration = Number.isFinite(chunk.eval_duration) ? Number(chunk.eval_duration) : null;

            if (chunk.done && evalCount !== null && evalDuration !== null) {
              applyGenerationSpeed(evalCount, evalDuration, 'none');
            }

            updateMessage(assistantIndex, {
              content: nextContent,
              rawContent: fullReply,
              thought: nextThought,
              streaming: !chunk.done,
            }, { historyMode: chunk.done ? 'immediate' : 'none' });
          }
        });
      }

      if (buffer.trim()) {
        const finalChunk = JSON.parse(buffer.trim());
        const delta = finalChunk.message?.content || '';
        const thinkingDelta = finalChunk.message?.thinking || '';
        const finalReply = delta ? `${fullReply}${delta}` : fullReply;
        const finalThought = thinkingDelta ? `${fullThought}${thinkingDelta}` : fullThought;
        const { content, thought } = stripThinkingContent(finalReply);
        const evalCount = Number.isFinite(finalChunk.eval_count) ? Number(finalChunk.eval_count) : null;
        const evalDuration = Number.isFinite(finalChunk.eval_duration) ? Number(finalChunk.eval_duration) : null;

        if (evalCount !== null && evalDuration !== null) {
          applyGenerationSpeed(evalCount, evalDuration, 'none');
        } else {
          const estimatedTokens = estimateTextTokens(content);
          const elapsedNs = Math.max(1, Math.round((performance.now() - requestStartedAt) * 1_000_000));

          if (estimatedTokens > 0) {
            applyGenerationSpeed(estimatedTokens, elapsedNs, 'none', true);
          }
        }

        updateMessage(assistantIndex, {
          content: content || 'No content returned.',
          rawContent: finalReply,
          thought: finalThought || thought || null,
          streaming: false,
        }, { historyMode: 'immediate' });
      }
    } catch (error) {
      const wasAbort = error.name === 'AbortError';
      updateMessage(assistantIndex, {
        role: 'error',
        content: wasAbort ? 'Generation stopped.' : error.message,
        streaming: false,
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
