import {
  compactSessionsForLocalStorage,
  compactSessionsForServerHistory,
  getSystemPromptContent,
  normalizeMessages,
  shouldUseThinkingMode,
  stripThinkingContent,
} from './app-shared.js';
import { wireAppEvents } from './app-events.js';
import { createChatManager } from './chat.js';
import { createHistoryManager } from './history.js';
import { createMediaManager } from './media.js';
import { createModelContextController } from './model-context.js';
import { createRenderer } from './render.js';

const elements = {
  clearChatButton: document.querySelector('#clearChatButton'),
  chatHeader: document.querySelector('#chatHeader'),
  chatTitle: document.querySelector('#chatTitle'),
  chatTitleStatus: document.querySelector('#chatTitleStatus'),
  composerForm: document.querySelector('#composerForm'),
  composerBody: document.querySelector('#composerBody'),
  composerTopbar: document.querySelector('#composerTopbar'),
  composerCollapseHint: document.querySelector('#composerCollapseHint'),
  promptDropzone: document.querySelector('#promptDropzone'),
  attachImageButton: document.querySelector('#attachImageButton'),
  connectionDetail: document.querySelector('#connectionDetail'),
  connectionStatus: document.querySelector('#connectionStatus'),
  contextHint: document.querySelector('#contextHint'),
  contextInput: document.querySelector('#contextInput'),
  emptyStateTemplate: document.querySelector('#emptyStateTemplate'),
  imageInput: document.querySelector('#imageInput'),
  imageLightbox: document.querySelector('#imageLightbox'),
  imageLightboxBackdrop: document.querySelector('#imageLightboxBackdrop'),
  imageLightboxClose: document.querySelector('#imageLightboxClose'),
  imageLightboxImage: document.querySelector('#imageLightboxImage'),
  imagePreviewList: document.querySelector('#imagePreviewList'),
  messageList: document.querySelector('#messageList'),
  meterBar: document.querySelector('#meterBar'),
  micButton: document.querySelector('#micButton'),
  modelInput: document.querySelector('#modelInput'),
  contextPill: document.querySelector('#contextPill'),
  speedPill: document.querySelector('#speedPill'),
  speedPillValue: document.querySelector('#speedPillValue'),
  historyList: document.querySelector('#historyList'),
  storageStatus: document.querySelector('#storageStatus'),
  chooseFolderButton: document.querySelector('#chooseFolderButton'),
  exportHistoryButton: document.querySelector('#exportHistoryButton'),
  importHistoryButton: document.querySelector('#importHistoryButton'),
  importHistoryInput: document.querySelector('#importHistoryInput'),
  clearHistoryButton: document.querySelector('#clearHistoryButton'),
  newChatButton: document.querySelector('#newChatButton'),
  systemPromptInput: document.querySelector('#systemPromptInput'),
  thinkingModeInput: document.querySelector('#thinkingModeInput'),
  visualTokenBudgetInput: document.querySelector('#visualTokenBudgetInput'),
  promptInput: document.querySelector('#promptInput'),
  refreshModelsButton: document.querySelector('#refreshModelsButton'),
  sendButton: document.querySelector('#sendButton'),
  stopButton: document.querySelector('#stopButton'),
  temperatureInput: document.querySelector('#temperatureInput'),
  voiceBadge: document.querySelector('#voiceBadge'),
  voiceHint: document.querySelector('#voiceHint'),
};

const STORAGE_KEY = 'gemma-local-chat-state';
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SAMPLING_PRESET = {
  temperature: 1.0,
  top_p: 0.95,
  top_k: 64,
};
const VISUAL_TOKEN_BUDGETS = [70, 140, 280, 560, 1120];
const DEFAULT_VISUAL_TOKEN_BUDGET = 280;

const state = {
  abortController: null,
  audioContext: null,
  audioMeterFrame: null,
  dragDepth: 0,
  isRecording: false,
  isStreaming: false,
  mediaStream: null,
  pendingImages: [],
  messageNodes: new Map(),
  messages: [],
  models: [],
  sessions: [],
  activeSessionId: null,
  modelContextLimits: new Map(),
  pendingMessageUpdates: new Set(),
  historySaveTimer: null,
  historySavePromise: Promise.resolve(),
  contextCustomized: false,
  historyFolderHandle: null,
  historyFolderName: '',
  recognition: null,
  renderFrame: null,
  shouldScrollOnFlush: false,
};

