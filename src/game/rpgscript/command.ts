import type { Command, ScriptValue } from './parser.js';

export type RuntimeValue = string | number | boolean | readonly RuntimeValue[] | { readonly [key: string]: RuntimeValue } | undefined;

// Only interpreter operations belong here. Host state is a separate generic argument.
export type CommandContext = {
  location: string;
  background?: boolean;
  value: (value: ScriptValue) => RuntimeValue;
  interpolate: (text: string) => string;
  setStorage: (key: string, value: RuntimeValue) => void;
  getStorage: (key: string) => RuntimeValue;
  setGlobal: (key: string, value: RuntimeValue) => void;
  getGlobal: (key: string) => RuntimeValue;
  setLocal: (name: string, value: RuntimeValue) => void;
  getLocal: (name: string) => RuntimeValue;
  call: (target: string, args: readonly RuntimeValue[]) => void;
  callWithResult: (target: string, args: readonly RuntimeValue[], destination: string, local: boolean) => void;
  returnValue: (value: RuntimeValue) => void;
  breakLoop: (target: number, header: number) => void;
  continueLoop: (header: number) => void;
  callSubscript: (ownerId: string, target: string) => void;
  showDialogue: (actor: string, text: string, emotion?: string, onFinish?: () => void) => void;
  showCenterToast: (message: string) => void;
  showChoices: (options: readonly string[], onChoose?: (index: number) => void, question?: string) => void;
  waitUntil: (isComplete: () => boolean) => void;
  writeLog: (message: string) => void;
};

export type CompiledCommand = Readonly<
  Record<string, unknown> & {
    command: string;
    line: number;
    targets?: readonly Readonly<{ name: string; argumentCount: number }>[];
    result?: Command['result'];
  }
>;

export type CommandCatalog = Readonly<
  Record<
    string,
    (command: Command, location: string, parameters: readonly string[]) => CompiledCommand
  >
>;

export type CommandRegistry<Host = unknown> = Readonly<
  Record<
    string,
    {
      (command: Command, location: string, parameters: readonly string[]): CompiledCommand;
      run: (step: CompiledCommand, context: CommandContext, host: Host) => void;
    }
  >
>;

export function defineCommand<T extends Record<string, unknown>, Host = unknown>(
  definition: {
    parse: (args: Command['args'], location: string, parameters: readonly string[]) => T | undefined;
    targets?: (step: T) => CompiledCommand['targets'];
  } & (
    | { returnsValue?: false; execute: (step: T, context: CommandContext, host: Host) => void }
    | { returnsValue: true; execute: (step: T, context: CommandContext, host: Host) => RuntimeValue }
    | { returnsValue: 'deferred'; execute: (step: T, context: CommandContext, host: Host, setResult: (value: RuntimeValue) => void) => void }
  ),
) {
  const { parse, targets } = definition;
  function compile(
    command: Command,
    location: string,
    parameters: readonly string[],
  ): Readonly<T & CompiledCommand> {
    if (command.result && !definition.returnsValue)
      throw new Error(`${location}: Command ${command.type} does not return a value`);
    const step = parse(command.args, location, parameters);
    if (!step) throw new Error(`${location}: Command ${command.type} is not supported yet`);
    return {
      ...step,
      command: command.type,
      line: command.i,
      ...(command.result ? { result: Object.freeze(command.result) } : {}),
      targets: targets
        ? Object.freeze(targets(step)?.map((target) => Object.freeze(target)))
        : undefined,
    };
  }
  return Object.assign(compile, {
    // The registry pairs a command's parser and implementation under the same name.
    parse,
    run: (step: CompiledCommand, context: CommandContext, host: Host) => {
      if (!definition.returnsValue) {
        definition.execute(step as T & CompiledCommand, context, host);
        return;
      }
      const setResult = (result: RuntimeValue): void => {
        if (!step.result) return;
        if ('localName' in step.result) context.setLocal(step.result.localName, result);
        else context.setGlobal(step.result.storageKey, result);
      };
      if (definition.returnsValue === 'deferred') definition.execute(step as T & CompiledCommand, context, host, setResult);
      else setResult(definition.execute(step as T & CompiledCommand, context, host));
    },
  });
}
