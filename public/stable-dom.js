// Update live text in place so polling retains focus, expanded details and scroll.
export function updateHTML(container, html) {
  if (container.__renderedHTML === html && container.hasChildNodes()) return;
  container.__renderedHTML = html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const key = node => node.nodeType === 1 ? node.getAttribute('data-task') || node.getAttribute('data-section') || node.id : null;
  function patch(parent, desired) {
    const existing = new Map([...parent.childNodes].map(n => [key(n), n]).filter(([k]) => k));
    let cursor = parent.firstChild;
    for (const next of [...desired.childNodes]) {
      const nextKey = key(next);
      let current = nextKey ? existing.get(nextKey) : cursor;
      if (!current || current.nodeType !== next.nodeType || current.nodeName !== next.nodeName || (key(current) || nextKey) && key(current) !== nextKey) {
        current = next.cloneNode(true);
        parent.insertBefore(current, cursor);
      } else {
        if (current !== cursor) parent.insertBefore(current, cursor);
        if (current.nodeType === 3) {
          if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
        } else if (current.nodeType === 1) {
          const preserve = name => current.tagName === 'DETAILS' && name === 'open';
          for (const attr of [...current.attributes]) if (!preserve(attr.name) && !next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
          for (const attr of [...next.attributes]) if (!preserve(attr.name) && current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
          patch(current, next);
        }
      }
      cursor = current.nextSibling;
    }
    while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
  }
  patch(container, template.content);
}
