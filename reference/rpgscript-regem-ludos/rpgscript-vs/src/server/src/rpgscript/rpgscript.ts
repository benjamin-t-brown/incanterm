import { logger } from '../logger';
import { parseScriptSignature } from './script-signature';

type Scene = any;

export const storageAssignmentPattern =
  /^([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*|\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\}|\[[A-Za-z_][\w-]*\])\s*=\s*(.*)$/;

// Code above this line exists for compatibility. Keep script-call reference
// tracking below: the language server uses it for project-wide diagnostics.

// Take care blindly pasting the parser stuff into this file, it has a few customizations
// that, if removed, will break the lsp

const sceneHasCommand = (scene: Scene, k: string) => {
  return scene.commands.includes(k);
};

function splitNotInParens(str: string, spl: string) {
  const ret: string[] = [];
  let agg = '';
  let quote = '';
  let ignore = false;
  let ignoreViaQuotes = false;
  let numOpenParen = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (quote) {
      if (ch === quote) {
        quote = '';
        ignoreViaQuotes = false;
      }
    } else if (ch === `"` || ch === `'`) {
      quote = ch;
      ignoreViaQuotes = true;
    } else if (ch === '(') {
      ignore = true;
      numOpenParen++;
    } else if (ch === ')') {
      numOpenParen--;
      if (numOpenParen === 0) {
        ignore = false;
      }
    }

    if (!ignore && !ignoreViaQuotes && str[i] === spl) {
      ret.push(agg);
      agg = '';
    } else {
      agg += ch;
    }
  }
  if (agg) {
    ret.push(agg);
  }
  return ret;
}

function indexOfNotInParens(str: string, spl: string) {
  let quote = '';
  let ignore = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (quote) {
      if (ch === quote) {
        quote = '';
        ignore = false;
      }
    } else if (ch === `"` || ch === `'`) {
      quote = ch;
      ignore = true;
    } else if (ch === '(') {
      ignore = true;
    } else if (ch === ')') {
      ignore = false;
    }

    if (!ignore && str[i] === spl) {
      return i;
    }
  }
  return -1;
}

function removeQuotes(args: (string | Object)[]) {
  return args.map(arg => {
    if (typeof arg === 'object') {
      return arg;
    }

    if (arg[0] === '"' || arg[0] === "'") {
      return arg.slice(1, -1);
    } else {
      return arg;
    }
  });
}

export function formatArgs(args: (string | Object)[]) {
  return removeQuotes(args).map(arg => {
    if (typeof arg === 'object') {
      return arg;
    }

    const parsedFloat = parseFloat(arg);
    if (!isNaN(parsedFloat)) {
      if (String(parsedFloat).length === arg.length) {
        return parsedFloat;
      } else {
        return arg;
      }
    } else {
      return arg;
    }
  });
}

export enum TriggerType {
  STEP = 'step',
  STEP_FIRST = 'step-first',
  STEP_OFF = 'step-off',
  ACTION = 'action',
  LOAD = 'load',
  ITEM = 'item',
}

export interface ScriptCall {
  type: string;
  condition: any;
  scriptName: string;
}

export interface Conditional {
  type: string;
  args: any[];
}

export interface Command {
  i: number;
  conditional?: Conditional | boolean;
  type: string;
  args: (
    | string
    | number
    | boolean
    | { storageKey: string }
    | { localName: string }
    | {
        text: string;
        target: any;
      }
  )[];
}

export type CommandWithBlock = Command & { block: CommandBlock };

export interface CommandBlock {
  conditional: Conditional | boolean;
  commands: Command[];
  conditionalResult?: boolean;
}

export class Trigger {
  name: string;
  filename: string;
  lineNum: number;
  scriptCalls: ScriptCall[];
  x = 0;
  y = 0;

  constructor(name: string, filename: string, lineNum: number) {
    this.name = name;
    this.filename = filename;
    this.lineNum = lineNum;
    this.scriptCalls = [];
  }

