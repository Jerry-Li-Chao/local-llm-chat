const { URL } = require('node:url');

function createRouter({ writeJson, apiHandlers, staticService }) {
  return async function routeRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/status') {
      await apiHandlers.handleStatus(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tags') {
      await apiHandlers.handleTags(res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      await apiHandlers.handleChat(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/context-usage') {
      await apiHandlers.handleContextUsage(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat-title') {
      await apiHandlers.handleChatTitle(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/model-info') {
      await apiHandlers.handleModelInfo(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/chat-history') {
      await apiHandlers.handleChatHistoryGet(res);
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/api/chat-history') {
      await apiHandlers.handleChatHistoryPut(req, res);
      return;
    }

    if (req.method === 'GET') {
      await staticService.serveStatic(url.pathname, res);
      return;
    }

    writeJson(res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
  };
}

module.exports = {
  createRouter,
};
