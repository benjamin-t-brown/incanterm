import { languages, TextDocument, TextEdit } from 'vscode';

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

export function getFormattingEdits(document: TextDocument): TextEdit[] {
  const edits: TextEdit[] = [];
  let indentLevel = 0;
  for (let index = 0; index < document.lineCount; index++) {
    const line = document.lineAt(index);
    let trimmed = line.text.trim();
    while (trimmed.endsWith(';')) trimmed = trimmed.slice(0, -1);

    const withoutComments = trimmed.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '');
    if (withoutComments === '') continue;

    const isHeader = withoutComments.startsWith('@') || withoutComments.startsWith('#');
    if (isHeader) indentLevel = 0;
    if (withoutComments === '}' || withoutComments === '|') indentLevel--;

    edits.push(TextEdit.replace(line.range, '  '.repeat(indentLevel) + replaceRepeatedQuotedSpaces(trimmed)));
    if (isHeader || trimmed.endsWith('{') || /^\+(?:\^?[A-Za-z_][\w.-]*|\[[A-Za-z_][\w-]*\])\s*=\s*\|$/.test(trimmed)) indentLevel++;
  }
  return edits;
}

export function registerRpgScriptFormatter(): ReturnType<typeof languages.registerDocumentFormattingEditProvider> {
  return languages.registerDocumentFormattingEditProvider('rpgscript', {
    provideDocumentFormattingEdits: getFormattingEdits,
  });
}
