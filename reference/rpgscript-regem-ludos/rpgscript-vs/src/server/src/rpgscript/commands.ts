import { CompletionItemKind } from 'vscode-languageserver';
import { getCurrentSettings } from '../settings';
import {
  DEFAULT_SCENE_COMMANDS_PATH,
  resolveSceneCommandsFileOnDisk,
  resolveWorkspacePath,
} from '../paths';
import * as fs from 'fs';
import { logger } from '../logger';
import {
  getCommands,
  SceneCommandMetadata,
  setCommands,
  setCommandsMetadata,
} from '../generics';

const findLineNum = (lines: string[], str: string) => {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(str) > -1) {
      return i;
    }
  }
  return -1;
};

/**
 * Reads argument names from a `const name = defineCommand({ parse: ... })` block. Names come from
 * the object keys that `parse` builds from `args[N]`; a key whose line also checks `args.length`
 * (e.g. `ms: args.length >= 3 ? ... args[2] ...`) is optional and shown as `?name`.
 */
export const getDefineCommandArgs = (
  lines: string[],
  lineNum: number
): string[] => {
  const names: string[] = [];
  for (let i = lineNum + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:export\s+)?(?:const|function)\s/.test(line) || /^\}\);?\s*$/.test(line)) {
      break;
    }
    if (/^\s*execute\s*:/.test(line)) {
      break;
    }
    for (const m of line.matchAll(/(\w+)\s*:\s*([^,]*?)\bargs\[(\d+)\]/g)) {
      const optional = m[2].includes('args.length') || /args\.length\s*[>=]/.test(line);
      names[Number(m[3])] = (optional ? '?' : '') + m[1];
    }
  }
  return Array.from(names, (name, i) => name ?? `arg${i}`);
};

export const getSceneCommands = (fetchAnyway?: boolean) => {
  if (!fetchAnyway) {
    const savedCommands = getCommands();
    if (savedCommands !== undefined) {
      return savedCommands;
    }
  }

  const settings = getCurrentSettings();

  const configuredPath = resolveWorkspacePath(
    settings.sceneCommandsPath ?? DEFAULT_SCENE_COMMANDS_PATH
  );

  const sceneCommandsSrcFile =
    resolveSceneCommandsFileOnDisk(configuredPath) ?? configuredPath;

  if (!sceneCommandsSrcFile || !fs.existsSync(sceneCommandsSrcFile)) {
    logger.log(
      'Scene commands file not found (tried .ts / .js): ',
      configuredPath
    );
    return [];
  }

  logger.log('Read scene commands file: ', sceneCommandsSrcFile);
  const sceneCommandsFile = fs.readFileSync(sceneCommandsSrcFile).toString();

  const assignMatch = sceneCommandsFile.match(
    /\bexports\.commands\s*=\s*\{/
  );
  const declMatch = sceneCommandsFile.match(
    /\b(?:export\s+)?(?:const|let|var)\s+commands\s*=\s*\{/
  );
  const m = declMatch ?? assignMatch;
  if (!m || m.index === undefined) {
    logger.log('No commands = { block in scene commands file');
    return [];
  }
  const innerStart = m.index + m[0].length;
  const ii = sceneCommandsFile.slice(innerStart).search(/}/);
  const commands = sceneCommandsFile
    .slice(innerStart, innerStart + ii)
    .replace(/\s/g, '')
    .replace(/\n/g, '')
    .split(',')
    .slice(0, -1);

  logger.log('Commands', innerStart, ii, commands.join(','));
  setCommands(commands);

  const lines = sceneCommandsFile.split('\n');
  const commandsMetadata: SceneCommandMetadata[] = commands.map((name) => {
    const lineNum = findLineNum(lines, `const ${name} = `);
    let args: string[] = [];
    if (lineNum > -1 && /=\s*defineCommand\s*\(/.test(lines[lineNum])) {
      args = getDefineCommandArgs(lines, lineNum);
    } else if (lineNum > -1) {
      let offset = 9;
      if (lines[lineNum].includes('export')) {
        offset += 6;
      }
      let agg = lines[lineNum].slice(offset + name.length);
      const ind = agg.indexOf('=> {');
      if (ind > -1) {
        agg = agg.slice(0, ind);
      } else {
        for (let i = 1; i < 10; i++) {
          const line = lines[lineNum + i];
          const ind = line.indexOf('=> {');
          if (ind > -1) {
            agg += line.slice(0, ind);
            break;
          } else {
            agg += line;
          }
        }
      }

      args = agg.replace(/\s/g, '').replace(/\n/g, '').slice(1, -1).split(',');
      if (args[0] === '') {
        args = [];
      }
    }
    return {
      name,
      lineNum,
      args,
    };
  });
  setCommandsMetadata(commandsMetadata);

  return commands;
};
