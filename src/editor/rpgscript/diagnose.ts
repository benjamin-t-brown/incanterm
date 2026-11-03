import { isKnownCommand } from './commands.js';

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
  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('//')) return;
    if (line.startsWith('@') || line.startsWith('#') || line.startsWith('$')) return;
    if (line === '{' || line === '}') return;
    if (isDialogue(line)) {
      if (!hasClosedQuote(line)) {
        diagnostics.push(reportError(lineNumber, 'Dialogue string is missing its closing quote'));
      }
      return;
    }
    if (line.startsWith('+')) {
      const parsed = parseCommand(line.slice(1).trim());
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
      return;
    }
    diagnostics.push(reportError(lineNumber, `Unrecognized line: ${line}`));
  });
  return diagnostics;
}

export function getScriptNames(source: string): string[] {
  const names: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim().replace(/^#@/, '@');
    if (!line.startsWith('@')) continue;
    const name = line.slice(1).trim().split(/\s+/)[0] ?? '';
    if (name && name !== 'this') names.push(name);
  }
  return names;
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
  if (source.startsWith('?')) source = source.slice(1).trim();
  const conditional = source.indexOf(':{');
  if (conditional !== -1) source = source.slice(0, conditional).trim();
  if (source.endsWith(';')) source = source.slice(0, -1).trim();
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
