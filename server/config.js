const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const CHAT_HISTORY_PATH = process.env.CHAT_HISTORY_PATH
  ? path.resolve(process.cwd(), process.env.CHAT_HISTORY_PATH)
  : path.join(DATA_DIR, 'chat-history.json');
const CHAT_ASSETS_DIR = path.join(DATA_DIR, 'chat-assets');
const DEFAULT_BODY_LIMIT = 1_000_000;
const MULTIMODAL_BODY_LIMIT = 50_000_000;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

module.exports = {
  HOST,
  PORT,
  OLLAMA_BASE_URL,
  PUBLIC_DIR,
  DATA_DIR,
  CHAT_HISTORY_PATH,
  CHAT_ASSETS_DIR,
  DEFAULT_BODY_LIMIT,
  MULTIMODAL_BODY_LIMIT,
  MIME_TYPES,
};
