import { createHistorySessionUtils } from './history-session-utils.js';
import { createHistorySessionController } from './history-sessions.js';
import { createHistoryStorageController } from './history-storage.js';

export function createHistoryManager({
  elements,
  state,
  storageKey,
  samplingPreset,
  visualTokenBudgets,
  defaultVisualTokenBudget,
  normalizeMessages,
  compactSessionsForLocalStorage,
  compactSessionsForServerHistory,
  updateContextPill,
  updateContextHint,
  updateChatHeader,
  fetchModelInfo,
  renderMessages,
}) {
  const sessionUtils = createHistorySessionUtils({ normalizeMessages });
  let sessionController = null;

  const storageController = createHistoryStorageController({
    elements,
    state,
    storageKey,
    samplingPreset,
    visualTokenBudgets,
    defaultVisualTokenBudget,
    normalizeMessages,
    compactSessionsForLocalStorage,
    compactSessionsForServerHistory,
    normalizeSessionsFromStorage: sessionUtils.normalizeSessionsFromStorage,
    mergeSessions: sessionUtils.mergeSessions,
    getActiveSession: () => sessionController?.getActiveSession() || null,
    renderHistoryList: () => sessionController?.renderHistoryList(),
    renderMessages,
    syncActiveSessionFields: () => sessionController?.syncActiveSessionFields(),
    updateContextPill,
    updateChatHeader,
  });

  sessionController = createHistorySessionController({
    elements,
    state,
    normalizeMessages,
    createSessionRecord: sessionUtils.createSessionRecord,
    formatHistoryMeta: sessionUtils.formatHistoryMeta,
    sortSessionsByUpdatedAt: sessionUtils.sortSessionsByUpdatedAt,
    persistState: storageController.persistState,
    updateContextPill,
    updateContextHint,
    updateChatHeader,
    fetchModelInfo,
    renderMessages,
  });

  return {
    createSessionRecord: sessionUtils.createSessionRecord,
    getActiveSession: sessionController.getActiveSession,
    loadStoredState: storageController.loadStoredState,
    persistState: storageController.persistState,
    loadHistoryFromStorage: storageController.loadHistoryFromStorage,
    flushHistorySave: storageController.flushHistorySave,
    renderHistoryList: sessionController.renderHistoryList,
    deleteSession: sessionController.deleteSession,
    setActiveSession: sessionController.setActiveSession,
    createNewSession: sessionController.createNewSession,
    clearHistory: sessionController.clearHistory,
    clearConversation: sessionController.clearConversation,
    updateSessionTitle: sessionController.updateSessionTitle,
    setSessionTitleStatus: sessionController.setSessionTitleStatus,
    chooseHistoryFolder: storageController.chooseHistoryFolder,
    exportHistoryToFile: storageController.exportHistoryToFile,
    importHistoryFromFile: storageController.importHistoryFromFile,
    refreshStorageUi: storageController.refreshStorageUi,
  };
}
