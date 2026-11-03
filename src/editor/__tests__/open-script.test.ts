import { describe, expect, it } from 'vitest';
import { openScriptWithDefaultApp, scriptOpenCommand } from '../open-script.js';
import { AssetStore } from '../store.js';

describe('opening a script in the OS', () => {
  it('passes a file path as an argument without a shell', () => {
    const file = 'C:\\projects with spaces\\scripts\\room.rpgscript';
    expect(scriptOpenCommand(file, 'win32')).toEqual({ command: 'explorer.exe', args: [file] });
    expect(scriptOpenCommand(file, 'darwin')).toEqual({ command: 'open', args: [file] });
    expect(scriptOpenCommand(file, 'linux')).toEqual({ command: 'xdg-open', args: [file] });
  });

  it('rejects invalid and missing scripts before launching an app', async () => {
    const store = new AssetStore('nonexistent-assets');
    await expect(openScriptWithDefaultApp(store, '../outside')).rejects.toThrow();
    await expect(openScriptWithDefaultApp(store, 'missing')).rejects.toThrow();
  });
});
