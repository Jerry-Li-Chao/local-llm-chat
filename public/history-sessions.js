export function createHistorySessionController({
  elements,
  state,
  normalizeMessages,
  createSessionRecord,
  formatHistoryMeta,
  sortSessionsByUpdatedAt,
  persistState,
  updateContextPill,
  updateContextHint,
  updateChatHeader,
  fetchModelInfo,
  renderMessages,
}) {
  function syncWebSearchToggle(enabled) {
    if (!elements.webSearchButton) {
      return;
    }

    const nextValue = Boolean(enabled);
    elements.webSearchButton.setAttribute('aria-pressed', String(nextValue));
    elements.webSearchButton.dataset.active = nextValue ? 'true' : 'false';
    elements.webSearchButton.title = nextValue ? 'Disable web search' : 'Enable web search';
  }

  function getActiveSession() {
    return state.sessions.find((session) => session.id === state.activeSessionId) || null;
  }

  function renderHistoryList() {
    if (!elements.historyList) {
      return;
    }

    elements.historyList.innerHTML = '';

    if (!state.sessions.length) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'No saved conversations.';
      elements.historyList.appendChild(empty);
      return;
    }

    const orderedSessions = sortSessionsByUpdatedAt(state.sessions);

    orderedSessions.forEach((session) => {
      const item = document.createElement('article');
      item.className = 'history-item';
      item.dataset.sessionId = session.id;

      if (session.id === state.activeSessionId) {
        item.classList.add('active');
      }

      const row = document.createElement('div');
      row.className = 'history-row';

      const title = document.createElement('span');
      title.className = 'history-title';
      title.textContent = session.title || 'New chat';

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'history-delete-button';
      deleteButton.dataset.sessionId = session.id;
      deleteButton.setAttribute('aria-label', `Delete ${session.title || 'chat'}`);
      deleteButton.title = 'Delete chat';
      deleteButton.textContent = 'x';

      const meta = document.createElement('small');
      meta.className = 'history-meta';
      meta.textContent = formatHistoryMeta(session);

      row.append(title, deleteButton);
      item.append(row, meta);

      if (session.titleStatus === 'generating' || session.titleStatus === 'error') {
        const status = document.createElement('small');
        status.className = 'history-meta-status';
        status.dataset.state = session.titleStatus;
        status.textContent = session.titleStatus === 'generating'
          ? 'Generating title…'
          : (session.titleStatusMessage || 'Could not generate title');
        item.append(status);
      }

      elements.historyList.appendChild(item);
    });
  }

  function syncActiveSessionFields() {
    const activeSession = getActiveSession();

    if (!activeSession) {
      return;
    }

    state.messages = normalizeMessages(activeSession.messages);

    if (activeSession.model) {
      elements.modelInput.value = activeSession.model;
    }

    elements.systemPromptInput.value = activeSession.systemPrompt || '';
    syncWebSearchToggle(activeSession.webSearchEnabled);
    updateContextPill();
    updateContextHint();
    updateChatHeader();
    fetchModelInfo(elements.modelInput.value.trim());
  }

  function deleteSession(sessionId) {
    if (state.isStreaming) {
      return;
    }

    const target = state.sessions.find((session) => session.id === sessionId);

    if (!target) {
      return;
    }

    if (!window.confirm(`Delete "${target.title || 'New chat'}"?`)) {
      return;
    }

    state.sessions = state.sessions.filter((session) => session.id !== sessionId);

    if (!state.sessions.length) {
      const replacement = createSessionRecord({
        model: elements.modelInput.value.trim(),
        title: 'New chat',
        messages: [],
        systemPrompt: elements.systemPromptInput.value,
        webSearchEnabled: elements.webSearchButton?.getAttribute('aria-pressed') === 'true',
      });

      state.sessions = [replacement];
      state.activeSessionId = replacement.id;
      state.messages = replacement.messages;
    } else if (state.activeSessionId === sessionId) {
      const nextSession = sortSessionsByUpdatedAt(state.sessions)[0];
      state.activeSessionId = nextSession.id;
      state.messages = normalizeMessages(nextSession.messages);
      elements.modelInput.value = nextSession.model || elements.modelInput.value;
      elements.systemPromptInput.value = nextSession.systemPrompt || '';
      syncWebSearchToggle(nextSession.webSearchEnabled);
      updateContextPill();
      updateContextHint();
      updateChatHeader();
      fetchModelInfo(elements.modelInput.value.trim());
    }

    persistState({ historyMode: 'immediate' });
    renderMessages();
    renderHistoryList();
  }

  function setActiveSession(sessionId) {
    if (state.isStreaming) {
      return;
    }

    const target = state.sessions.find((session) => session.id === sessionId);

    if (!target || target.id === state.activeSessionId) {
      return;
    }

    persistState({ historyMode: 'immediate', touchTimestamp: false });
    state.activeSessionId = target.id;
    state.messages = normalizeMessages(target.messages);

    if (target.model) {
      elements.modelInput.value = target.model;
    }

    elements.systemPromptInput.value = target.systemPrompt || '';
    syncWebSearchToggle(target.webSearchEnabled);

    updateContextPill();
    updateContextHint();
    fetchModelInfo(elements.modelInput.value.trim());
    persistState({ historyMode: 'immediate', touchTimestamp: false });
    renderMessages();
    renderHistoryList();
  }

  function createNewSession() {
    if (state.isStreaming) {
      return;
    }

    persistState({ historyMode: 'immediate' });
    const newSession = createSessionRecord({
      model: elements.modelInput.value.trim(),
      title: 'New chat',
      messages: [],
      systemPrompt: elements.systemPromptInput.value,
      webSearchEnabled: elements.webSearchButton?.getAttribute('aria-pressed') === 'true',
    });

    state.sessions.unshift(newSession);
    state.activeSessionId = newSession.id;
    state.messages = newSession.messages;

    persistState({ historyMode: 'immediate' });
    renderMessages();
    renderHistoryList();
  }

  function clearHistory() {
    if (state.isStreaming) {
      return;
    }

    if (!window.confirm('Clear all chat history?')) {
      return;
    }

    state.sessions = [];
    state.activeSessionId = null;
    state.messages = [];

    const restored = createSessionRecord({
      model: elements.modelInput.value.trim(),
      title: 'New chat',
      messages: [],
      systemPrompt: elements.systemPromptInput.value,
      webSearchEnabled: elements.webSearchButton?.getAttribute('aria-pressed') === 'true',
    });

    state.sessions = [restored];
    state.activeSessionId = restored.id;

    persistState({ historyMode: 'immediate' });
    renderMessages();
    renderHistoryList();
  }

  function clearConversation() {
    if (state.isStreaming) {
      return;
    }

    const activeSession = getActiveSession();

    if (activeSession) {
      activeSession.messages = [];
      activeSession.title = 'New chat';
      activeSession.titleStatus = 'idle';
      activeSession.titleStatusMessage = '';
      activeSession.contextUsage = 0;
      activeSession.generationSpeed = null;
      activeSession.generationSpeedApproximate = false;
    }

    state.messages = [];
    persistState({ historyMode: 'immediate' });
    renderMessages();
    renderHistoryList();
  }

  function updateSessionTitle(sessionId, title, { historyMode = 'immediate', touchTimestamp = false } = {}) {
    const target = state.sessions.find((session) => session.id === sessionId);
    const nextTitle = typeof title === 'string' ? title.trim() : '';

    if (!target || !nextTitle) {
      return;
    }

    target.title = nextTitle;

    if (touchTimestamp) {
      target.updatedAt = Date.now();
    }

    if (sessionId === state.activeSessionId) {
      updateChatHeader();
    }

    persistState({ historyMode, touchTimestamp: false });
  }

  function setSessionTitleStatus(sessionId, titleStatus = 'idle', titleStatusMessage = '', {
    historyMode = 'none',
    renderHistory = true,
  } = {}) {
    const target = state.sessions.find((session) => session.id === sessionId);

    if (!target) {
      return;
    }

    target.titleStatus = titleStatus;
    target.titleStatusMessage = titleStatusMessage;

    if (sessionId === state.activeSessionId) {
      updateChatHeader();
    }

    if (historyMode !== 'none') {
      persistState({ historyMode, touchTimestamp: false });
      return;
    }

    if (renderHistory) {
      renderHistoryList();
    }
  }

  return {
    getActiveSession,
    renderHistoryList,
    syncActiveSessionFields,
    deleteSession,
    setActiveSession,
    createNewSession,
    clearHistory,
    clearConversation,
    updateSessionTitle,
    setSessionTitleStatus,
  };
}
