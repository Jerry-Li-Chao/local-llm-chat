import { escapeHtml } from './markdown.js';
export const formatMemory = value => Number.isFinite(value) ? `${(value / 1024 ** 3).toFixed(2)} GiB` : 'Not recorded';
export function memoryFor(task, tasks) {
  const included = new Set([task.id]);
  let changed = true;
  while (changed) { changed = false; for (const t of tasks) if (included.has(t.parentId) && !included.has(t.id)) { included.add(t.id); changed = true; } }
  const values = tasks.filter(t => included.has(t.id) && t.memory).map(t => t.memory);
  const result = { records: values.length, samples: values.reduce((n,m)=>n+m.samples,0) };
  for (const key of ['peakModelBytes','peakGpuBytes','peakOllamaRssBytes']) {
    const numbers = values.map(m=>m[key]).filter(Number.isFinite);
    if (numbers.length) result[key] = Math.max(...numbers);
  }
  const free = values.map(m=>m.minHostFreeBytes).filter(Number.isFinite);
  if (free.length) result.minHostFreeBytes = Math.min(...free);
  return result;
}
export function memoryPanel(task,tasks) {
  const stats = memoryFor(task,tasks);
  if (!stats.records) return '<div class="rule"></div><h3>Peak memory</h3><p class="hint">Not recorded. Memory tracking applies to tasks processed after this update.</p>';
  return `<div class="rule"></div><h3>Peak observed memory</h3><dl class="memory-stats"><dt>Model allocation</dt><dd>${formatMemory(stats.peakModelBytes)}</dd><dt>GPU allocation</dt><dd>${formatMemory(stats.peakGpuBytes)}</dd><dt>Ollama RAM (RSS)</dt><dd>${formatMemory(stats.peakOllamaRssBytes)}</dd><dt>Lowest host free memory</dt><dd>${formatMemory(stats.minHostFreeBytes)}</dd></dl><p class="hint">${stats.samples} samples${task.children.length ? ' · maximum across recorded subtasks, not a sum' : ''}. Polled about once per second; brief spikes may be missed. Allocation and RSS overlap—do not add them.</p>${task.memory?.phases?.length ? `<details><summary>Measurement history (${task.memory.phases.length})</summary>${task.memory.phases.map(p=>`<div class="memory-phase"><strong>${escapeHtml(p.phase)} · ${escapeHtml(p.status)}</strong><p class="hint">${escapeHtml(new Date(p.startedAt).toLocaleString())}<br>Model ${formatMemory(p.peakModelBytes)} · RSS ${formatMemory(p.peakOllamaRssBytes)}<br>${p.contextLimit ? `${p.contextLimit.toLocaleString()} context tokens · ` : ""}${p.samples} samples${p.inputTokens != null ? ` · ${p.inputTokens} input tokens` : ''}</p></div>`).join('')}</details>` : ''}`;
}
export function memoryTable(book) {
  const tasks=book.tasks.filter(t=>!t.parentId || t.memory);
  return `<p class="hint memory-explainer">Saved peaks include context checks, generation, and interrupted attempts. Chapter rows show peak usage and lowest free memory across their recorded subtasks. Model/GPU allocation comes from Ollama; RSS (Resident Set Size) is RAM resident across all local Ollama processes, including model runners and other loaded models; shared mappings can be counted more than once. Lowest free memory is the minimum sampled free system RAM during that task, not its current value. On Apple silicon these share physical memory. Host free memory is not a safe context-growth allowance. Short spikes between samples can be missed.</p><div class="memory-table"><table><thead><tr><th>Section / task</th><th>Input tokens</th><th>Context tokens</th><th>Output tokens / sec</th><th>Model allocation</th><th>GPU allocation</th><th title="Resident Set Size: RAM resident across all local Ollama processes, including model runners. Shared mappings may be counted more than once.">Ollama RAM (RSS)</th><th title="Lowest sampled free system RAM while this task ran, not current free memory.">Lowest free memory</th></tr></thead><tbody>${tasks.map(t=>{const m=memoryFor(t,book.tasks);return `<tr><td><button class="text-button" data-memory-task="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button>${t.children.length ? '<small>Subtask aggregate</small>' : ''}</td><td>${t.measuredTokens?.toLocaleString() || '—'}</td><td>${(t.contextLimit || t.memory?.contextLimit)?.toLocaleString() || '—'}</td><td>${t.memory?.phases?.filter(p=>p.phase === 'summary generation' && p.status === 'completed').at(-1)?.outputTokensPerSecond?.toFixed(1) || '—'}</td><td>${formatMemory(m.peakModelBytes)}</td><td>${formatMemory(m.peakGpuBytes)}</td><td>${formatMemory(m.peakOllamaRssBytes)}</td><td>${formatMemory(m.minHostFreeBytes)}</td></tr>`;}).join('')}</tbody></table></div><button id="export-memory">Export memory records ↓</button>`;
}
export function memoryExport(book) {
  return { bookTitle:book.bookTitle || book.name, model:book.model, inputTarget:book.inputTarget, context:book.context, exportedAt:new Date().toISOString(), unit:'bytes', note:'Sampled peaks, not exact high-water marks. Model allocation and process RSS overlap. RSS covers all local Ollama processes. Free host memory is not available context headroom.', tasks:book.tasks.map(t=>({id:t.id,parentId:t.parentId,title:t.title,status:t.status,inputTokens:t.measuredTokens,outputTokens:t.outputTokens,memory:t.memory || null})) };
}