let getActiveSession = () => null;
let persistState = () => {};
let createSessionRecord = () => null;
let loadStoredState = () => ({});
let loadHistoryFromStorage = async () => {};
let flushHistorySave = async () => {};
let renderHistoryList = () => {};
let deleteSession = () => {};
let setActiveSession = () => {};
let createNewSession = () => {};
let clearHistory = () => {};
let clearConversation = () => {};
let updateSessionTitle = () => {};
let setSessionTitleStatus = () => {};
let chooseHistoryFolder = async () => {};
let exportHistoryToFile = () => {};
let importHistoryFromFile = async () => {};
let refreshStorageUi = () => {};
let measureCurrentConversationContextUsage = async () => null;
let maybeGenerateSessionTitle = () => {};
let scheduleContextUsageMeasurement = () => {};
let sendPrompt = async () => {};
let stopStreaming = () => {};

function setVoiceState(label, stateName) {
  elements.voiceBadge.textContent = label;
  elements.voiceBadge.dataset.state = stateName;
}

function setStreamingMode(isStreaming) {
  state.isStreaming = isStreaming;
  elements.sendButton.disabled = isStreaming;
  elements.stopButton.hidden = !isStreaming;
  elements.micButton.disabled = isStreaming;
  elements.refreshModelsButton.disabled = isStreaming;
}

function updateChatHeader() {
  const activeSession = getActiveSession();
  const title = activeSession?.title?.trim() || 'New chat';
  elements.chatTitle.textContent = title;

  if (!elements.chatTitleStatus) {
    return;
  }

  if (activeSession?.titleStatus === 'generating') {
    elements.chatTitleStatus.hidden = false;
    elements.chatTitleStatus.dataset.state = 'generating';
    elements.chatTitleStatus.textContent = 'Generating title…';
    return;
  }

  if (activeSession?.titleStatus === 'error') {
    elements.chatTitleStatus.hidden = false;
    elements.chatTitleStatus.dataset.state = 'error';
    elements.chatTitleStatus.textContent = activeSession.titleStatusMessage || 'Could not generate title';
    return;
  }

  elements.chatTitleStatus.hidden = true;
  elements.chatTitleStatus.textContent = '';
  delete elements.chatTitleStatus.dataset.state;
}

function syncCollapsibleUi() {
  const composerCollapsed = elements.composerForm.dataset.collapsed === 'true';

  elements.composerTopbar?.setAttribute('aria-expanded', String(!composerCollapsed));
  elements.composerTopbar?.setAttribute('aria-label', composerCollapsed ? 'Expand message composer' : 'Collapse message composer');
  if (elements.composerCollapseHint) {
    elements.composerCollapseHint.textContent = composerCollapsed
      ? 'Tap anywhere here to expand'
      : 'Tap anywhere here to collapse';
  }
}

function toggleComposer() {
  const next = elements.composerForm.dataset.collapsed === 'true' ? 'false' : 'true';
  elements.composerForm.dataset.collapsed = next;
  syncCollapsibleUi();
  persistState();
}

const mediaManager = createMediaManager({
  elements,
  state,
  SpeechRecognition,
  setVoiceState,
});

const {
  renderPendingImages,
  handleImageSelection,
  removePendingImage,
  openImageLightbox,
  closeImageLightbox,
  setDropzoneActive,
  hasImageFiles,
  startRecording,
  stopRecording,
  toggleRecording,
} = mediaManager;

function updateMessage(index, patch, options = {}) {
  const shouldScroll = isNearBottom();
  const historyMode = options.historyMode || 'debounced';

  state.messages[index] = {
    ...state.messages[index],
    ...patch,
  };
  persistState({ historyMode });
  queueMessageNodeUpdate(index, shouldScroll);
}

const renderer = createRenderer({
  elements,
  state,
  updateMessage,
  onOpenImageLightbox: openImageLightbox,
});

const {
  isNearBottom,
  scrollMessagesToBottom,
  appendMessageNode,
  queueMessageNodeUpdate,
  renderMessages,
  handleMessageClick,
} = renderer;

function addMessage(role, content, extra = {}, options = {}) {
  const shouldScroll = isNearBottom();
  const historyMode = options.historyMode || 'immediate';

  state.messages.push({
    role,
    content,
    ...extra,
  });
  persistState({ historyMode });
  appendMessageNode(state.messages[state.messages.length - 1], state.messages.length - 1);

  if (shouldScroll) {
    scrollMessagesToBottom();
  }
}

const modelContextController = createModelContextController({
  elements,
  state,
  persistState: (...args) => persistState(...args),
  getActiveSession: (...args) => getActiveSession(...args),
  maybeGenerateSessionTitle: (...args) => maybeGenerateSessionTitle(...args),
  measureCurrentConversationContextUsage: (...args) => measureCurrentConversationContextUsage(...args),
});

const {
  updateContextPill,
  updateContextHint,
  fetchModelInfo,
  fetchStatus,
} = modelContextController;

