import { describe, expect, it } from 'vitest';
import { CellBuffer, type Cell } from '../../game/cell-buffer.js';
import { plainText } from '../../game/terminal.js';
import { BorderBox } from './border-box.js';
import { UIElement } from './element.js';
import { ParagraphWrapped, wrapParagraph } from './paragraph-wrapped.js';

const ink: Cell = {
  ch: '.',
  fg: { r: 255, g: 255, b: 255 },
  bg: { r: 0, g: 0, b: 0 },
};

describe('wrapParagraph', () => {
  it('keeps text that already fits on one line', () => {
    expect(wrapParagraph('hello world', 11)).toEqual(['hello world']);
  });

  it('breaks at spaces and does not split a word just to fill the line', () => {
    expect(wrapParagraph('hello world', 8)).toEqual(['hello', 'world']);
    expect(wrapParagraph('Pack your lantern before the mountain pass.', 18)).toEqual([
      'Pack your lantern',
      'before the',
      'mountain pass.',
    ]);
  });

  it('breaks after hyphens when a token is longer than the width', () => {
    expect(wrapParagraph('hello-world', 8)).toEqual(['hello-', 'world']);
    expect(wrapParagraph('A well-known tightly-sealed crate.', 12)).toEqual([
      'A well-known',
      'tightly-',
      'sealed',
      'crate.',
    ]);
  });

  it('hard-wraps words with no space or hyphen break', () => {
    expect(wrapParagraph('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('preserves explicit newlines and collapses other whitespace', () => {
    expect(wrapParagraph('First line stays.\nSecond line wraps if needed.', 20)).toEqual([
      'First line stays.',
      'Second line wraps if',
      'needed.',
    ]);
    expect(wrapParagraph('hello   world', 20)).toEqual(['hello world']);
    expect(wrapParagraph('a\r\nb', 8)).toEqual(['a', 'b']);
    expect(wrapParagraph('\n', 8)).toEqual(['', '']);
  });

  it('treats empty text as a single blank line', () => {
    expect(wrapParagraph('', 8)).toEqual(['']);
  });

  it('rejects a non-positive wrap width', () => {
    expect(() => wrapParagraph('hello', 0)).toThrow(/at least 1/);
  });
});

describe('ParagraphWrapped', () => {
  it('sizes height to the wrapped lines and paints left-aligned text', () => {
    const paragraph = new ParagraphWrapped(
      'lore',
      0,
      0,
      12,
      'A well-known tightly-sealed crate.',
    );
    expect(paragraph.lines).toEqual(['A well-known', 'tightly-', 'sealed', 'crate.']);
    expect(paragraph.height).toBe(4);
    expect(draw(paragraph, 12, 4).split('\n')).toEqual([
      'A well-known',
      'tightly-    ',
      'sealed      ',
      'crate.      ',
    ]);
  });

  it('rewraps when text or width changes', () => {
    const paragraph = new ParagraphWrapped('lore', 1, 1, 20, 'hello world');
    expect(paragraph.height).toBe(1);
    paragraph.text = 'hello world again';
    paragraph.width = 8;
    expect(paragraph.lines).toEqual(['hello', 'world', 'again']);
    expect(paragraph.height).toBe(3);
    expect(draw(paragraph, 10, 5).split('\n')).toEqual([
      '..........',
      '.hello   .',
      '.world   .',
      '.again   .',
      '..........',
    ]);
  });

  it('fits wrapped text inside a BorderBox', () => {
    const box = new BorderBox('panel', 0, 0, 14, 6, { border: 'single' });
    box.addChild(new ParagraphWrapped('body', 0, 0, 12, 'A well-known tightly-sealed crate.'));
    expect(draw(box, 14, 6).split('\n')).toEqual([
      '┌────────────┐',
      '│A well-known│',
      '│tightly-    │',
      '│sealed      │',
      '│crate.      │',
      '└────────────┘',
    ]);
  });
});

function draw(root: UIElement, width: number, height: number): string {
  const buffer = new CellBuffer(width, height, ink);
  root.render(buffer);
  return plainText(buffer);
}