  addScriptCall(triggerType: string, condition: any, scriptName: string) {
    this.scriptCalls.push({
      type: triggerType,
      condition: condition,
      scriptName: scriptName,
    });
  }
}

export class Script {
  name: string;
  parameters: string[];
  filename: string;
  lineNum: number;
  blocks: CommandBlock[];
  soundNameStorage: Record<string, string>;
  currentBlockIndex: number;
  currentCommandIndex: number;
  sounds: number;
  soundsPerCharacter: Record<string, number>;

  constructor(name: string, filename: string, lineNum: number, parameters: string[] = []) {
    this.name = name;
    this.parameters = parameters;
    this.filename = filename;
    this.lineNum = lineNum;
    this.blocks = [];

    this.soundNameStorage = {};

    this.currentBlockIndex = 0;
    this.currentCommandIndex = 0;
    this.sounds = 0;
    this.soundsPerCharacter = {};
  }

  reset() {
    this.currentBlockIndex = 0;
    this.currentCommandIndex = 0;
    this.blocks.forEach(block => {
      block.conditionalResult = undefined;
    });
  }

  breakScript() {
    this.currentBlockIndex = Infinity;
    this.currentCommandIndex = Infinity;
  }

  breakBlock() {
    this.currentCommandIndex = Infinity;
  }

  isValid(scene: Scene) {
    if (!scene) {
      return {};
    }
    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i];
      for (let j = 0; j < block.commands.length; j++) {
        const command = block.commands[j];
        if (command.type[0] !== ':' && !sceneHasCommand(scene, command.type)) {
          return {
            msg:
              `No command exists with name "${command.type}" ` +
              `and args "${command.args.join(',')}" `,
            lineNum: command.i,
          };
        }
      }
    }
    return {};
  }

  getNextCommand(): CommandWithBlock | null {
    const block = this.blocks[this.currentBlockIndex];
    if (block) {
      const cmd = block.commands[this.currentCommandIndex];
      if (cmd) {
        this.currentCommandIndex++;
        const ret = {
          i: this.currentBlockIndex,
          args: cmd.args,
          type: cmd.type,
          conditional: block.conditional,
          block,
        };
        return ret;
      } else {
        this.currentBlockIndex++;
        this.currentCommandIndex = 0;
        return this.getNextCommand();
      }
    } else {
      return null;
    }
  }

  getNextDialog(actorName: string) {
    if (this.soundsPerCharacter[actorName]) {
      this.soundsPerCharacter[actorName]++;
    } else {
      this.soundsPerCharacter[actorName] = 1;
    }
    let n: number | string = this.soundsPerCharacter[actorName];
    if (n < 10) {
      n = '0' + n;
    }
    const soundNameIndexed = this.name + '/' + this.sounds;
    const soundNameCh = this.name + '/' + actorName + '-' + n;

    this.sounds++;
    return { soundNameIndexed, soundNameCh, n };
  }

  addCommandBlock(): CommandBlock {
    const block = {
      conditional: true,
      commands: [],
    };
    this.blocks.push(block);
    return block;
  }
}

export class ScriptParser {
  name: string;
  soundsToLoad: any[];
  constructor(name: string) {
    this.name = name;
    this.soundsToLoad = [];
  }

  throwParsingError(err: string, lineNum: number, lineContents: string) {
    const error = `{Line ${
      lineNum === -1 ? 0 : lineNum
    }} Script parsing error ${
      this.name
    }: ${err} CONTENTS [\n"${lineContents}"\n]`;
    logger.error(error);
    throw new Error(error);
  }

