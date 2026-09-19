const { bytes } = require('./chunking');
function suggestMetadata(info = '', filename = '') {
  const title = info.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
  const author = info.match(/^Author:\s*(.+)$/m)?.[1]?.trim();
  const usable = title && !/^(untitled|document|microsoft word)(\b|$)/i.test(title);
  return { bookTitle: (usable ? title : filename.replace(/\.pdf$/i, '').replace(/_/g, ' ')).slice(0, 200), author: (author || '').slice(0, 100), metadataSource: usable ? 'PDF metadata (review before starting)' : 'Filename suggestion (review before starting)', metadataConfirmed: false };
}
function validateMetadata(body) {
  const bookTitle = String(body.bookTitle || '').trim();
  const author = String(body.author || '').trim();
  if (!bookTitle || bytes(bookTitle) > 600) throw new Error('Enter a book title within 600 UTF-8 bytes.');
  if (bytes(author) > 300) throw new Error('Keep the author within 300 UTF-8 bytes.');
  return { bookTitle, author, metadataConfirmed: true, metadataSource: 'Reader-confirmed' };
}
module.exports = { suggestMetadata, validateMetadata };
