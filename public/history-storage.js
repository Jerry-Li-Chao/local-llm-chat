export function createHistoryStorageController({
  elements,
  state,
  storageKey,
  samplingPreset,
  visualTokenBudgets,
  defaultVisualTokenBudget,
  normalizeMessages,
  compactSessionsForLocalStorage,
  compactSessionsForServerHistory,
  normalizeSessionsFromStorage,
  mergeSessions,
  getActiveSession,
  renderHistoryList,
  renderMessages,
  syncActiveSessionFields,
  updateContextPill,
  updateChatHeader,
}) {
  const HISTORY_FILE_NAME = 'chat-history.json';
  const STORAGE_DB_NAME = 'local-llm-chat-storage';
  const STORAGE_STORE_NAME = 'kv';

  function supportsIndexedDbStorage() {
    return typeof window.indexedDB !== 'undefined';
  }

  function supportsDirectoryStorage() {
    return supportsIndexedDbStorage() && typeof window.showDirectoryPicker === 'function';
  }

  function setStorageStatus(message, tone = 'default') {
    if (!elements.storageStatus) {
      return;
    }

    elements.storageStatus.textContent = message;
    elements.storageStatus.dataset.state = tone;
  }

  function refreshStorageUi() {
    if (elements.chooseFolderButton) {
      elements.chooseFolderButton.disabled = !supportsDirectoryStorage();
      elements.chooseFolderButton.textContent = state.historyFolderName
        ? `Switch folder (${state.historyFolderName})`
        : 'Choose folder';
    }

    if (!supportsDirectoryStorage()) {
      setStorageStatus('Chat history is saved by the app. Folder sync is unavailable in this browser.');
      return;
    }

    if (!state.historyFolderHandle) {
      setStorageStatus('Chat history is always saved by the app. Choose a folder if you also want a normal JSON file there.');
      return;
    }

    setStorageStatus(`Chat history is saved by the app and mirrored to folder "${state.historyFolderName}".`);
  }

  function openStorageDb() {
    if (!supportsIndexedDbStorage()) {
      return Promise.reject(new Error('IndexedDB is not supported in this browser.'));
    }

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(STORAGE_DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORAGE_STORE_NAME)) {
          db.createObjectStore(STORAGE_STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open IndexedDB.'));
    });
  }

  async function readStorageValue(key) {
    const db = await openStorageDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORAGE_STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORAGE_STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error(`Could not read "${key}" from IndexedDB.`));
      transaction.oncomplete = () => db.close();
    });
  }

  async function writeStorageValue(key, value) {
    const db = await openStorageDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORAGE_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORAGE_STORE_NAME);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error(`Could not write "${key}" to IndexedDB.`));
      transaction.oncomplete = () => db.close();
    });
  }

  async function loadBrowserHistory() {
    if (!supportsIndexedDbStorage()) {
      return [];
    }

    const payload = await readStorageValue('history');
    return normalizeSessionsFromStorage(payload?.sessions);
  }

  async function saveHistoryToBrowser() {
    if (!supportsIndexedDbStorage()) {
      throw new Error('Browser local storage is not supported in this browser.');
    }

    await writeStorageValue('history', {
      sessions: state.sessions,
      updatedAt: Date.now(),
    });
  }

  async function loadStoredFolderHandle() {
    if (!supportsDirectoryStorage()) {
      return null;
    }

    const handle = await readStorageValue('history-folder-handle');
    state.historyFolderHandle = handle;
    state.historyFolderName = handle?.name || '';
    return handle;
  }

  async function saveFolderHandle(handle) {
    if (!supportsDirectoryStorage()) {
      throw new Error('Chosen folder storage is not supported in this browser.');
    }

    state.historyFolderHandle = handle;
    state.historyFolderName = handle?.name || '';
    await writeStorageValue('history-folder-handle', handle);
  }

  async function ensureFolderPermission(handle, request = false) {
    if (!handle) {
      return false;
    }

    if (typeof handle.queryPermission === 'function') {
      const status = await handle.queryPermission({ mode: 'readwrite' });

      if (status === 'granted') {
        return true;
      }

      if (!request || typeof handle.requestPermission !== 'function') {
        return false;
      }

      return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
    }

    return true;
  }

  async function loadHistoryFromFolder({ requestPermission = false } = {}) {
    if (!supportsDirectoryStorage()) {
      return [];
    }

    const handle = state.historyFolderHandle || await loadStoredFolderHandle();

    if (!handle) {
      return [];
    }

    const hasPermission = await ensureFolderPermission(handle, requestPermission);

    if (!hasPermission) {
      throw new Error('Folder access is not currently granted.');
    }

    state.historyFolderHandle = handle;
    state.historyFolderName = handle.name || '';

    try {
      const fileHandle = await handle.getFileHandle(HISTORY_FILE_NAME);
      const file = await fileHandle.getFile();
      const raw = await file.text();
      const payload = JSON.parse(raw);
      return normalizeSessionsFromStorage(payload?.sessions);
    } catch (error) {
      if (error?.name === 'NotFoundError') {
        return [];
      }

      throw error;
    }
  }

  async function saveHistoryToFolder() {
    if (!supportsDirectoryStorage()) {
      throw new Error('Chosen folder storage is not supported in this browser.');
    }

    const handle = state.historyFolderHandle || await loadStoredFolderHandle();

    if (!handle) {
      throw new Error('No folder has been selected yet.');
    }

    const hasPermission = await ensureFolderPermission(handle, false);

    if (!hasPermission) {
      throw new Error('Folder access is not currently granted.');
    }

    const fileHandle = await handle.getFileHandle(HISTORY_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({
      sessions: normalizeSessionsFromStorage(state.sessions),
      updatedAt: Date.now(),
    }, null, 2));
    await writable.close();
    state.historyFolderHandle = handle;
    state.historyFolderName = handle.name || '';
  }

  function debounceHistorySave(delayMs = 500) {
    if (state.historySaveTimer) {
      window.clearTimeout(state.historySaveTimer);
    }

    state.historySaveTimer = window.setTimeout(() => {
      state.historySaveTimer = null;
      enqueueHistorySave();
    }, delayMs);
  }

  function scheduleHistorySave() {
    debounceHistorySave(500);
  }

  function applyReturnedImageAssetIds(savedSessions = []) {
    if (!Array.isArray(savedSessions)) {
      return;
    }

    const sessionMap = new Map(savedSessions.map((session) => [session.id, session]));

    state.sessions.forEach((session) => {
      const savedSession = sessionMap.get(session.id);

      if (!savedSession || !Array.isArray(session.messages) || !Array.isArray(savedSession.messages)) {
        return;
      }

      session.messages.forEach((message, messageIndex) => {
        const savedMessage = savedSession.messages[messageIndex];

        if (!savedMessage || !Array.isArray(message.images) || !Array.isArray(savedMessage.images)) {
          return;
        }

        message.images.forEach((image, imageIndex) => {
          const savedImage = savedMessage.images[imageIndex];

          if (!savedImage?.assetId) {
            return;
          }

          image.assetId = savedImage.assetId;
        });
      });
    });
  }

  async function saveHistoryToServer() {
    const response = await fetch('/api/chat-history', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessions: compactSessionsForServerHistory(state.sessions) }),
    });

    const payload = await response.json().catch(() => ({ ok: false }));

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Could not save chat history (${response.status}).`);
    }

    applyReturnedImageAssetIds(payload.sessions);
  }

  async function saveHistoryToBackends() {
    await saveHistoryToServer();

    if (supportsIndexedDbStorage()) {
      await saveHistoryToBrowser();
    }

    if (!state.historyFolderHandle) {
      setStorageStatus('Chat history saved by the app.');
      return;
    }

    try {
      await saveHistoryToFolder();
      setStorageStatus(`Chat history saved by the app and mirrored to folder "${state.historyFolderName}".`);
    } catch (error) {
      console.error('Unable to mirror chat history to chosen folder.', error);
      setStorageStatus('Chat history saved by the app, but folder sync failed.', 'warning');
    }
  }

  function enqueueHistorySave() {
    state.historySavePromise = state.historySavePromise
      .catch(() => {})
      .then(() => saveHistoryToBackends())
      .catch((error) => {
        console.error('Unable to persist chat history.', error);
        setStorageStatus(error.message || 'Could not save chat history.', 'error');
      });

    return state.historySavePromise;
  }

  function flushHistorySave() {
    if (state.historySaveTimer) {
      window.clearTimeout(state.historySaveTimer);
      state.historySaveTimer = null;
    }

    return enqueueHistorySave();
  }

  function requestHistorySave(mode = 'debounced') {
    if (mode === 'none') {
      return Promise.resolve();
    }

    if (mode === 'immediate') {
      return flushHistorySave();
    }

    scheduleHistorySave();
    return Promise.resolve();
  }

  async function loadHistoryFromServer() {
    const response = await fetch('/api/chat-history');
    const payload = await response.json().catch(() => ({ ok: false, sessions: [] }));

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Could not load chat history (${response.status}).`);
    }

    return normalizeSessionsFromStorage(payload.sessions);
  }

  async function loadHistoryFromStorage(legacySessions = []) {
    const sources = [legacySessions];

    try {
      sources.push(await loadHistoryFromServer());
    } catch (error) {
      console.error('Unable to load chat history from server storage.', error);
    }

    try {
      sources.push(await loadBrowserHistory());
    } catch (error) {
      console.error('Unable to load chat history from browser storage.', error);
    }

    try {
      sources.push(await loadHistoryFromFolder());
    } catch (error) {
      console.error('Unable to load chat history from chosen folder.', error);
    }

    const mergedSessions = mergeSessions(...sources);

    if (mergedSessions.length) {
      state.sessions = mergedSessions;
      refreshStorageUi();
      return mergedSessions;
    }

    if (legacySessions.length) {
      state.sessions = legacySessions;
      refreshStorageUi();
      return legacySessions;
    }

    state.sessions = [];
    refreshStorageUi();
    return [];
  }

  function loadStoredState() {
    const result = {
      legacySessions: [],
      legacyActiveSessionId: null,
    };

    try {
      const raw = window.localStorage.getItem(storageKey);

      if (!raw) {
        return result;
      }

      const parsed = JSON.parse(raw);

      state.activeSessionId = typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : null;
      result.legacyActiveSessionId = state.activeSessionId;
      elements.modelInput.value = typeof parsed.model === 'string' ? parsed.model.trim() : '';
      elements.modelInput.dataset.pendingValue = typeof parsed.model === 'string' ? parsed.model.trim() : '';
      elements.systemPromptInput.value = typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : '';
      const parsedTemperature = Number(parsed.temperature);
      elements.temperatureInput.value = Number.isFinite(parsedTemperature)
        ? String(Math.max(0, Math.min(2, parsedTemperature)))
        : String(samplingPreset.temperature);
      elements.contextInput.value = String(parsed.num_ctx ?? 8192);
      state.contextCustomized = Boolean(parsed.contextCustomized);
      const parsedVisualTokenBudget = Number(parsed.visualTokenBudget);
      elements.visualTokenBudgetInput.value = visualTokenBudgets.includes(parsedVisualTokenBudget)
        ? String(parsedVisualTokenBudget)
        : String(defaultVisualTokenBudget);
      elements.composerForm.dataset.collapsed = parsed.composerCollapsed ? 'true' : 'false';
      elements.thinkingModeInput.checked = Boolean(parsed.thinkingMode);
      result.legacySessions = normalizeSessionsFromStorage(parsed.sessions);
    } catch (error) {
      console.error('Unable to load stored chat state.', error);
    }

    return result;
  }

  function persistState({ historyMode = 'debounced', touchTimestamp = true } = {}) {
    const activeSession = getActiveSession();

    if (activeSession) {
      activeSession.messages = normalizeMessages(state.messages);
      activeSession.model = elements.modelInput.value.trim() || activeSession.model;
      activeSession.systemPrompt = elements.systemPromptInput.value;
      if (touchTimestamp) {
        activeSession.updatedAt = Date.now();
      }
    }

    const payload = {
      model: elements.modelInput.value.trim(),
      systemPrompt: elements.systemPromptInput.value,
      temperature: Number(elements.temperatureInput.value),
      num_ctx: Number(elements.contextInput.value),
      contextCustomized: state.contextCustomized,
      composerCollapsed: elements.composerForm.dataset.collapsed === 'true',
      thinkingMode: elements.thinkingModeInput.checked,
      visualTokenBudget: Number(elements.visualTokenBudgetInput.value),
      activeSessionId: state.activeSessionId,
      sessions: compactSessionsForLocalStorage(state.sessions),
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));
    updateContextPill();
    updateChatHeader();
    requestHistorySave(historyMode);
    renderHistoryList();
    refreshStorageUi();
  }

  async function chooseHistoryFolder() {
    if (!supportsDirectoryStorage()) {
      setStorageStatus('Folder sync is not supported in this browser.', 'error');
      return;
    }

    try {
      const handle = await window.showDirectoryPicker({
        id: 'local-llm-chat-history',
        mode: 'readwrite',
      });

      const hasPermission = await ensureFolderPermission(handle, true);

      if (!hasPermission) {
        throw new Error('Folder access was not granted.');
      }

      await saveFolderHandle(handle);
      const folderSessions = await loadHistoryFromFolder({ requestPermission: false });
      const mergedSessions = mergeSessions(folderSessions, state.sessions);

      if (mergedSessions.length) {
        state.sessions = mergedSessions;

        if (!state.activeSessionId || !mergedSessions.some((session) => session.id === state.activeSessionId)) {
          state.activeSessionId = mergedSessions[0].id;
        }

        syncActiveSessionFields();
      }

      refreshStorageUi();
      persistState({ historyMode: 'none', touchTimestamp: false });
      renderMessages();
      renderHistoryList();
      await flushHistorySave();
    } catch (error) {
      if (error?.name === 'AbortError') {
        setStorageStatus('Folder selection was cancelled.');
        return;
      }

      console.error('Unable to choose history folder.', error);
      setStorageStatus(error.message || 'Could not choose folder.', 'error');
    }
  }

  function exportHistoryToFile() {
    const blob = new Blob([
      JSON.stringify({
        sessions: normalizeSessionsFromStorage(state.sessions),
        updatedAt: Date.now(),
      }, null, 2),
    ], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    link.href = url;
    link.download = `local-llm-chat-history-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    setStorageStatus('Exported chat history to a JSON file.');
  }

  async function importHistoryFromFile(file) {
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);
      const importedSessions = normalizeSessionsFromStorage(Array.isArray(payload) ? payload : payload?.sessions);

      if (!importedSessions.length) {
        throw new Error('This file does not contain any chat sessions.');
      }

      if (!window.confirm(`Import ${importedSessions.length} session${importedSessions.length === 1 ? '' : 's'} and replace current chat history?`)) {
        return;
      }

      state.sessions = importedSessions;
      state.activeSessionId = importedSessions[0].id;
      syncActiveSessionFields();
      persistState({ historyMode: 'immediate', touchTimestamp: false });
      renderMessages();
      renderHistoryList();
      setStorageStatus(`Imported ${importedSessions.length} session${importedSessions.length === 1 ? '' : 's'}.`);
    } catch (error) {
      console.error('Unable to import chat history.', error);
      setStorageStatus(error.message || 'Could not import chat history.', 'error');
    }
  }

  return {
    setStorageStatus,
    refreshStorageUi,
    loadStoredState,
    persistState,
    loadHistoryFromStorage,
    flushHistorySave,
    chooseHistoryFolder,
    exportHistoryToFile,
    importHistoryFromFile,
  };
}
