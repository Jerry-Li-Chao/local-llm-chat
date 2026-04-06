function createOllamaService({ baseUrl }) {
  function normalizeModelPayload(payload) {
    return Array.isArray(payload?.models)
      ? payload.models.map((model) => ({
          name: model.name,
          size: model.size,
          modified_at: model.modified_at,
        }))
      : [];
  }

  async function fetchUpstreamJson(endpoint) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
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

  async function fetchStatus() {
    const [version, tags] = await Promise.all([
      fetchUpstreamJson('/api/version'),
      fetchUpstreamJson('/api/tags'),
    ]);

    return {
      version,
      models: normalizeModelPayload(tags),
    };
  }

  async function fetchTags() {
    const tags = await fetchUpstreamJson('/api/tags');
    return normalizeModelPayload(tags);
  }

  async function fetchModelInfo(model) {
    const response = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model }),
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

    return {
      model,
      context_length: typeof contextLength === 'number' ? contextLength : null,
    };
  }

  async function createChatStream({ model, messages, options, signal }) {
    return fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson, application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: options || undefined,
      }),
      signal,
    });
  }

  async function measureContextUsage({ model, messages, options }) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          ...(options || {}),
          num_predict: 1,
        },
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw Object.assign(new Error(result.error || `Ollama returned ${response.status}.`), {
        statusCode: response.status || 502,
      });
    }

    return {
      prompt_eval_count: Number.isFinite(result.prompt_eval_count) ? Number(result.prompt_eval_count) : null,
    };
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

  async function generateChatTitle({ model, prompt }) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Write a concise chat title for the user message. Return exactly one plain-text line, no quotes, no markdown, no punctuation at the end, and keep it under 8 words.',
          },
          {
            role: 'user',
            content: prompt.trim(),
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
      throw Object.assign(new Error(result.error || `Ollama returned ${response.status}.`), {
        statusCode: response.status || 502,
      });
    }

    return {
      title: normalizeGeneratedTitle(result?.message?.content),
    };
  }

  return {
    fetchStatus,
    fetchTags,
    fetchModelInfo,
    createChatStream,
    measureContextUsage,
    generateChatTitle,
  };
}

module.exports = {
  createOllamaService,
};
