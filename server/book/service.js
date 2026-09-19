const { readGeneration } = require('./stream');
const { budgetFor } = require('./budget');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { inspectPdf } = require('./pdf');
const { createSampler, monitorMemory } = require('./memory');
const { suggestMetadata, validateMetadata } = require('./metadata');
const { CONTEXT, OUTPUT, INPUT_TOKENS, TARGET_TOKENS, upgradePlan, addTask, log, processTask, bytes } = require('./engine');
function createBookService({ dataDir, baseUrl, readJsonBody, writeJson }) {
  const directory = path.join(dataDir, 'books');
  const running = new Map();
  const clearing = new Set();
  const validId = id => /^[a-f0-9-]{36}$/.test(id);
  async function load(id) {
    if (!validId(id)) throw new Error('Invalid book ID.');
    if (clearing.has(id)) throw new Error('This book is being cleared.');
    if (running.has(id)) return running.get(id).job;
    const job = JSON.parse(await fs.readFile(path.join(directory, `${id}.json`), 'utf8'));
    if (job.status === 'running') { job.status = 'paused'; job.tasks.filter(t => ['running','measuring'].includes(t.status)).forEach(t => { t.status = 'queued'; }); }
    if (!job.bookTitle) Object.assign(job, suggestMetadata('', job.name));
    return job;
  }
  async function save(job) {
    await fs.mkdir(directory, { recursive: true });
    const dest = path.join(directory, `${job.id}.json`);
    await fs.writeFile(`${dest}.tmp`, JSON.stringify(job));
    await fs.rename(`${dest}.tmp`, dest);
  }
  function view(job) {
    const {context, input, target} = budgetFor(job);
    return { ...job, pages: undefined, tasks: job.tasks.map(({ source, prompt, summarySegments, ...t }) => t), context, inputAllowance: input, inputTarget: target, outputReserve: OUTPUT };
  }
  async function run(job) {
    const {context: CONTEXT, input: INPUT_TOKENS} = budgetFor(job);
    const controller = new AbortController();
    let finished;
    const state = { job, controller, pause: false, finished: new Promise(resolve => { finished = resolve; }) }; running.set(job.id, state);
    job.status = 'running'; delete job.error;
    const gate = async () => { if (state.pause) throw new Error('Paused by reader.'); };
    try {
      const versionResponse = await fetch(`${baseUrl}/api/version`, { signal: controller.signal });
      const version = await versionResponse.json();
      const [major, minor] = String(version.version || '').split('.').map(Number);
      if (!(major > 0 || major === 0 && minor >= 34)) throw new Error('Larger passages require Ollama 0.34 or newer for strict no-truncation requests. Please update Ollama.');
      const modelResponse = await fetch(`${baseUrl}/api/show`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({model:job.model}), signal:controller.signal });
      const modelInfo = await modelResponse.json();
      if (!modelResponse.ok) throw new Error(modelInfo.error || 'Could not inspect the selected model.');
      const capacity = Object.entries(modelInfo.model_info || {}).find(([key]) => key.endsWith('.context_length'))?.[1];
      if (CONTEXT > (Number(capacity) || 8192)) throw new Error(`Selected context (${CONTEXT} tokens) exceeds this model's reported capacity (${capacity || 8192}). Lower the reading target.`);
      upgradePlan(job);
      const request = async (prompt, limit) => {
        await gate();
        const response = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ model: job.model, prompt, raw: job.promptMode !== 'template', stream: true, think: false, truncate: false, shift: false, options: { num_ctx: CONTEXT, num_predict: limit, temperature: .2 } }),
        });
        const result = await readGeneration(response).catch(error => {
          error.contextOverflow = /exceed_context_size|request.*exceeds.*context|input.*(?:exceed|too long)|prompt.*(?:exceed|too long)|context.*(?:exceed|length limit)/i.test(error.message);
          throw error;
        });
        if (!response.ok || result.error) {
          const error = new Error(result.error || `Ollama returned ${response.status}.`);
          error.contextOverflow = /exceed_context_size|request.*exceeds.*context|input.*(?:exceed|too long)|prompt.*(?:exceed|too long)|context.*(?:exceed|length limit)/i.test(error.message);
          throw error;
        }
        return result;
      };
      const sampleMemory = createSampler({ baseUrl, model: job.model });
      await save(job);
      for (const task of job.tasks.filter(t => !t.parentId)) {
        await processTask(job, task, {
          gate, save: () => save(job),
          measure: async (prompt, task) => {
            try {
              const probe = await monitorMemory(task, 'context check', sampleMemory, () => request(prompt, 1), { contextLimit: CONTEXT, model: job.model });
              if (!Number.isInteger(probe.prompt_eval_count) || probe.prompt_eval_count <= 0) throw new Error('Ollama did not provide a prompt token count.');
              return probe.prompt_eval_count;
            } catch (error) {
              if (error.contextOverflow) return Infinity;
              throw error;
            }
          },
          generate: async (prompt, task) => {
            if (!Number.isInteger(task.measuredTokens) || task.measuredTokens + task.outputReserve + 512 > CONTEXT) throw new Error('A safe token preflight is required before summarization.');
            return monitorMemory(task, 'summary generation', sampleMemory, () => request(prompt, task.outputReserve), { contextLimit: CONTEXT, model: job.model });
          },
        });
      }
      job.status = 'done'; log(job, 'Book and chapter summaries are ready.', 'completed');
    } catch (error) {
      job.status = state.pause ? 'paused' : 'error';
      job.error = state.pause ? undefined : error.message === 'fetch failed' ? `Connection to Ollama failed${error.cause?.code ? ` (${error.cause.code})` : ''}. Completed chapters are saved. Check that Ollama is running, then retry unfinished tasks.` : error.message;
      for (const task of job.tasks.filter(t => ['running','measuring'].includes(t.status))) { task.status = state.pause ? 'queued' : 'error'; task.error = job.error; }
      log(job, state.pause ? 'Paused. Completed summaries are saved.' : `Stopped: ${job.error}`, state.pause ? 'paused' : 'error');
    } finally {
      try { await save(job); } finally { running.delete(job.id); finished(); }
    }
  }
  return async function route(req, res, url) {
    if (!url.pathname.startsWith('/api/books')) return false;
    try {
      const [, , , id, action, taskId] = url.pathname.split('/');
      if (req.method === 'DELETE' && id && !action) {
        if (!validId(id)) throw new Error('Invalid book ID.');
        if (clearing.has(id)) throw new Error('This book is already being cleared.');
        clearing.add(id);
        try {
          const state = running.get(id);
          if (state) {
            state.pause = true;
            state.controller.abort();
            // Wait for the worker's final save before removing its files.
            await state.finished;
          }
          for (const suffix of ['.json', '.json.tmp', '.pdf', '.json.before-chunking-v2']) {
            await fs.rm(path.join(directory, `${id}${suffix}`), { force: true });
          }
          writeJson(res, 200, { ok: true });
        } finally { clearing.delete(id); }
      } else if (req.method === 'GET' && !id) {
        await fs.mkdir(directory, { recursive: true });
        const files = (await fs.readdir(directory)).filter(f => f.endsWith('.json'));
        const books = [];
        for (const file of files) {
          try { const j = await load(file.slice(0, -5)); books.push({ id: j.id, name: j.name, status: j.status, model: j.model, inputTarget: budgetFor(j).target, createdAt: j.createdAt }); } catch { /* Skip damaged records, never overwrite them. */ }
        }
        writeJson(res, 200, { books: books.sort((a,b) => b.createdAt.localeCompare(a.createdAt)) });
      } else if (req.method === 'POST' && !id) {
        const bookId = randomUUID(); await fs.mkdir(directory, { recursive: true });
        const file = path.join(directory, `${bookId}.pdf`); const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 40 * 1024 * 1024) throw new Error('PDF exceeds the 40 MB upload limit.'); chunks.push(chunk); }
        const data = Buffer.concat(chunks);
        if (!data.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Upload a valid PDF file.');
        await fs.writeFile(file, data);
        let extracted;
        try { extracted = await inspectPdf(file, String(url.searchParams.get('name') || 'Untitled PDF')); } finally { await fs.unlink(file).catch(() => {}); }
        const job = { id: bookId, name: String(url.searchParams.get('name') || 'Untitled PDF').slice(0, 200), createdAt: new Date().toISOString(), status: 'review', ...extracted, tasks: [], events: [] };
        log(job, `Inspected ${job.pageCount} pages and ${job.words.toLocaleString()} words without sending the book to a model.`, 'inspected');
        log(job, job.tocPages.length ? `Contents found on PDF page(s) ${job.tocPages.join(', ')}. Suggested ${job.chapters.length} sections for review.` : 'No contents heading found. Used chapter headings or a full-text fallback.', 'planned');
        await save(job); writeJson(res, 201, view(job));
      } else {
        const job = await load(id);
        if (req.method === 'GET' && action === 'page') {
          const n = Number(taskId); if (!Number.isInteger(n) || n < 1 || n > job.pageCount) throw new Error('Invalid page.');
          writeJson(res, 200, { page: n, text: job.pages[n - 1] });
        } else if (req.method === 'GET' && action === 'task') {
          const task = job.tasks.find(t => t.id === taskId); if (!task) throw new Error('Task not found.');
          writeJson(res, 200, task);
        } else if (req.method === 'GET' && !action) writeJson(res, 200, view(job));
        else if (req.method === 'POST' && action === 'compare') {
          const copy = { ...job, id: randomUUID(), createdAt: new Date().toISOString(), status: 'review', tasks: [], events: [], comparisonOf: job.id };
          delete copy.error; delete copy.bytesPerToken;
          log(copy, 'New comparison run. Reused the extracted pages and chapter boundaries; previous results remain in the library.', 'planned');
          await save(copy); writeJson(res, 201, view(copy));
        } else if (req.method === 'PUT' && action === 'settings') {
          const body = await readJsonBody(req, 5000);
          if (running.has(id) || clearing.has(id) || job.status === 'done') throw new Error('Pause reading to change its target, or create a new comparison run.');
          const latest = await load(id);
          if (running.has(id) || clearing.has(id)) throw new Error('Pause reading before changing its target.');
          if (body.chunkTarget === undefined) throw new Error("Choose a reading target.");
          budgetFor({chunkTarget: body.chunkTarget});
          latest.chunkTarget = body.chunkTarget;
          latest.chunkingVersion = 0;
          log(latest, `Reading target changed to ${body.chunkTarget} tokens. Unfinished passages will be replanned on resume.`, 'planned');
          await save(latest); writeJson(res, 200, view(latest));
        } else if (req.method === 'PUT' && action === 'metadata') {
          const body = await readJsonBody(req, 5000);
          if (running.has(id) || clearing.has(id)) throw new Error('Pause reading before changing book details.');
          const latest = await load(id);
          if (running.has(id) || clearing.has(id)) throw new Error('Pause reading before changing book details.');
          Object.assign(latest, validateMetadata(body));
          log(latest, 'Book identity updated. Future prompts will include the title and author; existing summaries are unchanged.', 'planned');
          await save(latest); writeJson(res, 200, view(latest));
        } else if (req.method === 'POST' && action === 'start') {
          if (running.has(id)) throw new Error('This book is already processing.');
          if (running.size) throw new Error('Another book is processing. Pause it before starting this book.');
          if (job.status === 'done') throw new Error('This book is already complete.');
          const body = await readJsonBody(req, 100000);
          await fs.access(path.join(directory, `${id}.json`));
          if (clearing.has(id) || running.size) throw new Error('The book is being cleared or another run has started.');
          if (job.status === 'review') {
            Object.assign(job, validateMetadata(body));
            if (!body.model || typeof body.model !== 'string' || body.model.length > 200) throw new Error('Choose a local model.');
            budgetFor({chunkTarget: body.chunkTarget});
            job.chunkTarget = body.chunkTarget ?? 6000;
            job.promptMode = 'template';
            job.model = body.model; job.focus = String(body.focus || 'Summarize the key ideas, narrative, and conclusions.').trim();
            if (bytes(job.focus) > 1000) throw new Error('Keep the summary focus within 1,000 UTF-8 bytes.');
            if (!Array.isArray(body.chapters) || !body.chapters.length || body.chapters.length > job.pageCount) throw new Error('Provide valid chapter ranges.');
            let next = 1;
            for (const c of body.chapters) {
              if (!Number.isInteger(c.start) || !Number.isInteger(c.end) || c.start !== next || c.end < c.start || c.end > job.pageCount || !String(c.title || '').trim() || bytes(String(c.title)) > 240) throw new Error('Chapter ranges must cover every PDF page exactly once, in order; titles must be short.');
              next = c.end + 1;
            }
            if (next !== job.pageCount + 1) throw new Error('Chapter ranges must include the final PDF page.');
            job.chapters = body.chapters.map(({ title, start, end }) => ({ title, start, end }));
            for (const c of job.chapters) addTask(job, { kind: 'chapter', title: c.title, start: c.start, end: c.end, source: job.pages.slice(c.start - 1, c.end).map((p, i) => `[PDF page ${c.start + i}]\n${p}`).join('\n\n') });
            addTask(job, { kind: 'book', title: 'Full book summary', dependencies: job.tasks.map(t => t.id) });
            log(job, `Queued ${job.chapters.length} chapter tasks and a final book synthesis. Oversized tasks will split when reached.`, 'planned');
          }
          void run(job).catch(error => console.error('Book persistence failed:', error.message));
          writeJson(res, 202, view(job));
        } else if (req.method === 'POST' && action === 'pause') {
          const state = running.get(id); if (state) { state.pause = true; state.controller.abort(); }
          writeJson(res, 200, { ok: true });
        } else writeJson(res, 404, { error: 'Book endpoint not found.' });
      }
    } catch (error) { writeJson(res, 400, { error: error.message }); }
    return true;
  };
}
module.exports = { createBookService };
