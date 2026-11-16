import * as vscode from 'vscode';

function replaceRepeatedQuotedSpaces(text: string): string {
  let quote = '';
  let result = '';
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === quote) quote = '';
    else if (!quote && (character === '"' || character === "'")) quote = character;

    if (quote && character === ' ' && text[index + 1] === ' ') {
      result += ' ';
      while (text[index + 1] === ' ') index++;
    } else {
      result += character;
    }
  }
  return result;
}

export function activate(context: vscode.ExtensionContext) {
  // 👎 formatter implemented as separate command
  // vscode.commands.registerCommand('extension.format-rpgscript', () => {
  //   const { activeTextEditor } = vscode.window;

  //   if (
  //     activeTextEditor &&
  //     activeTextEditor.document.languageId === 'rpgscript'
  //   ) {
  //     const { document } = activeTextEditor;
  //     const firstLine = document.lineAt(0);
  //     if (firstLine.text !== '42') {
  //       const edit = new vscode.WorkspaceEdit();
  //       edit.insert(document.uri, firstLine.range.start, '42\n');
  //       return vscode.workspace.applyEdit(edit);
  //     }
  //   }
  // });

  // Removes // and /* */ comments that sit outside of quoted strings.
  function stripComments(text: string): string {
    let result = '';
    let quote = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        result += ch;
        if (ch === '\\' && i + 1 < text.length) result += text[++i];
        else if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        result += ch;
      } else if (ch === '/' && text[i + 1] === '/' && text[i - 1] !== ':') {
        break;
      } else if (ch === '/' && text[i + 1] === '*') {
        const close = text.indexOf('*/', i + 2);
        if (close === -1) break;
        i = close + 1;
      } else {
        result += ch;
      }
    }
    return result.trim();
  }

  class RPGScriptFormatter {
    format(document: vscode.TextDocument): vscode.TextEdit[] {
      const edits: vscode.TextEdit[] = [];
      let indentLevel = 0;
      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        let trimmed = line.text.trim();
        if (trimmed === '') {
          continue;
        }

        const code = stripComments(trimmed).replace(/;+$/, '').trim();

        // Comment-only lines follow the current indentation without changing it.
        if (code === '') {
          edits.push(
            vscode.TextEdit.replace(line.range, '  '.repeat(indentLevel) + trimmed)
          );
          continue;
        }

        // Trailing semicolons are dropped from the code, comments are preserved.
        if (trimmed.length > code.length && trimmed.startsWith(code + ';')) {
          trimmed = trimmed.replace(/^([^]*?);+(\s*(\/\/|\/\*).*)?$/, (_m, c, rest) => c + (rest ?? ''));
        } else {
          while (trimmed.slice(-1) === ';') {
            trimmed = trimmed.slice(0, -1);
          }
        }

        let isHeader = false;
        if (code[0] === '@' || code[0] === '#') {
          indentLevel = 0;
          isHeader = true;
        }

        if (code[0] === '}' || code === '|') {
          indentLevel = Math.max(0, indentLevel - 1);
        }

        edits.push(
          vscode.TextEdit.replace(line.range, '  '.repeat(indentLevel) + replaceRepeatedQuotedSpaces(trimmed))
        );

        if (isHeader || code.slice(-1) === '{' || /^\+(?:\^?[A-Za-z_][\w.-]*|\[[A-Za-z_][\w-]*\])\s*=\s*\|$/.test(code)) {
          indentLevel++;
        }
      }

      return edits;
    }
  }

  // 👍 formatter implemented using API
  vscode.languages.registerDocumentFormattingEditProvider('rpgscript', {
    provideDocumentFormattingEdits(
      document: vscode.TextDocument
    ): vscode.TextEdit[] {
      const formatter = new RPGScriptFormatter();
      return formatter.format(document);
    },
  });
}
