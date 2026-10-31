import { MarkupContent } from 'vscode-languageserver';
import { getCommandsMetadata, getCurrentParser } from '../generics';
import {
  DEFAULT_SCENE_COMMANDS_PATH,
  resolveSceneCommandsFileOnDisk,
  resolveWorkspacePath,
} from '../paths';
import { getCurrentSettings } from '../settings';
import { logger } from '../logger';
import { getSceneCommands } from './commands';
import { ScriptParser, storageAssignmentPattern } from './rpgscript';

export const getStorageAssignmentHover = (
  line: string,
  character: number
): MarkupContent | undefined => {
  let offset = line.length - line.trimStart().length;
  let source = line.slice(offset);
  if (source.startsWith('+')) {
    source = source.slice(1);
    offset++;
  }

  const parser = new ScriptParser('hover');
  try {
    const { endIndex } = parser.getConditionalFromLine(source, 1);
    source = source.slice(endIndex);
    offset += endIndex;
    const leadingSpace = source.length - source.trimStart().length;
    source = source.trimStart();
    offset += leadingSpace;
    if (source.startsWith('+')) {
      source = source.slice(1);
      offset++;
    }
    source = source.trimEnd();
    const assignment = storageAssignmentPattern.exec(source);
    const start = offset - (line[offset - 1] === '+' ? 1 : 0);
    if (!assignment || character < start || character >= offset + source.length) {
      return;
    }
    // Use the parser's validation so incomplete edits do not show a misleading call.
    parser.parseCommand(source, 1);
    const value = assignment[2].replace(/;$/, '').trim();
    const local = assignment[1].startsWith('[');
    return {
      kind: 'markdown',
      value: [
        local ? 'Local Assignment' : 'Storage Assignment',
        '```rpgscript',
        local ? `setLocal(${assignment[1].slice(1, -1)}, ${value})` : `setStorage(${assignment[1]}, ${value})`,
        '```',
      ].join('\n'),
    };
  } catch {
    return;
  }
};

const isSceneCommand = (str: string) => {
  return str[0] === '+' && str[1] !== ':';
};

const isScriptCall = (str: string) => {
  return str[0] === '+' && str[1] === ':';
};

const isPlayDialogueLine = (str: string) => {
  return str[str.length - 1] === ':';
};

export const getHoverContents = (word: string) => {
  if (!word) {
    return;
  }

  const settings = getCurrentSettings();
  const configuredPath = resolveWorkspacePath(
    settings.sceneCommandsPath ?? DEFAULT_SCENE_COMMANDS_PATH
  );
  const sceneCommandsSrcFile =
    resolveSceneCommandsFileOnDisk(configuredPath) ?? configuredPath;

  logger.log('Hover', word);

  if (isSceneCommand(word)) {
    getSceneCommands();
    const commandName =
      word.slice(1).split('(')[0]?.trim() ?? word.slice(1);
    const metadata = getCommandsMetadata().find(
      (m) => m.name === commandName
    );

    if (!metadata) {
      return;
    }

    const doc: MarkupContent = {
      kind: 'markdown',
      value: [
        'Scene Command',
        '```typescript',
        commandName + '(' + metadata.args.join(', ') + ')',
        '```',
        sceneCommandsSrcFile + ':' + metadata.lineNum,
      ].join('\n'),
    };

    return doc;
  } else if (isScriptCall(word)) {
    const parser = getCurrentParser();
    const name = word.slice(2).split('(')[0].trim();
    const script = parser?.getScripts()?.[name];

    if (!script) {
      const doc: MarkupContent = {
        kind: 'markdown',
        value: [
          'Unknown Script Call',
          '```rpgscript',
          '@' + name,
          '```',
        ].join('\n'),
      };
      return doc;
    }

    const doc: MarkupContent = {
      kind: 'markdown',
      value: [
        'Script Call',
        '```rpgscript',
        '@' + name + '(' + script.parameters.join(', ') + ')',
        '```',
        script.filename + ':' + script.lineNum,
      ].join('\n'),
    };

    return doc;
  } else if (isPlayDialogueLine(word)) {
    const doc: MarkupContent = {
      kind: 'markdown',
      value: [
        'Play Dialogue',
        '```',
        'speaker: ' + word.slice(0, -1),
        '```',
      ].join('\n'),
    };

    return doc;
  }

  return;
};
