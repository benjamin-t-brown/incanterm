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
    const script = parser?.getScripts()?.[word.slice(2)];

    if (!script) {
      const doc: MarkupContent = {
        kind: 'markdown',
        value: [
          'Unknown Script Call',
          '```rpgscript',
          '@' + word.slice(2),
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
        '@' + word.slice(2),
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
