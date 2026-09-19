const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { suggestMetadata } = require('./metadata');
const norm = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
async function inspectPdf(file, filename = '') {
  let info, extracted;
  try {
    info = await execute('pdfinfo', [file], { timeout: 30000, maxBuffer: 1024 * 1024 });
    extracted = await execute('pdftotext', ['-layout', file, '-'], { timeout: 120000, maxBuffer: 50 * 1024 * 1024 });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('PDF tools are missing. Install Poppler (macOS: brew install poppler), then try again.');
    throw new Error('Could not read this PDF. It may be encrypted, damaged, or exceed extraction limits.');
  }
  const count = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
  const pages = extracted.stdout.split('\f').slice(0, count);
  if (!count || pages.length !== count) throw new Error('Could not establish reliable PDF page boundaries.');
  if (pages.join('').trim().length < 80) throw new Error('This PDF has no usable text layer. Run OCR on the scanned PDF first.');
  const warnings = [];
  const blank = pages.filter(p => p.trim().length < 30).length;
  if (blank) warnings.push(`${blank} pages have little or no extractable text; images and scanned pages are not read.`);
  const tocPages = [];
  pages.slice(0, Math.min(40, Math.ceil(count * .3) + 2)).forEach((page, i) => {
    if (/^\s*(table of contents|contents)\s*$/im.test(page)) tocPages.push(i + 1);
  });
  const candidates = [];
  for (const p of tocPages) {
    for (const line of pages[p - 1].split('\n')) {
      const m = line.trim().match(/^(.{3,140}?)\s*(?:\.{2,}|\s{2,})\s*(\d+)\s*$/);
      if (!m) continue;
      const title = m[1].trim(); const key = norm(title);
      const idx = pages.findIndex((page, i) => i + 1 > p && !tocPages.includes(i + 1) && page.split('\n').slice(0, 18).some(l => norm(l) === key));
      if (idx >= 0) candidates.push({ title, start: idx + 1, method: 'Contents title matched to a page heading' });
    }
  }
  pages.forEach((page, i) => {
    if (tocPages.some(p => Math.abs(p - (i + 1)) <= 1)) return;
    const lines = page.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 7);
    const line = lines.find(l => /^(chapter|part|book)\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(l) && l.length < 140 && !/\.{2,}/.test(l));
    if (line && !candidates.some(c => c.start === i + 1)) candidates.push({ title: line, start: i + 1, method: 'Chapter heading heuristic' });
  });
  const unique = [...new Map(candidates.sort((a,b) => a.start - b.start).map(c => [c.start, c])).values()];
  if (!unique.length) {
    unique.push({ title: 'Full text (chapter boundaries not found)', start: 1, method: 'Fallback; edit chapter ranges below' });
    warnings.push('Chapter boundaries were not found automatically. Add chapter ranges, or process the full text as one section.');
  } else if (unique[0].start > 1) unique.unshift({ title: 'Front matter', start: 1, method: 'Pages before first detected chapter' });
  const chapters = unique.map((c, i) => ({ ...c, end: unique[i + 1] ? unique[i + 1].start - 1 : count }));
  warnings.push('Verify suggested chapters against the extracted text. Page numbers below are PDF page positions, not printed page labels.');
  return { ...suggestMetadata(info.stdout, filename), pages, pageCount: count, words: pages.join(' ').split(/\s+/).filter(Boolean).length, bytes: Buffer.byteLength(pages.join('\n')), tocPages, chapters, warnings };
}
module.exports = { inspectPdf };
