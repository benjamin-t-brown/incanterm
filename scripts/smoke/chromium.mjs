// Minimal CDP driver for installed Chromium browsers; no automation package or driver download.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import WebSocket from 'ws';

export async function waitFor(check, description, timeout = 15_000) {
  const until = Date.now() + timeout;
  do {
    const value = await check();
    if (value) return value;
    await wait(75);
  } while (Date.now() < until);
  throw new Error(`Timed out: ${description}`);
}

async function connectDebugger(url) {
  const socket = new WebSocket(url);
  await once(socket, 'open');
  const pending = new Map();
  let sequence = 0;
  socket.on('message', (data) => {
    const { id, error, result } = JSON.parse(String(data));
    const callback = pending.get(id);
    if (!callback) return;
    pending.delete(id);
    if (error) callback.reject(new Error(error.message));
    else callback.resolve(result);
  });
  socket.on('close', () => {
    for (const callback of pending.values()) callback.reject(new Error('Debugger disconnected'));
    pending.clear();
  });
  return async function send(method, params = {}) {
    const id = ++sequence;
    const { promise, resolve, reject } = Promise.withResolvers();
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20_000);
    pending.set(id, { resolve, reject });
    try {
      socket.send(JSON.stringify({ id, method, params }));
      return await promise;
    } finally {
      clearTimeout(timer);
      pending.delete(id);
    }
  };
}

export async function startBrowser(executable, profile) {
  const process = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--headless=new',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const exited = once(process, 'exit');
  // Surface launch errors alongside readiness failures.
  const failed = exited.then(([code]) => {
    throw new Error(`Browser exited: ${code}`);
  });
  let send;
  try {
    const contents = await Promise.race([
      failed,
      waitFor(
        () => fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => ''),
        'browser debugger',
        20_000,
      ),
    ]);
    const [port, endpoint] = contents.trim().split(/\r?\n/);
    const origin = `http://127.0.0.1:${port}`;
    send = await connectDebugger(`ws://127.0.0.1:${port}${endpoint}`);
    return {
      version: await send('Browser.getVersion'),
      setMicrophonePermission: (origin, setting) =>
        send('Browser.setPermission', { origin, permission: { name: 'microphone' }, setting }),
      async openTab(init = '') {
        const response = await fetch(`${origin}/json/new?about:blank`, { method: 'PUT' });
        const { webSocketDebuggerUrl } = await response.json();
        const call = await connectDebugger(webSocketDebuggerUrl);
        await call('Page.enable');
        if (init) await call('Page.addScriptToEvaluateOnNewDocument', { source: init });
        async function evaluate(expression) {
          const { result, exceptionDetails } = await call('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
            userGesture: true,
          });
          if (exceptionDetails) throw new Error(result.description || exceptionDetails.text);
          return result.value;
        }
        return {
          evaluate,
          navigate: (url) => call('Page.navigate', { url }),
          async pressKey(key, shift = false) {
            const fields = {
              key, code: key === ' ' ? 'Space' : key, modifiers: shift ? 8 : 0,
              windowsVirtualKeyCode: { Tab: 9, Enter: 13, Escape: 27, ' ': 32 }[key],
            };
            await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...fields });
            await call('Input.dispatchKeyEvent', { type: 'keyUp', ...fields });
          },
          click: (selector) =>
            evaluate(`(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el?.checkVisibility() || el.disabled) throw new Error('Control unavailable: ${selector}');
            el.click();
          })()`),
          async waitFor(expression) {
            try {
              return await waitFor(() => evaluate(expression), expression);
            } catch (error) {
              const page = await evaluate(`document.body.innerText.slice(-2000)`);
              throw new Error(`${error.message}\nPage: ${page}`, { cause: error });
            }
          },
        };
      },
      async close() {
        if (process.exitCode !== null) return;
        await send('Browser.close').catch(() => {});
        const timer = setTimeout(() => process.kill(), 4000);
        try {
          await exited;
        } finally {
          clearTimeout(timer);
        }
      },
    };
  } catch (error) {
    process.kill();
    throw error;
  }
}