  parseCommand(commandSrc: string, lineNum: number, script?: Script): Command {
    commandSrc = commandSrc.trim();

    // Keep assignment syntax aligned with Incanterm's runtime parser.
    const assignment = storageAssignmentPattern.exec(commandSrc);
    if (assignment) {
      const value = assignment[2].replace(/;$/, '').trim();
      if (!/^(?:"[^"]*"|'[^']*'|\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\}|[^\s,;=(){}"']+)$/.test(value)) {
        this.throwParsingError('Invalid storage assignment, expected one value', lineNum, commandSrc);
      }
      commandSrc = assignment[1].startsWith('[')
        ? `setLocal(${assignment[1].slice(1, -1)}, ${value})`
        : `setStorage(${assignment[1]}, ${value})`;
    }

    // shorthand for callScript(scriptName, ...args)
    if (commandSrc[0] === ':') {
      const src = commandSrc.slice();
      const indFirstOpen = src.indexOf('(');
      const indLastClose = src.lastIndexOf(')');
      if (indFirstOpen === -1) {
        this.throwParsingError(
          `Invalid callScript shorthand, no open paren.'`,
          lineNum,
          commandSrc
        );
      }
      if (indLastClose === -1) {
        this.throwParsingError(
          `Invalid callScript shorthand, no close paren.'`,
          lineNum,
          commandSrc
        );
      }
      const scriptName = src.slice(1, indFirstOpen);
      const scriptArgs = src.slice(indFirstOpen + 1, indLastClose).trim();
      commandSrc = `callScript(${scriptName}${scriptArgs ? ',' + scriptArgs : ''});`;
    }

    const firstParenIndex = commandSrc.indexOf('(');
    const lastParenIndex = commandSrc.lastIndexOf(')');

    if (commandSrc.match(/^(\w)+:/) && script) {
      return this.createDialogCommand(commandSrc, script, lineNum);
    }

    if (firstParenIndex === -1 || firstParenIndex === 0) {
      this.throwParsingError(
        'Invalid command, no name provided',
        lineNum,
        commandSrc
      );
    }
    if (lastParenIndex === -1 || lastParenIndex === 0) {
      this.throwParsingError(
        'Invalid command, no end parens',
        lineNum,
        commandSrc
      );
    }

    let args: string | string[] = commandSrc.substr(
      firstParenIndex + 1,
      commandSrc.length -
        (firstParenIndex + 1) -
        (commandSrc.length - lastParenIndex)
    );
    args = splitNotInParens(args, ',').map(arg => arg.trim());
    args.forEach(arg => {
      if (arg[0] === "'") {
        if (arg[arg.length - 1] !== "'") {
          this.throwParsingError(
            'Invalid command, unterminated single quote "\'"',
            lineNum,
            commandSrc
          );
        }
      } else if (arg[0] === '"') {
        if (arg[arg.length - 1] !== '"') {
          this.throwParsingError(
            "Invalid command, unterminated double quote '\"'",
            lineNum,
            commandSrc
          );
        }
      }
    });

    const type = commandSrc.substr(0, firstParenIndex);
    const formattedArgs = formatArgs(args) as Command['args'];
    if (type === 'callScript' || type === 'setLocal') {
      for (let index = 1; index < args.length; index++) {
        const arg = args[index];
        if (arg.startsWith('"') || arg.startsWith("'")) formattedArgs[index] = arg.slice(1, -1);
        else if (arg === 'true' || arg === 'false') formattedArgs[index] = arg === 'true';
      }
    }
    if (['setStorage', 'setLocal', 'callScript', 'is', 'isnot', 'eq', 'gt', 'lt'].includes(type)) {
      const indices = args.map((_, index) => index).filter(index =>
        index > 0 || (type !== 'callScript' && type !== 'setLocal'));
      for (const index of indices) {
        if (args[index]?.startsWith('[')) {
          const local = /^\[([A-Za-z_][\w-]*)\]$/.exec(args[index]);
          if (!local) this.throwParsingError('Invalid local reference', lineNum, commandSrc);
          else formattedArgs[index] = { localName: local[1] };
          continue;
        }
        if (!args[index]?.startsWith('{')) continue;
        const reference = /^\{([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\}$/.exec(args[index]);
        if (!reference) {
          this.throwParsingError('Invalid storage reference', lineNum, commandSrc);
        } else {
          formattedArgs[index] = { storageKey: reference[1] };
        }
      }
    }
    if (type === 'callScript' && typeof formattedArgs[0] === 'string') {
      this.recordScriptCall(formattedArgs[0], lineNum, formattedArgs.length - 1);
    }
    return {
      i: lineNum,
      type,
      args: formattedArgs,
    };
  }

  private recordScriptCall(scriptName: string, lineNum: number, argCount = 0) {
    currentParser?.callScriptStrings.push({
      scriptName: scriptName.trim(),
      lineNum,
      fileName: this.name,
      argCount,
    });
  }

  parseConditional(
    conditionalSrc: string,
    lineNum: number,
    script?: Script
  ): Conditional | boolean {
    if (conditionalSrc.trim() === 'else') conditionalSrc = 'else()';
    const { type, args } = this.parseCommand(conditionalSrc, lineNum, script);
    const validTypes = [
      'is',
      'isnot',
      'gt',
      'lt',
      'eq',
      'any',
      'all',
      'else',
      'as',
      'once',
      'oncePerInstance',
      'with',
      'func',
    ];
    if (!validTypes.includes(type)) {
      this.throwParsingError(
        `Invalid conditional, no type named "${type}"`,
        lineNum,
        conditionalSrc
      );
    }

    return {
      type: type,
      args: args.map(arg => {
        if (
          typeof arg === 'string' &&
          type !== 'func' &&
          arg.indexOf('(') !== -1
        ) {
          return this.parseConditional(arg, lineNum, script);
        } else {
          return arg;
        }
      }),
    };
  }

  combineConditionals(
    c1: Conditional | boolean,
    c2: Conditional | boolean,
    type: string
  ): Conditional {
    return {
      type,
      args: [c1, c2],
    };
  }

  createAllConditional(...args: (Conditional | boolean)[]): Conditional {
    if (args.length === 1) {
      return args[0] as Conditional;
    }

    return {
      type: 'all',
      args: [...args],
    };
  }

  getConditionalFromLine(
    line: string,
    lineNum: number,
    script?: Script
  ): {
    conditional: Conditional | boolean;
    endIndex: number;
  } {
    const conditionalStartIndex = indexOfNotInParens(line, '?');
    if (conditionalStartIndex > -1) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) {
        this.throwParsingError(
          `Invalid conditional, no ending ':'`,
          lineNum,
          line
        );
      }
      const conditionalSrc = line.slice(conditionalStartIndex + 1, colonIndex);
      const conditional = this.parseConditional(
        conditionalSrc.trim(),
        lineNum,
        script
      );
      return { conditional, endIndex: colonIndex + 1 };
    } else {
      return { conditional: true, endIndex: 0 };
    }
  }

