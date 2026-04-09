export function wireAppEvents({
  elements,
  state,
  samplingPreset,
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
}) {
  elements.refreshModelsButton.addEventListener('click', fetchStatus);

  elements.chooseFolderButton?.addEventListener('click', async () => {
    await chooseHistoryFolder();
  });
  elements.exportHistoryButton?.addEventListener('click', () => {
    exportHistoryToFile();
  });
  elements.importHistoryButton?.addEventListener('click', () => {
    elements.importHistoryInput?.click();
  });
  elements.importHistoryInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    await importHistoryFromFile(file);
    event.target.value = '';
  });

  const onModelChange = () => {
    elements.modelInput.dataset.pendingValue = elements.modelInput.value.trim();
    updateContextPill();
    fetchModelInfo(elements.modelInput.value.trim());
    persistState();
    maybeGenerateSessionTitle(getActiveSession());
    void measureCurrentConversationContextUsage({ historyMode: 'immediate' });
  };

  elements.modelInput.addEventListener('input', onModelChange);
  elements.modelInput.addEventListener('change', onModelChange);

  elements.temperatureInput.addEventListener('change', () => {
    const value = Number(elements.temperatureInput.value);
    const nextValue = Number.isFinite(value)
      ? Math.max(0, Math.min(2, value))
      : samplingPreset.temperature;
    elements.temperatureInput.value = String(nextValue);
    persistState();
  });
  elements.systemPromptInput.addEventListener('input', () => {
    persistState();
    scheduleContextUsageMeasurement();
  });
  elements.contextInput.addEventListener('change', () => {
    state.contextCustomized = true;
    const value = Number(elements.contextInput.value);
    const nextValue = Number.isFinite(value) && value > 0
      ? Math.max(512, Math.round(value / 512) * 512)
      : 8192;
    elements.contextInput.value = String(nextValue);
    persistState();
    void measureCurrentConversationContextUsage({ historyMode: 'immediate' });
  });
  elements.thinkingModeInput.addEventListener('change', () => {
    persistState();
    void measureCurrentConversationContextUsage({ historyMode: 'immediate' });
  });
  elements.visualTokenBudgetInput.addEventListener('change', () => {
    persistState();
    void measureCurrentConversationContextUsage({ historyMode: 'immediate' });
  });
  elements.webSearchButton?.addEventListener('click', () => {
    const nextValue = elements.webSearchButton.getAttribute('aria-pressed') !== 'true';
    elements.webSearchButton.setAttribute('aria-pressed', String(nextValue));
    elements.webSearchButton.dataset.active = nextValue ? 'true' : 'false';
    elements.webSearchButton.title = nextValue ? 'Disable web search' : 'Enable web search';
    persistState();
  });

  elements.clearChatButton.addEventListener('click', () => {
    clearConversation();
    void measureCurrentConversationContextUsage({ historyMode: 'immediate' });
  });
  elements.newChatButton.addEventListener('click', () => {
    createNewSession();
    void measureCurrentConversationContextUsage({ historyMode: 'immediate' });
  });
  elements.clearHistoryButton.addEventListener('click', () => {
    clearHistory();
    void measureCurrentConversationContextUsage({ historyMode: 'immediate' });
  });
  elements.attachImageButton.addEventListener('click', () => {
    elements.imageInput.click();
  });
  elements.imageInput.addEventListener('change', (event) => {
    void handleImageSelection(event.target.files || []);
  });
  elements.imageLightboxBackdrop.addEventListener('click', closeImageLightbox);
  elements.imageLightboxClose.addEventListener('click', closeImageLightbox);
  elements.promptDropzone.addEventListener('dragenter', (event) => {
    if (!hasImageFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    state.dragDepth += 1;
    setDropzoneActive(true);
  });
  elements.promptDropzone.addEventListener('dragover', (event) => {
    if (!hasImageFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropzoneActive(true);
  });
  elements.promptDropzone.addEventListener('dragleave', (event) => {
    if (!hasImageFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) {
      setDropzoneActive(false);
    }
  });
  elements.promptDropzone.addEventListener('drop', (event) => {
    if (!hasImageFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    state.dragDepth = 0;
    setDropzoneActive(false);
    void handleImageSelection(event.dataTransfer.files || []);
  });
  elements.micButton.addEventListener('click', toggleRecording);
  elements.stopButton.addEventListener('click', stopStreaming);
  elements.composerTopbar?.addEventListener('click', (event) => {
    if (event.target.closest('input, textarea, select, button, a, label')) {
      return;
    }

    toggleComposer();
  });
  elements.composerTopbar?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    toggleComposer();
  });
  elements.historyList.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('.history-delete-button[data-session-id]');

    if (deleteButton) {
      event.stopPropagation();
      deleteSession(deleteButton.dataset.sessionId);
      void measureCurrentConversationContextUsage({ historyMode: 'immediate' });
      return;
    }

    const item = event.target.closest('.history-item[data-session-id]');

    if (!item) {
      return;
    }

    setActiveSession(item.dataset.sessionId);
    void measureCurrentConversationContextUsage({ historyMode: 'immediate' });
    maybeGenerateSessionTitle(getActiveSession());
  });
  elements.messageList.addEventListener('click', (event) => {
    handleMessageClick(event);
  });
  elements.imagePreviewList.addEventListener('click', (event) => {
    const button = event.target.closest('.image-preview-remove[data-image-index]');

    if (!button) {
      return;
    }

    removePendingImage(Number(button.dataset.imageIndex));
  });

  elements.composerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const prompt = elements.promptInput.value.trim();
    const attachments = state.pendingImages.map((image) => ({ ...image }));

    if ((!prompt && !attachments.length) || state.isStreaming) {
      return;
    }

    elements.promptInput.value = '';
    state.pendingImages = [];
    renderPendingImages();
    await sendPrompt(prompt, attachments);
  });

  elements.promptInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      if (event.key === 'Escape' && !elements.imageLightbox.hidden) {
        closeImageLightbox();
      }
      return;
    }

    event.preventDefault();
    elements.composerForm.requestSubmit();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.imageLightbox.hidden) {
      closeImageLightbox();
    }
  });

  window.addEventListener('pagehide', () => {
    void flushHistorySave();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushHistorySave();
    }
  });
}
