import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ScriptParser,
  TriggerType,
  type Command,
  type Conditional,
  type StorageReference,
  type LocalReference,
  type ScriptValue,
} from './parser.js';
import { commands } from './scene-commands.js';
import { sceneCommandsShim } from './scene-commands-shim.js';

export type ScriptStep = Readonly<
  | { type: 'dialogue'; actor: string; text: string; line: number }
  | { type: 'call'; target: string; args: readonly ScriptValue[]; line: number }
  | {
      type: 'setStorage';
      key: string | StorageReference | LocalReference;
      value: ScriptValue;
      line: number;
    }
  | { type: 'log'; text: string; line: number }
  | { type: 'setConv'; portName: ScriptValue; line: number }
  | { type: 'setLocal'; name: string; value: ScriptValue; line: number }
  | { type: 'choices'; options: readonly Choice[]; line: number }
  | { type: 'awaitChoice'; options: readonly string[]; line: number }
>;
export type Choice = Readonly<{ text: string; target: string }>;
export type Condition =
  | boolean
  | Readonly<{ type: string; args: readonly (Condition | ScriptValue)[] }>;
export type ScriptBlock = Readonly<{
  condition: Condition;
  steps: readonly ScriptStep[];
}>;
export type ScriptDefinition = Readonly<{
  name: string;
  parameters: readonly string[];
  file: string;
  blocks: readonly ScriptBlock[];
}>;
export type TriggerCall = Readonly<{
  type: TriggerType;
  condition: Condition;
  target: string;
  line: number;
}>;
export type TriggerDefinition = Readonly<{
  name: string;
  file: string;
  line: number;
  calls: readonly TriggerCall[];
}>;
export type ScriptLibrary = ReadonlyMap<string, ScriptDefinition> & {
  readonly triggers: ReadonlyMap<string, TriggerDefinition>;
};

function libraryWithTriggers(
  scripts: Map<string, ScriptDefinition>,
  triggers: Map<string, TriggerDefinition>,
): ScriptLibrary {
  return Object.assign(scripts, {
    triggers: triggers as ReadonlyMap<string, TriggerDefinition>,
  });
}

export type ScriptOptions = { shim?: boolean };

export function parseRpgScript(
  source: string,
  file: string,
  options: ScriptOptions = {},
): ScriptLibrary {
  const parsed = new ScriptParser(file).parse(source);
  const scripts = new Map<string, ScriptDefinition>();
  const triggers = new Map<string, TriggerDefinition>();
  for (const script of Object.values(parsed.scripts)) {
    // Preserve empty branch headers: an else may refer to their evaluated result.
    const blocks = script.blocks.map((block) => {
      const line = block.commands[0]?.i ?? script.lineNum;
      validateLocals(block.conditional, script.parameters, file, line);
      for (const command of block.commands) {
        validateLocals(command.args, script.parameters, file, command.i);
        if (command.type === 'setLocal') {
          requireLocal(String(command.args[0]), script.parameters, file, command.i);
        }
      }
      return Object.freeze({
        condition: toCondition(block.conditional, file, line),
        steps: Object.freeze(
          block.commands.map((command) =>
            Object.freeze(toStep(command, file, options.shim ? sceneCommandsShim : commands)),
          ),
        ),
      });
    });
    scripts.set(
      script.name,
      Object.freeze({
        name: script.name,
        parameters: Object.freeze([...script.parameters]),
        file,
        blocks: Object.freeze(blocks),
      }),
    );
  }
  for (const trigger of Object.values(parsed.triggers)) {
    if (triggers.has(trigger.name))
      throw new Error(`${file}:${trigger.lineNum}: Duplicate trigger ${trigger.name}`);
    const calls = trigger.scriptCalls.map((call) => {
      validateLocals(call.condition, [], file, call.line);
      if (!Object.values(TriggerType).includes(call.type as TriggerType)) {
        throw new Error(`${file}:${call.line}: Unknown trigger event ${call.type}`);
      }
      if (!/^[\w-]+$/.test(call.scriptName)) {
        throw new Error(
          `${file}:${call.line}: Trigger target ${call.scriptName} is not supported (use a script name without arguments)`,
        );
      }
      return Object.freeze({
        type: call.type as TriggerType,
        condition: toCondition(call.condition, file, call.line),
        target: call.scriptName,
        line: call.line,
      });
    });
    triggers.set(
      trigger.name,
      Object.freeze({
        name: trigger.name,
        file,
        line: trigger.lineNum,
        calls: Object.freeze(calls),
      }),
    );
  }
  return libraryWithTriggers(scripts, triggers);
}

