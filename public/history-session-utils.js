export function createHistorySessionUtils({ normalizeMessages }) {
  function createSessionRecord({
    title = 'New chat',
    model = '',
    messages = [],
    systemPrompt = '',
    contextUsage = 0,
    generationSpeed = null,
    generationSpeedApproximate = false,
    titleStatus = 'idle',
    titleStatusMessage = '',
  } = {}) {
    return {
      id: `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      title,
      model,
      systemPrompt,
      contextUsage,
      generationSpeed,
      generationSpeedApproximate,
      titleStatus,
      titleStatusMessage,
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function normalizeStoredSession(session) {
    if (!session || typeof session !== 'object') {
      return null;
    }

    return {
      id: typeof session.id === 'string' && session.id.trim()
        ? session.id.trim()
        : `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      title: typeof session.title === 'string' && session.title.trim() ? session.title.trim() : 'New chat',
      model: typeof session.model === 'string' ? session.model.trim() : '',
      systemPrompt: typeof session.systemPrompt === 'string' ? session.systemPrompt : '',
      contextUsage: Number.isFinite(session.contextUsage) ? Number(session.contextUsage) : 0,
      generationSpeed: Number.isFinite(session.generationSpeed) ? Number(session.generationSpeed) : null,
      generationSpeedApproximate: Boolean(session.generationSpeedApproximate),
      titleStatus: typeof session.titleStatus === 'string' ? session.titleStatus : 'idle',
      titleStatusMessage: typeof session.titleStatusMessage === 'string' ? session.titleStatusMessage : '',
      messages: normalizeMessages(session.messages),
      createdAt: Number.isFinite(session.createdAt) ? Number(session.createdAt) : Date.now(),
      updatedAt: Number.isFinite(session.updatedAt) ? Number(session.updatedAt) : Date.now(),
    };
  }

  function sortSessionsByUpdatedAt(sessions) {
    return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function normalizeSessionsFromStorage(sessions) {
    if (!Array.isArray(sessions)) {
      return [];
    }

    return sortSessionsByUpdatedAt(
      sessions
        .map(normalizeStoredSession)
        .filter(Boolean),
    );
  }

  function imagePayloadScore(images = []) {
    if (!Array.isArray(images)) {
      return 0;
    }

    return images.reduce((score, image) => score + (image?.data ? 2 : 0) + (image?.previewUrl ? 1 : 0), 0);
  }

  function mergeMessageRecords(primary, secondary) {
    if (!primary) {
      return secondary;
    }

    if (!secondary) {
      return primary;
    }

    const primaryScore = imagePayloadScore(primary.images);
    const secondaryScore = imagePayloadScore(secondary.images);

    return {
      ...primary,
      images: primaryScore >= secondaryScore ? primary.images || [] : secondary.images || [],
    };
  }

  function mergeSessionRecords(existing, incoming) {
    const primary = incoming.updatedAt >= existing.updatedAt ? incoming : existing;
    const secondary = primary === incoming ? existing : incoming;
    const primaryMessages = Array.isArray(primary.messages) ? primary.messages : [];
    const secondaryMessages = Array.isArray(secondary.messages) ? secondary.messages : [];
    const secondaryIndex = new Map(
      secondaryMessages.map((message, index) => [`${message.role}:${message.content}:${index}`, message]),
    );

    const mergedMessages = primaryMessages.map((message, index) => {
      const key = `${message.role}:${message.content}:${index}`;
      return mergeMessageRecords(message, secondaryIndex.get(key));
    });

    secondaryMessages.forEach((message, index) => {
      const key = `${message.role}:${message.content}:${index}`;

      if (!secondaryIndex.has(key)) {
        return;
      }

      const alreadyIncluded = mergedMessages.some((candidate, candidateIndex) => (
        `${candidate.role}:${candidate.content}:${candidateIndex}` === key
      ));

      if (!alreadyIncluded) {
        mergedMessages.push(message);
      }
    });

    return {
      ...primary,
      messages: mergedMessages,
    };
  }

  function mergeSessions(...sessionLists) {
    const merged = new Map();

    sessionLists
      .flat()
      .map(normalizeStoredSession)
      .filter(Boolean)
      .forEach((session) => {
        const existing = merged.get(session.id);

        if (!existing) {
          merged.set(session.id, session);
          return;
        }

        merged.set(session.id, mergeSessionRecords(existing, session));
      });

    return sortSessionsByUpdatedAt([...merged.values()]);
  }

  function formatHistoryMeta(session) {
    const modelLabel = session.model ? `Model: ${session.model}` : 'Model not set';
    const messageCount = Array.isArray(session.messages) ? session.messages.length : 0;
    const countLabel = `${messageCount} message${messageCount === 1 ? '' : 's'}`;
    return `${modelLabel} • ${countLabel}`;
  }

  return {
    createSessionRecord,
    normalizeStoredSession,
    normalizeSessionsFromStorage,
    sortSessionsByUpdatedAt,
    mergeSessions,
    formatHistoryMeta,
  };
}
