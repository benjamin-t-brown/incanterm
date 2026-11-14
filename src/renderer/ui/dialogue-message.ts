import type { DrawContext } from './element.js';
import { ParagraphWrapped } from './paragraph-wrapped.js';
import { DEFAULT_GROWTH_SEQUENCES, DEFAULT_SHORT_GROWTH_SEQUENCES, getRandomGrowthSequence, GROWING_FG, isShortCharacter } from '../glyph-growth.js';

export { DEFAULT_GROWTH_SEQUENCES, DEFAULT_SHORT_GROWTH_SEQUENCES, isShortCharacter } from '../glyph-growth.js';

/** Keeps the final wrapping in place while each word grows through the glyph sequence. */
export class DialogueMessage extends ParagraphWrapped {
  alignRight = false;
  animationEnabled = true;
  /** Milliseconds spent on each growth glyph. */
  stepDurationMs = 25;
  /** Milliseconds between the starts of adjacent words. */
  wordDelayMs = 90;
  growthSequences: readonly string[] = DEFAULT_GROWTH_SEQUENCES;
  shortGrowthSequences: readonly string[] = DEFAULT_SHORT_GROWTH_SEQUENCES;
  private elapsedMs = 0;
  private animating = false;
  private characterSequences: string[][] = [];

  showText(text: string): void {
    this.text = text;
    this.elapsedMs = 0;
    this.animating = this.animationEnabled && text.length > 0;
    this.characterSequences = (text.match(/\S+/g) ?? []).map((word) =>
      word.split('').map((character) => getRandomGrowthSequence(character, this.growthSequences, this.shortGrowthSequences)));
  }

  clearText(): void {
    this.text = '';
    this.animating = false;
    this.characterSequences = [];
  }

  advanceAnimation(elapsedMs: number): void {
    if (this.animating) this.elapsedMs += Math.max(0, elapsedMs);
  }

  isAnimationComplete(): boolean {
    if (!this.animating || !this.animationEnabled) return true;
    const count = this.text.match(/\S+/g)?.length ?? 0;
    return count === 0 || this.elapsedMs >= (count - 1) * this.wordDelayMs +
      Math.max(this.growthSequences[0].length, this.shortGrowthSequences[0].length) * this.stepDurationMs;
  }

  finishAnimation(): void {
    this.animating = false;
  }

  protected paint(ctx: DrawContext): void {
    const lines = this.lines;
    const alignRight = this.alignRight && lines.length === 1;
    if (this.isAnimationComplete() && !alignRight) {
      super.paint(ctx);
      return;
    }
    const complete = this.isAnimationComplete();
    let wordIndex = 0;
    const words = this.text.match(/\S+/g) ?? [];
    let remaining = '';
    for (let y = 0; y < this.height; y++) {
      const line = lines[y] ?? '';
      const offset = alignRight ? Math.max(0, this.width - line.length) : 0;
      const fg = this.lineColors?.[y] ?? this.fg;
      for (let x = 0; x < this.width; x++) {
        ctx.set(x, y, { ch: ' ', fg, bg: this.bg });
      }
      for (const match of line.matchAll(/\S+/g)) {
        if (!remaining) remaining = words[wordIndex] ?? match[0];
        const wordOffset = (words[wordIndex]?.length ?? match[0].length) - remaining.length;
        const age = this.elapsedMs - wordIndex * this.wordDelayMs;
        const stage = Math.floor(age / this.stepDurationMs);
        for (let x = 0; x < match[0].length; x++) {
          const sequence = this.characterSequences[wordIndex]?.[wordOffset + x] ??
            (isShortCharacter(match[0][x]) ? this.shortGrowthSequences[0] : this.growthSequences[0]);
          const growing = age >= 0 && stage < sequence.length;
          const ch = complete ? match[0][x] : age < 0 ? ' ' : growing ? sequence[Math.max(0, stage)] : match[0][x];
          ctx.set(offset + match.index + x, y, { ch, fg: !complete && growing ? GROWING_FG : fg, bg: this.bg });
        }
        remaining = remaining.slice(match[0].length);
        if (!remaining) wordIndex++;
      }
    }
  }
}
