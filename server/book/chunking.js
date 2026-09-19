const bytes = text => Buffer.byteLength(text, 'utf8');
// No LLM pass: inspect textual structure near the proposed cut, preserving offsets.
function boundary(text, limit) {
  if (bytes(text) <= limit) return { end: text.length, boundary: 'end of section' };
  let end = 0, size = 0;
  for (const char of text) { if (size + bytes(char) > limit) break; size += bytes(char); end += char.length; }
  const window = text.slice(0, end);
  const floor = Math.floor(end * .72);
  const choices = [
    ['heading', /\n(?=(?:#{1,6}\s|(?:\d+(?:\.\d+)*[.)]?\s+|[A-Z][A-Z \d,:—-]{5,80}\n)))/g],
    ['paragraph', /\n[ \t]*\n/g],
    ['sentence', /[.!?。！？]["'”’)]*(?:\s+|(?=[\p{L}]))/gu],
    ['word', /\s+/g],
  ];
  for (const [type, regex] of choices) {
    let candidate = null;
    for (const match of window.matchAll(regex)) { const n = match.index + match[0].length; if (n >= floor) candidate = n; }
    if (candidate) return { end: candidate, boundary: type };
  }
  return { end, boundary: 'Unicode-safe hard limit' };
}
function splitStructured(text, limit, overlapBytes = 0) {
  if (limit < 256) throw new Error('The instructions leave too little space for source material.');
  const parts = []; let offset = 0;
  while (offset < text.length) {
    const cut = boundary(text.slice(offset), limit);
    if (!cut.end) throw new Error('Cannot split source within the input allowance.');
    const end = offset + cut.end;
    let overlap = '';
    if (offset && overlapBytes) {
      // Include the end of the previous passage as explicitly labelled context.
      let start = offset, used = 0;
      for (const char of [...text.slice(Math.max(0, offset - overlapBytes), offset)].reverse()) {
        if (used + bytes(char) > overlapBytes) break;
        start -= char.length; used += bytes(char);
      }
      if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start])) start++;
      overlap = text.slice(start, offset);
      const sentence = overlap.search(/[.!?。！？]["'”’)]*\s+/u);
      if (sentence >= 0 && sentence < overlap.length / 2) overlap = overlap.slice(sentence + 1).trimStart();
    }
    parts.push({ source: text.slice(offset, end), overlap, sourceStart: offset, sourceEnd: end, boundary: cut.boundary });
    offset = end;
  }
  return parts;
}
const splitText = (text, limit) => splitStructured(text, limit).map(p => p.source);
module.exports = { bytes, boundary, splitStructured, splitText };
