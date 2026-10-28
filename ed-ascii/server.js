const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = __dirname;
const directory = path.join(root, 'data');
const port = Number(process.env.PORT) || 3000;
const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function fileName(url) {
  const name = decodeURIComponent(url.pathname.slice('/api/files/'.length));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,63}$/.test(name) || name.endsWith('.') || name === '.' || name === '..') {
    throw new Error('Use a file name of up to 64 letters, numbers, spaces, dots, dashes or underscores.');
  }
  return path.join(directory, `${name}.json`);
}

function validDocument(doc) {
  return doc && doc.format === 'ed-ascii' && doc.version === 1 &&
    Number.isInteger(doc.width) && doc.width >= 1 && doc.width <= 256 &&
    Number.isInteger(doc.height) && doc.height >= 1 && doc.height <= 128 &&
    Array.isArray(doc.cells) && doc.cells.length === doc.width * doc.height &&
    doc.cells.every(cell => cell && typeof cell.ch === 'string' && [...cell.ch].length === 1 &&
      !/[\x00-\x1f\x7f-\x9f]/u.test(cell.ch) &&
      Number.isInteger(cell.fg) && cell.fg >= 0 && cell.fg < 16 &&
      Number.isInteger(cell.bg) && cell.bg >= 0 && cell.bg < 16);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/files' && req.method === 'GET') {
      await fs.mkdir(directory, { recursive: true });
      const files = (await fs.readdir(directory)).filter(name => name.endsWith('.json'))
        .map(name => name.slice(0, -5)).sort((a, b) => a.localeCompare(b));
      return send(res, 200, { files });
    }
    if (url.pathname.startsWith('/api/files/') && ['GET', 'PUT', 'DELETE'].includes(req.method)) {
      const target = fileName(url);
      if (req.method === 'GET') {
        const doc = JSON.parse(await fs.readFile(target, 'utf8'));
        if (!validDocument(doc)) return send(res, 422, { error: 'This is not a valid ed-ascii file.' });
        return send(res, 200, doc);
      }
      if (req.method === 'DELETE') {
        await fs.unlink(target);
        return send(res, 200, { ok: true });
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 3000000) return send(res, 413, { error: 'File is too large.' });
      }
      let doc;
      try { doc = JSON.parse(body); } catch { return send(res, 400, { error: 'Invalid JSON.' }); }
      if (!validDocument(doc)) return send(res, 422, { error: 'Invalid document. Maximum size is 256 × 128.' });
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(target, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && staticFiles[url.pathname]) {
      const [name, type] = staticFiles[url.pathname];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(await fs.readFile(path.join(root, name)));
      return;
    }
    send(res, 404, { error: 'Not found.' });
  } catch (error) {
    if (error.code === 'ENOENT') return send(res, 404, { error: 'File not found.' });
    if (error instanceof URIError || error.message.startsWith('Use a file name')) return send(res, 400, { error: error.message });
    console.error(error);
    send(res, 500, { error: 'Server error.' });
  }
});

const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`ed-ascii running at http://${host}:${port}`));
