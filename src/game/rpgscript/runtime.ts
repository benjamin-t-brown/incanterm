import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateNumericExpression, ScriptExpressionError } from './expression.js';
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
  loopTo?: number;
  loopLine?: number;
}>;
export type ScriptDefinition = Readonly<{
  name: string;
  parameters: readonly string[];
  locals: readonly string[];
  file: string;
  blocks: readonly ScriptBlock[];
}>;
export type TriggerCall = Readonly<{
  character?: string;
  intervalMs?: number;
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
    const locals = [...new Set([
      ...script.parameters,
      ...script.blocks.flatMap((block) => block.commands.flatMap((command) =>
        (command.type === 'setLocal' || (command.type === 'callScriptResult' && command.args[1] === true)) && typeof command.args[0] === 'string' &&
        /^[A-Za-z_][\w-]*$/.test(command.args[0]) ? [command.args[0]] : [])),
    ])];
    // Preserve empty branch headers: an else may refer to their evaluated result.
    const blocks = script.blocks.map((block) => {
      const line = block.commands[0]?.i ?? script.lineNum;
      validateLocals(block.conditional, locals, file, line);
      for (const command of block.commands) {
        validateLocals(command.args, locals, file, command.i);
      }
      return Object.freeze({
        condition: convertToCondition(block.conditional, file, line),
        loopTo: block.loopTo,
        loopLine: block.loopLine,
        steps: Object.freeze(
          block.commands.map((command) =>
            Object.freeze(toStep(command, file, catalog, locals)),
          ),
        ),
      });
    });
    scripts.set(
      script.name,
      Object.freeze({
        name: script.name,
        parameters: Object.freeze([...script.parameters]),
        locals: Object.freeze(locals),
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
        ...(call.intervalMs === undefined ? {} : { intervalMs: call.intervalMs }),
        ...(call.character === undefined ? {} : { character: call.character }),
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
  'func',
]);
function convertToCondition(value: Conditional | boolean, file: string, line: number): Condition {
  if (typeof value === 'boolean') return value;
  if (!conditionTypes.has(value.type))
    throw new Error(`${file}:${line}: Condition ${value.type} is not supported yet`);
  const args = value.args.map((arg) => {
    if (typeof arg === 'object' && arg !== null && 'type' in arg)
      return convertToCondition(arg as Conditional, file, line);
    if (typeof arg === 'object' && arg !== null && ('storageKey' in arg || 'localName' in arg || 'expression' in arg))
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
      : value.type === 'func'
        ? args.length === 2 && args[0] === 'hasItem' &&
          !(typeof args[1] === 'object' && 'type' in args[1])
      : value.type === 'else' || value.type === 'branch'
        ? args.length >= (1) &&
          (value.type === 'else' || args.length === 1) &&
          args.every((arg) => Number.isInteger(arg) && (arg as number) >= 0)
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
      checkArgumentCount(definition, call.character === undefined ? 0 : 1, `${trigger.file}:${call.line}`);
    }
  return libraryWithTriggers(scripts, triggers);
}

function isMissingDirectory(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export type Dialogue = Readonly<{ actor: string; text: string; emotion?: string }>;
export type ChoicePrompt = Readonly<{ options: readonly string[] }>;
const maxLoopPasses = 1000;
const valuePlaceholder = /\{([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\}|\[([A-Za-z_][\w-]*)\]/g;
type Frame = {
  onReturn?: (value: RuntimeValue) => void;
  script: ScriptDefinition;
  locals: Map<string, RuntimeValue>;
  block: number;
  next: number;
  passed?: boolean;
  instanceId?: string;
  results?: Map<number, boolean>;
  /** Completed passes of each active `while`, keyed by its header block. */
  loopPasses?: Map<number, number>;
};

export type RunnerOptions<Host> = {
  isCharacterBusy?: (ownerId: string) => boolean;
  getCharacterId?: (reference: string) => string;
  commands: CommandRegistry<Host>;
  context: Host;
  writeLog?: (message: string) => void;
  onCommandError?: (error: unknown, location: string) => void;
  background?: boolean;
};

export class ScriptRunner<Host> {
  private stack: Frame[] = [];
  private storage = new Map<string, RuntimeValue>();
  private usedOnce = new Set<string>();
  private subscripts = new Map<string, ScriptRunner<Host>>();
  dialogue: Dialogue | undefined;
  centerToast: string | undefined;
  choice: ChoicePrompt | undefined;
  private onChoose: ((index: number) => void) | undefined;
  private isWaitComplete: (() => boolean) | undefined;
  private waitLocation: string | undefined;
  private timers: { trigger: TriggerDefinition; index: number; elapsed: number }[] = [];

  constructor(
    private readonly library: ScriptLibrary,
    private readonly options: RunnerOptions<Host>,
  ) {}

  getStorage(key: string): RuntimeValue {
    return this.storage.get(key);
  }
  setStorage(key: string, value: RuntimeValue): void {
    this.storage.set(key, value);
  }

  isIdle(): boolean {
    return this.stack.length === 0 && !this.dialogue && !this.choice && this.centerToast === undefined;
  }

  start(name: string, args: readonly RuntimeValue[] = []): void {
    this.stack = [this.createFrame(name, args)];
    this.dialogue = this.choice = undefined;
    this.centerToast = undefined;
    this.onChoose = undefined;
    this.isWaitComplete = undefined;
    this.waitLocation = undefined;
    this.run();
  }

  update(): void {
    if (!this.options.background) {
      for (const [ownerId, child] of [...this.subscripts]) {
        child.update();
        if (child.isIdle()) this.subscripts.delete(ownerId);
      }
    }
    if (!this.isWaitComplete) return;
    try {
      if (!this.isWaitComplete()) return;
    } catch (error) {
      const location = this.waitLocation ?? '<waiting command>';
      this.isWaitComplete = undefined;
      this.waitLocation = undefined;
      if (!this.options.onCommandError) throw error;
      this.options.onCommandError(error, location);
      this.run();
      return;
    }
    this.isWaitComplete = undefined;
    this.waitLocation = undefined;
    this.run();
  }

  clearSubscripts(): void {
    this.subscripts.clear();
  }

  private callSubscript(ownerId: string, target: string, location: string): void {
    if (this.subscripts.has(ownerId) || this.options.isCharacterBusy?.(ownerId)) return;
    const child = new ScriptRunner(this.library, { ...this.options, background: true });
    child.storage = this.storage;
    child.usedOnce = this.usedOnce;
    child.subscripts = this.subscripts;
    child.stack = [child.createFrame(target, [ownerId], ownerId, location)];
    this.subscripts.set(ownerId, child);
    try {
      child.run();
    } catch (error) {
      this.subscripts.delete(ownerId);
      throw error;
    } finally {
      if (child.isIdle()) this.subscripts.delete(ownerId);
    }
  }

  restartTimers(names: readonly string[]): void {
    this.timers = [];
    for (const name of new Set(names)) {
      const trigger = this.library.triggers.get(name);
      trigger?.calls.forEach((call, index) => {
        if (call.type === TriggerType.TIMER) this.timers.push({ trigger, index, elapsed: 0 });
      });
    }
  }

  updateTimers(elapsedMs: number): void {
    for (const timer of this.timers) {
      const call = timer.trigger.calls[timer.index];
      const interval = call.intervalMs ?? 1000;
      timer.elapsed += elapsedMs;
      if (timer.elapsed < interval || (call.character === undefined && !this.isIdle())) continue;
      // Coalesce missed ticks instead of flooding the runner after a delay.
      timer.elapsed %= interval;
      this.dispatchTrigger(timer.trigger.name, TriggerType.TIMER, undefined, timer.index);
    }
  }

  dispatchTrigger(name: string, event: TriggerType, instanceId?: string, callIndex?: number): boolean {
    const trigger = this.library.triggers.get(name);
    if (!trigger) return false;
    for (let index = 0; index < trigger.calls.length; index++) {
      const call = trigger.calls[index];
      if (callIndex !== undefined && index !== callIndex) continue;
      if (call.type !== event) continue;
      if (call.character !== undefined && event === TriggerType.TIMER) {
        if (this.dispatchCharacterTimer(trigger, index)) return true;
        continue;
      }
      if (!this.isIdle()) continue;
      const pending = new Set<string>();
      try {
        if (!this.evaluate(call.condition, `${trigger.name}:${event}:${index}`, pending, instanceId))
          continue;
      } catch (error) {
        if (!(error instanceof ScriptExpressionError)) throw error;
        this.stopForExpressionError(error, `${trigger.file}:${call.line} (trigger condition)`);
        return false;
      }
      const frame = this.createFrame(call.target, [], instanceId, `${trigger.file}:${call.line}`);
      for (const key of pending) this.usedOnce.add(key);
      this.stack = [frame];
      this.run();
      return true;
    }
    return false;
  }

  private dispatchCharacterTimer(trigger: TriggerDefinition, index: number): boolean {
    const call = trigger.calls[index];
    const location = `${trigger.file}:${call.line} (character timer)`;
    try {
      if (!this.options.getCharacterId || call.character === undefined)
        throw new Error('Character timers require a character resolver');
      const ownerId = this.options.getCharacterId(call.character);
      if (this.subscripts.has(ownerId) || this.options.isCharacterBusy?.(ownerId)) return false;
      const pending = new Set<string>();
      if (!this.evaluate(call.condition, `${trigger.name}:${TriggerType.TIMER}:${index}`, pending, ownerId)) return false;
      checkArgumentCount(this.requireScript(call.target), 1, location);
      for (const key of pending) this.usedOnce.add(key);
      this.callSubscript(ownerId, call.target, location);
      return true;
    } catch (error) {
      if (!this.options.onCommandError) throw error;
      this.options.onCommandError(error, location);
      return false;
    }
  }

  advance(): void {
    if (!this.dialogue) return;
    this.dialogue = undefined;
    this.run();
  }

  dismissCenterToast(): void {
    if (this.centerToast === undefined) return;
    this.centerToast = undefined;
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
      locals: new Map([
        ...script.locals.map((name) => [name, undefined] as const),
        ...script.parameters.map((parameter, index) => [parameter, args[index]] as const),
      ]),
    };
  }

  private getLocalValue(name: string): RuntimeValue {
    const frame = this.stack[this.stack.length - 1];
    if (!frame?.locals.has(name)) throw new Error(`Unknown local [${name}]`);
    return frame.locals.get(name);
  }

  private getScriptValue(value: ScriptValue): RuntimeValue {
    if (typeof value === 'object') {
      if ('expression' in value) return evaluateNumericExpression(value.expression,
        (name, local) => local ? this.getLocalValue(name) : this.storage.get(name));
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

  private resolve(value: Condition | ScriptValue): RuntimeValue {
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
      if ('expression' in value) return this.getScriptValue(value);
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
      return args.every((arg) => {
        const previous = results?.get(arg as number);
        if (previous === undefined) throw new Error('else() has no evaluated preceding branch');
        return !previous;
      });
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
    if (type === 'func') {
      const item = this.getScriptValue(args[1] as ScriptValue);
      const inventory = this.storage.get('vars.inventory');
      return typeof item === 'string' && Array.isArray(inventory) && inventory.includes(item);
    }
    const first = args[0];
    if (type === 'is' || type === 'isnot') {
      const result =
        typeof first === 'object'
          ? 'storageKey' in first
            ? Boolean(this.storage.get(first.storageKey))
            : 'expression' in first
              ? Boolean(this.getScriptValue(first))
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
      const frame = this.stack[this.stack.length - 1];
      const block = frame.script.blocks[frame.block];
      if (--budget < 0) {
        const line = block?.steps[0]?.line ?? block?.loopLine ?? 1;
        this.stopForExpressionError(
          new ScriptExpressionError('RPGScript exceeded immediate work budget'),
          `${frame.script.file}:${line}`,
        );
        return;
      }
      if (!block) {
        this.stack.pop();
        frame.onReturn?.(undefined);
        continue;
      }
      if (frame.passed === undefined) {
        const pending = new Set<string>();
        try {
          frame.passed = this.evaluate(
            block.condition,
            `${frame.script.name}:${frame.block}`,
            pending,
            frame.instanceId,
            frame.results,
          );
        } catch (error) {
          if (!(error instanceof ScriptExpressionError)) throw error;
          this.stopForExpressionError(error, `${frame.script.file}:${block.steps[0]?.line ?? 1} (condition)`);
          return;
        }
        if (!frame.results) frame.results = new Map();
        frame.results.set(frame.block, frame.passed);
        if (frame.passed) for (const key of pending) this.usedOnce.add(key);
        // A failed header ends its loop; a later re-entry starts counting again.
        else frame.loopPasses?.delete(frame.block);
      }
      const step = frame.passed ? block.steps[frame.next++] : undefined;
      if (!step) {
        if (frame.passed && block.loopTo !== undefined) {
          if (!this.advanceLoopPass(frame, block.loopTo)) {
            this.stopForExpressionError(
              new ScriptExpressionError(`while loop exceeded ${maxLoopPasses} iterations`),
              `${frame.script.file}:${block.loopLine ?? 1} (while)`,
            );
            return;
          }
          this.jumpToBlock(frame, block.loopTo, block.loopTo);
          continue;
        }
        frame.block++;
        frame.next = 0;
        frame.passed = undefined;
        continue;
      }
      if (!Object.hasOwn(this.options.commands, step.command))
        throw new Error(`${frame.script.file}:${step.line}: Unknown command ${step.command}`);
      try {
        this.options.commands[step.command].run(
          step,
          this.getCommandContext(frame, step.line, step.command),
          this.options.context,
        );
      } catch (error) {
        if (error instanceof ScriptExpressionError) {
          this.stopForExpressionError(error, `${frame.script.file}:${step.line} (+${step.command})`);
          return;
        }
        if (!this.options.onCommandError) throw error;
        this.isWaitComplete = undefined;
        this.waitLocation = undefined;
        this.options.onCommandError(error, `${frame.script.file}:${step.line} (+${step.command})`);
      }
      if (this.dialogue || this.choice || this.centerToast !== undefined || this.isWaitComplete) return;
    }
  }

  /** Counts one more pass of a loop; false once it has run too many times. */
  private advanceLoopPass(frame: Frame, header: number): boolean {
    if (!frame.loopPasses) frame.loopPasses = new Map();
    const passes = (frame.loopPasses.get(header) ?? 0) + 1;
    frame.loopPasses.set(header, passes);
    return passes < maxLoopPasses;
  }

  /** Moves to a block, discarding branch results from `fromBlock` on so they re-evaluate. */
  private jumpToBlock(frame: Frame, target: number, fromBlock: number): void {
    for (const index of frame.results?.keys() ?? [])
      if (index >= fromBlock) frame.results?.delete(index);
    frame.block = target;
    frame.next = 0;
    frame.passed = undefined;
  }

  private stopForExpressionError(error: ScriptExpressionError, location: string): void {
    this.stack = [];
    this.isWaitComplete = undefined;
    this.waitLocation = undefined;
    if (!this.options.onCommandError) throw error;
    this.options.onCommandError(error, location);
  }

  private getCommandContext(frame: Frame, line: number, command: string): CommandContext {
    const location = `${frame.script.file}:${line}`;
    return {
      location,
      value: (value) => this.getScriptValue(value),
      interpolate: (text) => this.interpolate(text),
      setStorage: (key, value) => this.storage.set(key, value),
      getStorage: (key) => this.storage.get(key),
      setLocal: (name, value) => {
        requireLocal(name, frame.script.locals, frame.script.file, line);
        frame.locals.set(name, value);
      },
      call: (target, args) => {
        this.stack.push(this.createFrame(target, args, frame.instanceId, location));
      },
      callWithResult: (target, args, destination, local) => {
        if (local) requireLocal(destination, frame.script.locals, frame.script.file, line);
        const child = this.createFrame(target, args, frame.instanceId, location);
        child.onReturn = (value) => {
          if (local) frame.locals.set(destination, value);
          else this.storage.set(destination, value);
        };
        this.stack.push(child);
      },
      returnValue: (value) => {
        this.stack.pop();
        frame.onReturn?.(value);
      },
      breakLoop: (target, header) => {
        frame.loopPasses?.delete(header);
        this.jumpToBlock(frame, target, header);
      },
      continueLoop: (header) => {
        if (!this.advanceLoopPass(frame, header))
          throw new ScriptExpressionError(`while loop exceeded ${maxLoopPasses} iterations`);
        this.jumpToBlock(frame, header, header);
      },
      callSubscript: (ownerId, target) => this.callSubscript(ownerId, target, location),
      showDialogue: (actor, text, emotion) => {
        if (this.options.background) throw new Error(`${location}: Character subscripts cannot show dialogue`);
        this.dialogue = emotion ? { actor, text, emotion } : { actor, text };
      },
      showCenterToast: (message) => {
        if (this.options.background) throw new Error(`${location}: Character subscripts cannot show a center toast`);
        this.centerToast = message;
      },
      showChoices: (options, onChoose) => {
        if (this.options.background) throw new Error(`${location}: Character subscripts cannot show choices`);
        this.choice = { options };
        this.onChoose = onChoose;
      },
      waitUntil: (isComplete) => {
        if (!isComplete()) {
          this.isWaitComplete = isComplete;
          this.waitLocation = `${location} (+${command})`;
        }
      },
      writeLog: (message) => (this.options.writeLog ?? console.log)(message),
    };
  }
}
