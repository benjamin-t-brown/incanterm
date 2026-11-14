import { describe, expect, it } from 'vitest';
import { formatRpgScript } from '../format.js';

describe('RPGScript formatting', () => {
  it('indents scripts and blocks and removes trailing semicolons like the Cursor formatter', () => {
    const source = '@start\n+?is(flag):{\n+log("http://example.com");\n}\n@next\nGuide: "Hello";\n';
    const expected =
      '@start\n  +?is(flag):{\n    +log("http://example.com")\n  }\n@next\n  Guide: "Hello"\n';
    expect(formatRpgScript(source)).toBe(expected);
    expect(formatRpgScript(expected)).toBe(expected);
  });

  it('preserves comment-only and blank lines and their original line endings', () => {
    expect(formatRpgScript('@start\r\n  // leave this comment alone;\r\n  \r\n+log("ok");')).toBe(
      '@start\r\n  // leave this comment alone;\r\n  \r\n  +log("ok")',
    );
  });

  it('indents multiline list contents and restores the enclosing block after the closing pipe', () => {
    const source = '@start\n+?is(flag):{\n+[chs]=|\na,\nb,\n|\n+[ch]=[chs]->0\n}\n+other=|one|\n';
    const expected = '@start\n  +?is(flag):{\n    +[chs]=|\n      a,\n      b,\n    |\n    +[ch]=[chs]->0\n  }\n  +other=|one|\n';
    expect(formatRpgScript(source)).toBe(expected);
    expect(formatRpgScript(expected)).toBe(expected);
  });

  it('collapses repeated spaces inside single and double quotes without changing spaces outside them', () => {
    const source = '@start\n+log("A  word   here", \'it  works\')\nGuide: "It\'s   fine"\n+value  =  " x   y  "\n';
    const expected = '@start\n  +log("A word here", \'it works\')\n  Guide: "It\'s fine"\n  +value  =  " x y "\n';
    expect(formatRpgScript(source)).toBe(expected);
    expect(formatRpgScript(expected)).toBe(expected);
  });
});
