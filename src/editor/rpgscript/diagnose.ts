import { commands } from '../../game/scene-commands.js';
import { ScriptParser } from '../../game/rpgscript/parser.js';
import { checkRpgScript } from '../../game/rpgscript/runtime.js';
import { getTriggerScriptPrefix, parseScriptSignature, parseTriggerScriptHeader } from '../../game/rpgscript/signature.js';

import type { ScriptDiagnostic } from './diagnostic.js';
export type { ScriptDiagnostic } from './diagnostic.js';

export function diagnoseScript(source: string, knownScripts: readonly string[]): ScriptDiagnostic[] {
  const known = new Set(knownScripts);
  const diagnostics: ScriptDiagnostic[] = [];
  checkRpgScript(source, '<editor>', { commands }, (error) => {
    const text = error instanceof Error ? error.message : String(error);
    const location = /^<editor>:(\d+): ([\s\S]*)$/.exec(text);
    const line = Number(location?.[1] ?? 1);
    const message = location?.[2] ?? text;
    const unknown = /^Unknown command (.+)$/.exec(message);
    diagnostics.push(unknown
      ? { line, severity: 'warning', message: `No command exists with name "${unknown[1]}"` }
      : { line, severity: 'error', message });
  }, (name, line) => {
    if (!known.has(name)) diagnostics.push({ line, severity: 'error', message: `No script exists with name "${name}".` });
  });
  return diagnostics.sort((a, b) => a.line - b.line);
}

export function getScriptNames(source: string): string[] {
  try {
    return Object.keys(new ScriptParser('<editor>').parse(source).scripts);
  } catch {
    // Keep indexing intact definitions in other parts of an unfinished draft.
    const names: string[] = [];
    for (const raw of source.split(/\r?\n/)) {
      const line = raw.trim();
      const prefix = getTriggerScriptPrefix(line);
      try {
        const name = prefix ? parseTriggerScriptHeader(line, prefix).signature.name
          : line.startsWith('@') ? parseScriptSignature(line.slice(1)).name : undefined;
        if (name && name !== 'this') names.push(name);
      } catch { /* Skip incomplete headers. */ }
    }
    return names;
  }
}

export function getTriggerNames(source: string): string[] {
  const names: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const prefix = getTriggerScriptPrefix(line);
    try {
      const name = prefix ? parseTriggerScriptHeader(line, prefix).signature.name : /^#([\w-]+)$/.exec(line)?.[1];
      if (name) names.push(name);
    } catch { /* Invalid headers are reported by diagnostics. */ }
  }
  return names;
}
