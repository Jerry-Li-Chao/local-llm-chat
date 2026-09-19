async function readGeneration(response, onProgress = () => {}) {
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try { message = JSON.parse(text).error || text; } catch {}
    throw new Error(message || `Ollama returned ${response.status}.`);
  }
  const decoder = new TextDecoder();
  let pending = '', answer = '', final;
  function consume(line) {
    if (!line.trim()) return;
    const part = JSON.parse(line);
    if (part.error) throw new Error(part.error);
    if (final) throw new Error('Unexpected data after Ollama completed the answer.');
    answer += part.response || '';
    onProgress(answer.length);
    if (part.done) final = part;
  }
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, {stream:true});
    let end;
    while ((end = pending.indexOf('\n')) >= 0) { consume(pending.slice(0,end)); pending = pending.slice(end+1); }
  }
  pending += decoder.decode(); consume(pending);
  if (!final) throw new Error('Ollama disconnected before finishing the summary. Completed chapters are saved; retry unfinished tasks.');
  return {...final, response:answer};
}
module.exports = {readGeneration};
