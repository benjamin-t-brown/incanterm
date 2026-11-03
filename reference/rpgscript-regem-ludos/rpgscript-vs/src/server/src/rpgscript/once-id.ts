import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import * as path from 'path';
import { sourceLinesWithoutComments } from './source';

export function getOnceIdDiagnostics(file: string, source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  sourceLinesWithoutComments(source).forEach((line, lineNumber) => {
    // Mask strings without changing offsets or mistaking a quoted ID for no ID.
    const visible = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
      value => 'x'.repeat(value.length));
    const start = visible.indexOf('?');
    if (start < 0) return;
    const end = visible.indexOf(':', start);
    if (end < 0) return;
    const condition = visible.slice(start, end);
    for (const match of condition.matchAll(/\bonce\s*\(\s*\)/g)) {
      const character = start + match.index!;
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        code: 'once-missing-id',
        source: 'RPGScript:' + path.basename(file),
        message: 'Give once() an explicit stable ID, for example once(posterRead). The default key depends on the script block or trigger binding position and can change when the script is edited.',
        range: {
          start: { line: lineNumber, character },
          end: { line: lineNumber, character: character + match[0].length },
        },
      });
    }
  });
  return diagnostics;
}
