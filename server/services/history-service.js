const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function createHistoryService({ chatHistoryPath, chatAssetsDir }) {
  function parseDataUrl(previewUrl = '') {
    const match = /^data:([^;,]+);base64,(.+)$/u.exec(String(previewUrl || ''));

    if (!match) {
      return null;
    }

    return {
      mimeType: match[1],
      data: match[2],
    };
  }

  function normalizeImageRecord(image) {
    if (!image || typeof image !== 'object') {
      return null;
    }

    const parsedPreview = !image.data && image.previewUrl ? parseDataUrl(image.previewUrl) : null;
    const mimeType = typeof image.mimeType === 'string' && image.mimeType
      ? image.mimeType
      : (parsedPreview?.mimeType || 'image/png');
    const data = typeof image.data === 'string' && image.data
      ? image.data
      : (parsedPreview?.data || '');

    return {
      assetId: typeof image.assetId === 'string' ? image.assetId.trim() : '',
      name: typeof image.name === 'string' ? image.name : 'image',
      mimeType,
      data,
      previewUrl: typeof image.previewUrl === 'string' ? image.previewUrl : '',
    };
  }

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
                  .map(normalizeImageRecord)
                  .filter(Boolean)
                  .filter((image) => image.assetId || image.data || image.previewUrl)
                : [],
              streaming: Boolean(message.streaming),
            }))
          : [],
        createdAt: Number.isFinite(session.createdAt) ? Number(session.createdAt) : Date.now(),
        updatedAt: Number.isFinite(session.updatedAt) ? Number(session.updatedAt) : Date.now(),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function assetPath(assetId) {
    return path.join(chatAssetsDir, `${assetId}.bin`);
  }

  function computeAssetId(image) {
    return crypto
      .createHash('sha256')
      .update(`${image.mimeType}\0${image.data}`)
      .digest('hex');
  }

  async function ensureAssetDirectory() {
    await fs.mkdir(chatAssetsDir, { recursive: true });
  }

  async function compactSessionsForDisk(sessions) {
    const normalizedSessions = normalizeHistorySessions(sessions);
    const referencedAssetIds = new Set();

    await ensureAssetDirectory();

    const compactSessions = await Promise.all(normalizedSessions.map(async (session) => {
      const messages = await Promise.all(session.messages.map(async (message) => {
        const images = await Promise.all((message.images || []).map(async (image) => {
          const normalizedImage = normalizeImageRecord(image);

          if (!normalizedImage) {
            return null;
          }

          let assetId = normalizedImage.assetId;

          if (normalizedImage.data) {
            assetId = computeAssetId(normalizedImage);
            await fs.writeFile(assetPath(assetId), Buffer.from(normalizedImage.data, 'base64'));
          }

          if (!assetId) {
            return null;
          }

          referencedAssetIds.add(assetId);

          return {
            assetId,
            name: normalizedImage.name,
            mimeType: normalizedImage.mimeType,
          };
        }));

        return {
          ...message,
          images: images.filter(Boolean),
        };
      }));

      return {
        ...session,
        messages,
      };
    }));

    return {
      sessions: compactSessions,
      referencedAssetIds,
    };
  }

  async function hydrateSessionsFromDisk(sessions) {
    const normalizedSessions = normalizeHistorySessions(sessions);

    return Promise.all(normalizedSessions.map(async (session) => {
      const messages = await Promise.all(session.messages.map(async (message) => {
        const images = await Promise.all((message.images || []).map(async (image) => {
          const normalizedImage = normalizeImageRecord(image);

          if (!normalizedImage) {
            return null;
          }

          if (!normalizedImage.assetId) {
            return {
              ...normalizedImage,
              previewUrl: normalizedImage.data
                ? `data:${normalizedImage.mimeType};base64,${normalizedImage.data}`
                : normalizedImage.previewUrl,
            };
          }

          try {
            const bytes = await fs.readFile(assetPath(normalizedImage.assetId));
            const data = bytes.toString('base64');

            return {
              ...normalizedImage,
              data,
              previewUrl: `data:${normalizedImage.mimeType};base64,${data}`,
            };
          } catch (error) {
            if (error.code === 'ENOENT') {
              return {
                ...normalizedImage,
                data: '',
                previewUrl: '',
              };
            }

            throw error;
          }
        }));

        return {
          ...message,
          images: images.filter((image) => image && (image.assetId || image.data || image.previewUrl)),
        };
      }));

      return {
        ...session,
        messages,
      };
    }));
  }

  async function pruneUnusedAssets(referencedAssetIds) {
    await ensureAssetDirectory();
    const entries = await fs.readdir(chatAssetsDir, { withFileTypes: true });

    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.bin')) {
        return;
      }

      const assetId = entry.name.slice(0, -4);

      if (referencedAssetIds.has(assetId)) {
        return;
      }

      await fs.rm(path.join(chatAssetsDir, entry.name), { force: true });
    }));
  }

  async function loadSavedSessions() {
    try {
      const raw = await fs.readFile(chatHistoryPath, 'utf8');
      const payload = JSON.parse(raw);
      return hydrateSessionsFromDisk(payload?.sessions);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async function saveSessionsToDisk(sessions) {
    await fs.mkdir(path.dirname(chatHistoryPath), { recursive: true });
    const compactPayload = await compactSessionsForDisk(sessions);
    const payload = {
      sessions: compactPayload.sessions,
      updatedAt: Date.now(),
    };

    await fs.writeFile(chatHistoryPath, JSON.stringify(payload, null, 2), 'utf8');
    await pruneUnusedAssets(compactPayload.referencedAssetIds);

    return compactPayload.sessions;
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
