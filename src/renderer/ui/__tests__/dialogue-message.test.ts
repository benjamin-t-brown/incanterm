import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CellBuffer } from '../../../game/cell-buffer.js';
import { getPlainText } from '../../../game/terminal.js';
import { DEFAULT_GROWTH_SEQUENCES, DialogueMessage, isShortCharacter } from '../dialogue-message.js';

beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0));
afterEach(() => vi.restoreAllMocks());

function getRenderedText(message: DialogueMessage): string {
  const buffer = new CellBuffer(20, 3, { ch: ' ', fg: message.fg, bg: message.bg });
  message.render(buffer);
  return getPlainText(buffer).split('\n')[0].trimEnd();
}

describe('dialogue growth animation', () => {
  it('chooses a stable growth sequence independently for each character', () => {
    vi.mocked(Math.random)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.4)
      .mockReturnValueOnce(0.6)
      .mockReturnValueOnce(0.8);
    const message = new DialogueMessage('message', 0, 0, 20, '');
    message.shortGrowthSequences = message.growthSequences;
    message.stepDurationMs = 10;
    message.showText('Hello');
    for (let stage = 0; stage < 4; stage++) {
      expect(getRenderedText(message)).toBe(DEFAULT_GROWTH_SEQUENCES.map((sequence) => sequence[stage]).join(''));
      expect(getRenderedText(message)).toBe(DEFAULT_GROWTH_SEQUENCES.map((sequence) => sequence[stage]).join(''));
      message.advanceAnimation(10);
    }
    expect(getRenderedText(message)).toBe('Hello');
    expect(Math.random).toHaveBeenCalledTimes(5);
  });

  it('uses short sequences for x-height letters and low punctuation, tall sequences otherwise', () => {
    expect(['a', 'e', 'n', 'o', '.', ','].every(isShortCharacter)).toBe(true);
    expect(['A', 'B', 'b', 'd', 'g', 'i', 'y', '7', '!'].some(isShortCharacter)).toBe(false);
    const message = new DialogueMessage('message', 0, 0, 20, '');
    message.growthSequences = ['T123'];
    message.shortGrowthSequences = ['s123'];
    message.wordDelayMs = 0;
    message.showText('Ace bdy G.!');
    expect(getRenderedText(message)).toBe('Tss TTT TsT');
    message.advanceAnimation(100);
    expect(getRenderedText(message)).toBe('Ace bdy G.!');
  });

  it('grows whole words through _,n8 with staggered word starts', () => {
    const message = new DialogueMessage('message', 0, 0, 20, '');
    message.shortGrowthSequences = message.growthSequences;
    message.stepDurationMs = 10;
    message.wordDelayMs = 20;
    message.showText('Hi all');
    expect(getRenderedText(message)).toBe('__');
    message.advanceAnimation(10);
    expect(getRenderedText(message)).toBe(',,');
    message.advanceAnimation(10);
    expect(getRenderedText(message)).toBe('nn ___');
    message.advanceAnimation(10);
    expect(getRenderedText(message)).toBe('88 ,,,');
    message.advanceAnimation(10);
    expect(getRenderedText(message)).toBe('Hi nnn');
    message.advanceAnimation(10);
    expect(getRenderedText(message)).toBe('Hi 888');
    message.advanceAnimation(10);
    expect(message.isAnimationComplete()).toBe(true);
    expect(getRenderedText(message)).toBe('Hi all');
  });

  it('draws growing glyphs grey and restores the normal color as each word finishes', () => {
    const message = new DialogueMessage('message', 0, 0, 20, '');
    message.shortGrowthSequences = message.growthSequences;
    message.stepDurationMs = 10;
    message.wordDelayMs = 50;
    message.showText('Hi all');
    const buffer = new CellBuffer(20, 1, { ch: ' ', fg: message.fg, bg: message.bg });
    message.render(buffer);
    expect(buffer.get(0, 0).fg).toEqual({ r: 128, g: 128, b: 128 });
    message.advanceAnimation(50);
    message.render(buffer);
    expect(buffer.get(0, 0).ch).toBe('H');
    expect(buffer.get(0, 0).fg).toEqual(message.fg);
    expect(buffer.get(3, 0).fg).toEqual({ r: 128, g: 128, b: 128 });
    message.finishAnimation();
    message.render(buffer);
    expect(buffer.get(3, 0).ch).toBe('a');
    expect(buffer.get(3, 0).fg).toEqual(message.fg);
  });

  it('cascades across wrapped lines and keeps the final wrapping stable', () => {
    const message = new DialogueMessage('message', 0, 0, 5, '');
    message.shortGrowthSequences = message.growthSequences;
    message.wordDelayMs = 100;
    message.showText('Hello world');
    expect(message.lines).toEqual(['Hello', 'world']);
    expect(getRenderedText(message)).toBe('_____');
    message.advanceAnimation(125);
    expect(getRenderedText(message)).toBe('Hello');
    expect(message.isAnimationComplete()).toBe(false);
    message.advanceAnimation(100);
    expect(message.isAnimationComplete()).toBe(true);
  });

  it('left-aligns the entire wrapped reply during growth and after completion', () => {
    const message = new DialogueMessage('message', 0, 0, 8, '');
    message.alignRight = true;
    message.shortGrowthSequences = message.growthSequences;
    message.showText('Hi all there');
    const buffer = new CellBuffer(8, 3, { ch: ' ', fg: message.fg, bg: message.bg });
    message.render(buffer);
    expect(getPlainText(buffer).split('\n').slice(0, 2)).toEqual(['__      ', '        ']);
    message.advanceAnimation(180);
    message.render(buffer);
    expect(getPlainText(buffer).split('\n')[1]).toBe('_____   ');
    message.finishAnimation();
    message.render(buffer);
    expect(getPlainText(buffer).split('\n').slice(0, 2)).toEqual(['Hi all  ', 'there   ']);
  });

  it('keeps single-line replies right-aligned and updates alignment when resized', () => {
    const message = new DialogueMessage('message', 0, 0, 8, '');
    message.alignRight = true;
    message.shortGrowthSequences = message.growthSequences;
    message.showText('Hi all');
    expect(getRenderedText(message)).toBe('  __');
    message.finishAnimation();
    expect(getRenderedText(message)).toBe('  Hi all');
    message.width = 5;
    expect(getRenderedText(message)).toBe('Hi');
    message.width = 8;
    expect(getRenderedText(message)).toBe('  Hi all');
  });

  it('starts fragments of a long wrapped word at the same time', () => {
    const message = new DialogueMessage('message', 0, 0, 5, '');
    message.shortGrowthSequences = message.growthSequences;
    message.wordDelayMs = 100;
    message.showText('abcdefgh next');
    expect(message.lines).toEqual(['abcde', 'fgh', 'next']);
    const buffer = new CellBuffer(5, 3, { ch: ' ', fg: message.fg, bg: message.bg });
    message.render(buffer);
    expect(getPlainText(buffer).split('\n')).toEqual(['_____', '___  ', '     ']);
    message.advanceAnimation(125);
    expect(message.isAnimationComplete()).toBe(false);
    message.render(buffer);
    expect(getPlainText(buffer).split('\n')).toEqual(['abcde', 'fgh  ', ',,,, ']);
  });

  it('supports skipping, disabling, and restarting', () => {
    const message = new DialogueMessage('message', 0, 0, 20, '');
    message.shortGrowthSequences = message.growthSequences;
    message.showText('Hello world');
    expect(message.isAnimationComplete()).toBe(false);
    message.finishAnimation();
    expect(message.isAnimationComplete()).toBe(true);
    expect(getRenderedText(message)).toBe('Hello world');
    message.showText('Again');
    expect(getRenderedText(message)).toBe('_____');
    message.animationEnabled = false;
    expect(getRenderedText(message)).toBe('Again');
    message.showText('Done');
    expect(message.isAnimationComplete()).toBe(true);
    expect(getRenderedText(message)).toBe('Done');
  });
});
