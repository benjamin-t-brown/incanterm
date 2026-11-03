import { LocationLink } from 'vscode-languageserver';
import { getCommandsMetadata, getCurrentParser } from '../generics';
import * as url from 'url';
import {
  DEFAULT_SCENE_COMMANDS_PATH,
  resolveSceneCommandsFileOnDisk,
  resolveWorkspacePath,
} from '../paths';
import { getCurrentSettings } from '../settings';
import { getSceneCommands } from './commands';

const isSceneCommand = (str: string) => {
  return str[0] === '+' && str[1] !== ':';
};

const isScriptCall = (str: string) => {
  return str[0] === '+' && str[1] === ':';
};

const isTriggerScriptCall = (str: string) => {
  return str.match(/^[\w-]+,\s*([\w-]+)(?:\s*,|\s*$)/)?.[1];
};

export const getDefinition = (line: string): LocationLink | undefined => {
  line = line.trim();
  if (!line) {
    return undefined;
  }
  const returnCall = /^\+(?:\[[A-Za-z_][\w-]*\]|[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\s*<\s*(\+:[\w-]+\s*\(.*)$/.exec(line);
  if (returnCall) line = returnCall[1];

  const settings = getCurrentSettings();
  const configuredScenePath = resolveWorkspacePath(
    settings.sceneCommandsPath ?? DEFAULT_SCENE_COMMANDS_PATH
  );
  const scenePathOnDisk =
    resolveSceneCommandsFileOnDisk(configuredScenePath) ?? configuredScenePath;
  const sceneCommandsSrcFileUri = url.pathToFileURL(scenePathOnDisk).href;

  const scriptNameFromTrigger = isTriggerScriptCall(line || '');

  if (isSceneCommand(line)) {
    getSceneCommands();
    const commandName =
      line.slice(1).split('(')[0]?.trim() ?? line.slice(1);
    const meta = getCommandsMetadata().find((m) => m.name === commandName);
    if (meta) {
      const range = {
        start: {
          line: meta.lineNum,
          character: 0,
        },
        end: {
          line: meta.lineNum,
          character: Number.MAX_VALUE,
        },
      };
      return {
        targetUri: sceneCommandsSrcFileUri,
        targetRange: range,
        targetSelectionRange: range,
      };
    }
  } else if (scriptNameFromTrigger || isScriptCall(line)) {
    const parser = getCurrentParser();
    if (!parser) {
      return undefined;
    }
    let i = line.indexOf('(');
    if (i === -1) {
      i = line.length;
    }
    const scriptName = scriptNameFromTrigger || line.slice(2, i).trim();
    const script = parser.getScripts()?.[scriptName];

    if (script) {
      const range = {
        start: {
          line: script.lineNum - 1,
          character: 0,
        },
        end: {
          line: script.lineNum - 1,
          character: Number.MAX_VALUE,
        },
      };
      return {
        targetUri: url.pathToFileURL(script.filename).toString(),
        targetRange: range,
        targetSelectionRange: range,
      };
    }
  }

  return undefined;
};
