// Adapted from reference/rpgscript-regem-ludos/src/lib/rpgscript.ts.
// Keep RPGScript syntax here; no browser globals, fetch, or original Scene runtime.
import { parseScriptSignature } from './signature.js';
import { isNumericExpression, validateNumericExpression } from './expression.js';

function splitNotInParens(str: string, spl: string) {
  const ret: string[] = [];
  let agg = '';
  let quote = '';
  let parenDepth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === `"` || ch === `'`) {
      quote = ch;
    } else if (ch === '(') {
      parenDepth++;
    } else if (ch === ')') {
      parenDepth--;
    }

    if (parenDepth === 0 && !quote && ch === spl) {
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
  let parenDepth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === `"` || ch === `'`) {
      quote = ch;
    } else if (ch === '(') {
      parenDepth++;
    } else if (ch === ')') {
      parenDepth--;
    }

    if (parenDepth === 0 && !quote && ch === spl) {
      return i;
    }
  }
  return -1;
}

function formatArgs(args: readonly string[]) {
  return args.map((arg) => {
    if (arg[0] === '"' || arg[0] === "'") arg = arg.slice(1, -1);
    const parsedFloat = parseFloat(arg);
    if (!Number.isNaN(parsedFloat)) {
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
  TIMER = 'timer',
  ITEM = 'item',
}

export interface ScriptCall {
  character?: string;
  intervalMs?: number;
  type: string;
  condition: Conditional | boolean;
  scriptName: string;
  line: number;
}

export interface Conditional {
  type: string;
  args: unknown[];
}

export type StorageReference = Readonly<{ storageKey: string }>;
export type LocalReference = Readonly<{ localName: string }>;
export type ScriptValue = string | number | boolean | StorageReference | LocalReference | Readonly<{ expression: string }>;

export type CommandArg =
  | ScriptValue
  | { actorName: string; text: string; portraitEmotion: string }
  | { text: string; target: string };

export interface Command {
  i: number;
  type: string;
  args: CommandArg[];
}

export interface CommandBlock {
  conditional: Conditional | boolean;
  commands: Command[];
}

export interface Trigger {
  name: string;
  filename: string;
  lineNum: number;
  scriptCalls: ScriptCall[];
  x: number;
  y: number;
}

export interface ParsedScript {
  name: string;
  parameters: string[];
  filename: string;
  lineNum: number;
  blocks: CommandBlock[];
}

function addCommandBlock(script: ParsedScript): CommandBlock {
  const block: CommandBlock = { conditional: true, commands: [] };
  script.blocks.push(block);
  return block;
}

export class ScriptParser {
  constructor(readonly name: string) {}

  throwParsingError(err: string, lineNum: number, lineContents: string) {
    throw new Error(`${this.name}:${lineNum}: ${err} (${lineContents})`);
  }

  parseCommand(commandSrc: string, lineNum: number, script?: ParsedScript): Command {
    commandSrc = commandSrc.trim();
    if (commandSrc.startsWith('<')) {
      const value = commandSrc.slice(1).replace(/;$/, '').trim();
      return this.parseCommand(`returnValue(${value})`, lineNum, script);
    }
    const returnAssignment = /^(\[[A-Za-z_][\w-]*\]|[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\s*<\s*\+(:.*)$/.exec(commandSrc);
    if (returnAssignment) {
      const local = returnAssignment[1].startsWith('[');
      const destination = local ? returnAssignment[1].slice(1, -1) : returnAssignment[1];
      const call = this.parseCommand(returnAssignment[2], lineNum, script);
      return { i: lineNum, type: 'callScriptResult', args: [destination, local, ...call.args] };
    }

    // Lower assignments before parsing calls so blocks and inline conditions use
    // the same storage/local commands as their long forms.
    const assignment =
      /^\^?([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*|\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\}|\[[A-Za-z_][\w-]*\])\s*=\s*(.*)$/.exec(
        commandSrc,
      );
    if (assignment) {
      const ifUndefined = commandSrc.startsWith('^');
      if (ifUndefined && assignment[1].startsWith('[')) {
        this.throwParsingError('Set-if-undefined assignments cannot target local variables', lineNum, commandSrc);
      }
      const value = assignment[2].replace(/;$/, '').trim();
      if (isNumericExpression(value)) {
        try {
          validateNumericExpression(value);
        } catch (error) {
          this.throwParsingError(`Invalid storage assignment: ${String(error)}`, lineNum, commandSrc);
        }
      }
      if (
        !isNumericExpression(value) && !/^(?:"[^"]*"|'[^']*'|\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\}|[^\s,;=(){}"']+)$/.test(
          value,
        )
      ) {
        this.throwParsingError(
          'Invalid storage assignment, expected one value',
          lineNum,
          commandSrc,
        );
      }
      commandSrc = assignment[1].startsWith('[')
        ? `setLocal(${assignment[1].slice(1, -1)}, ${value})`
        : `${ifUndefined ? 'setStorageIfUndefined' : 'setStorage'}(${assignment[1]}, ${value})`;
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
          commandSrc,
        );
      }
      if (indLastClose === -1) {
        this.throwParsingError(
          `Invalid callScript shorthand, no close paren.'`,
          lineNum,
          commandSrc,
        );
      }
      const scriptName = src.slice(1, indFirstOpen);
      const scriptArgs = src.slice(indFirstOpen + 1, indLastClose).trim();
      commandSrc = `callScript(${scriptName}${scriptArgs ? `,${scriptArgs}` : ''});`;
    }

    const firstParenIndex = commandSrc.indexOf('(');
    const lastParenIndex = commandSrc.lastIndexOf(')');

    if (commandSrc.match(/^(\w)+:/) && script) {
      return this.createDialogCommand(commandSrc, lineNum);
    }

    if (firstParenIndex === -1 || firstParenIndex === 0) {
      this.throwParsingError('Invalid command, no name provided', lineNum, commandSrc);
    }
    if (lastParenIndex === -1 || lastParenIndex === 0) {
      this.throwParsingError('Invalid command, no end parens', lineNum, commandSrc);
    }

    const args = splitNotInParens(commandSrc.slice(firstParenIndex + 1, lastParenIndex), ',').map(
      (arg) => arg.trim(),
    );
    args.forEach((arg) => {
      if (arg[0] === "'") {
        if (arg[arg.length - 1] !== "'") {
          this.throwParsingError(
            'Invalid command, unterminated single quote "\'"',
            lineNum,
            commandSrc,
          );
        }
      } else if (arg[0] === '"') {
        if (arg[arg.length - 1] !== '"') {
          this.throwParsingError(
            "Invalid command, unterminated double quote '\"'",
            lineNum,
            commandSrc,
          );
        }
      }
    });

    const type = commandSrc.substr(0, firstParenIndex);
    const formattedArgs: CommandArg[] = formatArgs(args);
    if (type === 'callScript' || type === 'setLocal' || type === 'returnValue') {
      for (let index = type === 'returnValue' ? 0 : 1; index < args.length; index++) {
        const arg = args[index];
        if (arg.startsWith('"') || arg.startsWith("'")) formattedArgs[index] = arg.slice(1, -1);
        else if (arg === 'true' || arg === 'false') formattedArgs[index] = arg === 'true';
      }
    }
    // References are language syntax for every command, including game-supplied commands.
    const indices = args
      .map((_, index) => index)
      .filter((index) => index > 0 || (type !== 'callScript' && type !== 'setLocal'));
    for (const index of indices) {
      if (isNumericExpression(args[index])) {
        try {
          validateNumericExpression(args[index]);
        } catch (error) {
          this.throwParsingError(String(error), lineNum, commandSrc);
        }
        formattedArgs[index] = { expression: args[index] };
        continue;
      }
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

    return {
      i: lineNum,
      type,
      args: formattedArgs,
    };
  }

  parseConditional(
    conditionalSrc: string,
    lineNum: number,
    script?: ParsedScript,
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
        conditionalSrc,
      );
    }

    return {
      type: type,
      args: args.map((arg) => {
        if (typeof arg === 'string' && type !== 'func' && arg.indexOf('(') !== -1) {
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
    type: string,
  ): Conditional {
    return {
      type,
      args: [c1, c2],
    };
  }

  createAllConditional(...args: (Conditional | boolean)[]): Conditional | boolean {
    if (args.length === 1) {
      return args[0];
    }

    return {
      type: 'all',
      args: [...args],
    };
  }

  getConditionalFromLine(
    line: string,
    lineNum: number,
    script?: ParsedScript,
  ): {
    conditional: Conditional | boolean;
    endIndex: number;
  } {
    const conditionalStartIndex = indexOfNotInParens(line, '?');
    if (conditionalStartIndex > -1) {
      const colonIndex = indexOfNotInParens(line, ':');
      if (colonIndex === -1) {
        this.throwParsingError(`Invalid conditional, no ending ':'`, lineNum, line);
      }
      const conditionalSrc = line.slice(conditionalStartIndex + 1, colonIndex);
      const conditional = this.parseConditional(conditionalSrc.trim(), lineNum, script);
      return { conditional, endIndex: colonIndex + 1 };
    } else {
      return { conditional: true, endIndex: 0 };
    }
  }

  createDialogCommand(line: string, lineNum: number): Command {
    const firstIndOfColon = line.indexOf(':');
    if (firstIndOfColon === -1) {
      this.throwParsingError('Dialog command did not have a ":" character.', lineNum, line);
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

    if ((text[0] === '"' || text[0] === "'") && text[text.length - 1] !== text[0]) {
      this.throwParsingError('Dialogue string is missing its closing quote', lineNum, line);
    }

    if (text[0] === '"' || text[0] === "'") {
      text = text.slice(1);
    }
    if (text[text.length - 1] === '"' || text[text.length - 1] === "'") {
      text = text.slice(0, -1);
    }

    return {
      i: lineNum,
      type,
      args: [{ actorName, text, portraitEmotion }],
    };
  }

  parse(src: string) {
    const triggers: Record<string, Trigger> = Object.create(null) as Record<string, Trigger>;
    const scripts: Record<string, ParsedScript> = Object.create(null) as Record<
      string,
      ParsedScript
    >;

    const addTrigger = (n: string, s: Trigger) => (triggers[n] = s);
    const addScript = (n: string, s: ParsedScript) => (scripts[n] = s);

    let isCodeBlock = false;
    let isTrigger = false;
    let isChoice = false;
    let currentBlock: CommandBlock | null = null;
    let currentScript: ParsedScript | null = null;
    let currentTrigger: Trigger | null = null;
    let currentTriggerName: string | null = null;
    let conditionalStack: (Conditional | boolean)[] = [];
    // The most recent unmatched conditional at each brace depth. `else()` refers
    // to its block index so its result cannot change when its body mutates storage.
    const previousBranch = new Map<number, number>();
    const lines = src.split('\n');

    lines.forEach((line: string, lineNum: number) => {
      lineNum = lineNum + 1;
      line = line.trim();
      if (line.length === 0) {
        return;
      }
      if (line[0] === '/' && line[1] === '/') {
        return;
      }
      const firstCh = line[0];
      if (line === '{') {
        previousBranch.delete(conditionalStack.length);
        isCodeBlock = true;
        conditionalStack.push(true);
      } else if (firstCh === '}') {
        if (conditionalStack.length === 0) {
          this.throwParsingError('Unexpected closing brace', lineNum, line);
        }
        conditionalStack.pop();
        for (const depth of previousBranch.keys()) {
          if (depth > conditionalStack.length) previousBranch.delete(depth);
        }
        isCodeBlock = conditionalStack.length > 0;
        currentBlock = null;
      } else if ((firstCh === '@' || line.startsWith('#@')) && !isCodeBlock) {
        const isActionHeader = line.startsWith('#@');
        let signature: ReturnType<typeof parseScriptSignature>;
        try {
          signature = parseScriptSignature(line.slice(isActionHeader ? 2 : 1));
        } catch (error) {
          this.throwParsingError((error as Error).message, lineNum, line);
          return;
        }
        let scriptName = signature.name;
        if (isActionHeader) {
          if (signature.parameters.length > 0) {
            this.throwParsingError(
              'Action shorthand scripts cannot have parameters',
              lineNum,
              line,
            );
          }
          if (Object.hasOwn(triggers, scriptName)) {
            this.throwParsingError(`Duplicate trigger ${scriptName}`, lineNum, line);
          }
          currentTriggerName = scriptName;
          currentTrigger = {
            name: scriptName,
            filename: this.name,
            lineNum,
            scriptCalls: [{ type: TriggerType.ACTION, condition: true, scriptName, line: lineNum }],
            x: 0,
            y: 0,
          };
          addTrigger(scriptName, currentTrigger);
        }
        if (scriptName === 'this') {
          scriptName = currentTriggerName || '';
        }
        if (scriptName.length === 0) {
          this.throwParsingError('Invalid script name', lineNum, line);
        }
        if (Object.hasOwn(scripts, scriptName)) {
          this.throwParsingError(`Duplicate script ${scriptName}`, lineNum, line);
        }
        currentScript = {
          name: scriptName,
          parameters: signature.parameters,
          filename: this.name,
          lineNum,
          blocks: [],
        };
        addScript(scriptName, currentScript);
        currentBlock = null;
        isTrigger = false;
        isChoice = false;
        conditionalStack = [];
        previousBranch.clear();
      } else if (firstCh === '$') {
        previousBranch.clear();
        isChoice = true;
        isTrigger = false;
        if (currentScript) {
          currentBlock = addCommandBlock(currentScript);
          currentBlock.conditional = true;
          currentBlock.commands.push({
            i: lineNum,
            type: 'showChoices',
            args: [],
          });
        }
      } else if (firstCh === '#') {
        previousBranch.clear();
        isTrigger = true;
        isChoice = false;
        currentTriggerName = line.substr(1);
        if (Object.hasOwn(triggers, currentTriggerName)) {
          this.throwParsingError(`Duplicate trigger ${currentTriggerName}`, lineNum, line);
        }
        currentTrigger = {
          name: line.slice(1),
          filename: this.name,
          lineNum,
          scriptCalls: [],
          x: 0,
          y: 0,
        };
        addTrigger(line.substr(1), currentTrigger);
      } else if (firstCh === '+' || firstCh === '<' || isCodeBlock) {
        isChoice = false;
        const commandContents = line.substr(isCodeBlock || firstCh === '<' ? 0 : 1);
        if (currentScript) {
          let { conditional, endIndex } = this.getConditionalFromLine(
            commandContents,
            lineNum,
            currentScript,
          );
          const depth = conditionalStack.length;
          const isElse = typeof conditional === 'object' && conditional.type === 'else';
          if (isElse && typeof conditional === 'object') {
            const preceding = previousBranch.get(depth);
            if (conditional.args.length !== 0 || preceding === undefined) {
              this.throwParsingError(
                'else() requires a preceding conditional at the same level',
                lineNum,
                line,
              );
            }
            conditional = { type: 'else', args: [preceding] };
            previousBranch.delete(depth);
          } else if (conditional === true) {
            previousBranch.delete(depth);
          }
          if (typeof conditional === 'object') {
            if (commandContents.slice(endIndex).trim() === '{') {
              const block = addCommandBlock(currentScript);
              if (!isElse) previousBranch.set(depth, currentScript.blocks.length - 1);
              block.conditional = this.createAllConditional(conditional, ...conditionalStack);
              conditionalStack.push({
                type: 'branch',
                args: [currentScript.blocks.length - 1],
              });
              isCodeBlock = true;
              currentBlock = block;
              return;
            } else if (endIndex === commandContents.length) {
              currentBlock = addCommandBlock(currentScript);
              if (!isElse) previousBranch.set(depth, currentScript.blocks.length - 1);
              currentBlock.conditional = this.createAllConditional(
                conditional,
                ...conditionalStack,
              );
              return;
            }
            // An inline conditional is a separate block even inside a braced parent.
            const block = addCommandBlock(currentScript);
            if (!isElse) previousBranch.set(depth, currentScript.blocks.length - 1);
            block.conditional = this.createAllConditional(conditional, ...conditionalStack);
            let commandSrc = commandContents.slice(endIndex);
            if (commandSrc[0] === '+') commandSrc = commandSrc.slice(1);
            const isDialog = /^_?[\w-]+(?:&[\w-]+)?:\s*["']/.test(commandSrc);
            block.commands.push(
              isDialog
                ? this.createDialogCommand(commandSrc, lineNum)
                : this.parseCommand(commandSrc, lineNum, currentScript),
            );
            currentBlock = null;
            return;
          }

          let block: CommandBlock;
          if (isCodeBlock) {
            if (currentBlock === null) {
              currentBlock = addCommandBlock(currentScript);
              currentBlock.conditional = this.createAllConditional(
                conditional,
                ...conditionalStack,
              );
            }
            block = currentBlock;
          } else {
            block = currentBlock = addCommandBlock(currentScript);
            currentBlock.conditional = this.createAllConditional(
              ...[conditional, ...conditionalStack],
            );
          }

          let commandSrc = commandContents.substr(endIndex);
          const isDialog = /^_?[\w-]+(?:&[\w-]+)?:\s*["']/.test(commandSrc);
          if (commandSrc[0] === '?') {
            this.throwParsingError(
              `Invalid conditional, did you forget '+' at the start?`,
              lineNum,
              line,
            );
            return;
          }

          if (commandSrc[0] === '+') {
            commandSrc = commandSrc.slice(1);
          } else if (isDialog) {
            const command = this.createDialogCommand(commandSrc, lineNum);
            block.commands.push(command);
            return;
          }

          block.commands.push(this.parseCommand(commandSrc, lineNum, currentScript));
        }
      } else if (isChoice) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
          this.throwParsingError(`Invalid choice definition, no colon '"'`, lineNum, line);
        }
        const choiceText = line.substr(0, colonIndex);
        const target = line.substr(colonIndex + 1);
        if (currentBlock) {
          currentBlock.commands[0].args.push({
            text: choiceText,
            target: target,
          });
        }
      } else if (isTrigger) {
        const firstCommaIndex = line.indexOf(',');
        if (firstCommaIndex === -1) {
          this.throwParsingError(
            `Invalid trigger script call, invalid number of arguments`,
            lineNum,
            line,
          );
        }
        const triggerType = line.substr(0, firstCommaIndex) as TriggerType;
        let triggerContents = line.substr(firstCommaIndex + 1);
        let itemConditional: Conditional | null = null;
        if (triggerType === 'item') {
          const itemName = triggerContents.slice(0, triggerContents.indexOf(','));
          itemConditional = {
            type: 'with',
            args: [itemName],
          };
          triggerContents = triggerContents.slice(triggerContents.indexOf(',') + 1);
        }

        const { conditional: localConditional, endIndex } = this.getConditionalFromLine(
          triggerContents,
          lineNum,
          currentScript ?? undefined,
        );
        let conditional = localConditional;
        if (itemConditional) {
          conditional = this.combineConditionals(itemConditional, localConditional, 'all');
        }

        let scriptName = triggerContents.substr(endIndex);
        let intervalMs: number | undefined;
        let character: string | undefined;
        if (triggerType === TriggerType.TIMER) {
          const parts = scriptName.split(',');
          scriptName = parts[0].trim();
          if (parts.length === 3) {
            character = parts[1].trim();
            if (!character) this.throwParsingError('Character timer requires a character name or ID', lineNum, line);
          }
          intervalMs = parts.length === 1 ? 1000 : Number(parts.at(-1)?.trim());
          if (parts.length > 3 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
            this.throwParsingError('Timer interval must be a positive number of milliseconds', lineNum, line);
          }
        }
        if (scriptName === 'this' && currentTriggerName) {
          scriptName = currentTriggerName;
        }
        if (currentTrigger) {
          currentTrigger.scriptCalls.push({
            type: triggerType,
            condition: conditional,
            scriptName,
            line: lineNum,
            ...(intervalMs === undefined ? {} : { intervalMs }),
            ...(character === undefined ? {} : { character }),
          });
        }
      } else if (firstCh === '>') {
        if (currentBlock) {
          currentBlock.commands.push({
            i: lineNum,
            type: 'callScript',
            args: [line.substr(1)],
          });
        }
      } else {
        previousBranch.delete(conditionalStack.length);
        isTrigger = false;
        if (currentScript) {
          if (line[0] === '?') {
            this.throwParsingError(
              `Invalid conditional, did you forget '+' at the start?`,
              lineNum,
              line,
            );
            return;
          }

          const block = addCommandBlock(currentScript);
          if (conditionalStack.length) {
            block.conditional = this.createAllConditional(...[true, ...conditionalStack]);
          }
          const command = this.createDialogCommand(line, lineNum);
          block.commands.push(command);
        }
      }
    });
    if (conditionalStack.length > 0) {
      this.throwParsingError('Unclosed conditional block', lines.length, '');
    }
    return { triggers, scripts };
  }
}
