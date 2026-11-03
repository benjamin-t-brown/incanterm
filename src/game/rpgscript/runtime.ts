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
import type {
  CommandContext,
  RuntimeValue,
  CompiledCommand,
  CommandRegistry,
  CommandCatalog,
} from './command.js';
export type ScriptStep = CompiledCommand;
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

export type ScriptOptions = { commands: CommandCatalog };

export function parseRpgScript(
  source: string,
  file: string,
  options: ScriptOptions,
): ScriptLibrary {
  const parsed = new ScriptParser(file).parse(source);
  const catalog = options.commands;
  const scripts = new Map<string, ScriptDefinition>();
  const triggers = new Map<string, TriggerDefinition>();
  for (const script of Object.values(parsed.scripts)) {
    // Preserve empty branch headers: an else may refer to their evaluated result.
    const blocks = script.blocks.map((block) => {
      const line = block.commands[0]?.i ?? script.lineNum;
      validateLocals(block.conditional, script.parameters, file, line);
      for (const command of block.commands) {
        validateLocals(command.args, script.parameters, file, command.i);
      }
      return Object.freeze({
        condition: convertToCondition(block.conditional, file, line),
        steps: Object.freeze(
          block.commands.map((command) =>
            Object.freeze(toStep(command, file, catalog, script.parameters)),
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
        condition: convertToCondition(call.condition, file, call.line),
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
function convertToCondition(value: Conditional | boolean, file: string, line: number): Condition {
  if (typeof value === 'boolean') return value;
  if (!conditionTypes.has(value.type))
    throw new Error(`${file}:${line}: Condition ${value.type} is not supported yet`);
  const args = value.args.map((arg) => {
    if (typeof arg === 'object' && arg !== null && 'type' in arg)
      return convertToCondition(arg as Conditional, file, line);
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
  catalog: CommandCatalog,
  parameters: readonly string[],
): ScriptStep {
  if (!Object.hasOwn(catalog, command.type)) {
    throw new Error(`${file}:${command.i}: Unknown command ${command.type}`);
  }
  return catalog[command.type](command, `${file}:${command.i}`, parameters);
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

export async function loadRpgScripts(root: string, options: ScriptOptions): Promise<ScriptLibrary> {
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
        for (const target of step.targets ?? []) {
          const definition = scripts.get(target.name);
          if (!definition)
            throw new Error(`${script.file}:${step.line}: Unknown script ${target.name}`);
          checkArgumentCount(definition, target.argumentCount, `${script.file}:${step.line}`);
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

export type Dialogue = Readonly<{ actor: string; text: string; emotion?: string }>;
export type ChoicePrompt = Readonly<{ options: readonly string[] }>;
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

export type RunnerOptions<Host> = {
  commands: CommandRegistry<Host>;
  context: Host;
  writeLog?: (message: string) => void;
};

export class ScriptRunner<Host> {
  private stack: Frame[] = [];
  private readonly storage = new Map<string, string | number | boolean | undefined>();
  private readonly usedOnce = new Set<string>();
  dialogue: Dialogue | undefined;
  choice: ChoicePrompt | undefined;
  private onChoose: ((index: number) => void) | undefined;

  constructor(
    private readonly library: ScriptLibrary,
    private readonly options: RunnerOptions<Host>,
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
    this.onChoose = undefined;
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
    this.storage.set('lastChoiceIndex', index);
    this.choice = undefined;
    const onChoose = this.onChoose;
    this.onChoose = undefined;
    onChoose?.(index);
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

  private getLocalValue(name: string): RuntimeValue {
    const frame = this.stack[this.stack.length - 1];
    if (!frame?.locals.has(name)) throw new Error(`Unknown local [${name}]`);
    return frame.locals.get(name);
  }

  private getScriptValue(value: ScriptValue): RuntimeValue {
    if (typeof value === 'object') {
      return 'storageKey' in value
        ? this.storage.get(value.storageKey)
        : this.getLocalValue(value.localName);
    }
    return typeof value === 'string' ? this.interpolate(value) : value;
  }

  private interpolate(text: string): string {
    return text.replace(
      valuePlaceholder,
      (_, key: string | undefined, local: string | undefined) => {
        const value = local === undefined ? this.storage.get(key ?? '') : this.getLocalValue(local);
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
      if ('localName' in value) return this.getLocalValue(value.localName);
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
              ? Boolean(this.getLocalValue(first.localName))
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
      if (!Object.hasOwn(this.options.commands, step.command))
        throw new Error(`${frame.script.file}:${step.line}: Unknown command ${step.command}`);
      this.options.commands[step.command].run(
        step,
        this.getCommandContext(frame, step.line),
        this.options.context,
      );
      if (this.dialogue || this.choice) return;
    }
  }

  private getCommandContext(frame: Frame, line: number): CommandContext {
    const location = `${frame.script.file}:${line}`;
    return {
      location,
      value: (value) => this.getScriptValue(value),
      interpolate: (text) => this.interpolate(text),
      setStorage: (key, value) => this.storage.set(key, value),
      setLocal: (name, value) => {
        requireLocal(name, frame.script.parameters, frame.script.file, line);
        frame.locals.set(name, value);
      },
      call: (target, args) => {
        this.stack.push(this.createFrame(target, args, frame.instanceId, location));
      },
      showDialogue: (actor, text, emotion) => {
        this.dialogue = emotion ? { actor, text, emotion } : { actor, text };
      },
      showChoices: (options, onChoose) => {
        this.choice = { options };
        this.onChoose = onChoose;
      },
      writeLog: (message) => (this.options.writeLog ?? console.log)(message),
    };
  }
}
