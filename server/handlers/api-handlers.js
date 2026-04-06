function createApiHandlers({
  readJsonBody,
  writeJson,
  defaultBodyLimit,
  multimodalBodyLimit,
  ollamaBaseUrl,
  historyService,
  ollamaService,
}) {
  async function handleChatHistoryGet(res) {
    try {
      const sessions = await historyService.loadSavedSessions();
      writeJson(res, 200, {
        ok: true,
        sessions,
      });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: error.message,
        sessions: [],
      });
    }
  }

  async function handleChatHistoryPut(req, res) {
    let payload;

    try {
      payload = await readJsonBody(req, multimodalBodyLimit);
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: `Invalid JSON body: ${error.message}`,
      });
      return;
    }

    if (!('sessions' in payload) || !Array.isArray(payload.sessions)) {
      writeJson(res, 400, {
        ok: false,
        error: 'Expected "sessions" array.',
      });
      return;
    }

    try {
      const sessions = historyService.normalizeHistorySessions(payload.sessions);
      const savedSessions = await historyService.saveSessionsToDisk(sessions);
      writeJson(res, 200, {
        ok: true,
        saved: sessions.length,
        sessions: savedSessions,
      });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: error.message,
        saved: 0,
        sessions: [],
      });
    }
  }

  async function handleStatus(res) {
    try {
      const result = await ollamaService.fetchStatus();
      writeJson(res, 200, {
        ok: true,
        baseUrl: ollamaBaseUrl,
        version: result.version,
        models: result.models,
      });
    } catch (error) {
      writeJson(res, 200, {
        ok: false,
        baseUrl: ollamaBaseUrl,
        error: error.message,
        models: [],
      });
    }
  }

  async function handleTags(res) {
    try {
      const models = await ollamaService.fetchTags();
      writeJson(res, 200, {
        ok: true,
        models,
      });
    } catch (error) {
      writeJson(res, 200, {
        ok: false,
        error: error.message,
        models: [],
      });
    }
  }

  async function handleModelInfo(req, res) {
    let payload;

    try {
      payload = await readJsonBody(req, defaultBodyLimit);
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: `Invalid JSON body: ${error.message}`,
      });
      return;
    }

    if (!payload.model) {
      writeJson(res, 400, {
        ok: false,
        error: 'Expected "model".',
      });
      return;
    }

    try {
      const result = await ollamaService.fetchModelInfo(payload.model);
      writeJson(res, 200, {
        ok: true,
        ...result,
      });
    } catch (error) {
      writeJson(res, 200, {
        ok: false,
        model: payload.model,
        error: error.message,
        context_length: null,
      });
    }
  }

  async function handleChat(req, res) {
    let payload;

    try {
      payload = await readJsonBody(req, multimodalBodyLimit);
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: `Invalid JSON body: ${error.message}`,
      });
      return;
    }

    if (!payload.model || !Array.isArray(payload.messages) || payload.messages.length === 0) {
      writeJson(res, 400, {
        ok: false,
        error: 'Expected "model" and a non-empty "messages" array.',
      });
      return;
    }

    const controller = new AbortController();

    res.on('close', () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    try {
      const upstream = await ollamaService.createChatStream({
        model: payload.model,
        messages: payload.messages,
        options: payload.options || undefined,
        signal: controller.signal,
      });

      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text();
        writeJson(res, upstream.status || 502, {
          ok: false,
          error: text || 'Ollama returned an empty response.',
        });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });

      for await (const chunk of upstream.body) {
        res.write(chunk);
      }

      res.end();
    } catch (error) {
      const statusCode = error.name === 'AbortError' ? 499 : 502;
      writeJson(res, statusCode, {
        ok: false,
        error: error.name === 'AbortError' ? 'Request cancelled.' : error.message,
      });
    }
  }

  async function handleContextUsage(req, res) {
    let payload;

    try {
      payload = await readJsonBody(req, multimodalBodyLimit);
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: `Invalid JSON body: ${error.message}`,
      });
      return;
    }

    if (!payload.model || !Array.isArray(payload.messages) || payload.messages.length === 0) {
      writeJson(res, 400, {
        ok: false,
        error: 'Expected "model" and a non-empty "messages" array.',
      });
      return;
    }

    try {
      const result = await ollamaService.measureContextUsage({
        model: payload.model,
        messages: payload.messages,
        options: payload.options || {},
      });

      writeJson(res, 200, {
        ok: true,
        ...result,
      });
    } catch (error) {
      writeJson(res, error.statusCode || 502, {
        ok: false,
        error: error.message,
      });
    }
  }

  async function handleChatTitle(req, res) {
    let payload;

    try {
      payload = await readJsonBody(req, defaultBodyLimit);
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: `Invalid JSON body: ${error.message}`,
      });
      return;
    }

    if (!payload.model || typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
      writeJson(res, 400, {
        ok: false,
        error: 'Expected "model" and a non-empty "prompt" string.',
      });
      return;
    }

    try {
      const result = await ollamaService.generateChatTitle({
        model: payload.model,
        prompt: payload.prompt,
      });

      writeJson(res, 200, {
        ok: true,
        ...result,
      });
    } catch (error) {
      writeJson(res, error.statusCode || 502, {
        ok: false,
        error: error.message,
      });
    }
  }

  return {
    handleChatHistoryGet,
    handleChatHistoryPut,
    handleStatus,
    handleTags,
    handleModelInfo,
    handleChat,
    handleContextUsage,
    handleChatTitle,
  };
}

module.exports = {
  createApiHandlers,
};
