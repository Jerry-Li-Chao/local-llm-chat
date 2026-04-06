export function createRenderer({ elements, state, updateMessage, onOpenImageLightbox }) {
  function escapeHtml(value) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('`', '&#96;');
  }

  function renderInlineMarkdown(text) {
    const tokens = [];
    let output = escapeHtml(text);

    output = output.replace(/`([^`\n]+)`/g, (_, code) => {
      const token = `__INLINE_CODE_${tokens.length}__`;
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
      output = output.replaceAll(`__INLINE_CODE_${index}__`, tokenValue);
    });

    return output;
  }

  function renderMarkdown(markdown) {
    const source = (markdown || '').replace(/\r\n?/g, '\n').trim();

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

  function isNearBottom() {
    const { scrollTop, scrollHeight, clientHeight } = elements.messageList;
    return scrollHeight - scrollTop - clientHeight < 80;
  }

  function scrollMessagesToBottom() {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
  }

  function removeEmptyState() {
    const emptyState = elements.messageList.querySelector('.empty-state');
    emptyState?.remove();
  }

  function showEmptyState() {
    if (elements.messageList.querySelector('.empty-state')) {
      return;
    }

    const emptyNode = elements.emptyStateTemplate.content.firstElementChild.cloneNode(true);
    elements.messageList.appendChild(emptyNode);
  }

  function hasThought(message) {
    return message.role === 'assistant' && typeof message.thought === 'string' && message.thought.trim().length > 0;
  }

  function setBubbleContent(bubble, message) {
    bubble.classList.toggle('markdown', message.role === 'assistant');

    if (message.role === 'assistant') {
      if (!message.content && hasThought(message)) {
        bubble.innerHTML = '<p class="message-placeholder">Thinking...</p>';
        return;
      }

      bubble.innerHTML = renderMarkdown(message.content);
      return;
    }

    if (!message.content && Array.isArray(message.images) && message.images.length) {
      bubble.innerHTML = '<p class="message-placeholder">Image attached</p>';
      return;
    }

    bubble.textContent = message.content || '';
  }

  function renderMessageImages(message) {
    const images = Array.isArray(message.images) ? message.images : [];

    if (!images.length) {
      return null;
    }

    const gallery = document.createElement('div');
    gallery.className = 'message-image-grid';

    images.forEach((image, index) => {
      const frame = document.createElement('button');
      frame.className = 'message-image-frame';
      frame.type = 'button';
      frame.setAttribute('aria-label', `Open ${image.name || `image ${index + 1}`}`);

      const element = document.createElement('img');
      element.className = 'message-image';
      element.loading = 'lazy';
      element.alt = image.name || `Attached image ${index + 1}`;

      if (image.previewUrl) {
        element.src = image.previewUrl;
      } else if (image.data && image.mimeType) {
        element.src = `data:${image.mimeType};base64,${image.data}`;
      } else {
        return;
      }

      frame.dataset.imageSrc = element.src;
      frame.dataset.imageAlt = element.alt;
      frame.appendChild(element);
      gallery.appendChild(frame);
    });

    return gallery.childElementCount ? gallery : null;
  }

  function setThoughtContent(panel, message) {
    if (!panel) {
      return;
    }

    const toggle = panel.querySelector('.thought-toggle');
    const body = panel.querySelector('.thought-body');
    const available = hasThought(message);
    const expanded = message.thoughtExpanded !== false;

    panel.hidden = !available;
    panel.dataset.expanded = expanded ? 'true' : 'false';

    if (!available) {
      body.innerHTML = '';
      toggle.textContent = 'Show reasoning';
      toggle.setAttribute('aria-expanded', 'false');
      return;
    }

    body.innerHTML = renderMarkdown(message.thought);
    toggle.textContent = expanded ? 'Hide reasoning' : 'Show reasoning';
    toggle.setAttribute('aria-expanded', String(expanded));
  }

  function syncMessageMeta(meta, message) {
    const label = meta.querySelector('.message-label');
    const modelTag = meta.querySelector('.message-model');
    const debugTag = meta.querySelector('.message-debug');

    if (label) {
      label.textContent = message.role;
    }

    if (!modelTag) {
      return;
    }

    const showModel = message.role === 'assistant' && typeof message.model === 'string' && message.model.trim();
    modelTag.hidden = !showModel;
    modelTag.textContent = showModel ? message.model.trim() : '';

    if (!debugTag) {
      return;
    }

    const hasDebugInfo = message.role === 'assistant'
      && ('requestThinkingEnabled' in message || 'requestSystemPrompt' in message);

    debugTag.hidden = !hasDebugInfo;

    if (!hasDebugInfo) {
      debugTag.textContent = '';
      return;
    }

    const promptSnapshot = typeof message.requestSystemPrompt === 'string'
      ? message.requestSystemPrompt.trim()
      : '';
    const promptLabel = promptSnapshot
      ? `system prompt "${promptSnapshot.length > 48 ? `${promptSnapshot.slice(0, 45)}...` : promptSnapshot}"`
      : 'system prompt none';

    debugTag.textContent = `thinking ${message.requestThinkingEnabled ? 'on' : 'off'} • ${promptLabel}`;
  }

  function makeMessageNode(message, index) {
    const article = document.createElement('article');
    article.className = `message ${message.role}${message.streaming ? ' streaming' : ''}`;
    article.dataset.index = String(index);

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const label = document.createElement('span');
    label.className = 'message-label';
    label.textContent = message.role;

    const modelTag = document.createElement('span');
    modelTag.className = 'message-model';
    modelTag.hidden = true;

    const debugTag = document.createElement('span');
    debugTag.className = 'message-debug';
    debugTag.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const copyMarkdownButton = document.createElement('button');
    copyMarkdownButton.className = 'message-copy-button';
    copyMarkdownButton.type = 'button';
    copyMarkdownButton.dataset.messageIndex = String(index);
    copyMarkdownButton.dataset.copyMode = 'markdown';
    copyMarkdownButton.setAttribute('aria-label', 'Copy markdown');
    copyMarkdownButton.title = 'Copy markdown';
    copyMarkdownButton.textContent = '⧉';

    const copyPlainButton = document.createElement('button');
    copyPlainButton.className = 'message-copy-button';
    copyPlainButton.type = 'button';
    copyPlainButton.dataset.messageIndex = String(index);
    copyPlainButton.dataset.copyMode = 'plain';
    copyPlainButton.setAttribute('aria-label', 'Copy plain text');
    copyPlainButton.title = 'Copy plain text';
    copyPlainButton.textContent = 'T';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    setBubbleContent(bubble, message);
    const imageGallery = renderMessageImages(message);

    const thoughtPanel = document.createElement('section');
    thoughtPanel.className = 'thought-panel';
    thoughtPanel.dataset.messageIndex = String(index);

    const thoughtToggle = document.createElement('button');
    thoughtToggle.className = 'thought-toggle';
    thoughtToggle.type = 'button';
    thoughtToggle.dataset.messageIndex = String(index);
    thoughtToggle.setAttribute('aria-expanded', String(message.thoughtExpanded !== false));

    const thoughtBody = document.createElement('div');
    thoughtBody.className = 'thought-body';

    thoughtPanel.append(thoughtToggle, thoughtBody);
    setThoughtContent(thoughtPanel, message);

    actions.append(copyMarkdownButton, copyPlainButton);
    meta.append(label, modelTag, debugTag);
    syncMessageMeta(meta, message);
    article.append(meta);
    if (message.role === 'assistant') {
      article.append(thoughtPanel);
    }
    if (imageGallery) {
      article.append(imageGallery);
    }
    article.append(bubble, actions);
    return article;
  }

  function appendMessageNode(message, index) {
    removeEmptyState();
    const node = makeMessageNode(message, index);
    state.messageNodes.set(index, node);
    elements.messageList.appendChild(node);
  }

  function updateMessageNode(index) {
    const message = state.messages[index];
    const node = state.messageNodes.get(index);

    if (!message || !node) {
      return;
    }

    node.className = `message ${message.role}${message.streaming ? ' streaming' : ''}`;
    syncMessageMeta(node.querySelector('.message-meta'), message);
    node.querySelectorAll('.message-copy-button').forEach((button) => {
      button.dataset.messageIndex = String(index);
    });
    const thoughtPanel = node.querySelector('.thought-panel');
    if (thoughtPanel) {
      thoughtPanel.dataset.messageIndex = String(index);
      thoughtPanel.querySelector('.thought-toggle')?.setAttribute('data-message-index', String(index));
      setThoughtContent(thoughtPanel, message);
    }
    node.querySelector('.message-image-grid')?.remove();
    const nextGallery = renderMessageImages(message);
    if (nextGallery) {
      const bubble = node.querySelector('.bubble');
      bubble.before(nextGallery);
    }
    setBubbleContent(node.querySelector('.bubble'), message);
  }

  async function copyMessage(index, mode) {
    const message = state.messages[index];

    if (!message) {
      return;
    }

    const node = state.messageNodes.get(index);
    const button = node?.querySelector(`.message-copy-button[data-copy-mode="${mode}"]`);
    const textToCopy = mode === 'plain'
      ? (node?.querySelector('.bubble')?.innerText || message.content || '')
      : (message.content || '');

    try {
      await navigator.clipboard.writeText(textToCopy);

      if (button) {
        button.textContent = '✓';
        button.setAttribute('aria-label', 'Copied');
        button.title = 'Copied';

        window.setTimeout(() => {
          button.textContent = mode === 'plain' ? 'T' : '⧉';
          button.setAttribute('aria-label', mode === 'plain' ? 'Copy plain text' : 'Copy markdown');
          button.title = mode === 'plain' ? 'Copy plain text' : 'Copy markdown';
        }, 1200);
      }
    } catch (error) {
      console.error('Unable to copy message.', error);
    }
  }

  function toggleThought(index) {
    const message = state.messages[index];

    if (!message || !hasThought(message)) {
      return;
    }

    updateMessage(index, {
      thoughtExpanded: message.thoughtExpanded === false,
    });
  }

  function flushMessageNodeUpdates() {
    state.pendingMessageUpdates.forEach((index) => {
      updateMessageNode(index);
    });

    state.pendingMessageUpdates.clear();
    state.renderFrame = null;

    if (state.shouldScrollOnFlush) {
      scrollMessagesToBottom();
      state.shouldScrollOnFlush = false;
    }
  }

  function queueMessageNodeUpdate(index, shouldScroll) {
    state.pendingMessageUpdates.add(index);

    if (shouldScroll) {
      state.shouldScrollOnFlush = true;
    }

    if (state.renderFrame !== null) {
      return;
    }

    state.renderFrame = window.requestAnimationFrame(flushMessageNodeUpdates);
  }

  function renderMessages() {
    elements.messageList.innerHTML = '';
    state.messageNodes.clear();
    state.pendingMessageUpdates.clear();

    if (state.renderFrame !== null) {
      window.cancelAnimationFrame(state.renderFrame);
      state.renderFrame = null;
    }

    if (!state.messages.length) {
      showEmptyState();
      return;
    }

    state.messages.forEach((message, index) => {
      appendMessageNode(message, index);
    });

    scrollMessagesToBottom();
  }

  function handleMessageClick(event) {
    const imageFrame = event.target.closest('.message-image-frame[data-image-src]');

    if (imageFrame) {
      onOpenImageLightbox(imageFrame.dataset.imageSrc, imageFrame.dataset.imageAlt || '');
      return true;
    }

    const thoughtButton = event.target.closest('.thought-toggle');

    if (thoughtButton) {
      toggleThought(Number(thoughtButton.dataset.messageIndex));
      return true;
    }

    const button = event.target.closest('.message-copy-button');

    if (!button) {
      return false;
    }

    copyMessage(Number(button.dataset.messageIndex), button.dataset.copyMode);
    return true;
  }

  return {
    isNearBottom,
    scrollMessagesToBottom,
    appendMessageNode,
    queueMessageNodeUpdate,
    renderMessages,
    handleMessageClick,
  };
}
