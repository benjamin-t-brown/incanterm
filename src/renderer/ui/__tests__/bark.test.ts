import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../../../game/cell-buffer.js';
import { Character } from '../../../game/character.js';
import { Scene } from '../../../game/scene.js';
import { Sprite } from '../../../game/sprite.js';
import { getPlainText } from '../../../game/terminal.js';
import { LayoutStandardScene, STANDARD_BACKGROUND } from '../layout-standard-scene.js';

function createLayout(): { layout: LayoutStandardScene; character: Character } {
  const sprite = new Sprite('s', 3, 3, 1, 2, Array.from({ length: 9 }, () => ({ ...STANDARD_BACKGROUND, ch: '#' })));
  const character = new Character('c', 20, 20, 0, sprite, 'c', undefined, 'idle', 'down');
  const scene = new Scene('room', 40, 30, 'regular-z', STANDARD_BACKGROUND, [character]);
  return { layout: new LayoutStandardScene(scene), character };
}

function getLines(layout: LayoutStandardScene): string[] {
  const buffer = new CellBuffer(120, 40, STANDARD_BACKGROUND);
  layout.render(buffer);
  return getPlainText(buffer).split('\n');
}

describe('bark', () => {
  it('wraps to 20 columns above the character and expires', () => {
    const { layout, character } = createLayout();
    const isDone = layout.addBark(character, 'hello there my friend how are you', 2000);
    const lines = getLines(layout);
    const rows = lines.map((line, y) => ({ line, y })).filter(({ line }) => /hello|friend|you/.test(line));
    expect(rows.length).toBeGreaterThan(1);
    expect(Math.max(...rows.map(({ line }) => line.trim().length))).toBeLessThanOrEqual(20);
    const spriteTop = lines.findIndex((line) => line.includes('###'));
    expect(Math.max(...rows.map(({ y }) => y))).toBeLessThan(spriteTop);
    expect(isDone()).toBe(false);
    layout.updateBarks(2000);
    expect(isDone()).toBe(true);
    expect(getLines(layout).join('\n')).not.toContain('hello');
  });
});
