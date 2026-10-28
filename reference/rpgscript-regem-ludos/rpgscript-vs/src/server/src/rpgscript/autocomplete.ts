import { CompletionItemKind } from 'vscode-languageserver';
import { getCurrentParser } from '../generics';
import { logger } from '../logger';
import { getSceneCommands } from './commands';

const isLineSceneCommand = (line: string) => {
  line = line.trim();
  return line[0] === '+' && line[1] !== ':';
};

const isLineScriptCall = (line: string) => {
  line = line.trim();
  return line[0] === '+' && line[1] === ':';
};

export const getCompletionObjects = (word: string, line: string) => {
  logger.log('Get completion objects', word, line);

  if (isLineSceneCommand(line)) {
    const commands = getSceneCommands();
    const sceneCommands = commands
      .filter((commandName) => {
        return true;
      })
      .map((commandName) => {
        return {
          label: commandName,
          kind: CompletionItemKind.Method,
          data: 'sceneCommand',
        };
      });

    return sceneCommands;
  } else if (isLineScriptCall(line)) {
    const parser = getCurrentParser();
    const scripts = parser?.getScripts();

    const scriptCalls = Object.keys(scripts ?? {})
      .filter((scriptName) => {
        return scriptName.includes(line.slice(2));
      })
      .map((scriptName) => {
        return {
          label: scriptName,
          kind: CompletionItemKind.Function,
          data: 'scriptCall',
        };
      });

    return scriptCalls;
  }

  return [];
};
