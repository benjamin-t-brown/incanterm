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

  class RPGScriptFormatter {
    format(document: vscode.TextDocument): vscode.TextEdit[] {
      const edits: vscode.TextEdit[] = [];
      let indentLevel = 0;
      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text;
        let trimmed = text.trim();
        while (trimmed.slice(-1) === ';') {
          trimmed = trimmed.slice(0, -1);
        }
        const trimmedNoComments = trimmed.replace(
          /\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm,
          ''
        );

        if (trimmedNoComments === '') {
          continue;
        }

        let incIndent = false;

        if (
          trimmedNoComments.at(0) === '@' ||
          trimmedNoComments.at(0) === '#'
        ) {
          indentLevel = 0;
          incIndent = true;
        }

        if (trimmedNoComments === '}' || trimmedNoComments === '|') {
          indentLevel--;
        }

        console.log('read line', trimmed, indentLevel);
        const indent = '  '.repeat(indentLevel);
        edits.push(vscode.TextEdit.replace(line.range, indent + replaceRepeatedQuotedSpaces(trimmed)));

        if (incIndent) {
          indentLevel++;
        } else if (trimmed.slice(-1) === '{' || /^\+(?:\^?[A-Za-z_][\w.-]*|\[[A-Za-z_][\w-]*\])\s*=\s*\|$/.test(trimmed)) {
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
