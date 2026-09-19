export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function renderInlineMarkdown(text) {
  const tokens = [];
  let output = escapeHtml(text);

  output = output.replace(/`([^`\n]+)`/g, (_, code) => {
    const token = `\u0000I${tokens.length}\u0000`;
    tokens.push(`<code>${code}</code>`);
    return token;
  });

  output = output.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, href) => `<a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">${label}</a>`,
  );

  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  output = output.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  output = output.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  output = output.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  tokens.forEach((tokenValue, index) => {
    output = output.replaceAll(`\u0000I${index}\u0000`, tokenValue);
  });

  return output;
}

export function renderMarkdown(markdown) {
  const source = String(markdown || '').replace(/\0/g, '').replace(/\r\n?/g, '\n').trim();

  if (!source) {
    return '';
  }

  const blocks = [];
  let normalized = source.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, language, code) => {
    const blockToken = `__CODE_BLOCK_${blocks.length}__`;
    const className = language ? ` class="language-${escapeAttribute(language)}"` : '';
    blocks.push(`<pre><code${className}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return blockToken;
  });

  normalized = normalized.replace(/\n{3,}/g, '\n\n');

  const lines = normalized.split('\n');
  const output = [];
  let index = 0;

  const isTableDivider = (line) => /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
  const parseTableRow = (row) => row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  const isSpecialBlockStart = (line) => (
    /^__CODE_BLOCK_\d+__$/.test(line.trim())
    || /^\s*(#{1,6})\s+/.test(line)
    || /^\s*(-{3,}|\*{3,})\s*$/.test(line)
    || /^\s*>\s?/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+\.\s+/.test(line)
    || (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1]))
  );

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^__CODE_BLOCK_\d+__$/.test(trimmed)) {
      output.push(blocks[Number(trimmed.match(/\d+/)[0])]);
      index += 1;
      continue;
    }

    if (/^\s*(#{1,6})\s+/.test(line)) {
      const [, marks] = line.match(/^\s*(#{1,6})\s+/);
      const content = line.replace(/^\s*#{1,6}\s+/, '').trim();
      output.push(`<h${marks.length}>${renderInlineMarkdown(content)}</h${marks.length}>`);
      index += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      output.push('<hr />');
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];

      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }

      output.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];

      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*[-*+]\s+/, '').trim())}</li>`);
        index += 1;
      }

      output.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];

      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*\d+\.\s+/, '').trim())}</li>`);
        index += 1;
      }

      output.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = parseTableRow(line);
      const alignments = parseTableRow(lines[index + 1]).map((cell) => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');

        if (left && right) {
          return 'center';
        }

        if (right) {
          return 'right';
        }

        return 'left';
      });
      const rows = [];
      index += 2;

      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }

      const head = headers
        .map((cell, cellIndex) => `<th style="text-align:${alignments[cellIndex] || 'left'}">${renderInlineMarkdown(cell)}</th>`)
        .join('');
      const body = rows
        .map((row) => `<tr>${headers.map((_, cellIndex) => `<td style="text-align:${alignments[cellIndex] || 'left'}">${renderInlineMarkdown(row[cellIndex] || '')}</td>`).join('')}</tr>`)
        .join('');

      output.push(`<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }

    const paragraphLines = [];

    while (index < lines.length && lines[index].trim()) {
      if (paragraphLines.length && isSpecialBlockStart(lines[index])) {
        break;
      }

      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    output.push(`<p>${paragraphLines.map((paragraphLine) => renderInlineMarkdown(paragraphLine)).join('<br />')}</p>`);
  }

  return output.join('');
}
