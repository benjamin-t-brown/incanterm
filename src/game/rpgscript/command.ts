import type { Command, ScriptValue } from './parser.js';

export type RuntimeValue = string | number | boolean | readonly string[] | undefined;

// Only interpreter operations belong here. Host state is a separate generic argument.
export type CommandContext = {
  location: string;
  value: (value: ScriptValue) => RuntimeValue;
  interpolate: (text: string) => string;
  setStorage: (key: string, value: RuntimeValue) => void;
  getStorage: (key: string) => RuntimeValue;
  setLocal: (name: string, value: RuntimeValue) => void;
  call: (target: string, args: readonly RuntimeValue[]) => void;
  callWithResult: (target: string, args: readonly RuntimeValue[], destination: string, local: boolean) => void;
  returnValue: (value: RuntimeValue) => void;
  breakLoop: (target: number, header: number) => void;
  continueLoop: (header: number) => void;
  callSubscript: (ownerId: string, target: string) => void;
  showDialogue: (actor: string, text: string, emotion?: string) => void;
  showCenterToast: (message: string) => void;
  showChoices: (options: readonly string[], onChoose?: (index: number) => void) => void;
  waitUntil: (isComplete: () => boolean) => void;
  writeLog: (message: string) => void;
};

export type CompiledCommand = Readonly<
  Record<string, unknown> & {
    command: string;
    line: number;
    targets?: readonly Readonly<{ name: string; argumentCount: number }>[];
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

export function defineCommand<T extends Record<string, unknown>, Host = unknown>({
  parse,
  execute,
  targets,
}: {
  parse: (args: Command['args'], location: string, parameters: readonly string[]) => T | undefined;
  execute: (step: T, context: CommandContext, host: Host) => void;
  targets?: (step: T) => CompiledCommand['targets'];
}) {
  function compile(
    command: Command,
    location: string,
    parameters: readonly string[],
  ): Readonly<T & CompiledCommand> {
    const step = parse(command.args, location, parameters);
    if (!step) throw new Error(`${location}: Command ${command.type} is not supported yet`);
    return {
      ...step,
      command: command.type,
      line: command.i,
      targets: targets
        ? Object.freeze(targets(step)?.map((target) => Object.freeze(target)))
        : undefined,
    };
  }
  return Object.assign(compile, {
    // The registry pairs a command's parser and implementation under the same name.
    parse,
    run: (step: CompiledCommand, context: CommandContext, host: Host) =>
      execute(step as T & CompiledCommand, context, host),
  });
}
