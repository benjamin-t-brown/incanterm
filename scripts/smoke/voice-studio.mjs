// node --import tsx scripts/smoke/voice-studio.mjs [chrome|edge]
// Requires FFmpeg on PATH. Override CHROME_BIN / EDGE_BIN for other installations.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createServer } from 'vite';
import { exportGame } from '../../src/export/export-game.ts';
import { createProject } from '../../src/project/project.ts';
import { startBrowser, waitFor } from './chromium.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const browsers = {
  chrome: process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  edge: process.env.EDGE_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
};
const tempBase = process.env.SMOKE_TEMP || os.tmpdir();
const $ = 'document.querySelector.bind(document)';
const oldText = 'Wait by the lifts.';
const newText = 'Wait by the stairs.';
const silentText = 'Text only.';

async function createFixture(directory) {
  const project = await createProject(path.join(directory, 'project'), 'Studio smoke');
  const scenePath = path.join(project.assetsRoot, 'scenes/start.json');
  const scene = JSON.parse(await fs.readFile(scenePath, 'utf8'));
  scene.triggers = ['entry'];
  await fs.writeFile(scenePath, JSON.stringify(scene));
  await fs.writeFile(
    path.join(project.assetsRoot, 'session-config.json'),
    JSON.stringify({
      dialogueAnimation: { enabled: true, stepDurationMs: 250, wordDelayMs: 500 },
    }),
  );
  await fs.writeFile(
    path.join(project.assetsRoot, 'scripts/entry.rpgscript'),
    `#entry\nload,start\n@start\nGuide: "${oldText}"\nGuide: "${silentText}"\n`,
  );
  return project;
}

async function startEditor(directory) {
  const server = await createServer({
    configFile: path.join(root, 'vite.editor.config.ts'),
    cacheDir: path.join(directory, 'vite'),
    logLevel: 'error',
    server: { port: 0, host: '127.0.0.1', watch: null, hmr: false },
    plugins: [
      {
        name: 'block-workspace-project-discovery',
        enforce: 'pre',
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (/^\/api\/projects\/?(?:\?|$)/.test(req.url)) {
              res.statusCode = 403;
              return res.end('Workspace project enumeration is disabled in the smoke.');
            }
            if (req.url?.startsWith('/api/'))
              res.once('finish', () => {
                if (res.statusCode >= 400)
                  console.error(
                    `${req.method} ${req.url}: ${res.statusCode}, Content-Type: ${req.headers['content-type']}`,
                  );
              });
            next();
          });
        },
      },
    ],
  });
  await server.listen();
  return {
    origin: `http://127.0.0.1:${server.httpServer.address().port}`,
    close: () => server.close(),
  };
}

async function getResponse(url, options) {
  const response = await fetch(url, options);
  assert(response.ok, `${response.status} ${url}: ${response.ok ? '' : await response.text()}`);
  return response;
}