const conditionTypes = new Set([
  'is',
  'isnot',
  'eq',
  'gt',
  'lt',
  'any',
  'all',
  'else',
  'branch',
  'once',
  'oncePerInstance',
]);
function toCondition(value: Conditional | boolean, file: string, line: number): Condition {
  if (typeof value === 'boolean') return value;
  if (!conditionTypes.has(value.type))
    throw new Error(`${file}:${line}: Condition ${value.type} is not supported yet`);
  const args = value.args.map((arg) => {
    if (typeof arg === 'object' && arg !== null && 'type' in arg)
      return toCondition(arg as Conditional, file, line);
    if (typeof arg === 'object' && arg !== null && ('storageKey' in arg || 'localName' in arg))
      return Object.freeze({ ...(arg as StorageReference | LocalReference) });
    if (typeof arg === 'string') {
      return arg;
    }
    if (typeof arg === 'number' || typeof arg === 'boolean') return arg;
    throw new Error(`${file}:${line}: Invalid argument for condition ${value.type}`);
  });
  const arity =
    value.type === 'any' || value.type === 'all'
      ? args.length > 0
      : value.type === 'else' || value.type === 'branch'
        ? args.length === 1 && Number.isInteger(args[0]) && (args[0] as number) >= 0
        : value.type === 'once' || value.type === 'oncePerInstance'
          ? args.length <= 1
          : value.type === 'eq' || value.type === 'gt' || value.type === 'lt'
            ? args.length === 2
            : args.length === 1;
  const nested = args.some((arg) => typeof arg === 'object' && 'type' in arg);
  if (
    !arity ||
    ((value.type === 'once' || value.type === 'oncePerInstance') &&
      args.length === 1 &&
      typeof args[0] !== 'string') ||
    ((value.type === 'eq' ||
      value.type === 'gt' ||
      value.type === 'lt' ||
      value.type === 'else' ||
      value.type === 'branch' ||
      value.type === 'once' ||
      value.type === 'oncePerInstance') &&
      nested) ||
    ((value.type === 'all' || value.type === 'any') &&
      args.some((arg) => typeof arg !== 'object' && typeof arg !== 'boolean'))
  ) {
    throw new Error(`${file}:${line}: Invalid arguments for condition ${value.type}`);
  }
  return Object.freeze({ type: value.type, args: Object.freeze(args) });
}

