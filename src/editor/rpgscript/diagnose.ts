import { isKnownCommand, PROP_SLIDE_COMMAND_NAMES } from './commands.js';
import { commands } from '../../game/scene-commands.js';
import { ScriptParser } from '../../game/rpgscript/parser.js';
import {
  getTriggerScriptPrefix,
  parseScriptSignature,
  parseTriggerScriptHeader,
} from '../../game/rpgscript/signature.js';

export type ScriptDiagnostic = {
  line: number;
  severity: 'error' | 'warning';
  message: string;
};

// Checks adapted from the reference editor linter: command shape, unknown
// commands, and callScript targets. Unknown commands stay warnings. The
// reference snapshot is not imported or modified.
export function diagnoseScript(
  source: string,
  knownScripts: readonly string[],
): ScriptDiagnostic[] {
  const known = new Set(knownScripts);
  const diagnostics: ScriptDiagnostic[] = [];
  const lines = source.split(/\r?\n/);
  const parser = new ScriptParser('<editor>');
  let depth = 0;
  const switchDepths: number[] = [];
  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('//')) return;
    const atDepth = depth;
    if (line === '}') {
      depth--;
      while (switchDepths.length && switchDepths[switchDepths.length - 1] > depth)
        switchDepths.pop();
    } else if (line.endsWith('{')) depth++;
    if (/^\+\?switch\(.*\)\s*:\s*\{$/.test(line)) {
      switchDepths.push(depth);
      return;
    }
    if (switchDepths.includes(atDepth) && /^.+:\s*\{$/.test(line)) return;
    const triggerPrefix = getTriggerScriptPrefix(line);
    if (triggerPrefix) {
      try {
        parseTriggerScriptHeader(line, triggerPrefix);
      } catch (error) {
        diagnostics.push(reportError(lineNumber, (error as Error).message));
      }
      return;
    }
    if (line.startsWith('@') || line.startsWith('#') || line.startsWith('$')) return;
    if (line === '{' || line === '}') return;
    if (line.startsWith('<')) return;
    if (isDialogue(line)) {
      if (!hasClosedQuote(line)) {
        diagnostics.push(reportError(lineNumber, 'Dialogue string is missing its closing quote'));
      }
      return;
    }
    if (line.startsWith('+')) {
      let body = line.slice(1).trim();
      const assignment = /^(?:\[[A-Za-z_][\w-]*\]|[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\s*=\s*(?=[+?]?[A-Za-z_][\w-]*\s*\()/.exec(body);
      if (assignment) body = body.slice(assignment[0].length);
      if (body.startsWith('?')) {
        try {
          if (assignment) parser.parseConditional(body.slice(1).replace(/;$/, ''), lineNumber);
          else parser.getConditionalFromLine(body, lineNumber);
        } catch (error) {
          diagnostics.push(reportError(lineNumber, String(error instanceof Error ? error.message : error)));
        }
        return;
      }
      const parsed = parseCommand(body.replace(/^\+/, ''));
      if ('error' in parsed) {
        diagnostics.push(reportError(lineNumber, parsed.error));
        return;
      }
      if (parsed.name === 'callScript') {
        if (!parsed.target) {
          diagnostics.push(reportError(lineNumber, 'callScript needs a script name'));
        } else if (!known.has(parsed.target)) {
          diagnostics.push(
            reportError(lineNumber, `No script exists with name "${parsed.target}".`),
          );
        }
        return;
      }
      if (!isKnownCommand(parsed.name)) {
        diagnostics.push({
          line: lineNumber,
          severity: 'warning',
          message: `No command exists with name "${parsed.name}"`,
        });
      }
      const slideCommand = PROP_SLIDE_COMMAND_NAMES.find((name) => name === parsed.name);
      if (slideCommand) {
        try {
          const command = parser.parseCommand(body.replace(/^\+/, '').replace(/;$/, ''), lineNumber);
          commands[slideCommand](command, 'Prop slide command', []);
        } catch (error) {
          diagnostics.push(reportError(lineNumber, (error as Error).message));
        }
      }
      return;
    }
    diagnostics.push(reportError(lineNumber, `Unrecognized line: ${line}`));
  });
  return diagnostics;
}

export function getScriptNames(source: string): string[] {
  const names: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const triggerScript = getInlineTriggerScriptName(line);
    if (triggerScript) {
      names.push(triggerScript);
    } else if (line.startsWith('@')) {
      try {
        const { name } = parseScriptSignature(line.slice(1));
        if (name !== 'this') names.push(name);
      } catch {
        // An invalid signature should not hide valid definitions later in the file.
      }
    }
  }
  return names;
}

export function getTriggerNames(source: string): string[] {
  const names: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const name = /^#([\w-]+)$/.exec(line)?.[1] ?? getInlineTriggerScriptName(line);
    if (name) names.push(name);
  }
  return names;
}

function getInlineTriggerScriptName(line: string): string | undefined {
  const prefix = getTriggerScriptPrefix(line);
  if (!prefix) return undefined;
  try {
    return parseTriggerScriptHeader(line, prefix).signature.name;
  } catch {
    // Invalid headers are handled by diagnostics.
    return undefined;
  }
}

function isDialogue(line: string): boolean {
  return /^[^+:#@${}][^:]*:/.test(line);
}

function hasClosedQuote(line: string): boolean {
  const start = line.indexOf('"');
  if (start === -1) return false;
  return line.lastIndexOf('"') > start;
}

function parseCommand(body: string): { name: string; target?: string } | { error: string } {
  let source = body.trim();
  if (source.endsWith(';')) source = source.slice(0, -1).trim();
  const assignment = /^(?:\[[A-Za-z_][\w-]*\]|[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\s*=\s*(?=[A-Za-z_][\w-]*\s*\()/.exec(source);
  if (assignment) source = source.slice(assignment[0].length);
  const open = source.indexOf('(');
  const close = source.lastIndexOf(')');
  if (open <= 0 || close < open || close !== source.length - 1) {
    return { error: 'Invalid command, missing parentheses' };
  }
  const name = source.slice(0, open).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return { error: 'Invalid command name' };
  }
  const args = source.slice(open + 1, close);
  if (!areQuotesBalanced(args)) return { error: 'Invalid command, unterminated quote' };
  if (name !== 'callScript') return { name };
  const target = getFirstArg(args);
  return { name, target };
}

function areQuotesBalanced(value: string): boolean {
  let quote = '';
  for (const character of value) {
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    }
  }
  return quote === '';
}

function getFirstArg(value: string): string {
  let quote = '';
  let current = '';
  for (const character of value) {
    if (quote) {
      if (character === quote) quote = '';
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ',') break;
    current += character;
  }
  return current.trim();
}

function reportError(line: number, message: string): ScriptDiagnostic {
  return { line, severity: 'error', message };
}
