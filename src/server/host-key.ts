import fs from 'node:fs';
import path from 'node:path';
import { utils } from './ssh2.js';

export function generateHostKey(): string {
  return utils.generateKeyPairSync('ed25519').private;
}

export function loadOrCreateHostKey(filePath: string): string {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  const key = generateHostKey();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, key, { encoding: 'utf8', mode: 0o600 });
  return key;
}