function toStep(
  command: Command,
  file: string,
  catalog: typeof commands | typeof sceneCommandsShim,
): ScriptStep {
  if (!Object.hasOwn(catalog, command.type)) {
    throw new Error(`${file}:${command.i}: Unknown command ${command.type}`);
  }
  if (command.type === 'playDialogue') {
    const dialogue = command.args[0];
    if (
      command.args.length === 2 &&
      typeof dialogue === 'string' &&
      typeof command.args[1] === 'string'
    ) {
      return {
        ...catalog.playDialogue(dialogue, command.args[1]),
        line: command.i,
      };
    }
    if (
      typeof dialogue === 'object' &&
      dialogue &&
      'actorName' in dialogue &&
      'text' in dialogue &&
      !('portraitEmotion' in dialogue && dialogue.portraitEmotion)
    ) {
      return {
        ...catalog.playDialogue(dialogue.actorName, dialogue.text),
        line: command.i,
      };
    }
  }
  if (
    command.type === 'callScript' &&
    command.args.length >= 1 &&
    typeof command.args[0] === 'string' &&
    command.args[0]
  ) {
    const args = command.args.slice(1).map((arg) => toScriptValue(arg, file, command.i));
    return {
      ...catalog.callScript(command.args[0], ...args),
      args: Object.freeze(args),
      line: command.i,
    };
  }
  if (command.type === 'setStorage' && command.args.length === 2) {
    let key = command.args[0];
    if (typeof key === 'object' && ('storageKey' in key || 'localName' in key)) {
      key = Object.freeze({ ...key });
    } else if (typeof key !== 'string' || !key) {
      throw new Error(`${file}:${command.i}: setStorage requires a non-empty string key`);
    }
    const value = toScriptValue(command.args[1], file, command.i);
    return {
      ...catalog.setStorage(key, value === 'true' ? true : value === 'false' ? false : value),
      line: command.i,
    };
  }
  if (
    command.type === 'setLocal' &&
    command.args.length === 2 &&
    typeof command.args[0] === 'string'
  ) {
    return {
      ...catalog.setLocal(command.args[0], toScriptValue(command.args[1], file, command.i)),
      line: command.i,
    };
  }
  if (command.type === 'log' && command.args.length === 1 && typeof command.args[0] === 'string') {
    return { ...catalog.log(command.args[0]), line: command.i };
  }
  if (command.type === 'setConv' && command.args.length === 1) {
    return { ...catalog.setConv(toScriptValue(command.args[0], file, command.i)), line: command.i };
  }
  if (
    command.type === 'showChoices' &&
    command.args.length > 0 &&
    command.args.every(
      (arg) =>
        typeof arg === 'object' &&
        arg &&
        'target' in arg &&
        'text' in arg &&
        arg.text &&
        arg.target,
    )
  ) {
    if (command.args.length > 9)
      throw new Error(`${file}:${command.i}: At most 9 choices can be displayed`);
    const options = Object.freeze(
      command.args.map((arg) => {
        if (typeof arg !== 'object' || !('target' in arg) || !('text' in arg))
          throw new Error('Invalid choice');
        return Object.freeze({ text: arg.text, target: arg.target });
      }),
    );
    return {
      ...catalog.showChoices(options),
      line: command.i,
    };
  }
  if (
    command.type === 'awaitChoice' &&
    command.args.length > 0 &&
    command.args.every((arg) => typeof arg === 'string')
  ) {
    if (command.args.length > 9)
      throw new Error(`${file}:${command.i}: At most 9 choices can be displayed`);
    const choice = catalog.awaitChoice(...(command.args as string[]));
    return {
      ...choice,
      line: command.i,
      options: Object.freeze(choice.options),
    };
  }
  throw new Error(`${file}:${command.i}: Command ${command.type} is not supported yet`);
}

function toScriptValue(value: Command['args'][number], file: string, line: number): ScriptValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if ('storageKey' in value || 'localName' in value) return Object.freeze({ ...value });
  throw new Error(`${file}:${line}: Expected a scalar script argument`);
}

function requireLocal(
  name: string,
  parameters: readonly string[],
  file: string,
  line: number,
): void {
  if (!parameters.includes(name)) throw new Error(`${file}:${line}: Unknown local [${name}]`);
}

function validateLocals(
  value: unknown,
  parameters: readonly string[],
  file: string,
  line: number,
): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\[([A-Za-z_][\w-]*)\]/g))
      requireLocal(match[1], parameters, file, line);
  } else if (value && typeof value === 'object') {
    if ('localName' in value) requireLocal(String(value.localName), parameters, file, line);
    else for (const nested of Object.values(value)) validateLocals(nested, parameters, file, line);
  }
}

function checkArgumentCount(script: ScriptDefinition, count: number, location: string): void {
  if (script.parameters.length !== count) {
    throw new Error(
      `${location}: Script ${script.name} expects ${script.parameters.length} argument(s), got ${count}`,
    );
  }
}

