const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const SAMPLE_MS = 1000;
const valid = n => Number.isFinite(n) && n >= 0;
const canonical = name => name.includes(':') ? name : `${name}:latest`;
function ollamaRss(output) {
  const rows = output.split('\n').map(line => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return m ? { pid: +m[1], parent: +m[2], rss: +m[3] * 1024, command: m[4].trim() } : null;
  }).filter(Boolean);
  const ids = new Set(rows.filter(r => /(?:^|\/)ollama(?:\.exe)?$/i.test(r.command)).map(r => r.pid));
  let changed = true;
  while (changed) { changed = false; for (const r of rows) if (ids.has(r.parent) && !ids.has(r.pid)) { ids.add(r.pid); changed = true; } }
  const matched = rows.filter(r => ids.has(r.pid));
  return matched.length ? { ollamaRssBytes: matched.reduce((sum,r) => sum + r.rss, 0), processCount: matched.length } : {};
}
function createSampler({ baseUrl, model, fetchImpl = fetch, executeImpl = execute }) {
  const local = ['localhost','127.0.0.1','[::1]','::1'].includes(new URL(baseUrl).hostname);
  return async () => {
    const sample = { at: new Date().toISOString() };
    const readings = await Promise.allSettled([
      (async()=>{
        const response = await fetchImpl(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(900) });
        if (!response.ok) return;
        const payload = await response.json();
        const current = payload.models?.find(m => canonical(m.name || m.model || '') === canonical(model));
        if (current) {
          if (valid(current.size)) sample.modelBytes = current.size;
          if (valid(current.size_vram)) sample.gpuBytes = current.size_vram;
          if (valid(current.context_length)) sample.contextLength = current.context_length;
        }
      })(),
      (async()=>{
        if (!local) return;
        sample.hostTotalBytes = os.totalmem(); sample.hostFreeBytes = os.freemem();
        if (!['darwin','linux'].includes(process.platform)) return;
        const { stdout } = await executeImpl('ps', ['-axo','pid=,ppid=,rss=,comm='], { timeout:900, maxBuffer:4*1024*1024 });
        Object.assign(sample, ollamaRss(stdout));
      })(),
    ]);
    sample.readErrors = readings.filter(r=>r.status === 'rejected').length;
    return sample;
  };
}
function recordSample(record, sample) {
  record.samples++;
  record.readErrors += sample.readErrors || 0;
  for (const [source,dest] of [['modelBytes','peakModelBytes'],['gpuBytes','peakGpuBytes'],['ollamaRssBytes','peakOllamaRssBytes']]) {
    if (valid(sample[source])) record[dest] = Math.max(record[dest] ?? 0, sample[source]);
  }
  if (valid(sample.hostFreeBytes)) record.minHostFreeBytes = Math.min(record.minHostFreeBytes ?? Infinity, sample.hostFreeBytes);
  if (valid(sample.hostTotalBytes)) record.hostTotalBytes = sample.hostTotalBytes;
  if (valid(sample.contextLength)) record.observedContextLength = sample.contextLength;
  record.lastSampleAt = sample.at;
}
async function monitorMemory(task, phase, sample, action, { intervalMs = SAMPLE_MS, contextLimit, model } = {}) {
  task.memory ||= { sampleIntervalMs: intervalMs, samples:0, readErrors:0, phases:[] };
  const memory = task.memory;
  if (contextLimit) memory.contextLimit = contextLimit;
  if (model) memory.model = model;
  const record = { phase, contextLimit, model, startedAt:new Date().toISOString(), samples:0, readErrors:0, status:'running' };
  memory.phases.push(record);
  let stopped = false, timer;
  const take = async()=>{
    try { const value = await sample(); recordSample(record,value); recordSample(memory,value); }
    catch { record.readErrors++; memory.readErrors++; }
  };
  let pending = take();
  const schedule = ()=> { timer = setTimeout(()=> { pending = take(); pending.then(()=> { if (!stopped) schedule(); }); }, intervalMs); };
  pending.then(()=> { if (!stopped) schedule(); });
  try { const result = await action(); record.status = 'completed';
    if (valid(result?.prompt_eval_count)) record.inputTokens = result.prompt_eval_count;
    if (valid(result?.eval_count)) record.outputTokens = result.eval_count;
    if (phase === 'summary generation' && result?.eval_duration > 0) record.outputTokensPerSecond = result.eval_count * 1e9 / result.eval_duration;
    return result; }
  catch (error) { record.status = 'interrupted'; throw error; }
  finally {
    stopped = true; clearTimeout(timer); await pending;
    await take();
    record.finishedAt = new Date().toISOString();
    record.durationMs = Date.parse(record.finishedAt) - Date.parse(record.startedAt);
  }
}
module.exports = { SAMPLE_MS, ollamaRss, createSampler, recordSample, monitorMemory };
