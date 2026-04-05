const http = require('node:http');
const { createReadStream, existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const CHAT_HISTORY_PATH = process.env.CHAT_HISTORY_PATH
  ? path.resolve(process.cwd(), process.env.CHAT_HISTORY_PATH)
  : path.join(DATA_DIR, 'chat-history.json');
const DEFAULT_BODY_LIMIT = 1_000_000;
const MULTIMODAL_BODY_LIMIT = 50_000_000;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
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
    const raw = await fs.readFile(CHAT_HISTORY_PATH, 'utf8');
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
  await fs.mkdir(path.dirname(CHAT_HISTORY_PATH), { recursive: true });
  const payload = {
    sessions: normalizeHistorySessions(sessions),
    updatedAt: Date.now(),
  };

  await fs.writeFile(CHAT_HISTORY_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

async function handleChatHistoryGet(res) {
  try {
    const sessions = await loadSavedSessions();
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
    payload = await readJsonBody(req, MULTIMODAL_BODY_LIMIT);
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
    const sessions = normalizeHistorySessions(payload.sessions);
    await saveSessionsToDisk(sessions);
    writeJson(res, 200, {
      ok: true,
      saved: sessions.length,
    });
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      error: error.message,
      saved: 0,
    });
  }
}

function normalizeModelPayload(payload) {
  return Array.isArray(payload?.models)
    ? payload.models.map((model) => ({
        name: model.name,
        size: model.size,
        modified_at: model.modified_at,
      }))
    : [];
}

async function readJsonBody(req, maxBytes = DEFAULT_BODY_LIMIT) {
  let body = '';

  for await (const chunk of req) {
    body += chunk;

    if (body.length > maxBytes) {
      throw new Error('Request body is too large.');
    }
  }

  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}

async function fetchUpstreamJson(endpoint) {
  const response = await fetch(`${OLLAMA_BASE_URL}${endpoint}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Upstream responded with ${response.status}.`);
  }

  return response.json();
}

async function handleStatus(res) {
  try {
    const [version, tags] = await Promise.all([
      fetchUpstreamJson('/api/version'),
      fetchUpstreamJson('/api/tags'),
    ]);

    writeJson(res, 200, {
      ok: true,
      baseUrl: OLLAMA_BASE_URL,
      version,
      models: normalizeModelPayload(tags),
    });
  } catch (error) {
    writeJson(res, 200, {
      ok: false,
      baseUrl: OLLAMA_BASE_URL,
      error: error.message,
      models: [],
    });
  }
}

async function handleTags(res) {
  try {
    const tags = await fetchUpstreamJson('/api/tags');
    writeJson(res, 200, {
      ok: true,
      models: normalizeModelPayload(tags),
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
    payload = await readJsonBody(req);
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
    const response = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model: payload.model }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Upstream responded with ${response.status}.`);
    }

    const details = await response.json();
    const contextLength =
      details?.model_info?.['gemma4.context_length'] ??
      details?.model_info?.['gemma3.context_length'] ??
      details?.model_info?.['llama.context_length'] ??
      details?.model_info?.context_length ??
      null;

    writeJson(res, 200, {
      ok: true,
      model: payload.model,
      context_length: typeof contextLength === 'number' ? contextLength : null,
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
    payload = await readJsonBody(req, MULTIMODAL_BODY_LIMIT);
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
    const upstream = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson, application/json',
      },
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        stream: true,
        options: payload.options || undefined,
      }),
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
    payload = await readJsonBody(req, MULTIMODAL_BODY_LIMIT);
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
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        stream: false,
        options: {
          ...(payload.options || {}),
          num_predict: 1,
        },
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      writeJson(res, response.status || 502, {
        ok: false,
        error: result.error || `Ollama returned ${response.status}.`,
      });
      return;
    }

    writeJson(res, 200, {
      ok: true,
      prompt_eval_count: Number.isFinite(result.prompt_eval_count) ? Number(result.prompt_eval_count) : null,
    });
  } catch (error) {
    writeJson(res, 502, {
      ok: false,
      error: error.message,
    });
  }
}

function normalizeGeneratedTitle(title) {
  const firstLine = String(title || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';

  return firstLine
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
}

async function handleChatTitle(req, res) {
  let payload;

  try {
    payload = await readJsonBody(req);
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
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: payload.model,
        messages: [
          {
            role: 'system',
            content: 'Write a concise chat title for the user message. Return exactly one plain-text line, no quotes, no markdown, no punctuation at the end, and keep it under 8 words.',
          },
          {
            role: 'user',
            content: payload.prompt.trim(),
          },
        ],
        stream: false,
        options: {
          temperature: 0.2,
          top_p: 0.9,
          top_k: 40,
          num_ctx: 1024,
          num_predict: 24,
        },
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      writeJson(res, response.status || 502, {
        ok: false,
        error: result.error || `Ollama returned ${response.status}.`,
      });
      return;
    }

    writeJson(res, 200, {
      ok: true,
      title: normalizeGeneratedTitle(result?.message?.content),
    });
  } catch (error) {
    writeJson(res, 502, {
      ok: false,
      error: error.message,
    });
  }
}

async function serveStatic(reqPath, res) {
  const safePath = reqPath === '/' ? '/index.html' : reqPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    writeJson(res, 403, {
      ok: false,
      error: 'Forbidden',
    });
    return;
  }

  if (!existsSync(filePath)) {
    writeJson(res, 404, {
      ok: false,
      error: 'Not found',
    });
    return;
  }

  const stat = await fs.stat(filePath);

  if (stat.isDirectory()) {
    await serveStatic(path.join(reqPath, 'index.html'), res);
    return;
  }

  const extension = path.extname(filePath);
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300',
  });

  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      await handleStatus(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tags') {
      await handleTags(res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      await handleChat(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/context-usage') {
      await handleContextUsage(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat-title') {
      await handleChatTitle(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/model-info') {
      await handleModelInfo(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/chat-history') {
      await handleChatHistoryGet(res);
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/api/chat-history') {
      await handleChatHistoryPut(req, res);
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(url.pathname, res);
      return;
    }

    writeJson(res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
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
