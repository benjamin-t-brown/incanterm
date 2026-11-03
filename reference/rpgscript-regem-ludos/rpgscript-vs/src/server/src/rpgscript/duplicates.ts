import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { sourceLinesWithoutComments } from './source';
import { parseScriptSignature } from './script-signature';

type Declaration = {
  kind: 'script' | 'trigger';
  name: string;
  file: string;
  range: Range;
  parameters: string[];
};

// Collect headers independently of parsing: a syntax error elsewhere must not
// hide duplicates, and the parser's name-keyed maps discard earlier declarations.
const declarations = (file: string, source: string): Declaration[] => {
  const result: Declaration[] = [];
  let trigger = '';
  sourceLinesWithoutComments(source).forEach((visible, lineNumber) => {
    const header = /^(\s*)(#@|[@#])(.+?)\s*$/.exec(visible);
    if (!header || !header[3].trim()) return;
    const kind = header[2] === '#' ? 'trigger' : 'script';
    let rawName = header[3];
    let parameters: string[] = [];
    if (kind === 'script') {
      try {
        const signature = parseScriptSignature(rawName);
        rawName = signature.name;
        parameters = signature.parameters;
      } catch { return; }
    }
    if (header[2] === '#@') trigger = rawName;
    const name = kind === 'script' && rawName === 'this' ? trigger : rawName;
    if (kind === 'trigger') trigger = name;
    if (!name) return;
    const character = header[1].length + header[2].length;
    result.push({
      kind, name, file, parameters,
      range: {
        start: { line: lineNumber, character },
        end: { line: lineNumber, character: character + rawName.length },
      },
    });
    if (header[2] === '#@') result.push({ ...result[result.length - 1], kind: 'trigger' });
  });
  return result;
};

export const declaredScriptSignatures = (sources: ReadonlyMap<string, string>): Map<string, readonly string[]> => {
  const names = new Map<string, readonly string[]>();
  for (const [file, source] of sources) {
    for (const declaration of declarations(file, source)) {
      if (declaration.kind === 'script') names.set(declaration.name, declaration.parameters);
    }
  }
  return names;
};

export const duplicateNameDiagnostics = (
  file: string,
  root: string,
  sources: ReadonlyMap<string, string>
): Diagnostic[] => {
  const byName = new Map<string, Declaration[]>();
  for (const [sourceFile, source] of sources) {
    for (const declaration of declarations(sourceFile, source)) {
      const key = `${declaration.kind}:${declaration.name}`;
      const entries = byName.get(key) ?? [];
      entries.push(declaration);
      byName.set(key, entries);
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const entries of byName.values()) {
    if (entries.length < 2) continue;
    for (const declaration of entries.filter(entry => entry.file === file)) {
      const others = entries.filter(entry => entry !== declaration);
      const location = (entry: Declaration) =>
        `${path.relative(root, entry.file)}:${entry.range.start.line + 1}`;
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        code: `duplicate-${declaration.kind}`,
        source: 'RPGScript:' + path.basename(file),
        range: declaration.range,
        message: `Duplicate ${declaration.kind} name "${declaration.name}". Also defined at ${others.map(location).join(', ')}.`,
        relatedInformation: others.map(entry => ({
          location: { uri: pathToFileURL(entry.file).href, range: entry.range },
          message: `Other ${entry.kind} definition of "${entry.name}"`,
        })),
      });
    }
  }
  return diagnostics.sort((a, b) => a.range.start.line - b.range.start.line);
};
