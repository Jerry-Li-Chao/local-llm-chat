const http = require('node:http');

const {
  HOST,
  PORT,
  OLLAMA_BASE_URL,
  PUBLIC_DIR,
  CHAT_HISTORY_PATH,
  DEFAULT_BODY_LIMIT,
  MULTIMODAL_BODY_LIMIT,
  MIME_TYPES,
} = require('./server/config.js');
const { writeJson, readJsonBody } = require('./server/utils/http.js');
const { createHistoryService } = require('./server/services/history-service.js');
const { createOllamaService } = require('./server/services/ollama-service.js');
const { createStaticService } = require('./server/services/static-service.js');
const { createApiHandlers } = require('./server/handlers/api-handlers.js');
const { createRouter } = require('./server/router.js');

const historyService = createHistoryService({
  chatHistoryPath: CHAT_HISTORY_PATH,
});

const ollamaService = createOllamaService({
  baseUrl: OLLAMA_BASE_URL,
});

const staticService = createStaticService({
  publicDir: PUBLIC_DIR,
  mimeTypes: MIME_TYPES,
  writeJson,
});

const apiHandlers = createApiHandlers({
  readJsonBody,
  writeJson,
  defaultBodyLimit: DEFAULT_BODY_LIMIT,
  multimodalBodyLimit: MULTIMODAL_BODY_LIMIT,
  ollamaBaseUrl: OLLAMA_BASE_URL,
  historyService,
  ollamaService,
});

const routeRequest = createRouter({
  writeJson,
  apiHandlers,
  staticService,
});

const server = http.createServer(async (req, res) => {
  try {
    await routeRequest(req, res);
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local LLM chat UI available at http://${HOST}:${PORT}`);
  console.log(`Expecting Ollama at ${OLLAMA_BASE_URL}`);
  console.log(`Saving chat history to ${CHAT_HISTORY_PATH}`);
});
