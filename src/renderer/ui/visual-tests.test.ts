import { describe, expect, it } from 'vitest';
import { plainText } from '../../game/terminal.js';
import { renderVisualTest, visualTests } from './visual-tests.js';

describe('UI visual tests', () => {
  const borderBox = visualTests.find((test) => test.name === 'border-box');
  if (!borderBox) throw new Error('Missing border-box gallery');

  it('renders every border style with the real components', () => {
    const frame = plainText(renderVisualTest(borderBox, 40, 24));
    expect(frame).toContain('┌──────────────────────────────────┐');
    expect(frame).toContain('╔══════════════════════════════════╗');
    expect(frame).toContain('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
    expect(frame).toContain('╭──────────────────────────────────╮');
    expect(frame).toContain('│rounded border');
  });

  const paragraphWrapped = visualTests.find((test) => test.name === 'paragraph-wrapped');
  if (!paragraphWrapped) throw new Error('Missing paragraph-wrapped gallery');

  it('wraps gallery copy at words, hyphens, and hard newlines', () => {
    const frame = plainText(renderVisualTest(paragraphWrapped, 40, 24));
    expect(frame).toContain('Pack your lantern');
    expect(frame).toContain('before the');
    expect(frame).toContain('A well-known');
    expect(frame).toContain('tightly-');
    expect(frame).toContain('First line stays.');
    expect(frame).toContain('Second line wraps if');
    expect(frame).not.toMatch(/[┌│└]/);
  });

  const quad = visualTests.find((test) => test.name === 'quad');
  if (!quad) throw new Error('Missing quad gallery');

  it('clips oversized children to the quad bounds', () => {
    const frame = plainText(renderVisualTest(quad, 40, 24));
    expect(frame).toContain('  ABCDEFGH    ABCD');
    expect(frame).toContain('  IJKLMNOP    IJKL');
    expect(frame).toContain('  QRSTUVWX    QRST');
    expect(frame).toContain('  YZabcdef    YZab');
    expect(frame).toContain('  ghijklmn');
    expect(frame).not.toContain('ghijklmn    efgh');
    expect(frame).toContain('Pack your lantern');
    expect(frame).toContain('before the');
    expect(frame).not.toContain('mountain pass.');
  });

  it('scrolls a small viewport without overwriting the controls', () => {
    const first = plainText(renderVisualTest(borderBox, 20, 8));
    const last = plainText(renderVisualTest(borderBox, 20, 8, 999));
    expect(first).toContain('single border');
    expect(first).not.toContain('rounded border');
    expect(last).toContain('rounded border');
    expect(last).not.toContain('single border');
    expect(last.split('\n').at(-1)).toContain('border-box');
    expect(last.split('\n')).toHaveLength(8);
  });
});
