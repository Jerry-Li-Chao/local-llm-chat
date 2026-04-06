const fs = require('node:fs/promises');

function createHistoryService({ chatHistoryPath }) {
  function normalizeHistorySessions(sessions) {
    if (!Array.isArray(sessions)) {
      return [];
    }

    return sessions
      .filter((session) => session && typeof session === 'object')
      .map((session) => ({
        id: typeof session.id === 'string' && session.id.trim() ? session.id.trim() : `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        title: typeof session.title === 'string' && session.title.trim() ? session.title.trim() : 'New chat',
        model: typeof session.model === 'string' ? session.model.trim() : '',
        systemPrompt: typeof session.systemPrompt === 'string' ? session.systemPrompt : '',
        contextUsage: Number.isFinite(session.contextUsage) ? Number(session.contextUsage) : 0,
        generationSpeed: Number.isFinite(session.generationSpeed) ? Number(session.generationSpeed) : null,
        generationSpeedApproximate: Boolean(session.generationSpeedApproximate),
        messages: Array.isArray(session.messages)
          ? session.messages
            .filter((message) => message && typeof message === 'object' && typeof message.role === 'string')
            .map((message) => ({
              role: message.role,
              model: typeof message.model === 'string' ? message.model.trim() : '',
              requestThinkingEnabled: Boolean(message.requestThinkingEnabled),
              requestSystemPrompt: typeof message.requestSystemPrompt === 'string' ? message.requestSystemPrompt : '',
              content: typeof message.content === 'string' ? message.content : String(message.content ?? ''),
              images: Array.isArray(message.images)
                ? message.images
                  .filter((image) => image && typeof image === 'object')
                  .map((image) => ({
                    name: typeof image.name === 'string' ? image.name : 'image',
                    mimeType: typeof image.mimeType === 'string' ? image.mimeType : 'image/png',
                    data: typeof image.data === 'string' ? image.data : '',
                    previewUrl: typeof image.previewUrl === 'string' ? image.previewUrl : '',
                  }))
                  .filter((image) => image.data || image.previewUrl)
                : [],
              streaming: Boolean(message.streaming),
            }))
          : [],
        createdAt: Number.isFinite(session.createdAt) ? Number(session.createdAt) : Date.now(),
        updatedAt: Number.isFinite(session.updatedAt) ? Number(session.updatedAt) : Date.now(),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function loadSavedSessions() {
    try {
      const raw = await fs.readFile(chatHistoryPath, 'utf8');
      const payload = JSON.parse(raw);
      return normalizeHistorySessions(payload?.sessions);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async function saveSessionsToDisk(sessions) {
    await fs.mkdir(require('node:path').dirname(chatHistoryPath), { recursive: true });
    const payload = {
      sessions: normalizeHistorySessions(sessions),
      updatedAt: Date.now(),
    };

    await fs.writeFile(chatHistoryPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  return {
    normalizeHistorySessions,
    loadSavedSessions,
    saveSessionsToDisk,
  };
}

module.exports = {
  createHistoryService,
};
