export function stripThinkingContent(content = '') {
  const source = String(content);
  const startMarkers = ['<|channel|>thought', '<|channel>thought'];
  const endMarkers = ['<channel|>', '<|channel|>'];
  const startMarker = startMarkers.find((marker) => source.includes(marker)) || null;
  const start = startMarker ? source.indexOf(startMarker) : -1;

  if (start === -1) {
    return {
      content: source,
      thought: '',
    };
  }

  const endMarker = endMarkers.find((marker) => source.indexOf(marker, start) !== -1) || endMarkers[0];
  const end = source.indexOf(endMarker, start);

  if (end === -1) {
    const before = source.slice(0, start);
    return {
      thought: source.slice(start + startMarker.length).trim(),
      content: before.trimStart(),
    };
  }

  const thought = source.slice(start + startMarker.length, end).trim();
  const before = source.slice(0, start);
  const after = source.slice(end + endMarker.length);

  return {
    thought,
    content: `${before}${after}`.trimStart(),
  };
}

export function shouldUseThinkingMode(elements) {
  return Boolean(elements.thinkingModeInput?.checked);
}

export function isWebSearchEnabled(elements) {
  return elements.webSearchButton?.getAttribute('aria-pressed') === 'true';
}

export function setWebSearchEnabled(elements, enabled) {
  if (!elements.webSearchButton) {
    return;
  }

  const nextValue = Boolean(enabled);
  elements.webSearchButton.setAttribute('aria-pressed', String(nextValue));
  elements.webSearchButton.dataset.active = nextValue ? 'true' : 'false';
  elements.webSearchButton.title = nextValue ? 'Disable web search' : 'Enable web search';
}

export function getClientContext() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const locale = navigator.language || Intl.DateTimeFormat().resolvedOptions().locale || '';
  const languages = Array.isArray(navigator.languages)
    ? navigator.languages.filter((value) => typeof value === 'string' && value.trim())
    : [];
  const timeZoneOffsetMinutes = new Date().getTimezoneOffset();

  return {
    timeZone,
    locale,
    languages,
    timeZoneOffsetMinutes,
  };
}

export function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => message && typeof message?.role === 'string')
    .map((message) => {
      const normalizedImages = Array.isArray(message.images)
        ? message.images
          .filter((image) => image && typeof image === 'object')
          .map((image) => ({
            assetId: typeof image.assetId === 'string' ? image.assetId : '',
            name: typeof image.name === 'string' ? image.name : 'image',
            mimeType: typeof image.mimeType === 'string' ? image.mimeType : 'image/png',
            data: typeof image.data === 'string' ? image.data : '',
            previewUrl: typeof image.previewUrl === 'string' ? image.previewUrl : '',
          }))
          .filter((image) => image.data || image.previewUrl)
        : [];
      const normalizedWebSearch = message.webSearch && typeof message.webSearch === 'object'
        ? {
          enabled: Boolean(message.webSearch.enabled),
          query: typeof message.webSearch.query === 'string' ? message.webSearch.query : '',
          status: typeof message.webSearch.status === 'string' ? message.webSearch.status : 'idle',
          compactedChars: Number.isFinite(message.webSearch.compactedChars)
            ? Number(message.webSearch.compactedChars)
            : 0,
          activityLabel: typeof message.webSearch.activityLabel === 'string'
            ? message.webSearch.activityLabel
            : '',
          error: typeof message.webSearch.error === 'string' ? message.webSearch.error : '',
          visits: Array.isArray(message.webSearch.visits)
            ? message.webSearch.visits
              .filter((visit) => visit && typeof visit === 'object')
              .map((visit) => ({
                index: Number.isFinite(visit.index) ? Number(visit.index) : 0,
                status: typeof visit.status === 'string' ? visit.status : 'idle',
                domain: typeof visit.domain === 'string' ? visit.domain : '',
                title: typeof visit.title === 'string' ? visit.title : '',
                url: typeof visit.url === 'string' ? visit.url : '',
              }))
            : [],
          sources: Array.isArray(message.webSearch.sources)
            ? message.webSearch.sources
              .filter((source) => source && typeof source === 'object')
              .map((source) => ({
                index: Number.isFinite(source.index) ? Number(source.index) : 0,
                title: typeof source.title === 'string' ? source.title : '',
                url: typeof source.url === 'string' ? source.url : '',
                domain: typeof source.domain === 'string' ? source.domain : '',
                snippet: typeof source.snippet === 'string' ? source.snippet : '',
              }))
            : [],
        }
        : null;

      if (message.role !== 'assistant' || typeof message.content !== 'string') {
        return {
          ...message,
          model: typeof message.model === 'string' ? message.model.trim() : '',
          requestThinkingEnabled: Boolean(message.requestThinkingEnabled),
          requestWebSearchEnabled: Boolean(message.requestWebSearchEnabled),
          requestSystemPrompt: typeof message.requestSystemPrompt === 'string' ? message.requestSystemPrompt : '',
          webSearch: normalizedWebSearch,
          images: normalizedImages,
        };
      }

      const { content } = stripThinkingContent(message.content);
      return {
        ...message,
        model: typeof message.model === 'string' ? message.model.trim() : '',
        requestThinkingEnabled: Boolean(message.requestThinkingEnabled),
        requestWebSearchEnabled: Boolean(message.requestWebSearchEnabled),
        requestSystemPrompt: typeof message.requestSystemPrompt === 'string' ? message.requestSystemPrompt : '',
        content,
        thought: message.thought || null,
        webSearch: normalizedWebSearch,
        images: normalizedImages,
      };
    });
}

export function compactSessionsForLocalStorage(sessions) {
  return sessions.map((session) => ({
    id: session.id,
    title: session.title,
    model: session.model,
    systemPrompt: session.systemPrompt,
    webSearchEnabled: Boolean(session.webSearchEnabled),
    contextUsage: session.contextUsage,
    generationSpeed: session.generationSpeed,
    generationSpeedApproximate: session.generationSpeedApproximate,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: Array.isArray(session.messages)
      ? session.messages.map((message) => ({
        ...message,
        images: Array.isArray(message.images)
          ? message.images.map((image) => ({
            assetId: image.assetId,
            name: image.name,
            mimeType: image.mimeType,
          }))
          : [],
      }))
      : [],
  }));
}

export function compactSessionsForServerHistory(sessions) {
  return sessions.map((session) => ({
    ...session,
    webSearchEnabled: Boolean(session.webSearchEnabled),
    messages: Array.isArray(session.messages)
      ? session.messages.map((message) => ({
        ...message,
        images: Array.isArray(message.images)
          ? message.images.map((image) => ({
            assetId: typeof image.assetId === 'string' ? image.assetId : '',
            name: image.name,
            mimeType: image.mimeType,
            ...(typeof image.assetId === 'string' && image.assetId
              ? {}
              : { data: typeof image.data === 'string' ? image.data : '' }),
          }))
          : [],
      }))
      : [],
  }));
}
