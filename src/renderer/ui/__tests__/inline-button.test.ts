import { expect, it } from 'vitest';
import { CellBuffer } from '../../../game/cell-buffer.js';
import { getPlainText } from '../../../game/terminal.js';
import { InlineButton } from '../button.js';
import { UI_INK } from '../standard-ui.js';

it('renders a button with brackets and padding on a single line', () => {
  const button = new InlineButton('examine', 1, 1, 'Examine');
  const buffer = new CellBuffer(13, 3, { ...UI_INK, ch: '.' });
  button.render(buffer);
  expect(button.height).toBe(1);
  expect(button.width).toBe(11);
  expect(buffer.get(3, 1)).toEqual({
    ch: 'E',
    bg: { r: 210, g: 210, b: 210 },
    fg: { r: 20, g: 64, b: 40 },
  });
  expect(getPlainText(buffer).split('\n')).toEqual([
    '.............',
    '.[ Examine ].',
    '.............',
  ]);
});
