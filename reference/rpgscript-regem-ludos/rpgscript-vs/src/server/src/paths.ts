import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { getBaseSettings } from './settings';

export const DEFAULT_SCRIPTS_ROOT = '${workspaceFolder}/src';
export const DEFAULT_SCENE_COMMANDS_PATH =
  '${workspaceFolder}/src/scene-commands.ts';

/**
 * Turn `rpgscript.*` path settings into a filesystem path after
 * `${workspaceFolder}` substitution. VS Code gives `workspaceFolders[].uri` as a
 * `file:` URL; older defaults used plain paths like `/src`, which must not be
 * passed to url.fileURLToPath (that API only accepts file URLs).
 */
export function resolveWorkspacePath(raw: string | undefined): string {
  const rootUri = getBaseSettings().rootPath ?? '';
  const s = (raw ?? '').replace(/\${workspaceFolder}/g, rootUri);

  if (!s.trim()) {
    return s;
  }

  if (s.startsWith('file:')) {
    return url.fileURLToPath(s);
  }

  const workspaceFs =
    rootUri && rootUri.startsWith('file:')
      ? url.fileURLToPath(rootUri)
      : '';

  if (path.isAbsolute(s)) {
    // On Windows, a single leading "/" (e.g. legacy default "/src") is not an
    // absolute filesystem path; treat it as workspace-relative.
    if (
      process.platform === 'win32' &&
      s.startsWith('/') &&
      !s.startsWith('//') &&
      workspaceFs
    ) {
      return path.join(workspaceFs, s.replace(/^\/+/, ''));
    }
    return path.normalize(s);
  }

  if (workspaceFs) {
    return path.join(workspaceFs, s);
  }

  return path.normalize(s);
}

/**
 * Picks an existing scene-commands module on disk. If the configured path is
 * missing, tries the sibling `.js` / `.ts` so workspaces that only ship
 * `scene-commands.js` (or compiled output) still work.
 */
export function resolveSceneCommandsFileOnDisk(
  resolvedPath: string
): string | null {
  if (!resolvedPath.trim()) {
    return null;
  }
  if (fs.existsSync(resolvedPath)) {
    return resolvedPath;
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const base = ext ? resolvedPath.slice(0, -ext.length) : resolvedPath;

  if (ext === '.ts' || ext === '.tsx') {
    const js = `${base}.js`;
    if (fs.existsSync(js)) {
      return js;
    }
  }
  if (ext === '.js' || ext === '.cjs') {
    const ts = `${base}.ts`;
    if (fs.existsSync(ts)) {
      return ts;
    }
  }
  if (!ext) {
    const ts = `${resolvedPath}.ts`;
    const js = `${resolvedPath}.js`;
    if (fs.existsSync(ts)) {
      return ts;
    }
    if (fs.existsSync(js)) {
      return js;
    }
  }
  return null;
}