function getChecksum(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function checkStudioFlow(browser, project, origin) {
  const headers = { origin, 'content-type': 'application/json' };
  const { key } = await (
    await getResponse(`${origin}/api/projects/open`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: project.manifestPath }),
    })
  ).json();
  const api = `${origin}/api/projects/${key}`;
  async function getCatalog() {
    return (await getResponse(`${api}/voice`)).json();
  }
  const init = `sessionStorage.setItem('incanterm-open-project', ${JSON.stringify(project.manifestPath)});
    window.$ = ${$}; window.testTracks = [];
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await getMedia(...args);
      testTracks.push(...stream.getAudioTracks());
      return stream;
    };`;
  const writer = await browser.openTab(init);
  const studio = await browser.openTab(init);
  await writer.navigate(`${origin}/scripts`);
  await writer.waitFor(`window.$ && $('#script-list button')`);
  await writer.click('#script-list button');
  await writer.waitFor(`$('#script-source').value.includes('Wait by the lifts.')`);
  await writer.evaluate(
    `{ const el = $('#script-source'); const i = el.value.indexOf('Wait'); el.setSelectionRange(i,i); }`,
  );
  await writer.click('#request-voice');
  await waitFor(
    async () => (await getCatalog()).catalog.lines.some((l) => l.requested),
    'saved voice request',
  );
  await studio.navigate(`${origin}/voice`);
  await studio.waitFor(`window.$ && $('#voice-state')?.textContent === 'Needs recording'`);
  if (browser.version.product.startsWith('Edg/')) await studio.click('#theme-toggle');
  await browser.setMicrophonePermission(origin, 'denied');
  await studio.click('#voice-record');
  await studio.waitFor(
    `!$('#voice-record').disabled && /denied|not allowed/i.test($('#voice-status').textContent)`,
  );
  assert.equal(await studio.evaluate(`testTracks.length`), 0);
  await browser.setMicrophonePermission(origin, 'granted');

  async function captureTake(ms, whileRecording) {
    await studio.click('#voice-record');
    await studio.waitFor(`$('#voice-stop')?.disabled === false`);
    if (whileRecording) await whileRecording();
    await wait(ms);
    await studio.click('#voice-stop');
    await studio.waitFor(
      `$('#voice-status').textContent === 'Take saved.' && !$('#voice-record').disabled`,
    );
    assert(
      await studio.evaluate(
        `testTracks.length > 0 && testTracks.every(t => t.readyState === 'ended')`,
      ),
    );
  }
  for (let i = 0; i < 3; i++) await captureTake(450);
  await captureTake(500, async () => {
    await writer.evaluate(
      `{ const el = $('#script-source'); el.value = el.value.replace('lifts','stairs'); el.dispatchEvent(new Event('input')); }`,
    );
    await writer.click('#save-script');
    await waitFor(
      async () => (await getCatalog()).catalog.lines.some((l) => l.text === newText),
      'saved rewrite while recording',
    );
  });
  await studio.navigate(`${origin}/voice`);
  await studio.waitFor(
    `window.$ && $('#voice-state')?.textContent === 'Needs pickup' && $('#voice-takes').length === 4`,
  );
  assert.equal(await studio.evaluate(`$('#voice-text').textContent`), newText);
  assert.match(await studio.evaluate(`$('#voice-before').innerText`), /Wait by the lifts/);
  const { takes } = await getCatalog();
  assert.equal(takes.length, 4);
  const originals = new Map();
  async function getOriginal(id) {
    return Buffer.from(await (await getResponse(`${api}/voice/takes/${id}/audio`)).arrayBuffer());
  }
  for (const take of takes) {
    assert.equal(take.text, oldText);
    const bytes = await getOriginal(take.takeId);
    assert(bytes.length > 100);
    originals.set(take.takeId, getChecksum(bytes));
    const duration = await studio.evaluate(`(async () => {
      const bytes = await (await fetch(${JSON.stringify(`${api}/voice/takes/${take.takeId}/audio`)})).arrayBuffer();
      return (await new OfflineAudioContext(1,1,48000).decodeAudioData(bytes)).duration;
    })()`);
    assert(duration > 0.1);
  }
  console.log('  Four original captures decode after reopen; concurrent rewrite needs pickup.');
  await studio.click('#voice-tone');
  await studio.waitFor(
    `$('#voice-status').textContent === 'Room tone saved.' && !$('#voice-record').disabled`,
  );
  await captureTake(2200);
  await studio.click('#voice-favorite');
  await studio.waitFor(
    `$('#voice-favorite').textContent === 'Remove favorite' && !$('#voice-record').disabled`,
  );
  assert.equal(await studio.evaluate(`$('#voice-state').textContent`), 'Needs review');
  await studio.click('#voice-review summary');
  await studio.evaluate(
    `{ const el = $('#voice-cleanup'); el.selectedIndex=1; el.dispatchEvent(new Event('change')); }`,
  );
  assert(await studio.evaluate(`!!$('#voice-cleanup').value`));
  await studio.click('#voice-save-edits');
  await studio.waitFor(`$('#voice-status').textContent === 'Take settings saved.'`);
  await studio.navigate(`${origin}/voice`);
  await studio.waitFor(`window.$ && $('#voice-cleanup')?.value && !$('#voice-record').disabled`);
  const pickup = await studio.evaluate(`$('#voice-takes').value`);
  originals.set(pickup, getChecksum(await getOriginal(pickup)));
  await studio.click('#voice-review summary');
  const comparison = [];
  for (const selector of ['#voice-ab-original', '#voice-ab-cleaned']) {
    await studio.click(selector);
    await studio.waitFor(
      `$('#voice-status').textContent === 'Playing preview.' && !$('#voice-record').disabled`,
    );
    const [size, digest] = await studio.evaluate(`(async () => {
      const res = await fetch($('#voice-player').src); const bytes = await res.arrayBuffer();
      if (new TextDecoder().decode(bytes.slice(0,4)) !== 'RIFF') throw new Error('Expected WAV');
      return [bytes.byteLength, [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].join('.')];
    })()`);
    assert(size > 1000);
    comparison.push(digest);
  }
  assert.notEqual(comparison[0], comparison[1], 'cleanup should alter the synthetic waveform');
  console.log('  Room tone and pickup saved; browser rendered distinct original/Light WAVs.');
  await studio.click('#voice-publish');
  await studio.waitFor(
    `$('#voice-status').textContent === 'Approved take published.' && $('#voice-state').textContent === 'Approved'`,
  );
  const history = await getCatalog();
  assert.equal(history.approvals[0].takeId, pickup);
  for (const [id, hash] of originals) assert.equal(getChecksum(await getOriginal(id)), hash);
  const index = JSON.parse(
    await fs.readFile(path.join(project.assetsRoot, 'audio/voice/index.json'), 'utf8'),
  );
  assert.equal(index.clips.length, 1);
  const clip = index.clips[0];
  assert.equal(clip.revision, history.approvals[0].revision);
  assert.equal(
    getChecksum(await fs.readFile(path.join(project.assetsRoot, 'audio/voice', clip.file))),
    clip.checksum,
  );
  console.log('  Edited pickup published; all five originals remain byte-identical.');
  await studio.click('#voice-record');
  await studio.waitFor(`testTracks.at(-1)?.readyState === 'live' && !$('#voice-stop').disabled`);
  await studio.click('a[href="/scripts"]');
  await studio.waitFor(`$('#editor-modal')?.open`);
  await studio.click('#editor-modal-ok');
  await studio.waitFor(
    `location.pathname === '/scripts' && testTracks.every(t => t.readyState === 'ended')`,
  );
  console.log('  Microphone denial was visible; leaving during capture released the input track.');
  return { api, headers, clip };
}

