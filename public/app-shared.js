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

export function getSystemPromptContent(elements) {
  const customPrompt = elements.systemPromptInput?.value?.trim() || '';

  if (!shouldUseThinkingMode(elements)) {
    return customPrompt;
  }

  return customPrompt ? `<|think|>\n${customPrompt}` : '<|think|>';
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
            name: typeof image.name === 'string' ? image.name : 'image',
            mimeType: typeof image.mimeType === 'string' ? image.mimeType : 'image/png',
            data: typeof image.data === 'string' ? image.data : '',
            previewUrl: typeof image.previewUrl === 'string' ? image.previewUrl : '',
          }))
          .filter((image) => image.data || image.previewUrl)
        : [];

      if (message.role !== 'assistant' || typeof message.content !== 'string') {
        return {
          ...message,
          images: normalizedImages,
        };
      }

      const { content } = stripThinkingContent(message.content);
      return {
        ...message,
        content,
        thought: message.thought || null,
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
            name: image.name,
            mimeType: image.mimeType,
          }))
          : [],
      }))
      : [],
  }));
}