  createDialogCommand(line: string, script: Script, lineNum: number): Command {
    const firstIndOfColon = line.indexOf(':');
    if (firstIndOfColon === -1) {
      this.throwParsingError(
        'Dialog command did not have a ":" character.',
        lineNum,
        line
      );
    }

    let actorName = line.slice(0, firstIndOfColon);
    let text = line.slice(firstIndOfColon + 1);
    let portraitEmotion = '';

    let type = 'playDialogue';
    if (actorName[0] === '_') {
      actorName = actorName.slice(1);
      type = 'playDialogueInterruptable';
    }

    const emotionParseIndex = actorName.indexOf('&');
    if (emotionParseIndex > -1) {
      portraitEmotion = actorName.slice(emotionParseIndex + 1);
      actorName = actorName.slice(0, emotionParseIndex);
    }

    text = text.trim();
    const { soundNameCh, soundNameIndexed, n } =
      script.getNextDialog(actorName);
    this.soundsToLoad.push({ soundNameCh, soundNameIndexed });
    return {
      i: parseInt(String(n)),
      type,
      args: formatArgs([
        { actorName, text, soundNameCh, portraitEmotion },
      ]) as any[],
    };
  }

  parseScriptNames(src: string) {
    const lines = src.split('\n');
    const scripts = {};
    let lastTriggerName = '';
    lines.forEach((line, lineNum) => {
      line = line.trim();
      if (line[0] === '#') {
        lastTriggerName = line.slice(1).trim();
      }
      if (line[0] === '@') {
        let signature: ReturnType<typeof parseScriptSignature>;
        try { signature = parseScriptSignature(line.slice(1)); } catch { return; }
        let scriptName = signature.name;
        if (scriptName === 'this') {
          scriptName = lastTriggerName;
        }
        scripts[scriptName] = new Script(scriptName, this.name, lineNum, signature.parameters);
      }
    });

    return scripts;
  }