async function checkGame(browser, url, clip) {
  // Track actual native audio elements (including detached ones created by new Audio).
  const tab = await browser.openTab(`window.$ = ${$}; window.testAudio = []; window.gameInputs = [];
    const sendMessage = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      if (typeof data === 'string' && data.startsWith('{')) {
        const message = JSON.parse(data);
        if (message.type === 'input') gameInputs.push(message.data);
      }
      return sendMessage.call(this, data);
    };
    const NativeAudio = window.Audio; window.Audio = class extends NativeAudio {
      constructor(...args) { super(...args); testAudio.push(this); }
    };`);
  await tab.navigate(url);
  await tab.waitFor(`window.testAudio?.[0]?.currentTime > 0`);
  assert(new URL(await tab.evaluate(`testAudio[0].src`)).pathname.endsWith(`${clip.checksum}.mp3`));
  async function advanceDialogue() {
    await tab.pressKey(' ');
  }
  await advanceDialogue();
  await tab.waitFor(`$('#screen').innerText.includes(${JSON.stringify(newText)})`);
  assert(
    await tab.evaluate(`testAudio.length === 1 && !!testAudio[0].getAttribute('src')`),
    'reveal stopped or replaced clip',
  );
  await advanceDialogue();
  await tab.waitFor(`testAudio.length === 1 && !testAudio[0].hasAttribute('src')`);
  await advanceDialogue();
  await tab.waitFor(`$('#screen').innerText.includes(${JSON.stringify(silentText)})`);
  await tab.pressKey('Tab');
  assert.equal(await tab.evaluate('document.activeElement.id'), 'voice');
  await tab.pressKey('Tab');
  assert.equal(await tab.evaluate('document.activeElement.id'), 'screen');
  await tab.pressKey('Tab', true);
  assert.equal(await tab.evaluate('document.activeElement.id'), 'voice');
  await tab.pressKey('Tab');
  await tab.pressKey('Enter');
  await tab.pressKey('Tab');
  await tab.pressKey('Tab', true);
  assert.equal(await tab.evaluate('document.activeElement.id'), 'screen');
  assert.deepEqual(await tab.evaluate('gameInputs.slice(-3)'), ['\r', '\t', '\x1b[Z']);
  const inputs = await tab.evaluate('gameInputs.length');
  await tab.pressKey('Escape');
  await tab.pressKey('Tab', true);
  assert.equal(await tab.evaluate('document.activeElement.id'), 'voice');
  await tab.pressKey(' ');
  assert.equal(await tab.evaluate(`$('#voice').checked`), false);
  assert.equal(await tab.evaluate('gameInputs.length'), inputs);
  await tab.navigate(url);
  await tab.waitFor(
    `window.$ && $('#status')?.textContent.startsWith('Connected ·') && $('#screen')?.innerText.includes('Guide')`,
  );
  assert.equal(await tab.evaluate(`$('#voice').checked`), false);
  await advanceDialogue();
  await tab.waitFor(`$('#screen').innerText.includes(${JSON.stringify(newText)})`);
  assert.equal(await tab.evaluate(`testAudio.length`), 0);
  await tab.navigate('about:blank');
}