export async function loadRpgScripts(
  root: string,
  options: ScriptOptions = {},
): Promise<ScriptLibrary> {
  const directory = path.join(root, 'scripts');
  const scripts = new Map<string, ScriptDefinition>();
  const triggers = new Map<string, TriggerDefinition>();
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (error) {
    if (isMissingDirectory(error)) return libraryWithTriggers(scripts, triggers);
    throw error;
  }
  for (const file of entries.filter((name) => name.endsWith('.rpgscript')).sort()) {
    const parsed = parseRpgScript(
      await fs.readFile(path.join(directory, file), 'utf8'),
      file,
      options,
    );
    for (const [name, definition] of parsed) {
      if (scripts.has(name))
        throw new Error(`Duplicate RPGScript ${name} in ${file} and ${scripts.get(name)?.file}`);
      scripts.set(name, definition);
    }
    for (const [name, definition] of parsed.triggers) {
      if (triggers.has(name))
        throw new Error(
          `Duplicate RPGScript trigger ${name} in ${file} and ${triggers.get(name)?.file}`,
        );
      triggers.set(name, definition);
    }
  }
  for (const script of scripts.values())
    for (const block of script.blocks)
      for (const step of block.steps) {
        const targets =
          step.type === 'call'
            ? [step.target]
            : step.type === 'choices'
              ? step.options.map((choice) => choice.target)
              : [];
        for (const target of targets) {
          const definition = scripts.get(target);
          if (!definition) throw new Error(`${script.file}:${step.line}: Unknown script ${target}`);
          checkArgumentCount(
            definition,
            step.type === 'call' ? step.args.length : 0,
            `${script.file}:${step.line}`,
          );
        }
      }
  for (const trigger of triggers.values())
    for (const call of trigger.calls) {
      const definition = scripts.get(call.target);
      if (!definition)
        throw new Error(`${trigger.file}:${call.line}: Unknown script ${call.target}`);
      checkArgumentCount(definition, 0, `${trigger.file}:${call.line}`);
    }
  return libraryWithTriggers(scripts, triggers);
}

