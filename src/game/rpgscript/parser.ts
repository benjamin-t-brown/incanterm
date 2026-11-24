// Adapted from reference/rpgscript-regem-ludos/src/lib/rpgscript.ts.
// Keep RPGScript syntax here; no browser globals, fetch, or original Scene runtime.
import {
  getTriggerScriptPrefix,
  parseScriptSignature,
  parseTriggerScriptHeader,
} from './signature.js';
import { isNumericExpression, validateNumericExpression } from './expression.js';
import { parseVoiceAnnotation } from './voice-annotation.js';

const DIALOGUE_LINE = /^_?[A-Za-z_][\w. -]*(?:&[\w-]+)?:\s*["']/;

function splitNotInParens(str: string, spl: string) {
  const ret: string[] = [];
  let agg = '';
  let quote = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let listDepth = 0;
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
    } else if (ch === '[') {
      bracketDepth++;
    } else if (ch === ']') {
      bracketDepth--;
    } else if (ch === '|') {
      listDepth = listDepth === 0 ? 1 : 0;
    }

    if (parenDepth === 0 && bracketDepth === 0 && listDepth === 0 && !quote && ch === spl) {
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

function getLogicalLines(source: string, file: string): string[] {
  const lines = source.split('\n');
  for (let line = 0; line < lines.length; line++) {
    const start = /^\s*\+(?:\^?(?:[A-Za-z_][\w.-]*|\{[^}]+\}|\[[A-Za-z_][\w-]*\]))\s*=\s*\|/.exec(lines[line]);
    if (!start) continue;
    let quote = '';
    let pipes = 0;
    let end = line;
    for (; end < lines.length; end++) {
      for (const character of lines[end].slice(end === line ? start[0].length - 1 : 0)) {
        if (quote) { if (character === quote) quote = ''; }
        else if (character === '"' || character === "'") quote = character;
        else if (character === '|') pipes++;
      }
      if (pipes >= 2) break;
    }
    if (end === lines.length) throw new Error(`${file}:${line + 1}: Unterminated list literal`);
    if (end > line) {
      lines[line] = lines.slice(line, end + 1).map((part) => part.trim()).join(' ');
      for (let index = line + 1; index <= end; index++) lines[index] = '';
    }
  }
  return lines;
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
export type ScriptValue = string | number | boolean | StorageReference | LocalReference | Readonly<{ expression: string }> | Readonly<{ literal: string }> | Readonly<{ quoted: string }> | Readonly<{ list: readonly ScriptValue[] }> | Readonly<{ indexed: { list: StorageReference | LocalReference; index: ScriptValue } }>;

export type CommandArg =
  | ScriptValue
  | { actorName: string; text: string; portraitEmotion: string }
  | { text: string; target: string };

export interface Command {
  i: number;
  type: string;
  args: CommandArg[];
  result?: StorageReference | LocalReference;
  condition?: Conditional | boolean;
}

export interface CommandBlock {
  conditional: Conditional | boolean;
  commands: Command[];
  conditionLine?: number;
  /** Marks a loop's closing block: when it runs, execution jumps back to this block index. */
  loopTo?: number;
  /** Source line of the `while` that this closing block belongs to. */
  loopLine?: number;
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

function hasOnceCondition(condition: Conditional | boolean): boolean {
  if (typeof condition !== 'object') return false;
  return (
    condition.type === 'once' ||
    condition.type === 'oncePerInstance' ||
    condition.args.some(
      (arg) =>
        typeof arg === 'object' && arg !== null && 'type' in arg && hasOnceCondition(arg as Conditional),
    )
  );
}

export class ScriptParser {
  constructor(readonly name: string, private readonly getMissingVoiceId?: (line: number) => string) {}

  throwParsingError(err: string, lineNum: number, lineContents: string): never {
    throw new Error(`${this.name}:${lineNum}: ${err} (${lineContents})`);
  }

  parseCommand(commandSrc: string, lineNum: number, script?: ParsedScript): Command {
    commandSrc = commandSrc.trim();
    if (commandSrc.startsWith('!')) {
      const keyword = commandSrc.slice(1).replace(/;$/, '').trim();
      if (keyword === 'returnempty') return this.parseCommand('returnValue()', lineNum, script);
      // Loop targets are block indexes, filled in when the enclosing `while` closes.
      if (keyword === 'break') return { i: lineNum, type: 'breakLoop', args: [] };
      if (keyword === 'continue') return { i: lineNum, type: 'continueLoop', args: [] };
      this.throwParsingError(`Unknown control keyword "!${keyword}"`, lineNum, commandSrc);
    }
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
    const indexedAssignment = /^(\[[A-Za-z_][\w-]*\]|\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\})\s*->\s*(\[[A-Za-z_][\w-]*\]|\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\}|\d+)\s*=\s*(.*?)\s*;?$/.exec(commandSrc);
    if (indexedAssignment) {
      return {
        i: lineNum,
        type: 'setIndex',
        args: [this.parseListValue(indexedAssignment[1], lineNum), this.parseListValue(indexedAssignment[2], lineNum), this.parseListValue(indexedAssignment[3], lineNum)],
      };
    }
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
      const commandValue = /^\+?[A-Za-z_][\w-]*\s*\(.*\)$/.test(value);
      if (commandValue || value.startsWith('?')) {
        if (ifUndefined || assignment[1].startsWith('{'))
          this.throwParsingError('Command and condition results require a direct local or global assignment', lineNum, commandSrc);
        const destination = assignment[1];
        const result = destination.startsWith('[')
          ? { localName: destination.slice(1, -1) }
          : { storageKey: destination };
        if (commandValue)
          return { ...this.parseCommand(value.replace(/^\+/, ''), lineNum, script), result };
        return {
          i: lineNum, type: 'evaluateCondition', args: [], result,
          condition: this.parseConditional(value.slice(1), lineNum, script),
        };
      }
      if (!value.startsWith('|') && !value.startsWith('[') && !/^(?:\[[A-Za-z_][\w-]*\]|\{[A-Za-z_][\w.-]*\})\s*->/.test(value) && isNumericExpression(value)) {
        try {
          validateNumericExpression(value);
        } catch (error) {
          this.throwParsingError(`Invalid storage assignment: ${String(error)}`, lineNum, commandSrc);
        }
      }
      if (
        !isNumericExpression(value) && !value.startsWith('|') && !value.startsWith('[') && !/^(?:\[[A-Za-z_][\w-]*\]|\{[A-Za-z_][\w.-]*\})\s*->/.test(value) && !/^(?:"[^"]*"|'[^']*'|\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\}|[^\s,;=(){}"']+)$/.test(
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

    if (script && DIALOGUE_LINE.test(commandSrc)) {
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

    const type = commandSrc.slice(0, firstParenIndex).trim();
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
      if (args[index]?.startsWith('|') || /^(?:\[[A-Za-z_][\w-]*\]|\{[A-Za-z_][\w.-]*\})\s*->/.test(args[index])) {
        formattedArgs[index] = this.parseListValue(args[index], lineNum);
        continue;
      }
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

  parseListValue(source: string, lineNum: number): ScriptValue {
    const text = source.trim();
    if (text.startsWith('|') && text.endsWith('|')) {
      const inner = text.slice(1, -1).trim();
      return { list: inner ? splitNotInParens(inner, ',').map((part) => this.parseListValue(part, lineNum)) : [] };
    }
    const indexed = /^(\[[A-Za-z_][\w-]*\]|\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\})\s*->\s*(\[[A-Za-z_][\w-]*\]|\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\}|\d+)$/.exec(text);
    if (indexed) {
      const list = this.parseListValue(indexed[1], lineNum);
      if (typeof list !== 'object' || !('localName' in list || 'storageKey' in list))
        this.throwParsingError('Indexing requires a list variable', lineNum, text);
      return { indexed: { list: list as StorageReference | LocalReference, index: this.parseListValue(indexed[2], lineNum) } };
    }
    if (/^\[[A-Za-z_][\w-]*\]$/.test(text)) return { localName: text.slice(1, -1) };
    if (/^\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\}$/.test(text)) return { storageKey: text.slice(1, -1) };
    if (/^(["']).*\1$/.test(text)) return text.slice(1, -1);
    if (text === 'true' || text === 'false') return text === 'true';
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    if (isNumericExpression(text)) {
      try { validateNumericExpression(text); } catch (error) { this.throwParsingError(String(error), lineNum, text); }
      return { expression: text };
    }
    if (/^[A-Za-z_][\w-]*$/.test(text)) return text;
    this.throwParsingError('Invalid list value or index', lineNum, text);
    throw new Error('Unreachable invalid list value');
  }

  parseConditional(
    conditionalSrc: string,
    lineNum: number,
    script?: ParsedScript,
  ): Conditional | boolean {
    conditionalSrc = conditionalSrc.trim();
    if (conditionalSrc.startsWith('+:')) {
      const target = /^\+:([\w-]+)\s*\(.*\)$/.exec(conditionalSrc);
      if (!target) this.throwParsingError('Invalid script call in condition', lineNum, conditionalSrc);
      const { args } = this.parseCommand(conditionalSrc.slice(1), lineNum, script);
      return { type: 'scriptResult', args: [target[1], ...args.slice(1)] };
    }
    if (conditionalSrc.trim() === 'else') conditionalSrc = 'else()';
    const whileLoop = /^while\s+(.+)$/s.exec(conditionalSrc.trim());
    if (whileLoop) {
      const condition = this.parseConditional(whileLoop[1], lineNum, script);
      if (hasOnceCondition(condition)) {
        this.throwParsingError(
          'while cannot use once or oncePerInstance, which would stop the loop after one pass',
          lineNum,
          conditionalSrc,
        );
      }
      return { type: 'while', args: [condition] };
    }
    const ifLong = /^if\s+(.+)$/s.exec(conditionalSrc.trim());
    if (ifLong) return this.parseConditional(ifLong[1], lineNum, script);
    const elseIf = /^elseif\s+(.+)$/s.exec(conditionalSrc.trim());
    if (elseIf) {
      return { type: 'elseif', args: [this.parseConditional(elseIf[1], lineNum, script)] };
    }
    const { type, args } = this.parseCommand(conditionalSrc, lineNum, script);
    const validTypes = [
      'is',
      'isnot',
      'gt',
      'gte',
      'lt',
      'lte',
      'eq',
      'in',
      'any',
      'all',
      'else',
      'elseif',
      'while',
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

    const rawArgs = splitNotInParens(conditionalSrc.slice(
      conditionalSrc.indexOf('(') + 1, conditionalSrc.lastIndexOf(')'),
    ), ',');
    return {
      type,
      args: args.map((arg, index) => {
        const raw = rawArgs[index].trim();
        const isQuoted = raw.startsWith('"') || raw.startsWith("'");
        if (type === 'eq' && isQuoted) return { quoted: raw.slice(1, -1) };
        if (type === 'eq' && (raw === 'true' || raw === 'false')) return raw === 'true';
        if (typeof arg === 'string' && type !== 'func' && arg.includes('(') && !isQuoted) {
          return this.parseConditional(arg, lineNum, script);
        } else {
          return arg;
        }
      }),
    };
  }

  /** Rewrites longform `if cond:`, `elseif cond:`, `while cond:` and `else:` into the `?cond:` form. */
  getShortFormConditional(contents: string): string {
    const longForm = /^(if|elseif|while)\s+(?=\S)/.exec(contents);
    if (longForm) {
      const rest = contents.slice(longForm[0].length);
      return longForm[1] === 'if' ? `?${rest}` : `?${longForm[1]} ${rest}`;
    }
    if (/^else\s*:/.test(contents)) return `?${contents}`;
    return contents;
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
    const prefix = /^\s*\+?\?\s*/.exec(line);
    if (prefix) {
      const start = prefix[0].length;
      const searchFrom = line.startsWith('+:', start) ? start + 2 : start;
      const colonOffset = indexOfNotInParens(line.slice(searchFrom), ':');
      if (colonOffset === -1) {
        this.throwParsingError(`Invalid conditional, no ending ':'`, lineNum, line);
      }
      const colonIndex = searchFrom + colonOffset;
      const conditionalSrc = line.slice(start, colonIndex);
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
    let annotation: ReturnType<typeof parseVoiceAnnotation>;
    try {
      annotation = parseVoiceAnnotation(text);
    } catch (error) {
      this.throwParsingError((error as Error).message, lineNum, line);
    }
    let lineId = annotation?.id;
    if (annotation) {
      text = annotation.spoken;
      if (annotation.requested && !lineId) {
        lineId = this.getMissingVoiceId?.(lineNum);
        if (!lineId) this.throwParsingError('Voice request needs an ID: save in Script Writer or run npm run voice:ids', lineNum, line);
      }
    }

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
      args: lineId
        ? [actorName, text, portraitEmotion, lineId, ...(annotation?.requested ? [] : ['no-voice'])]
        : [{ actorName, text, portraitEmotion }],
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
    const previousBranch = new Map<number, number[]>();
    // Header block index of each open `while` body, keyed by the brace depth it opened at.
    const loopHeaders = new Map<number, { block: number; line: number; jumps: Command[] }>();
    const switches = new Map<number, { header: number; cases: number[]; hasDefault: boolean }>();
    const parseLineCommand = (src: string, lineNum: number, script: ParsedScript): Command => {
      const command = this.parseCommand(src, lineNum, script);
      if (command.type === 'breakLoop' || command.type === 'continueLoop') {
        const innermost = Math.max(-1, ...loopHeaders.keys());
        const loop = loopHeaders.get(innermost);
        if (loop) loop.jumps.push(command);
        else {
          const keyword = command.type === 'breakLoop' ? '!break' : '!continue';
          this.throwParsingError(`${keyword} must be inside a while loop`, lineNum, src);
        }
      }
      return command;
    };
    const lines = getLogicalLines(src, this.name);

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
      const triggerPrefix = isCodeBlock ? undefined : getTriggerScriptPrefix(line);
      if (line === '{') {
        previousBranch.delete(conditionalStack.length);
        isCodeBlock = true;
        conditionalStack.push(true);
      } else if (firstCh === '}') {
        if (conditionalStack.length === 0) {
          this.throwParsingError('Unexpected closing brace', lineNum, line);
        }
        conditionalStack.pop();
        switches.delete(conditionalStack.length);
        const loopHeader = loopHeaders.get(conditionalStack.length);
        if (loopHeader && currentScript) {
          loopHeaders.delete(conditionalStack.length);
          const loopEnd = addCommandBlock(currentScript);
          loopEnd.conditional = { type: 'branch', args: [loopHeader.block] };
          loopEnd.loopTo = loopHeader.block;
          loopEnd.loopLine = loopHeader.line;
          const afterLoop = currentScript.blocks.length;
          for (const jump of loopHeader.jumps) {
            jump.args =
              jump.type === 'breakLoop'
                ? [afterLoop, loopHeader.block]
                : [loopHeader.block];
          }
        }
        for (const depth of previousBranch.keys()) {
          if (depth > conditionalStack.length) previousBranch.delete(depth);
        }
        isCodeBlock = conditionalStack.length > 0;
        currentBlock = null;
      } else if (!isCodeBlock && (firstCh === '@' || triggerPrefix)) {
        let signature: ReturnType<typeof parseScriptSignature>;
        let triggerHeader: ReturnType<typeof parseTriggerScriptHeader> | undefined;
        try {
          triggerHeader = triggerPrefix ? parseTriggerScriptHeader(line, triggerPrefix) : undefined;
          signature = triggerHeader?.signature ?? parseScriptSignature(line.slice(1));
        } catch (error) {
          this.throwParsingError((error as Error).message, lineNum, line);
        }
        let scriptName = signature.name;
        if (triggerHeader) {
          const { type, intervalMs } = triggerHeader;
          if (Object.hasOwn(triggers, scriptName)) {
            this.throwParsingError(`Duplicate trigger ${scriptName}`, lineNum, line);
          }
          currentTriggerName = scriptName;
          currentTrigger = {
            name: scriptName,
            filename: this.name,
            lineNum,
            scriptCalls: [
              {
                type,
                condition: true,
                scriptName,
                line: lineNum,
                ...(intervalMs === undefined ? {} : { intervalMs }),
              },
            ],
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
        loopHeaders.clear();
        switches.clear();
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
      } else if (firstCh === '+' || firstCh === '<' || firstCh === '!' || isCodeBlock) {
        isChoice = false;
        const plusControl = /\+\s*(!(?:break|continue|returnempty))\b\s*;?$/.exec(line);
        if (plusControl) {
          this.throwParsingError(
            `${plusControl[1]} is written without a leading "+"`,
            lineNum,
            line,
          );
        }
        let commandContents = line.substr(isCodeBlock || firstCh === '<' || firstCh === '!' ? 0 : 1);
        if (firstCh === '+' && !isCodeBlock) {
          commandContents = this.getShortFormConditional(commandContents);
        }
        if (currentScript) {
          const switchHeader = /^\+?\?switch\((.*)\)\s*:\s*\{$/.exec(commandContents);
          if (switchHeader) {
            if (!switchHeader[1].trim()) this.throwParsingError('switch requires a value', lineNum, line);
            const selector = this.parseCommand(`switch(${switchHeader[1]})`, lineNum, currentScript).args;
            if (selector.length !== 1) this.throwParsingError('switch requires one value', lineNum, line);
            if (/^(["']).*\1$/.test(switchHeader[1].trim()))
              selector[0] = { literal: switchHeader[1].trim().slice(1, -1) };
            const header = currentScript.blocks.length;
             const block = addCommandBlock(currentScript);
            block.conditionLine = lineNum;
             block.conditional = this.createAllConditional(
              ...conditionalStack, { type: 'switchValue', args: [selector[0], header] },
            );
            switches.set(conditionalStack.length, { header, cases: [], hasDefault: false });
            conditionalStack.push({ type: 'branch', args: [header] });
            isCodeBlock = true;
            currentBlock = block;
            return;
          }
          const activeSwitch = switches.get(conditionalStack.length - 1);
          if (activeSwitch) {
            const colon = indexOfNotInParens(line, ':');
            if (colon < 0 || line.slice(colon + 1).trim() !== '{')
              this.throwParsingError('switch cases require a braced block', lineNum, line);
            const label = line.slice(0, colon).trim();
            if (activeSwitch.hasDefault) this.throwParsingError('No case may follow the default', lineNum, line);
            if (!label) this.throwParsingError('switch case requires a value', lineNum, line);
            const isDefault = label === '*';
            let value: unknown;
            if (!isDefault) {
              if (/^(["']).*\1$/.test(label)) value = { literal: label.slice(1, -1) };
              else if (/^(?:true|false)$/.test(label)) value = label === 'true';
              else if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(label)) value = Number(label);
              else if (/^\[[A-Za-z_][\w-]*\]$/.test(label)) value = { localName: label.slice(1, -1) };
              else if (/^\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\}$/.test(label)) value = { storageKey: label.slice(1, -1) };
              else if (/^[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*$/.test(label)) value = { literal: label };
              else value = this.parseConditional(label, lineNum, currentScript);
            }
            const blockIndex = currentScript.blocks.length;
            const block = addCommandBlock(currentScript);
            block.conditionLine = lineNum;
            block.conditional = this.createAllConditional(
              ...conditionalStack,
              { type: isDefault ? 'switchDefault' : 'switchCase', args: isDefault ? [activeSwitch.header, ...activeSwitch.cases] : [activeSwitch.header, value, ...activeSwitch.cases] },
            );
            if (isDefault) activeSwitch.hasDefault = true;
            activeSwitch.cases.push(blockIndex);
            conditionalStack.push({ type: 'branch', args: [blockIndex] });
            isCodeBlock = true;
            currentBlock = block;
            return;
          }
          let { conditional, endIndex } = this.getConditionalFromLine(
            commandContents,
            lineNum,
            currentScript,
          );
          const depth = conditionalStack.length;
          const isWhile = typeof conditional === 'object' && conditional.type === 'while';
          if (isWhile && typeof conditional === 'object') {
            if (commandContents.slice(endIndex).trim() !== '{') {
              this.throwParsingError('while requires a braced block', lineNum, line);
            }
            previousBranch.delete(conditionalStack.length);
            const block = addCommandBlock(currentScript);
            block.conditionLine = lineNum;
            block.conditional = this.createAllConditional(
              ...conditionalStack,
              conditional.args[0] as Conditional,
            );
            loopHeaders.set(conditionalStack.length, {
              block: currentScript.blocks.length - 1,
              line: lineNum,
              jumps: [],
            });
            conditionalStack.push({ type: 'branch', args: [currentScript.blocks.length - 1] });
            isCodeBlock = true;
            currentBlock = block;
            return;
          }
          const isElseIf = typeof conditional === 'object' && conditional.type === 'elseif';
          const isElse = isElseIf || (typeof conditional === 'object' && conditional.type === 'else');
          let chain: number[] = [];
          if (typeof conditional === 'object' && isElse) {
            const preceding = previousBranch.get(depth) ?? [];
            if ((!isElseIf && conditional.args.length !== 0) || preceding.length === 0) {
              this.throwParsingError(
                `${isElseIf ? 'elseif' : 'else()'} requires a preceding conditional at the same level`,
                lineNum,
                line,
              );
            }
            const elseCondition: Conditional = { type: 'else', args: [...preceding] };
            if (isElseIf) {
              chain = preceding;
              conditional = this.createAllConditional(
                elseCondition,
                conditional.args[0] as Conditional,
              ) as Conditional;
            } else {
              conditional = elseCondition;
              previousBranch.delete(depth);
            }
          } else if (conditional === true) {
            previousBranch.delete(depth);
          }
          const script = currentScript;
          const setPreviousBranch = () => {
            if (isElseIf || !isElse) {
              previousBranch.set(depth, [...chain, script.blocks.length - 1]);
            }
          };
          if (typeof conditional === 'object') {
            if (commandContents.slice(endIndex).trim() === '{') {
              const block = addCommandBlock(currentScript);
              block.conditionLine = lineNum;
              setPreviousBranch();
              block.conditional = this.createAllConditional(...conditionalStack, conditional);
              conditionalStack.push({
                type: 'branch',
                args: [currentScript.blocks.length - 1],
              });
              isCodeBlock = true;
              currentBlock = block;
              return;
            } else if (endIndex === commandContents.length) {
              currentBlock = addCommandBlock(currentScript);
              currentBlock.conditionLine = lineNum;
              setPreviousBranch();
              currentBlock.conditional = this.createAllConditional(
                ...conditionalStack,
                conditional,
              );
              return;
            }
            // An inline conditional is a separate block even inside a braced parent.
            const block = addCommandBlock(currentScript);
            block.conditionLine = lineNum;
            setPreviousBranch();
            block.conditional = this.createAllConditional(...conditionalStack, conditional);
            let commandSrc = commandContents.slice(endIndex);
            if (commandSrc[0] === '+') commandSrc = commandSrc.slice(1);
            const isDialog = DIALOGUE_LINE.test(commandSrc);
            block.commands.push(
              isDialog
                ? this.createDialogCommand(commandSrc, lineNum)
                : parseLineCommand(commandSrc, lineNum, currentScript),
            );
            currentBlock = null;
            return;
          }

          let block: CommandBlock;
          if (isCodeBlock) {
            if (currentBlock === null) {
              currentBlock = addCommandBlock(currentScript);
              currentBlock.conditional = this.createAllConditional(
                ...conditionalStack,
                conditional,
              );
            }
            block = currentBlock;
          } else {
            block = currentBlock = addCommandBlock(currentScript);
            currentBlock.conditional = this.createAllConditional(
              ...conditionalStack, conditional,
            );
          }

          let commandSrc = commandContents.substr(endIndex);
          const isDialog = DIALOGUE_LINE.test(commandSrc);
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

          block.commands.push(parseLineCommand(commandSrc, lineNum, currentScript));
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
