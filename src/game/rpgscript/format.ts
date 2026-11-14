// Mirrors the formatter in reference/rpgscript-regem-ludos/rpgscript-format/src/extension.ts.
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

export function formatRpgScript(source: string): string {
  let indentLevel = 0;
  const lines = source.split(/(\r\n|\n|\r)/);

  for (let i = 0; i < lines.length; i += 2) {
    let trimmed = lines[i].trim();
    while (trimmed.endsWith(';')) trimmed = trimmed.slice(0, -1);

    const withoutComments = trimmed.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '');
    if (withoutComments === '') continue;

    const isHeader = withoutComments.startsWith('@') || withoutComments.startsWith('#');
    if (isHeader) indentLevel = 0;
    if (withoutComments === '}' || withoutComments === '|') indentLevel--;

    lines[i] = '  '.repeat(indentLevel) + replaceRepeatedQuotedSpaces(trimmed);
    if (isHeader || trimmed.endsWith('{') || /^\+(?:\^?[A-Za-z_][\w.-]*|\[[A-Za-z_][\w-]*\])\s*=\s*\|$/.test(trimmed)) indentLevel++;
  }

  return lines.join('');
}
