async function readJsonBody(req, maxBytes = 1_000_000) {
  let body = '';

  for await (const chunk of req) {
    body += chunk;

    if (body.length > maxBytes) {
      throw new Error('Request body is too large.');
    }
  }

  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

module.exports = {
  readJsonBody,
  writeJson,
};
