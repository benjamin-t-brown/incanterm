const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { pathToFileURL } = require('url');
const { createMessageConnection, IPCMessageReader, IPCMessageWriter } = require('vscode-jsonrpc/node');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgscript-diagnostics-'));
const first = path.join(root, 'first.rpgscript');
const second = path.join(root, 'second.rpgscript');
const firstUri = pathToFileURL(first).href;
const secondUri = pathToFileURL(second).href;
fs.writeFileSync(first, '@shared\n');
fs.writeFileSync(second, '@other\n');
fs.writeFileSync(path.join(root, 'commands.ts'), 'const callScript = (target: string) => {};\nconst playDialogue = (actor: string, text: string) => {};\nconst setStorage = (key: string, value: string) => {};\nexport const commands = { callScript, playDialogue, setStorage, };\n');
const child = fork(path.resolve(__dirname, '../src/server/dist/server.js'), ['--node-ipc'], { silent: true });
let output = '';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
const connection = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
connection.onRequest('workspace/configuration', params => params.items.map(() => ({
  scriptsRoot: root, sceneCommandsPath: path.join(root, 'commands.ts'), debug: false,
})));
connection.onRequest('client/registerCapability', () => null);
connection.listen();

const expectDiagnostics = (expected, send) => new Promise((resolve, reject) => {
  const received = new Map();
  const timeout = setTimeout(() => {
    subscription.dispose();
    reject(new Error(`Timed out waiting for diagnostics: ${JSON.stringify([...received])}\n${output}`));
  }, 10000);
  const subscription = connection.onNotification('textDocument/publishDiagnostics', params => {
    received.set(params.uri, params.diagnostics);
    if (Object.entries(expected).every(([uri, codes]) => {
      const diagnostics = received.get(uri);
      return diagnostics && JSON.stringify(diagnostics.map(d => d.code)) === JSON.stringify(codes);
    })) {
      clearTimeout(timeout);
      subscription.dispose();
      resolve(received);
    }
  });
  send();
});
const open = (uri, text) => connection.sendNotification('textDocument/didOpen', {
  textDocument: { uri, languageId: 'rpgscript', version: 1, text },
});
const change = (version, text) => connection.sendNotification('textDocument/didChange', {
  textDocument: { uri: secondUri, version }, contentChanges: [{ text }],
});
const watched = (uri, type) => connection.sendNotification('workspace/didChangeWatchedFiles', {
  changes: [{ uri, type }],
});