async function checkExport(browser, project, directory, clip) {
  const release = path.join(directory, 'release');
  await exportGame({ projectPath: project.root, outputPath: release });
  const voice = path.join(release, 'game/assets/audio/voice');
  assert.deepEqual((await fs.readdir(voice)).sort(), ['index.json', clip.file].sort());
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(voice, 'index.json'), 'utf8')).clips, [
    clip,
  ]);
  assert.equal(getChecksum(await fs.readFile(path.join(voice, clip.file))), clip.checksum);
  assert(
    !(await fs.readdir(path.join(release, 'game'), { recursive: true })).some((name) =>
      /voice-work|\.webm$/i.test(name),
    ),
  );
  // Use installed runtime dependencies without fetching packages for each disposable release.
  await fs.symlink(path.join(root, 'node_modules'), path.join(release, 'node_modules'), 'junction');
  const child = spawn(process.execPath, ['dist/server.js', '--project', 'game', '--no-ssh'], {
    cwd: release,
    env: { ...process.env, INCANTERM_HTTP_PORT: '0', INCANTERM_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let log = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      log += chunk;
    });
  try {
    const url = await waitFor(() => {
      if (child.exitCode !== null) throw new Error(log);
      return log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    }, 'exported game server');
    await checkGame(browser, url, clip);
  } finally {
    child.kill();
    await exited;
  }
}

async function runSmoke(name) {
  assert(Object.hasOwn(browsers, name), `Unknown browser ${name}`);
  const directory = await fs.mkdtemp(path.join(tempBase, `incanterm-voice-${name}-`));
  let browser;
  let editor;
  try {
    const project = await createFixture(directory);
    editor = await startEditor(directory);
    browser = await startBrowser(browsers[name], path.join(directory, 'profile'));
    console.log(`${name}: ${browser.version.product}; Vite ${editor.origin}`);
    const { api, headers, clip } = await checkStudioFlow(browser, project, editor.origin);
    const preview = await (await getResponse(`${api}/play`, { method: 'POST', headers })).json();
    try {
      await checkGame(browser, editor.origin + preview.url, clip);
    } finally {
      await getResponse(`${api}/play`, { method: 'DELETE', headers });
    }
    await editor.close();
    editor = undefined;
    console.log(
      '  Live preview preserved voice on reveal and stopped on advance to text-only dialogue.',
    );
    await checkExport(browser, project, directory, clip);
    console.log('  Export served the approved MP3 and progressed independently with Vite stopped.');
  } finally {
    try {
      await browser?.close();
    } finally {
      await editor?.close();
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
}

for (const name of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(browsers)) {
  try {
    await runSmoke(name);
  } catch (error) {
    console.error(`${name} FAIL:`, error);
    process.exitCode = 1;
  }
}