const historyManager = createHistoryManager({
  elements,
  state,
  storageKey: STORAGE_KEY,
  samplingPreset: SAMPLING_PRESET,
  visualTokenBudgets: VISUAL_TOKEN_BUDGETS,
  defaultVisualTokenBudget: DEFAULT_VISUAL_TOKEN_BUDGET,
  normalizeMessages,
  compactSessionsForLocalStorage,
  compactSessionsForServerHistory,
  updateContextPill,
  updateContextHint,
  updateChatHeader,
  fetchModelInfo,
  renderMessages,
});

({
  createSessionRecord,
  getActiveSession,
  loadStoredState,
  persistState,
  loadHistoryFromStorage,
  flushHistorySave,
  renderHistoryList,
  deleteSession,
  setActiveSession,
  createNewSession,
  clearHistory,
  clearConversation,
  updateSessionTitle,
  setSessionTitleStatus,
  chooseHistoryFolder,
  exportHistoryToFile,
  importHistoryFromFile,
  refreshStorageUi,
} = historyManager);

const chatManager = createChatManager({
  elements,
  state,
  samplingPreset: SAMPLING_PRESET,
  visualTokenBudgets: VISUAL_TOKEN_BUDGETS,
  defaultVisualTokenBudget: DEFAULT_VISUAL_TOKEN_BUDGET,
  stripThinkingContent,
  shouldUseThinkingMode: () => shouldUseThinkingMode(elements),
  getSystemPromptContent: () => getSystemPromptContent(elements),
  getActiveSession,
  persistState,
  updateSessionTitle,
  setSessionTitleStatus,
  renderMessages,
  addMessage,
  updateMessage,
  setStreamingMode,
});

({
  measureCurrentConversationContextUsage,
  maybeGenerateSessionTitle,
  scheduleContextUsageMeasurement,
  sendPrompt,
  stopStreaming,
} = chatManager);

async function init() {
  closeImageLightbox();
  const storedState = loadStoredState();
  await loadHistoryFromStorage(storedState.legacySessions);

  if (!state.sessions.length) {
    state.sessions = [createSessionRecord({
      model: elements.modelInput.value.trim(),
      systemPrompt: elements.systemPromptInput.value,
    })];
  }

  if (storedState.legacyActiveSessionId && state.sessions.some((session) => session.id === storedState.legacyActiveSessionId)) {
    state.activeSessionId = storedState.legacyActiveSessionId;
  }

  if (!state.activeSessionId && state.sessions.length) {
    state.activeSessionId = state.sessions[0].id;
  }

  const activeSession = getActiveSession();
  if (activeSession && !elements.modelInput.value.trim() && activeSession.model) {
    elements.modelInput.value = activeSession.model;
    elements.modelInput.dataset.pendingValue = activeSession.model;
  }
  if (activeSession) {
    elements.systemPromptInput.value = activeSession.systemPrompt || elements.systemPromptInput.value;
  }

  if (!VISUAL_TOKEN_BUDGETS.includes(Number(elements.visualTokenBudgetInput.value))) {
    elements.visualTokenBudgetInput.value = String(DEFAULT_VISUAL_TOKEN_BUDGET);
  }

  state.messages = activeSession ? activeSession.messages : [];

  persistState();
  updateChatHeader();
  updateContextPill();
  syncCollapsibleUi();
  updateContextHint();
  renderMessages();
  renderHistoryList();
  refreshStorageUi();
  wireAppEvents({
    elements,
    state,
    samplingPreset: SAMPLING_PRESET,
    fetchStatus,
    chooseHistoryFolder,
    exportHistoryToFile,
    importHistoryFromFile,
    updateContextPill,
    fetchModelInfo,
    persistState,
    maybeGenerateSessionTitle,
    measureCurrentConversationContextUsage,
    scheduleContextUsageMeasurement,
    clearConversation,
    createNewSession,
    clearHistory,
    handleImageSelection,
    closeImageLightbox,
    hasImageFiles,
    setDropzoneActive,
    toggleRecording,
    stopStreaming,
    toggleComposer,
    deleteSession,
    setActiveSession,
    getActiveSession,
    handleMessageClick,
    removePendingImage,
    renderPendingImages,
    sendPrompt,
    flushHistorySave,
  });
  maybeGenerateSessionTitle(activeSession);

  if (!SpeechRecognition) {
    setVoiceState('Unsupported', 'unsupported');
    elements.voiceHint.textContent = 'This browser does not expose the Web Speech API. Text chat still works.';
  } else {
    setVoiceState('Idle', 'idle');
  }

  fetchStatus();
  window.setInterval(fetchStatus, 15000);
}

void init();
