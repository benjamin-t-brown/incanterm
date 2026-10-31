// RPGScript commands supported by the server. Keep this catalog and each `const name =`
// declaration together: the existing RPGScript language extension reads this file.
import type { StorageReference, LocalReference, ScriptValue } from './parser.js';

const callScript = (target: string, ...args: ScriptValue[]) => {
  return { type: 'call' as const, target, args };
};

const playDialogue = (actor: string, text: string) => {
  return { type: 'dialogue' as const, actor, text };
};

const setStorage = (key: string | StorageReference | LocalReference, value: ScriptValue) => {
  return { type: 'setStorage' as const, key, value };
};

const log = (text: string) => {
  return { type: 'log' as const, text };
};

const setConv = (portName: ScriptValue) => {
  return { type: 'setConv' as const, portName };
};

const setLocal = (name: string, value: ScriptValue) => {
  return { type: 'setLocal' as const, name, value };
};

const awaitChoice = (...options: string[]) => {
  return { type: 'awaitChoice' as const, options };
};

// The language parser emits showChoices for `$` choice blocks.
type ChoiceOption = Readonly<{ text: string; target: string }>;
const showChoices = (options: readonly ChoiceOption[]) => {
  return { type: 'choices' as const, options };
};

export const commands = {
  callScript,
  playDialogue,
  setStorage,
  setLocal,
  log,
  setConv,
  awaitChoice,
  showChoices,
};
