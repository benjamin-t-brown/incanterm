const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

test('serves the editor and round-trips validated documents', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const name = `test-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { await fetch(base); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(ready, 'server started');
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /ED\/ASCII/);

    const document = { format: 'ed-ascii', version: 1, width: 2, height: 1,
      cells: [{ ch: '█', fg: 15, bg: 0 }, { ch: ' ', fg: 7, bg: 4 }] };
    const url = `${base}/api/files/${name}`;
    let response = await fetch(url, { method: 'PUT', body: JSON.stringify(document) });
    assert.equal(response.status, 200);
    response = await fetch(url);
    assert.deepEqual(await response.json(), document);
    response = await fetch(`${base}/api/files`);
    assert.ok((await response.json()).files.includes(name));
    response = await fetch(url, { method: 'PUT', body: JSON.stringify({ ...document, width: 999 }) });
    assert.equal(response.status, 422);
    response = await fetch(url, { method: 'PUT', body: JSON.stringify({ ...document, cells: [{ ch: '\x1b', fg: 15, bg: 0 }, document.cells[1]] }) });
    assert.equal(response.status, 422, 'terminal control characters are not valid glyphs');
    response = await fetch(url);
    assert.deepEqual(await response.json(), document, 'invalid saves do not overwrite valid files');
    response = await fetch(url, { method: 'DELETE' });
    assert.equal(response.status, 200);
    response = await fetch(url);
    assert.equal(response.status, 404);
  } finally {
    child.kill();
  }
});
