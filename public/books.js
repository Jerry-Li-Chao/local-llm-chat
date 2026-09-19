import { updateHTML } from './stable-dom.js';
import { renderMarkdown } from './markdown.js';
import { memoryPanel, memoryTable, memoryExport } from './book-memory.js?v=3';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let activityFilter = 'all';
let book = null, selectedTask = null, tab = 'queue', busy = false, signature = '', detailSignature = '';
async function api(url, options) {
  const response = await fetch(url, options); const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed.'); return body;
}
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
async function safe(action) { try { await action(); } catch (error) { notice(error.message); } }
async function models() {
  try {
    const selected = $('model').value || book?.model;
    const data = await api('/api/tags');
    const items = Array.isArray(data) ? data : data.models || [];
    $('model').innerHTML = items.length ? items.map(m => `<option value="${escape(m.name)}">${escape(m.name)}</option>`).join('') : '<option value="">No models installed</option>';
    if (items.some(m => m.name === selected)) $('model').value = selected;
    $('connection').textContent = items.length ? '● Ollama connected' : 'No local models found';
  } catch { $('connection').textContent = '○ Ollama offline'; $('model').innerHTML = '<option value="">Start Ollama, then refresh</option>'; }
}
async function library() {
  const data = await api('/api/books');
  $('library').innerHTML = data.books.map(b => `<button data-book="${b.id}" class="${book?.id === b.id ? 'selected' : ''}">${escape(b.name)}<small>${escape(b.status)}${b.model ? ` · ${escape(b.model)} · ${b.inputTarget.toLocaleString()} target` : ""}</small></button>`).join('');
}
async function openBook(id) {
  book = await api(`/api/books/${id}`); selectedTask = null; signature = ''; detailSignature = ''; notice();
  localStorage.setItem('book-reader-active', id); render(true); await library();
}
function renderRanges() {
  $('chapters').innerHTML = book.chapters.map(c => `<div class="chapter"><input aria-label="Chapter title" value="${escape(c.title)}"><input aria-label="First PDF page" type="number" min="1" max="${book.pageCount}" value="${c.start}"><input aria-label="Last PDF page" type="number" min="1" max="${book.pageCount}" value="${c.end}"><button aria-label="Remove chapter" class="remove">×</button></div>`).join('');
}
function setText(id, value) { if ($(id).textContent !== value) $(id).textContent = value; }
function render(initial = false) {
  if (!book) return;
  $('empty').hidden = true; $('book').hidden = false;
  setText('book-name', book.bookTitle || book.name);
  setText('book-status', book.status === 'review' ? 'PDF INSPECTED · READY FOR REVIEW' : `READING WORKSPACE · ${book.status.toUpperCase()}`);
  setText('context-limit', book.context.toLocaleString());
  $('model').disabled = book.status !== 'review';
  $('chunk-target').disabled = ['running','done'].includes(book.status);
  $('save-settings').hidden = ['running','done','review'].includes(book.status);
  $('compare').hidden = book.status === 'review';
  setText('input-target', (book.inputTarget || 6000).toLocaleString());
  setText('output-reserve', (book.outputReserve || 1024).toLocaleString());
  setText('stats', `${book.pageCount.toLocaleString()} pages · ${book.words.toLocaleString()} words · ${(book.bytes / 1024).toFixed(0)} KB of text · ${book.chapters.length} sections`);
  $('review').hidden = book.status !== 'review';
  $('execution').hidden = book.status === 'review';
  $('start').hidden = ['running','done'].includes(book.status);
  setText('start', book.status === 'review' ? 'Start reading →' : book.status === 'error' ? 'Retry unfinished tasks →' : 'Resume reading →');
  $('pause').hidden = book.status !== 'running';
  $('export').hidden = !book.tasks.some(t => t.result);
  const completed = book.tasks.filter(t => t.status === 'done').length;
  setText('progress', book.tasks.length ? `${completed} / ${book.tasks.length} tasks complete` : '');
  if (book.error) notice(book.error);
  $('inspector-empty').hidden = book.status === 'review' || !!selectedTask;
  $('page-preview').hidden = book.status !== 'review';
  $('task-detail').hidden = !selectedTask;
  for (const id of ['book-title-input','book-author-input','save-metadata']) $(id).disabled = book.status === 'running';
  if (initial) {
    $('chunk-target').value = book.inputTarget || 6000; updateChunkLabel();
    if (book.model) $('model').value = book.model;
    if (book.focus) $('focus').value = book.focus;
    $('book-title-input').value = book.bookTitle || book.name.replace(/\.pdf$/i, '');
    $('book-author-input').value = book.author || '';
    $('book-details').open = book.status === 'review' || !book.metadataConfirmed;
    $('metadata-hint').textContent = `${book.metadataSource || 'Review suggested details'} · Source: ${book.name}`;
    $('warnings').innerHTML = book.warnings.map(w => `<p>${escape(w)}</p>`).join('');
    renderRanges(); $('page-number').max = book.pageCount;
    if (book.status === 'review') { $('page-number').value = book.tocPages[0] || 1; void safe(showPage); }
  }
  const next = JSON.stringify([book.tasks, book.events]);
  if (next !== signature) { signature = next; renderExecution(); }
  if (selectedTask) void safe(() => showTask(selectedTask));
}
let bookmarkFrame = 0;
function updateSummaryBookmark() {
  if (tab !== 'summaries' || !book) return;
  const sections = [...$('summaries').querySelectorAll('.summary-item')];
  const offset = window.innerWidth <= 800 ? 160 : 40;
  let current = sections[0];
  for (const section of sections) { if (section.getBoundingClientRect().top <= offset) current = section; else break; }
  for (const link of $('summaries').querySelectorAll('[data-summary-link]')) {
    const active = current?.id === `summary-${link.dataset.summaryLink}`;
    if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
  }
}
window.addEventListener('scroll', () => {
  if (!bookmarkFrame) bookmarkFrame = requestAnimationFrame(() => { bookmarkFrame = 0; updateSummaryBookmark(); });
}, {passive:true});
$('summaries').addEventListener('click', event => {
  const link = event.target.closest('[data-summary-link]');
  if (!link) return;
  const target = document.getElementById(`summary-${link.dataset.summaryLink}`);
  if (!target) return;
  event.preventDefault();
  target.focus({preventScroll:true});
  target.scrollIntoView({behavior:'instant', block:'start'});
  updateSummaryBookmark();
});
function renderExecution() {
  const all = book.tasks;
  const ordered = [];
  function visit(t, depth) { ordered.push({ t, depth }); all.filter(x => x.parentId === t.id).forEach(x => visit(x, depth + 1)); }
  all.filter(t => !t.parentId).forEach(t => visit(t, 0));
  updateHTML($('queue'), ordered.map(({t,depth}) => `<button data-task="${t.id}" class="task ${t.status} ${selectedTask === t.id ? 'active' : ''}" style="padding-left:${10 + Math.min(depth, 6) * 16}px"><span class="dot"></span><span class="title">${escape(t.title)}<small>${t.kind === 'book' ? 'Summary synthesis' : t.start ? `PDF pages ${t.start}–${t.end}` : 'Created by context scheduler'}${t.measuredTokens ? ` · ${t.measuredTokens} input tokens` : ''}</small></span><span class="badge">${t.status}</span></button>`).join(''));
  const summaries = all.filter(t => !t.parentId && t.status === 'done').sort((a,b) => (b.kind === 'book') - (a.kind === 'book'));
  updateHTML($('summaries'), summaries.length ? `<div class="summary-layout"><nav class="summary-bookmarks" aria-label="Summary bookmarks"><div class="eyebrow">JUMP TO SUMMARY</div>${summaries.map(t => `<a href="#summary-${escape(t.id)}" data-summary-link="${escape(t.id)}">${escape(t.title)}</a>`).join('')}</nav><div class="summary-content">${summaries.map(t => `<section id="summary-${escape(t.id)}" class="summary-item" tabindex="-1"><h2>${escape(t.title)}</h2><div class="markdown">${renderMarkdown(t.result)}</div></section>`).join('')}</div></div>` : '<p class="hint">Chapter summaries will appear here as they finish.</p>');
  renderActivity();
  updateHTML($('memory'), memoryTable(book));
  for (const name of ['queue','summaries','activity','memory']) $(name).hidden = name !== tab;
  document.querySelector('.workspace').classList.toggle('reading-summaries', tab === 'summaries');
  updateSummaryBookmark();
}
const eventStyles = {
  reading: ['Reading', '↗'], completed: ['Completed', '✓'], split: ['Splitting', '⑂'],
  synthesis: ['Synthesizing', '⇢'], planned: ['Planning', '≡'], inspected: ['Inspecting', '⌕'],
  continuation: ['Continuing', '→'], retry: ['Retrying', '↻'], paused: ['Paused', 'Ⅱ'], error: ['Needs attention', '!'], info: ['Update', '·'],
};
function eventType(event) {
  if (event.type && event.type !== 'info') return event.type;
  // Older saved books have plain text events; keep their history readable.
  if (/^Completed |summaries are ready/.test(event.text)) return 'completed';
  if (/^Reading /.test(event.text)) return 'reading';
  if (/created .*smaller reading tasks/.test(event.text)) return 'split';
  if (/queued synthesis/.test(event.text)) return 'synthesis';
  if (/^Paused/.test(event.text)) return 'paused';
  if (/^Stopped/.test(event.text)) return 'error';
  if (/^Inspected/.test(event.text)) return 'inspected';
  if (/^(Queued|Contents|No contents)/.test(event.text)) return 'planned';
  return 'info';
}
function renderActivity() {
  const events = [...book.events].reverse().map(e => ({ ...e, category: eventType(e) }));
  const filters = [['all','All'],['reading','Reading'],['completed','Completed'],['planning','Planning & splits'],['attention','Attention']];
  const matches = (e,filter) => filter === 'all' || (filter === 'reading' ? ['reading','synthesis','continuation'].includes(e.category) : filter === 'planning' ? ['planned','split','inspected'].includes(e.category) : filter === 'attention' ? ['paused','error','retry'].includes(e.category) : e.category === filter);
  const visible = events.filter(e => matches(e, activityFilter));
  const active = book.tasks.find(t => ['running','measuring'].includes(t.status));
  updateHTML($('activity'), `${active ? `<div class="activity-current"><span class="dot"></span><div><strong>${active.status === 'measuring' ? 'Checking context' : active.title.endsWith('· synthesis') || active.kind === 'book' ? 'Synthesizing' : 'Reading'}</strong><span>${escape(active.title)}</span></div></div>` : ''}<div class="activity-filters" aria-label="Activity filters">${filters.map(([key,label]) => `<button data-filter="${key}" aria-pressed="${activityFilter === key}">${label}<span>${events.filter(e => matches(e,key)).length}</span></button>`).join('')}</div><div class="event-list">${visible.length ? visible.map(e => {
    const [label,icon] = eventStyles[e.category] || eventStyles.info;
    const taskExists = e.taskId && book.tasks.some(t => t.id === e.taskId);
    return `<div class="event event-${e.category}"><span class="event-icon" aria-hidden="true">${icon}</span><div class="event-content"><div class="event-heading"><span class="event-label">${label}</span><time>${new Date(e.time).toLocaleTimeString()}</time></div><p>${escape(e.text)}</p>${taskExists ? `<button class="text-button" data-event-task="${e.taskId}">Inspect task →</button>` : ''}</div></div>`;
  }).join('') : '<p class="hint">No events in this category yet.</p>'}</div>`);
}
$('activity').addEventListener('click', e => {
  const filter = e.target.closest('[data-filter]');
  if (filter) { activityFilter = filter.dataset.filter; renderActivity(); }
  const task = e.target.closest('[data-event-task]');
  if (task) { selectedTask = task.dataset.eventTask; detailSignature = ''; void safe(async () => { await showTask(selectedTask); if (window.innerWidth < 1150) document.querySelector('.inspector').scrollIntoView({behavior:'smooth'}); }); }
});
async function showPage() {
  const id = book.id;
  const page = await api(`/api/books/${id}/page/${Number($('page-number').value)}`);
  if (book?.id === id) $('page-text').textContent = page.text || '[No extractable text on this page]';
}
async function showTask(id) {
  const bookId = book.id;
  const task = await api(`/api/books/${bookId}/task/${id}`);
  if (selectedTask !== id || book?.id !== bookId) return;
  const next = JSON.stringify(task); if (detailSignature === next) return; detailSignature = next;
  if ($('task-detail').dataset.task !== id) { $('task-detail').replaceChildren(); $('task-detail').__renderedHTML = undefined; $('task-detail').dataset.task = id; }
  const open = new Set([...$('task-detail').querySelectorAll('details[open]')].map(d => d.dataset.section));
  $('inspector-empty').hidden = true; $('task-detail').hidden = false;
  updateHTML($('task-detail'), `<span class="badge">${escape(task.status)} · ${escape(task.kind)}</span><h2>${escape(task.title)}</h2>${task.reason ? `<p class="hint">${escape(task.reason)}</p>` : ''}${task.boundary ? `<p class="hint">Cut at: ${escape(task.boundary)}${task.overlap ? ' · preceding passage included for continuity' : ''}</p>` : ''}${task.error ? `<p>${escape(task.error)}</p>` : ''}<div class="rule"></div><h3>Context budget</h3><p class="hint">${task.inputBytes ? `${task.inputBytes.toLocaleString()} prompt bytes` : 'Evaluated when this task starts'}${task.children.length ? ' · parent delegated to smaller tasks' : ''}</p><div class="meter"><span style="width:${Math.min(100, (task.measuredTokens || 0) / (task.contextLimit || task.memory?.contextLimit || (task.measuredTokens ? 8192 : book.context)) * 100)}%"></span></div><p class="hint">${task.measuredTokens ? `${task.measuredTokens} measured input tokens` : task.children.length ? 'No model call: delegated to smaller tasks' : 'Exact tokens measured before full generation'}<br>${task.outputReserve || book.outputReserve || 1024} tokens available for this request · ${(task.contextLimit || task.memory?.contextLimit || (task.measuredTokens ? 8192 : book.context)).toLocaleString()} total</p>${task.generationAttempts?.length ? `<details><summary>Generation attempts (${task.generationAttempts.length})</summary>${task.generationAttempts.map(a=>`<p class="hint">${escape(a.continuation ? "Continuation" : a.concise ? "Legacy short-summary retry" : "Initial request")}: ${a.inputTokens} input / ${a.outputTokens} output tokens · ${escape(a.reason === "length" ? "answer limit reached" : a.reason)}</p>`).join('')}</details>` : ''}${memoryPanel(task,book.tasks)}${[['result','Summary',task.result], ...(task.summarySegments?.length && !task.result ? [['draft','Unfinished draft (saved)',task.summarySegments.map(s=>s.text).join('')]] : []),['prompt',task.children.length ? 'Planned prompt (not sent)' : task.promptMode === 'template' ? 'Prompt (Ollama adds the model’s chat template)' : 'Exact model prompt',task.prompt],['source','Source material',task.source]].map(([key,label,value]) => `<details data-section="${key}" ${open.has(key) || key === 'result' ? 'open' : ''}><summary>${label}</summary>${key === 'result' && value ? `<div class="markdown">${renderMarkdown(value)}</div>` : `<pre>${escape(value || (key === 'prompt' ? 'Prepared when this task starts.' : 'Not available yet.'))}</pre>`}</details>`).join('')}`);
}
document.querySelectorAll('[data-import]').forEach(button => button.addEventListener('click', () => $('pdf').click()));
$('pdf').addEventListener('change', () => safe(async () => {
  const file = $('pdf').files[0]; if (!file || busy) return;
  if (file.size > 40 * 1024 * 1024) throw new Error('Choose a PDF smaller than 40 MB.');
  busy = true; $('pdf').disabled = true; notice(`Inspecting ${file.name}: extracting pages and locating chapters…`);
  try {
    const result = await api(`/api/books?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type':'application/pdf' }, body: file });
    await openBook(result.id);
  } finally { busy = false; $('pdf').disabled = false; $('pdf').value = ''; }
}));
$('library').addEventListener('click', e => { if (busy) return; const b = e.target.closest('[data-book]'); if (b) void safe(() => openBook(b.dataset.book)); });
$('chapters').addEventListener('click', e => { if (e.target.closest('.remove')) e.target.closest('.chapter').remove(); });
$('add-chapter').addEventListener('click', () => {
  const row = document.createElement('div'); row.className = 'chapter';
  row.innerHTML = '<input aria-label="Chapter title" placeholder="Chapter title"><input aria-label="First PDF page" type="number" min="1"><input aria-label="Last PDF page" type="number" min="1"><button aria-label="Remove chapter" class="remove">×</button>'; $('chapters').append(row); row.querySelector('input').focus();
});
$('save-metadata').addEventListener('click', () => safe(async () => {
  if (!book || busy) return;
  busy = true; $('save-metadata').disabled = true;
  try {
    book = await api(`/api/books/${book.id}/metadata`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({bookTitle:$('book-title-input').value, author:$('book-author-input').value}) });
    render(); $('metadata-hint').textContent = `${book.metadataSource} · Source: ${book.name}`; notice('Book details saved. New prompts will use this identity; completed summaries are unchanged.');
  } finally { busy = false; $('save-metadata').disabled = false; }
}));
function updateChunkLabel() {
  const target = Number($('chunk-target').value);
  $('chunk-label').textContent = `${target.toLocaleString()} tokens`;
  $('chunk-hint').textContent = `Allocates ${ (Math.ceil((target + 1536) / 1024) * 1024).toLocaleString()} context tokens, with at least 1,024 tokens for the answer and a safety margin. Unused input space is also available for output. No summary word limit; unfinished answers continue in another request. Model capacity is checked before reading.`;
}
$('chunk-target').addEventListener('input', updateChunkLabel);
$('save-settings').addEventListener('click', () => safe(async () => {
  if (!book || busy) return;
  busy = true;
  try { book = await api(`/api/books/${book.id}/settings`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({chunkTarget:Number($('chunk-target').value)})}); render(); notice('Reading target saved. Resume to replan unfinished passages.'); }
  finally { busy = false; }
}));
$('compare').addEventListener('click', () => safe(async () => {
  if (!book || busy) return;
  busy = true;
  try { const copy = await api(`/api/books/${book.id}/compare`, {method:'POST'}); await openBook(copy.id); notice('Separate run created. Choose a model and reading target, then start reading.'); }
  finally { busy = false; }
}));
$('start').addEventListener('click', () => safe(async () => {
  if (!book || busy) return; busy = true; $('start').disabled = true; notice();
  try {
    const chapters = [...$('chapters').children].map(row => { const [title,start,end] = row.querySelectorAll('input'); return { title:title.value.trim(), start:Number(start.value), end:Number(end.value) }; });
    const updated = await api(`/api/books/${book.id}/start`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ bookTitle:$('book-title-input').value, author:$('book-author-input').value, model:$('model').value, chunkTarget:Number($('chunk-target').value), focus:$('focus').value, chapters }) });
    book = updated; render(); await library();
  } finally { busy = false; $('start').disabled = false; }
}));
$('clear-book').addEventListener('click', () => safe(async () => {
  if (!book || busy) return;
  const id = book.id;
  if (!window.confirm(`Cancel and clear “${book.name}”?\n\nThis stops processing and permanently removes this book's extracted text, task history, and summaries from the library. Your original PDF and other books are kept.`)) return;
  busy = true; $('clear-book').disabled = true;
  $('start').disabled = true; $('pause').disabled = true;
  notice('Stopping processing and clearing this book…');
  try {
    await api(`/api/books/${id}`, { method: 'DELETE' });
    if (book?.id === id) {
      book = null; selectedTask = null; signature = ''; detailSignature = '';
      $('book').hidden = true; $('empty').hidden = false; document.querySelector('.workspace').classList.remove('reading-summaries');
      $('page-preview').hidden = true; $('task-detail').hidden = true;
      $('inspector-empty').hidden = false;
      for (const name of ['queue','summaries','activity','task-detail','page-text','chapters','warnings','memory']) $(name).replaceChildren();
    }
    if (localStorage.getItem('book-reader-active') === id) localStorage.removeItem('book-reader-active');
    await library(); notice('Book cleared. You can import a PDF to start again.');
  } finally {
    busy = false; $('clear-book').disabled = false;
    $('start').disabled = false; $('pause').disabled = false;
  }
}));
$('pause').addEventListener('click', () => safe(async () => { await api(`/api/books/${book.id}/pause`, { method:'POST' }); notice('Pausing the active request. Completed tasks will be kept.'); }));
$('queue').addEventListener('click', e => { const b = e.target.closest('[data-task]'); if (b) { selectedTask = b.dataset.task; detailSignature = ''; renderExecution(); void safe(async () => { await showTask(selectedTask); if (window.innerWidth < 1150) document.querySelector('.inspector').scrollIntoView({behavior:'smooth'}); }); } });
document.querySelector('.tabs').addEventListener('click', e => { if (!e.target.dataset.tab) return; tab = e.target.dataset.tab; document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab)); renderExecution(); });
$('memory').addEventListener('click', e => {
  const row = e.target.closest('[data-memory-task]');
  if (row) { selectedTask = row.dataset.memoryTask; detailSignature = ''; void safe(async () => { await showTask(selectedTask); if (window.innerWidth < 1150) document.querySelector('.inspector').scrollIntoView({behavior:'smooth'}); }); }
  if (e.target.closest('#export-memory')) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(memoryExport(book), null, 2)], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = `${book.name.replace(/\.pdf$/i,'')}-memory.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
});
$('show-page').addEventListener('click', () => safe(showPage)); $('refresh').addEventListener('click', models);
$('export').addEventListener('click', () => {
  const text = `# ${book.bookTitle || book.name}\n\nAuthor: ${book.author || "Not specified"}\nSource: ${book.name}\n\nModel: ${book.model}\nStatus: ${book.status}\nFocus: ${book.focus}\n\n` + book.tasks.filter(t => !t.parentId && t.result).map(t => `## ${t.title}${t.start ? ` (PDF pages ${t.start}–${t.end})` : ''}\n\n${t.result}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type:'text/markdown' })); const a = document.createElement('a'); a.href = url; a.download = `${book.name.replace(/\.pdf$/i,'')}-summaries.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
});
async function poll() {
  if (book?.status === 'running' && !busy) {
    const id = book.id;
    try { const updated = await api(`/api/books/${id}`); if (book?.id === id && !busy) { const changed = book.status !== updated.status; book = updated; render(); if (changed) await library(); } } catch (error) { if (book?.id === id && !busy) notice(`Connection interrupted: ${error.message}. Reconnecting…`); }
  }
  setTimeout(poll, 1200);
}
await models(); await safe(library);
const previous = localStorage.getItem('book-reader-active'); if (previous) await safe(() => openBook(previous));
void poll();
