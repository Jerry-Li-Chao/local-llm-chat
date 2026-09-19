// Match the book-reader address used during development; honor an explicit PORT.
process.env.PORT ||= '3020';
require('../server.js');
