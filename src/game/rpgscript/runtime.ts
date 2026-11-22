import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateNumericExpression, ScriptExpressionError } from './expression.js';
import {
  ScriptParser,
  TriggerType,
  type Command,
  type Conditional,
  type ScriptValue,
} from './parser.js';
import type {
  CommandContext,
  RuntimeValue,
  CompiledCommand,
  CommandRegistry,
  CommandCatalog,
} from './command.js';
export type ScriptStep = CompiledCommand & Readonly<{ condition?: Condition }>;
export type Condition =
  | boolean
  | Readonly<{ type: string; args: readonly (Condition | ScriptValue)[] }>;
export type ScriptBlock = Readonly<{
  condition: Condition;
  conditionLine?: number;
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
      ...script.blocks.flatMap((block) => block.commands.flatMap((command) => {
        if (command.result && 'localName' in command.result) return [command.result.localName];
        return (command.type === 'setLocal' || (command.type === 'callScriptResult' && command.args[1] === true)) &&
          typeof command.args[0] === 'string' && /^[A-Za-z_][\w-]*$/.test(command.args[0])
          ? [command.args[0]] : [];
      })),
    ])];
    // Preserve empty branch headers: an else may refer to their evaluated result.
    const blocks = script.blocks.map((block) => {
      const line = block.conditionLine ?? block.commands[0]?.i ?? script.lineNum;
      validateLocals(block.conditional, locals, file, line);
      for (const command of block.commands) {
        validateLocals(command.args, locals, file, command.i);
        validateLocals(command.condition, locals, file, command.i);
      }
      return Object.freeze({
        condition: convertToCondition(block.conditional, file, line),
        ...(block.conditionLine === undefined ? {} : { conditionLine: block.conditionLine }),
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
      const condition = convertToCondition(call.condition, file, call.line);
      if (getConditionTargets(condition).length)
        throw new Error(`${file}:${call.line}: Script calls are not supported in trigger conditions`);
      return Object.freeze({
        type: call.type as TriggerType,
        condition,
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
  'gte',
  'lt',
  'lte',
  'any',
  'all',
  'else',
  'branch',
  'once',
  'oncePerInstance',
  'func',
  'in',
  'scriptResult',
  'switchValue',
  'switchCase',
  'switchDefault',
]);
function convertToCondition(value: Conditional | boolean, file: string, line: number): Condition {
  if (typeof value === 'boolean') return value;
  if (!conditionTypes.has(value.type))
    throw new Error(`${file}:${line}: Condition ${value.type} is not supported yet`);
  const args = value.args.map((arg) => {
    if (typeof arg === 'object' && arg !== null && 'type' in arg)
      return convertToCondition(arg as Conditional, file, line);
    if (typeof arg === 'object' && arg !== null && ('storageKey' in arg || 'localName' in arg || 'expression' in arg || 'literal' in arg || 'quoted' in arg || 'list' in arg || 'indexed' in arg))
      return Object.freeze({ ...(arg as Exclude<ScriptValue, string | number | boolean>) });
    if (typeof arg === 'string') {
      return arg;
    }
    if (typeof arg === 'number' || typeof arg === 'boolean') return arg;
    throw new Error(`${file}:${line}: Invalid argument for condition ${value.type}`);
  });
  const isComparison = ['eq', 'gt', 'gte', 'lt', 'lte', 'in'].includes(value.type);
  const arity =
    value.type === 'switchValue' ? args.length === 2 && Number.isInteger(args[1])
      : value.type === 'switchCase' ? args.length >= 2 && Number.isInteger(args[0]) && args.slice(2).every(Number.isInteger)
      : value.type === 'switchDefault' ? args.length >= 1 && args.every(Number.isInteger)
      : value.type === 'scriptResult'
        ? typeof args[0] === 'string' && /^[\w-]+$/.test(args[0])
      : value.type === 'any' || value.type === 'all'
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
      : isComparison
             ? args.length === 2
             : args.length === 1;
  const nested = args.filter((arg) => typeof arg === 'object' && 'type' in arg) as Exclude<Condition, boolean>[];
  if (
    !arity ||
    ((value.type === 'once' || value.type === 'oncePerInstance') &&
      args.length === 1 &&
      typeof args[0] !== 'string') ||
    (isComparison && nested.some((arg) => arg.type !== 'scriptResult')) ||
    ((value.type === 'else' ||
       value.type === 'branch' ||
       value.type === 'once' ||
       value.type === 'oncePerInstance' ||
       value.type === 'scriptResult') &&
       nested.length > 0) ||
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
  if (command.condition !== undefined && command.result) {
    const condition = convertToCondition(command.condition, file, command.i);
    return {
      command: command.type, line: command.i, condition, result: Object.freeze(command.result),
      targets: Object.freeze(getConditionTargets(condition)),
    };
  }
  if (!Object.hasOwn(catalog, command.type)) {
    throw new Error(`${file}:${command.i}: Unknown command ${command.type}`);
  }
  return catalog[command.type](command, `${file}:${command.i}`, parameters);
}

function getConditionTargets(condition: Condition | ScriptValue): { name: string; argumentCount: number }[] {
  if (typeof condition !== 'object' || !('type' in condition)) return [];
  if (condition.type === 'scriptResult')
    return [{ name: condition.args[0] as string, argumentCount: condition.args.length - 1 }];
  return condition.args.flatMap(getConditionTargets);
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
    if ('literal' in value) return;
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
  function validateTarget(name: string, argumentCount: number, location: string): void {
    const definition = scripts.get(name);
    if (!definition) throw new Error(`${location}: Unknown script ${name}`);
    checkArgumentCount(definition, argumentCount, location);
  }
  for (const script of scripts.values()) {
    for (const block of script.blocks) {
      for (const target of getConditionTargets(block.condition))
        validateTarget(target.name, target.argumentCount, `${script.file}:${block.conditionLine ?? 1}`);
      for (const step of block.steps)
        for (const target of step.targets ?? [])
          validateTarget(target.name, target.argumentCount, `${script.file}:${step.line}`);
    }
  }
  for (const trigger of triggers.values())
    for (const call of trigger.calls) {
      validateTarget(call.target, call.character === undefined ? 0 : 1, `${trigger.file}:${call.line}`);
    }
  return libraryWithTriggers(scripts, triggers);
}

function isMissingDirectory(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export type Dialogue = Readonly<{ actor: string; text: string; emotion?: string }>;
export type ChoicePrompt = Readonly<{ options: readonly string[]; question?: string }>;
const maxLoopPasses = 1000;
const valuePlaceholder = /\{([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\}|\[([A-Za-z_][\w-]*)\]/g;
type ConditionCall = { target: string; args: readonly RuntimeValue[] };
type ConditionEvaluation = Generator<ConditionCall, boolean, RuntimeValue>;
type ConditionScope = {
  key: string;
  pendingOnce: Set<string>;
  instanceId?: string;
  results?: ReadonlyMap<number, boolean>;
  switchValues?: Map<number, RuntimeValue>;
};
type PendingCondition = {
  evaluation: ConditionEvaluation;
  scope: ConditionScope;
  location: string;
  complete: (passed: boolean) => void;
  returned?: RuntimeValue;
};
type Frame = {
  onReturn?: (value: RuntimeValue) => void;
  script: ScriptDefinition;
  locals: Map<string, RuntimeValue>;
  block: number;
  next: number;
  passed?: boolean;
  pendingCondition?: PendingCondition;
  instanceId?: string;
  results?: Map<number, boolean>;
  switchValues?: Map<number, RuntimeValue>;
  /** Completed passes of each active `while`, keyed by its header block. */
  loopPasses?: Map<number, number>;
};

export type RunnerOptions<Host> = {
  hasItem?: (inventory: RuntimeValue, reference: string) => boolean;
  isCharacterBusy?: (ownerId: string) => boolean;
  getCharacterId?: (reference: string) => string;
  commands: CommandRegistry<Host>;
  context: Host;
  writeLog?: (message: string) => void;
  onCommandError?: (error: unknown, location: string) => void;
  background?: boolean;
};

type TimerBinding = {
  trigger: TriggerDefinition;
  index: number;
  elapsed: number;
  scope: 'scene' | 'session';
};

export class ScriptRunner<Host> {
  private stack: Frame[] = [];
  private storage = new Map<string, RuntimeValue>();
  private usedOnce = new Set<string>();
  private subscripts = new Map<string, ScriptRunner<Host>>();
  dialogue: Dialogue | undefined;
  private finishDialogue: (() => void) | undefined;
  centerToast: string | undefined;
  choice: ChoicePrompt | undefined;
  private onChoose: ((index: number) => void) | undefined;
  private isWaitComplete: (() => boolean) | undefined;
  private waitLocation: string | undefined;
  private timers: TimerBinding[] = [];

  constructor(
    private readonly library: ScriptLibrary,
    private readonly options: RunnerOptions<Host>,
  ) {}

  /** Script-visible variables live under `global.`; engine keys such as `dialogue.active` stay raw. */
  getGlobal(key: string): RuntimeValue {
    return this.storage.get(`global.${key}`);
  }
  setGlobal(key: string, value: RuntimeValue): void {
    this.storage.set(`global.${key}`, value);
  }

  getVariableState() {
    return {
      globals: Object.fromEntries(
        [...this.storage].filter(([key]) => key.startsWith('global.'))
          .map(([key, value]) => [key.slice('global.'.length), value] as const),
      ),
      foreground: this.getStackVariables(),
      background: [...this.subscripts].map(([ownerId, runner]) => ({
        ownerId, frames: runner.getStackVariables(),
      })),
    };
  }

  private getStackVariables() {
    return this.stack.map((frame) => ({
      script: frame.script.name, locals: Object.fromEntries(frame.locals),
    }));
  }

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
    this.clearDialogue();
    this.choice = undefined;
    this.centerToast = undefined;
    this.onChoose = undefined;
    this.isWaitComplete = undefined;
    this.waitLocation = undefined;
    this.run();
  }

  /** Abort the foreground interaction without advancing dialogue, choices, or waits. */
  cancel(): void {
    this.stack = [];
    this.clearDialogue();
    this.choice = undefined;
    this.centerToast = undefined;
    this.onChoose = undefined;
    this.isWaitComplete = undefined;
    this.waitLocation = undefined;
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

  clearSubscript(ownerId: string): void {
    this.subscripts.delete(ownerId);
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

  startTimers(sceneNames: readonly string[], sessionNames: readonly string[]): void {
    this.timers = this.getTimerBindings(sessionNames, 'session');
    this.restartTimers(sceneNames);
  }

  /** Replace only the scene timers; session timers keep their elapsed time. */
  restartTimers(names: readonly string[]): void {
    const sessionTimers = this.timers.filter((timer) => timer.scope === 'session');
    const sessionNames = new Set(sessionTimers.map((timer) => timer.trigger.name));
    this.timers = [
      ...sessionTimers,
      ...this.getTimerBindings(names.filter((name) => !sessionNames.has(name)), 'scene'),
    ];
  }

  private getTimerBindings(names: readonly string[], scope: TimerBinding['scope']): TimerBinding[] {
    const timers: TimerBinding[] = [];
    for (const name of new Set(names)) {
      const trigger = this.library.triggers.get(name);
      trigger?.calls.forEach((call, index) => {
        if (call.type === TriggerType.TIMER) timers.push({ trigger, index, elapsed: 0, scope });
      });
    }
    return timers;
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
        if (!this.getTriggerConditionResult(call.condition, {
          key: `${trigger.name}:${event}:${index}`, pendingOnce: pending, instanceId,
        }))
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
      if (!this.getTriggerConditionResult(call.condition, {
        key: `${trigger.name}:${TriggerType.TIMER}:${index}`, pendingOnce: pending, instanceId: ownerId,
      })) return false;
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
    this.clearDialogue();
    this.run();
  }

  private clearDialogue(): void {
    this.dialogue = undefined;
    const finishDialogue = this.finishDialogue;
    this.finishDialogue = undefined;
    finishDialogue?.();
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
    this.setGlobal('lastChoiceIndex', index);
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
      if ('literal' in value) return value.literal;
      if ('quoted' in value) return this.interpolate(value.quoted);
      if ('list' in value) return value.list.map((item) => this.getScriptValue(item));
      if ('indexed' in value) {
        const list = this.getScriptValue(value.indexed.list);
        const index = this.getScriptValue(value.indexed.index);
        if (!Array.isArray(list) || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= list.length)
          throw new ScriptExpressionError('Indexed read requires a list and an existing integer index');
        return list[index];
      }
      if ('expression' in value) return evaluateNumericExpression(value.expression,
        (name, local) => local ? this.getLocalValue(name) : this.getGlobal(name));
      return 'storageKey' in value
        ? this.getGlobal(value.storageKey)
        : this.getLocalValue(value.localName);
    }
    return typeof value === 'string' ? this.interpolate(value) : value;
  }

  private interpolate(text: string): string {
    return text.replace(
      valuePlaceholder,
      (_, key: string | undefined, local: string | undefined) => {
        const value = local === undefined ? this.getGlobal(key ?? '') : this.getLocalValue(local);
        return value === undefined ? '' : String(value);
      },
    );
  }

  private resolve(value: Condition | ScriptValue): RuntimeValue {
    if (typeof value === 'string') {
      const text = this.interpolate(value);
      return this.storage.has(`global.${text}`)
        ? this.getGlobal(text)
        : text === 'true'
          ? true
          : text === 'false'
            ? false
            : text;
    }
    if (typeof value === 'object') {
      if ('literal' in value) return value.literal;
      if ('list' in value || 'indexed' in value || 'quoted' in value) return this.getScriptValue(value);
      if ('expression' in value) return this.getScriptValue(value);
      if ('storageKey' in value) return this.getGlobal(value.storageKey);
      if ('localName' in value) return this.getLocalValue(value.localName);
      throw new Error('Nested condition is not a value');
    }
    return value;
  }

  private getTriggerConditionResult(condition: Condition, scope: ConditionScope): boolean {
    const result = this.evaluate(condition, scope).next();
    if (!result.done) throw new Error('Script calls are not supported in trigger conditions');
    return result.value;
  }

  private *getConditionValue(value: Condition | ScriptValue): Generator<ConditionCall, RuntimeValue, RuntimeValue> {
    if (typeof value === 'object' && 'type' in value && value.type === 'scriptResult') {
      return yield {
        target: value.args[0] as string,
        args: value.args.slice(1).map((arg) => this.getScriptValue(arg as ScriptValue)),
      };
    }
    return this.resolve(value);
  }

  private *evaluate(condition: Condition, scope: ConditionScope): ConditionEvaluation {
    if (typeof condition === 'boolean') return condition;
    const { pendingOnce, instanceId, results, switchValues } = scope;
    const { type, args } = condition;
    if (type === 'scriptResult') return Boolean(yield* this.getConditionValue(condition));
    if (type === 'switchValue') {
      if (!switchValues) throw new Error('switch requires a script frame');
      switchValues.set(args[1] as number, yield* this.getConditionValue(args[0]));
      return true;
    }
    if (type === 'switchCase' || type === 'switchDefault') {
      const header = args[0] as number;
      if (!switchValues?.has(header)) throw new Error('switch has no evaluated value');
      const previous = args.slice(type === 'switchCase' ? 2 : 1) as number[];
      if (previous.some((index) => results?.get(index) === true)) return false;
      if (type === 'switchDefault') return true;
      const label = args[1];
      const selected = switchValues.get(header);
      const candidate = typeof label === 'object' && 'type' in label && label.type !== 'scriptResult'
        ? yield* this.evaluate(label, scope)
        : yield* this.getConditionValue(label);
      return selected === candidate || (typeof label === 'number' && selected === String(label));
    }
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
    if (type === 'all') {
      for (const arg of args)
        if (!(yield* this.evaluate(arg as Condition, scope))) return false;
      return true;
    }
    if (type === 'any') {
      for (const arg of args) {
        const branch = new Set(pendingOnce);
        if (yield* this.evaluate(arg as Condition, { ...scope, pendingOnce: branch })) {
          for (const key of branch) pendingOnce.add(key);
          return true;
        }
      }
      return false;
    }
    if (type === 'once' || type === 'oncePerInstance') {
      if (type === 'oncePerInstance' && !instanceId)
        throw new Error('oncePerInstance requires an explicit instanceId');
      const name = typeof args[0] === 'string' ? this.interpolate(args[0]) : undefined;
      const key = `${type}:${name || scope.key}${type === 'oncePerInstance' ? `:${instanceId}` : ''}`;
      if (this.usedOnce.has(key)) return false;
      pendingOnce.add(key);
      return true;
    }
    if (type === 'func') {
      const item = this.getScriptValue(args[1] as ScriptValue);
      const inventory = this.getGlobal('vars.inventory');
      return typeof item === 'string' && (this.options.hasItem
        ? this.options.hasItem(inventory, item)
        : Array.isArray(inventory) && inventory.some((entry) => entry === item ||
          entry && typeof entry === 'object' && !Array.isArray(entry) && entry.itemId === item));
    }
    const first = args[0];
    if (type === 'is' || type === 'isnot') {
      const result =
         typeof first === 'object'
           ? 'type' in first && first.type !== 'scriptResult'
             ? yield* this.evaluate(first, scope)
             : Boolean(yield* this.getConditionValue(first))
          : first === 'true'
            ? true
            : first === 'false'
              ? false
              : typeof first === 'string'
                ? Boolean(this.getGlobal(this.interpolate(first)))
                : Boolean(first);
      return type === 'is' ? result : !result;
    }
    const left = yield* this.getConditionValue(first);
    const right = yield* this.getConditionValue(args[1]);
    if (type === 'in') return Array.isArray(right) && typeof left === 'number' && Number.isInteger(left) && left >= 0 && left < right.length;
    if (type === 'eq') return left !== undefined && right !== undefined && left === right;
    if (type === 'gt' || type === 'gte' || type === 'lt' || type === 'lte') {
      const leftNumber = typeof left === 'string' && left.trim() !== '' ? Number(left) : left;
      const rightNumber = typeof right === 'string' && right.trim() !== '' ? Number(right) : right;
      if (typeof leftNumber !== 'number' || !Number.isFinite(leftNumber) ||
        typeof rightNumber !== 'number' || !Number.isFinite(rightNumber))
        throw new Error(`${type} requires numeric values`);
      if (type === 'gt') return leftNumber > rightNumber;
      if (type === 'gte') return leftNumber >= rightNumber;
      if (type === 'lt') return leftNumber < rightNumber;
      return leftNumber <= rightNumber;
    }
    throw new Error(`Condition ${type} is not supported`);
  }

  private setPendingCondition(
    frame: Frame, condition: Condition, key: string, location: string, complete: (passed: boolean) => void,
  ): void {
    frame.switchValues ??= new Map();
    const scope: ConditionScope = {
      key, pendingOnce: new Set(), instanceId: frame.instanceId,
      results: frame.results, switchValues: frame.switchValues,
    };
    frame.pendingCondition = { scope, location, complete, evaluation: this.evaluate(condition, scope) };
  }

  private advanceCondition(frame: Frame, pending: PendingCondition): boolean {
    const result = pending.evaluation.next(pending.returned);
    if (!result.done) {
      const { target, args } = result.value;
      const child = this.createFrame(target, args, frame.instanceId, pending.location);
      child.onReturn = (value) => { pending.returned = value; };
      this.stack.push(child);
      return false;
    }
    frame.pendingCondition = undefined;
    if (result.value) for (const key of pending.scope.pendingOnce) this.usedOnce.add(key);
    pending.complete(result.value);
    return true;
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
      if (frame.passed === undefined && !frame.pendingCondition) {
        frame.results ??= new Map();
        const evaluatedBlock = frame.block;
        const setBlockResult = (passed: boolean) => {
          frame.passed = passed;
          frame.results?.set(evaluatedBlock, passed);
          // A failed header ends its loop; a later re-entry starts counting again.
          if (!passed) frame.loopPasses?.delete(evaluatedBlock);
        };
        if (block.condition === true) setBlockResult(true);
        else this.setPendingCondition(
          frame, block.condition, `${frame.script.name}:${frame.block}`,
          `${frame.script.file}:${block.conditionLine ?? block.steps[0]?.line ?? 1}`, setBlockResult,
        );
      }
      if (frame.pendingCondition) {
        const pending = frame.pendingCondition;
        try {
          if (!this.advanceCondition(frame, pending)) continue;
        } catch (error) {
          if (!(error instanceof ScriptExpressionError)) throw error;
          this.stopForExpressionError(error, `${pending.location} (condition)`);
          return;
        }
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
      if (step.condition !== undefined && step.result) {
        const destination = step.result;
        this.setPendingCondition(
          frame, step.condition, `${frame.script.name}:condition:${step.line}`,
          `${frame.script.file}:${step.line}`, (passed) => {
            if ('localName' in destination) frame.locals.set(destination.localName, passed);
            else this.setGlobal(destination.storageKey, passed);
          },
        );
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
    for (const index of frame.switchValues?.keys() ?? [])
      if (index >= fromBlock) frame.switchValues?.delete(index);
    frame.block = target;
    frame.next = 0;
    frame.passed = undefined;
    frame.pendingCondition = undefined;
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
      background: this.options.background,
      value: (value) => this.getScriptValue(value),
      interpolate: (text) => this.interpolate(text),
      setStorage: (key, value) => this.storage.set(key, value),
      getStorage: (key) => this.storage.get(key),
      setGlobal: (key, value) => this.setGlobal(key, value),
      getGlobal: (key) => this.getGlobal(key),
      setLocal: (name, value) => {
        requireLocal(name, frame.script.locals, frame.script.file, line);
        frame.locals.set(name, value);
      },
      getLocal: (name) => this.getLocalValue(name),
      call: (target, args) => {
        this.stack.push(this.createFrame(target, args, frame.instanceId, location));
      },
      callWithResult: (target, args, destination, local) => {
        if (local) requireLocal(destination, frame.script.locals, frame.script.file, line);
        const child = this.createFrame(target, args, frame.instanceId, location);
        child.onReturn = (value) => {
          if (local) frame.locals.set(destination, value);
          else this.setGlobal(destination, value);
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
      showDialogue: (actor, text, emotion, onFinish) => {
        if (this.options.background) throw new Error(`${location}: Character subscripts cannot show dialogue`);
        this.clearDialogue();
        this.dialogue = emotion ? { actor, text, emotion } : { actor, text };
        this.finishDialogue = onFinish;
      },
      showCenterToast: (message) => {
        if (this.options.background) throw new Error(`${location}: Character subscripts cannot show a center toast`);
        this.centerToast = message;
      },
      showChoices: (options, onChoose, question) => {
        if (this.options.background) throw new Error(`${location}: Character subscripts cannot show choices`);
        this.choice = question === undefined ? { options } : { options, question };
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
