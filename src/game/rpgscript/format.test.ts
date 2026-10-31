import { describe, expect, it } from 'vitest';
import { formatRpgScript } from './format.js';

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
});
