const { createReadStream, existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

function createStaticService({ publicDir, mimeTypes, writeJson }) {
  async function serveStatic(reqPath, res) {
    const safePath = reqPath === '/' ? '/index.html' : reqPath;
    const filePath = path.normalize(path.join(publicDir, safePath));

    if (!filePath.startsWith(publicDir)) {
      writeJson(res, 403, {
        ok: false,
        error: 'Forbidden',
      });
      return;
    }

    if (!existsSync(filePath)) {
      writeJson(res, 404, {
        ok: false,
        error: 'Not found',
      });
      return;
    }

    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      await serveStatic(path.join(reqPath, 'index.html'), res);
      return;
    }

    const extension = path.extname(filePath);
    const contentType = mimeTypes[extension] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300',
    });

    createReadStream(filePath).pipe(res);
  }

  return {
    serveStatic,
  };
}

module.exports = {
  createStaticService,
};