function isMissingDirectory(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export type Dialogue = Readonly<{ actor: string; text: string }>;
export type ChoicePrompt = Readonly<{ options: readonly string[] }>;
type RuntimeValue = string | number | boolean | undefined;
const valuePlaceholder = /\{([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\}|\[([A-Za-z_][\w-]*)\]/g;
type Frame = {
  script: ScriptDefinition;
  locals: Map<string, RuntimeValue>;
  block: number;
  next: number;
  passed?: boolean;
  instanceId?: string;
  results?: Map<number, boolean>;
};

export class ScriptRunner {
  private stack: Frame[] = [];
  private readonly storage = new Map<string, string | number | boolean | undefined>();
  private readonly usedOnce = new Set<string>();
  dialogue: Dialogue | undefined;
  choice: ChoicePrompt | undefined;

  constructor(
    private readonly library: ScriptLibrary,
    private readonly writeLog: (message: string) => void = console.log,
    private readonly onSetConv?: (portName: string | undefined) => void,
  ) {}

  getStorage(key: string): string | number | boolean | undefined {
    return this.storage.get(key);
  }
  setStorage(key: string, value: string | number | boolean | undefined): void {
    this.storage.set(key, value);
  }

  isIdle(): boolean {
    return this.stack.length === 0 && !this.dialogue && !this.choice;
  }

  start(name: string, args: readonly RuntimeValue[] = []): void {
    this.stack = [this.createFrame(name, args)];
    this.dialogue = this.choice = undefined;
    this.run();
  }

  // Explicit RPGScript event names. A caller must supply the scene-to-event mapping.
  dispatchTrigger(name: string, event: TriggerType, instanceId?: string): boolean {
    if (this.stack.length || this.dialogue || this.choice) return false;
    const trigger = this.library.triggers.get(name);
    if (!trigger) return false;
    for (let index = 0; index < trigger.calls.length; index++) {
      const call = trigger.calls[index];
      if (call.type !== event) continue;
      const pending = new Set<string>();
      if (!this.evaluate(call.condition, `${trigger.name}:${event}:${index}`, pending, instanceId))
        continue;
      const frame = this.createFrame(call.target, [], instanceId, `${trigger.file}:${call.line}`);
      for (const key of pending) this.usedOnce.add(key);
      this.stack = [frame];
      this.run();
      return true;
    }
    return false;
  }

  advance(): void {
    if (!this.dialogue) return;
    this.dialogue = undefined;
    this.run();
  }

  choose(index: number): void {
    if (
      !this.choice ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.choice.options.length
    ) {
      throw new Error('No such RPGScript choice');
    }
    const frame = this.stack[this.stack.length - 1];
    const step = frame.script.blocks[frame.block].steps[frame.next - 1];
    this.storage.set('lastChoiceIndex', index);
    this.choice = undefined;
    if (step.type === 'choices') {
      this.stack.push(
        this.createFrame(
          step.options[index].target,
          [],
          frame.instanceId,
          `${frame.script.file}:${step.line}`,
        ),
      );
    }
    this.run();
  }

  private requireScript(name: string): ScriptDefinition {
    const script = this.library.get(name);
    if (!script) throw new Error(`Unknown script ${name}`);
    return script;
  }

  private createFrame(
    name: string,
    args: readonly RuntimeValue[],
    instanceId?: string,
    location?: string,
  ): Frame {
    const script = this.requireScript(name);
    checkArgumentCount(script, args.length, location ?? script.file);
    return {
      script,
      block: 0,
      next: 0,
      instanceId,
      locals: new Map(script.parameters.map((parameter, index) => [parameter, args[index]])),
    };
  }

  private localValue(name: string): RuntimeValue {
    const frame = this.stack[this.stack.length - 1];
    if (!frame?.locals.has(name)) throw new Error(`Unknown local [${name}]`);
    return frame.locals.get(name);
  }

  private scriptValue(value: ScriptValue): RuntimeValue {
    if (typeof value === 'object') {
      return 'storageKey' in value
        ? this.storage.get(value.storageKey)
        : this.localValue(value.localName);
    }
    return typeof value === 'string' ? this.interpolate(value) : value;
  }

  private interpolate(text: string): string {
    return text.replace(
      valuePlaceholder,
      (_, key: string | undefined, local: string | undefined) => {
        const value = local === undefined ? this.storage.get(key ?? '') : this.localValue(local);
        return value === undefined ? '' : String(value);
      },
    );
  }

  private resolve(value: Condition | ScriptValue): string | number | boolean | undefined {
    if (typeof value === 'string') {
      const text = this.interpolate(value);
      return this.storage.has(text)
        ? this.storage.get(text)
        : text === 'true'
          ? true
          : text === 'false'
            ? false
            : text;
    }
    if (typeof value === 'object') {
      if ('storageKey' in value) return this.storage.get(value.storageKey);
      if ('localName' in value) return this.localValue(value.localName);
      throw new Error('Nested condition is not a value');
    }
    return value;
  }

  private evaluate(
    condition: Condition,
    scope: string,
    pending: Set<string>,
    instanceId?: string,
    results?: ReadonlyMap<number, boolean>,
  ): boolean {
    if (typeof condition === 'boolean') return condition;
    const { type, args } = condition;
    if (type === 'branch') {
      const previous = results?.get(args[0] as number);
      if (previous === undefined) throw new Error('Nested branch has no evaluated parent');
      return previous;
    }
    if (type === 'else') {
      const previous = results?.get(args[0] as number);
      if (previous === undefined) throw new Error('else() has no evaluated preceding branch');
      return !previous;
    }
    if (type === 'all')
      return args.every((arg) =>
        this.evaluate(arg as Condition, scope, pending, instanceId, results),
      );
    if (type === 'any') {
      for (const arg of args) {
        const branch = new Set(pending);
        if (this.evaluate(arg as Condition, scope, branch, instanceId, results)) {
          for (const key of branch) pending.add(key);
          return true;
        }
      }
      return false;
    }
    if (type === 'once' || type === 'oncePerInstance') {
      if (type === 'oncePerInstance' && !instanceId)
        throw new Error('oncePerInstance requires an explicit instanceId');
      const name = typeof args[0] === 'string' ? this.interpolate(args[0]) : undefined;
      const key = `${type}:${name || scope}${type === 'oncePerInstance' ? `:${instanceId}` : ''}`;
      if (this.usedOnce.has(key)) return false;
      pending.add(key);
      return true;
    }
    const first = args[0];
    if (type === 'is' || type === 'isnot') {
      const result =
        typeof first === 'object'
          ? 'storageKey' in first
            ? Boolean(this.storage.get(first.storageKey))
            : 'localName' in first
              ? Boolean(this.localValue(first.localName))
              : this.evaluate(first as Condition, scope, pending, instanceId, results)
          : first === 'true'
            ? true
            : first === 'false'
              ? false
              : typeof first === 'string'
                ? Boolean(this.storage.get(this.interpolate(first)))
                : Boolean(first);
      return type === 'is' ? result : !result;
    }
    const left = this.resolve(first);
    const right = this.resolve(args[1]);
    if (type === 'eq') return left !== undefined && right !== undefined && left === right;
    if (type === 'gt' || type === 'lt') {
      if (typeof left !== 'number' || typeof right !== 'number')
        throw new Error(`${type} requires numeric values`);
      return type === 'gt' ? left > right : left < right;
    }
    throw new Error(`Condition ${type} is not supported`);
  }

  private run(): void {
    // Bound immediate work even if scripts recursively call each other.
    let budget = 1000;
    while (this.stack.length) {
      if (--budget < 0) throw new Error('RPGScript exceeded immediate work budget');
      const frame = this.stack[this.stack.length - 1];
      const block = frame.script.blocks[frame.block];
      if (!block) {
        this.stack.pop();
        continue;
      }
      if (frame.passed === undefined) {
        const pending = new Set<string>();
        frame.passed = this.evaluate(
          block.condition,
          `${frame.script.name}:${frame.block}`,
          pending,
          frame.instanceId,
          frame.results,
        );
        if (!frame.results) frame.results = new Map();
        frame.results.set(frame.block, frame.passed);
        if (frame.passed) for (const key of pending) this.usedOnce.add(key);
      }
      const step = frame.passed ? block.steps[frame.next++] : undefined;
      if (!step) {
        frame.block++;
        frame.next = 0;
        frame.passed = undefined;
        continue;
      }
      if (step.type === 'dialogue') {
        this.dialogue = { actor: this.interpolate(step.actor), text: this.interpolate(step.text) };
        return;
      }
      if (step.type === 'call') {
        const args = step.args.map((arg) => this.scriptValue(arg));
        this.stack.push(
          this.createFrame(
            step.target,
            args,
            frame.instanceId,
            `${frame.script.file}:${step.line}`,
          ),
        );
        continue;
      }
      if (step.type === 'setLocal') {
        requireLocal(step.name, frame.script.parameters, frame.script.file, step.line);
        frame.locals.set(step.name, this.scriptValue(step.value));
        continue;
      }
      if (step.type === 'setStorage') {
        const key = typeof step.key === 'object' ? this.scriptValue(step.key) : step.key;
        if (typeof key !== 'string' || !key) {
          throw new Error(
            `${frame.script.file}:${step.line}: setStorage requires a non-empty string key`,
          );
        }
        const value = this.scriptValue(step.value);
        this.storage.set(key, value);
        continue;
      }
      if (step.type === 'log') {
        this.writeLog(
          `[RPGSCRIPT] ${this.interpolate(step.text)} (${frame.script.file}:${step.line})`,
        );
        continue;
      }
      if (step.type === 'setConv') {
        const portName = this.scriptValue(step.portName);
        if (portName !== undefined && typeof portName !== 'string') {
          throw new Error(`${frame.script.file}:${step.line}: setConv requires a portrait name`);
        }
        this.storage.set('dialogue.portraitLeft', portName);
        this.onSetConv?.(portName);
        continue;
      }
      this.choice = {
        options:
          step.type === 'choices'
            ? step.options.map((choice) => this.interpolate(choice.text))
            : step.options.map((option) => this.interpolate(option)),
      };
      return;
    }
  }
}
