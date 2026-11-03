import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import * as path from 'path';
import { sourceLinesWithoutComments } from './source';
import { parseScriptSignature } from './script-signature';

function getBodyLocalScopes(lines: string[]): Map<number, Set<string>> {
  const scopes = new Map<number, Set<string>>();
  let locals: Set<string> | undefined;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('@') || trimmed.startsWith('#')) {
      locals = trimmed.startsWith('@') || trimmed.startsWith('#@') ? new Set<string>() : undefined;
      if (locals) scopes.set(index, locals);
      return;
    }
    if (!locals || !trimmed.startsWith('+')) return;
    const unquoted = line.replace(/"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)/g,
      text => ' '.repeat(text.length));
    const assignment = /(?:^\s*\+|:\s*\+?)\s*\[([A-Za-z_][\w-]*)\]\s*(?:=|<\s*\+:)/.exec(unquoted);
    if (assignment) locals.add(assignment[1]);
    const call = /(?:^\s*\+|:\s*\+?)\s*setLocal\s*\(/.exec(unquoted);
    if (call) {
      const argument = line.slice(call.index + call[0].length).split(',')[0].trim();
      const name = argument.replace(/^(["'])(.*)\1$/, '$2');
      if (/^[A-Za-z_][\w-]*$/.test(name)) locals.add(name);
    }
  });
  return scopes;
}

export const localScopeDiagnostics = (file: string, source: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  let parameters = new Set<string>();
  const lines = sourceLinesWithoutComments(source);
  const bodyScopes = getBodyLocalScopes(lines);
  lines.forEach((line, lineNumber) => {
    const warn = (character: number, length: number, message: string, code = 'local-global-confusion') => {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        code,
        source: 'RPGScript:' + path.basename(file),
        range: {
          start: { line: lineNumber, character },
          end: { line: lineNumber, character: character + length },
        },
        message,
      });
    };
    const trimmed = line.trim();
    if (trimmed.startsWith('@') || trimmed.startsWith('#')) {
      parameters = new Set();
      if (trimmed.startsWith('@')) {
        try { parameters = new Set(parseScriptSignature(trimmed.slice(1)).parameters); } catch { /* Parser reports invalid signatures. */ }
        if (parameters.has('true') || parameters.has('false')) {
          const start = line.indexOf('(') + 1;
          for (const parameter of line.slice(start).matchAll(/[A-Za-z_][\w-]*/g)) {
            const name = parameter[0];
            if (name !== 'true' && name !== 'false') continue;
            warn(start + parameter.index!, name.length,
              `Parameter "${name}" conflicts with the boolean literal ${name}. Consider a name such as ${name === 'true' ? 'is_enabled' : 'is_disabled'}.`,
              'parameter-literal-shadowing');
          }
        }
      }
      for (const name of bodyScopes.get(lineNumber) ?? []) parameters.add(name);
      return;
    }
    for (const reference of line.matchAll(/\{([A-Za-z_][\w-]*)\}|\[([A-Za-z_][\w-]*)\]/g)) {
      const name = reference[1] ?? reference[2];
      const local = reference[2] !== undefined;
      if (local === parameters.has(name)) continue;
      const character = reference.index!;
      diagnostics.push({
        severity: local ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
        code: local ? 'unknown-local' : 'local-global-confusion',
        source: 'RPGScript:' + path.basename(file),
        range: {
          start: { line: lineNumber, character },
          end: { line: lineNumber, character: character + reference[0].length },
        },
        message: local ? `Unknown local [${name}].` : `"${name}" is a local parameter. Did you mean [${name}]?`,
      });
    }
    // Bare scalar condition arguments read global storage, even when a local
    // parameter has the same name. Mask strings without moving source ranges.
    const unquoted = line.replace(/"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)/g,
      text => ' '.repeat(text.length));
    const conditional = /^\s*\+?\s*\?/.test(unquoted);
    const colon = unquoted.indexOf(':');
    const condition = conditional ? (colon < 0 ? unquoted : unquoted.slice(0, colon)) : '';
    for (const call of condition.matchAll(/\b(is|isnot|eq|gt|lt)\s*\(([^()]*)\)/g)) {
      const argsStart = call.index! + call[0].indexOf('(') + 1;
      for (const argument of call[2].matchAll(/(?:^|,)\s*([A-Za-z_][\w-]*)\s*(?=,|$)/g)) {
        const name = argument[1];
        if (!parameters.has(name) || name === 'true' || name === 'false') continue;
        const character = argsStart + argument.index! + argument[0].indexOf(name);
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          code: 'local-global-confusion',
          source: 'RPGScript:' + path.basename(file),
          range: {
            start: { line: lineNumber, character },
            end: { line: lineNumber, character: character + name.length },
          },
          message: `Bare ${name} in ${call[1]}() reads global storage, but "${name}" is a local parameter. Did you mean [${name}]?`,
        });
      }
    }

    // Only inspect the command after an inline condition, not names in its
    // expression or in quoted dialogue. Keep offsets into the original line.
    if (conditional && colon < 0) return;
    const bodyStart = conditional ? colon + 1 : 0;
    const body = unquoted.slice(bodyStart);
    const assignment = /^\s*\+?\s*([A-Za-z_][\w-]*)\s*=/.exec(body);
    if (assignment && parameters.has(assignment[1])) {
      const name = assignment[1];
      warn(bodyStart + assignment[0].indexOf(name), name.length,
        `Assignment to ${name} writes global storage, but "${name}" is a local parameter. Did you mean +[${name}]=...?`);
    }

    const call = /^\s*\+?\s*([A-Za-z_][\w-]*|:[\w-]+)\s*\(/.exec(body);
    if (!call) return;
    const argsStart = bodyStart + call[0].length;
    // Split on top-level commas only. Strings have been masked above, so commas
    // and parentheses in quoted arguments cannot alter argument positions.
    const args: { text: string; start: number }[] = [];
    let start = argsStart;
    let depth = 0;
    for (let i = argsStart; i < unquoted.length; i++) {
      const ch = unquoted[i];
      if ((ch === ',' || ch === ')') && depth === 0) {
        const raw = line.slice(start, i);
        args.push({ text: raw.trim(), start: start + raw.length - raw.trimStart().length });
        start = i + 1;
        if (ch === ')') break;
      } else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (call[1] === 'setStorage') {
      const destination = args[0];
      if (!destination) return;
      const quoted = /^(?:"[A-Za-z_][\w-]*"|'[A-Za-z_][\w-]*')$/.test(destination.text);
      const name = quoted ? destination.text.slice(1, -1) : destination.text;
      if (parameters.has(name)) {
        warn(destination.start + (quoted ? 1 : 0), name.length,
          `setStorage(${destination.text}, ...) writes global storage, but "${name}" is a local parameter. Did you mean setLocal(${name}, ...)?`);
      }
    }
    const valueArgs = call[1] === 'callScript' || call[1] === 'setLocal' || call[1] === 'setStorage'
      ? args.slice(1) : args;
    for (const argument of valueArgs) {
      const name = argument.text;
      if (!parameters.has(name)) continue;
      warn(argument.start, name.length,
        `Bare ${name} passes a literal, but "${name}" is a local parameter. Did you mean [${name}]?`);
    }
  });
  return diagnostics;
};