  parse(src: string, scene: Scene) {
    const triggers: Record<string, Trigger> = {};
    const scripts: Record<string, Script> = {};

    const addTrigger = (n: string, s: Trigger) => (triggers[n] = s);
    const addScript = (n: string, s: Script) => (scripts[n] = s);

    let isCodeBlock = false;
    let isTrigger = false;
    let isChoice = false;
    let currentBlock: CommandBlock | null = null;
    let currentScript: Script | null = null;
    let currentTrigger: Trigger | null = null;
    let currentTriggerName: string | null = null;
    const conditionalStack: (Conditional | boolean)[] = [];
    const lines = src.split('\n');

    let lastValidLine = 0;
    lines.forEach((line: string, lineNum: number) => {
      lineNum = lineNum + 1;
      line = line.trim();
      if (line.length === 0) {
        return;
      }
      if (line[0] === '/' && line[1] === '/') {
        return;
      }
      lastValidLine = lineNum;

      const firstCh = line[0];
      if (line === '{') {
        isCodeBlock = true;
        conditionalStack.push(true);
      } else if (firstCh === '}') {
        isCodeBlock = false;
        currentBlock = null;
        conditionalStack.pop();
      } else if (firstCh === '@' && !isCodeBlock) {
        let signature: ReturnType<typeof parseScriptSignature>;
        try {
          signature = parseScriptSignature(line.slice(1));
        } catch (error) {
          this.throwParsingError((error as Error).message, lineNum, line);
          return;
        }
        let scriptName = signature.name;
        if (scriptName === 'this') {
          scriptName = currentTriggerName || '';
        }
        if (scriptName.length === 0) {
          this.throwParsingError('Invalid script name', lineNum, line);
        }
        if (currentScript) {
          const obj = currentScript.isValid(scene);
          const err = obj.msg;
          if (err) {
            this.throwParsingError(err, obj.lineNum ?? 0, '');
          }
        }
        currentScript = new Script(scriptName, this.name, lineNum, signature.parameters);
        addScript(scriptName, currentScript);
        isTrigger = false;
        isChoice = false;
      } else if (firstCh === '$') {
        isChoice = true;
        isTrigger = false;
        if (currentScript) {
          currentBlock = currentScript.addCommandBlock();
          currentBlock.conditional = true;
          currentBlock.commands.push({
            i: lineNum,
            type: 'showChoices',
            args: [],
          });
        }
      } else if (firstCh === '#') {
        isTrigger = true;
        isChoice = false;
        currentTriggerName = line.substr(1);
        currentTrigger = new Trigger(line.substr(1), this.name, lineNum);
        addTrigger(line.substr(1), currentTrigger);
      } else if (firstCh === '+' || isCodeBlock) {
        const commandContents = line.substr(isCodeBlock ? 0 : 1);
        if (currentScript) {
          const { conditional, endIndex } = this.getConditionalFromLine(
            commandContents,
            lineNum,
            currentScript
          );
          if (typeof conditional === 'object') {
            if (commandContents.slice(endIndex).trim() === '{') {
              conditionalStack.push(conditional);
              isCodeBlock = true;
              currentBlock = currentScript.addCommandBlock();
              currentBlock.conditional = this.createAllConditional(
                ...conditionalStack
              );
              return;
            } else if (endIndex === commandContents.length) {
              currentBlock = currentScript.addCommandBlock();
              currentBlock.conditional = conditional;
              return;
            }
          }

          let block: CommandBlock | null = null;
          if (isCodeBlock) {
            if (currentBlock === null) {
              currentBlock = currentScript.addCommandBlock();
              currentBlock.conditional = conditional;
            }
            block = currentBlock;
          } else {
            block = currentBlock = currentScript.addCommandBlock();
            currentBlock.conditional = this.createAllConditional(
              ...[conditional, ...conditionalStack]
            );
            // block.conditional = conditional;
          }

          let commandSrc = commandContents.substr(endIndex);
          const isDialog = /(.*): "(.*)"/.test(commandSrc);
          if (commandSrc[0] === '?') {
            this.throwParsingError(
              `Invalid conditional, did you forget '+' at the start?`,
              lineNum,
              line
            );
            return;
          }

          if (commandSrc[0] === '+') {
            commandSrc = commandSrc.slice(1);
            // console.log('cmd src', commandSrc);
            // if (commandSrc[0] === ':') {
            //   let src = commandSrc;
            //   const indFirstOpen = src.indexOf('(');
            //   const indLastClose = src.lastIndexOf(')');
            //   if (indFirstOpen === -1) {
            //     this.throwParsingError(
            //       `Invalid callScript shorthand, no open paren.'`,
            //       lineNum,
            //       line
            //     );
            //   }
            //   if (indLastClose === -1) {
            //     this.throwParsingError(
            //       `Invalid callScript shorthand, no close paren.'`,
            //       lineNum,
            //       line
            //     );
            //   }
            //   // :jump(ada, bob);
            //   let scriptName = src.slice(1, indFirstOpen);
            //   let scriptArgs = src
            //     .slice(indFirstOpen + 1, indLastClose)
            //     .split(',');
            //   const args = src.split(',').slice(1);
            //   commandSrc = `callScript(${scriptName},${scriptArgs.join(',')})`;
            //   console.log('created a shorthand callScript', commandSrc);
            // }
          } else if (isDialog) {
            const command = this.createDialogCommand(
              commandSrc,
              currentScript,
              lineNum
            );
            block.commands.push(command);
            return;
          }

          const { type, args } = this.parseCommand(
            commandSrc,
            lineNum,
            currentScript
          );
          const command = {
            i: lineNum,
            type,
            args,
          };
          block.commands.push(command);
        }
      } else if (isChoice) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
          this.throwParsingError(
            `Invalid choice definition, no colon '"'`,
            lineNum,
            line
          );
        }
        const choiceText = line.substr(0, colonIndex);
        const target = line.substr(colonIndex + 1);
        if (currentBlock) {
          currentBlock.commands[0].args.push({
            text: choiceText,
            target: target,
          });
          this.recordScriptCall(target, lineNum);
        }
      } else if (isTrigger) {
        const firstCommaIndex = line.indexOf(',');
        if (firstCommaIndex === -1) {
          this.throwParsingError(
            `Invalid trigger script call, invalid number of arguments`,
            lineNum,
            line
          );
        }
        const triggerType = line.substr(0, firstCommaIndex) as TriggerType;
        let triggerContents = line.substr(firstCommaIndex + 1);
        let itemConditional: Conditional | null = null;
        if (triggerType === 'item') {
          const itemName = triggerContents.slice(
            0,
            triggerContents.indexOf(',')
          );
          itemConditional = {
            type: 'with',
            args: [itemName],
          };
          triggerContents = triggerContents.slice(
            triggerContents.indexOf(',') + 1
          );
        }

        const { conditional: localConditional, endIndex } =
          this.getConditionalFromLine(
            triggerContents,
            lineNum,
            currentScript as Script | undefined
          );
        let conditional = localConditional;
        if (itemConditional) {
          conditional = this.combineConditionals(
            itemConditional,
            localConditional,
            'all'
          );
        }

        let scriptName = triggerContents.substr(endIndex);
        if (scriptName === 'this' && currentTriggerName) {
          scriptName = currentTriggerName;
        }
        if (currentTrigger) {
          currentTrigger.addScriptCall(triggerType, conditional, scriptName);
          this.recordScriptCall(scriptName, lineNum);
        }
      } else if (firstCh === '>') {
        if (currentBlock) {
          currentBlock.commands.push({
            i: lineNum,
            type: 'callScript',
            args: [line.substr(1)],
          });
          this.recordScriptCall(line.substr(1), lineNum);
        }
      } else {
        isTrigger = false;
        if (currentScript) {
          if (line[0] === '?') {
            this.throwParsingError(
              `Invalid conditional, did you forget '+' at the start?`,
              lineNum,
              line
            );
            return;
          }

          const block = currentScript.addCommandBlock();
          if (conditionalStack.length) {
            block.conditional = this.createAllConditional(
              ...[true, ...conditionalStack]
            );
          }
          const command = this.createDialogCommand(
            line,
            currentScript,
            lineNum
          );
          block.commands.push(command);
        }
      }
    });
    if (currentScript) {
      const obj = (currentScript as Script).isValid(scene);
      const err = obj?.msg;
      if (err) {
        this.throwParsingError(err, obj.lineNum ?? 0, lines[lines.length - 1]);
      }
    }
    return { triggers, scripts };
  }
}

