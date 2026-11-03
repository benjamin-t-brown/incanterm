import { spawn } from 'node:child_process';
import path from 'node:path';
import { AssetError, type AssetStore } from './store.js';

export function scriptOpenCommand(
  file: string,
  platform = process.platform,
): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'explorer.exe', args: [file] };
  if (platform === 'darwin') return { command: 'open', args: [file] };
  return { command: 'xdg-open', args: [file] };
}

export async function openScriptWithDefaultApp(store: AssetStore, id: string): Promise<void> {
  await store.readScript(id); // Validate the id and require an existing .rpgscript file.
  const file = path.join(store.root, 'scripts', `${id}.rpgscript`);
  const { command, args } = scriptOpenCommand(file);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', () =>
      reject(new AssetError('Could not open script with the default app', 500)),
    );
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
