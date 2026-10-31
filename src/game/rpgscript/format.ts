// Mirrors the formatter in reference/rpgscript-regem-ludos/rpgscript-format/src/extension.ts.
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
    if (withoutComments === '}') indentLevel--;

    lines[i] = '  '.repeat(indentLevel) + trimmed;
    if (isHeader || trimmed.endsWith('{')) indentLevel++;
  }

  return lines.join('');
}