// -- STOP COPY HERE --

// lame
let currentParser: any;

export class RPGScriptParser {
  scripts: Record<string, Script> = {};
  triggers: Record<string, Trigger> = {};
  callScriptStrings: {
    scriptName: string;
    lineNum: number;
    fileName: string;
    argCount: number;
  }[] = [];
  scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  parse(scriptName: string, scriptSrc: string) {
    currentParser = this;
    try {
      parseRPGScript(scriptName, scriptSrc, this.scene, this);
    } catch (e) {
      const parser = new ScriptParser(scriptName);
      const scripts = parser.parseScriptNames(scriptSrc);
      Object.assign(this.scripts, scripts);
      throw e;
    }
  }

  getScript = (scriptName: string): Script => {
    const script = this.scripts[scriptName];
    if (!script) {
      throw new Error(`Cannot get script with name ${scriptName}`);
    }
    return script;
  };

  getTrigger = (triggerName: string): Trigger => {
    const trigger = this.triggers[triggerName];
    if (!trigger) {
      throw new Error(`Cannot get trigger with name ${triggerName}`);
    }
    return trigger;
  };

  scriptExists = (scriptName: string) => {
    const script = this.scripts[scriptName];
    if (!script) {
      return false;
    }
    return true;
  };

  triggerExists = (triggerName: string) => {
    const trigger = this.triggers[triggerName];
    if (!trigger) {
      return false;
    }
    return true;
  };

  getScripts = () => this.scripts;
  getTriggers = () => this.triggers;
  getCallScriptStrings = () => this.callScriptStrings;
}

const parseRPGScript = (
  scriptName: string,
  scriptSrc: string,
  scene: Scene,
  globalParser: RPGScriptParser
) => {
  const parser = new ScriptParser(scriptName);
  const { triggers: localTriggers, scripts: localScripts } = parser.parse(
    scriptSrc,
    scene
  );

  Object.assign(globalParser.scripts, localScripts);
  Object.assign(globalParser.triggers, localTriggers);
};
