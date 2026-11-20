import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'https://github.com/benjamin-t-brown/rpgscript-vs.git';
const revision = 'fe86077fd8bb66e87ce0ccc71ddec4da4e524e8c';
const triggerHeadersPatch = fileURLToPath(new URL('./rpgscript-vs-trigger-headers.patch', import.meta.url));
const output = fileURLToPath(new URL('../dist/rpgscript-vs.vsix', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script with npm run build:rpgscript-vs.');

const cwd = mkdtempSync(join(tmpdir(), 'rpgscript-vs-'));
const options = { cwd, stdio: 'inherit' };
try {
  execFileSync('git', ['init', '--quiet'], options);
  execFileSync('git', ['fetch', '--depth=1', repository, revision], options);
  execFileSync('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], options);
  execFileSync('git', ['apply', '--whitespace=error', triggerHeadersPatch], options);
  execFileSync(process.execPath, [npm, 'ci'], options);
  mkdirSync(dirname(output), { recursive: true });
  execFileSync(process.execPath, [npm, 'run', 'package:vsix', '--', '--out', output], options);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