(async () => {
  try {
    await connection.sendRequest('initialize', {
      processId: process.pid,
      capabilities: {
        workspace: { configuration: true },
        textDocument: { publishDiagnostics: { relatedInformation: true } },
      },
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'test' }],
    });
    connection.sendNotification('initialized', {});
    await expectDiagnostics({ [firstUri]: [], [secondUri]: [] }, () => {
      open(firstUri, '@shared\n');
      open(secondUri, '@other\n');
    });
    const duplicates = await expectDiagnostics({
      [firstUri]: ['duplicate-script'], [secondUri]: ['duplicate-script'],
    }, () => change(2, '@shared\n'));
    assert.equal(duplicates.get(firstUri)[0].severity, 2);
    assert.equal(duplicates.get(firstUri)[0].range.start.line, 0);
    assert.equal(duplicates.get(firstUri)[0].relatedInformation.length, 1);
    await expectDiagnostics({ [firstUri]: [], [secondUri]: [] }, () => change(3, '@other\n'));

    // Open buffers override disk; closing a buffer restores its on-disk headers.
    fs.writeFileSync(second, '@shared\n');
    await expectDiagnostics({ [firstUri]: [], [secondUri]: [] }, () => watched(secondUri, 2));
    await expectDiagnostics({ [firstUri]: ['duplicate-script'], [secondUri]: [] }, () => {
      connection.sendNotification('textDocument/didClose', { textDocument: { uri: secondUri } });
    });
    fs.unlinkSync(second);
    await expectDiagnostics({ [firstUri]: [] }, () => watched(secondUri, 3));
    fs.writeFileSync(second, '@shared\n');
    await expectDiagnostics({ [firstUri]: ['duplicate-script'] }, () => watched(secondUri, 1));
    fs.writeFileSync(second, '@renamed\n');
    await expectDiagnostics({ [firstUri]: [] }, () => watched(secondUri, 2));

    // Missing global script targets are errors, refreshed by edits to another file.
    const unknown = await expectDiagnostics({ [firstUri]: ['unknown-script'] }, () => {
      connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: firstUri, version: 2 },
        contentChanges: [{ text: '@shared\n  +:target()\n' }],
      });
    });
    assert.equal(unknown.get(firstUri)[0].severity, 1);
    assert.equal(unknown.get(firstUri)[0].range.start.line, 1);
    await expectDiagnostics({ [firstUri]: [], [secondUri]: [] }, () => open(secondUri, '@target\n'));
    await expectDiagnostics({ [firstUri]: ['unknown-script'], [secondUri]: [] }, () => change(2, '@renamed\n'));
    await expectDiagnostics({ [firstUri]: [], [secondUri]: [] }, () => change(3, '@target\n'));
    await expectDiagnostics({ [firstUri]: ['unknown-script'], [secondUri]: [] }, () => {
      connection.sendNotification('textDocument/didClose', { textDocument: { uri: secondUri } });
    });
    fs.writeFileSync(second, '@target\n');
    await expectDiagnostics({ [firstUri]: [] }, () => watched(secondUri, 2));
    fs.unlinkSync(second);
    await expectDiagnostics({ [firstUri]: ['unknown-script'] }, () => watched(secondUri, 3));

    const localWarnings = await expectDiagnostics({ [firstUri]: ['local-global-confusion'] }, () => {
      connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: firstUri, version: 3 },
        contentChanges: [{ text: '@with_args(arg1)\nGuide: "{arg1}"\n' }],
      });
    });
    assert.equal(localWarnings.get(firstUri)[0].severity, 2);
    assert.match(localWarnings.get(firstUri)[0].message, /Did you mean \[arg1\]\?/);
    await expectDiagnostics({ [firstUri]: [] }, () => {
      connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: firstUri, version: 4 },
        contentChanges: [{ text: '@with_args(arg1)\nGuide: "[arg1]"\n' }],
      });
    });

    await expectDiagnostics({ [firstUri]: ['unknown-local'] }, () => {
      connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: firstUri, version: 5 },
        contentChanges: [{ text: '@with_args(arg1)\nGuide: "[missing]"\n' }],
      });
    });
    await expectDiagnostics({ [firstUri]: [], [secondUri]: [] }, () => {
      open(secondUri, '@target(arg1)\n');
      connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: firstUri, version: 6 },
        contentChanges: [{ text: '@start\n+:target("a")\n' }],
      });
    });
    await expectDiagnostics({ [firstUri]: ['script-argument-count'], [secondUri]: [] }, () => change(2, '@target(arg1, arg2)\n'));
    await expectDiagnostics({ [firstUri]: [], [secondUri]: [] }, () => change(3, '@target(arg1)\n'));

    await expectDiagnostics({ [firstUri]: ['local-global-confusion'] }, () => {
      connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: firstUri, version: 7 },
        contentChanges: [{ text: '@with_args(arg1)\n+?is(arg1):+playDialogue("Guide", "Good")\n' }],
      });
    });
    await expectDiagnostics({ [firstUri]: [] }, () => {
      connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: firstUri, version: 8 },
        contentChanges: [{ text: '@with_args(arg1)\n+?is([arg1]):+playDialogue("Guide", "Good")\n' }],
      });
    });

    const shadows = await expectDiagnostics({ [firstUri]: ['parameter-literal-shadowing', 'local-global-confusion', 'local-global-confusion', 'local-global-confusion'] }, () => {
      connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: firstUri, version: 9 },
        contentChanges: [{ text: '@with_args(arg1, true)\n+arg1=1\n+setStorage(arg1, 2)\n+:target(arg1)\n' }],
      });
    });
    assert(shadows.get(firstUri).every(d => d.severity === 2));
    await expectDiagnostics({ [firstUri]: [] }, () => {
      connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: firstUri, version: 10 },
        contentChanges: [{ text: '@with_args(arg1, is_enabled)\n+global=1\n+setStorage(global, 2)\n+:target([arg1])\n' }],
      });
    });

    await expectDiagnostics({ [firstUri]: [] }, () => {
      connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: firstUri, version: 11 },
        contentChanges: [{ text: '@bare_else\n+?is(flag):+playDialogue("Guide", "Yes")\n+?else:{\n+playDialogue("Guide", "No")\n}\n' }],
      });
    });

    await connection.sendRequest('shutdown');
    connection.sendNotification('exit');
    console.log('Duplicate-name, unknown-script, and local/global diagnostics refresh on unsaved edits, buffer close, and watched file creation/change/deletion passed.');
  } finally {
    connection.dispose();
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
