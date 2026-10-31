// Preserve character positions for diagnostics, and retain quoted text because
// storage/local references in dialogue and strings are executable substitutions.
export const sourceLinesWithoutComments = (source: string): string[] => {
  let blockComment = false;
  return source.split(/\r?\n/).map(line => {
    let visible = '';
    let quote = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const pair = line.slice(i, i + 2);
      if (blockComment) {
        visible += ' ';
        if (pair === '*/') {
          blockComment = false;
          visible += ' ';
          i++;
        }
      } else if (quote) {
        visible += ch;
        if (ch === '\\' && i + 1 < line.length) {
          visible += line[++i];
        } else if (ch === quote) {
          quote = '';
        }
      } else if (pair === '//') {
        break;
      } else if (pair === '/*') {
        blockComment = true;
        visible += '  ';
        i++;
      } else {
        visible += ch;
        if (ch === '"' || ch === "'") quote = ch;
      }
    }
    return visible;
  });
};
