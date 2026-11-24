import { ScriptParser } from './parser.js';

/** Source-to-source authoring pass. Ask the parser which physical lines are dialogue
 * so that a marker in a choice, comment, or quoted argument never receives an ID. */
export function assignMissingVoiceIds(source: string, file: string, createId = () => `v_${crypto.randomUUID()}`): string {
  if (!/\/\/[ \t]*voice[ \t]*\r?$/m.test(source)) return source;
  const lines = source.split('\n');
  new ScriptParser(file, (line) => {
    const id = createId();
    lines[line - 1] = lines[line - 1].replace(/(\/\/[ \t]*voice)([ \t]*\r?)$/, `$1 ${id}$2`);
    return id;
  }).parse(source);
  return lines.join('\n');
}
