import { expect, it } from 'vitest';
import { CellBuffer } from '../../../game/cell-buffer.js';
import { getPlainText } from '../../../game/terminal.js';
import { ChoicePanel } from '../choice-panel.js';
import { UI_INK } from '../standard-ui.js';

it('puts the question above left-aligned buttons in a 60-column panel', () => {
  const panel = new ChoicePanel();
  panel.setChoices({ question: 'Reset the shelves?', options: ['Yes', 'No'] });
  panel.resize(80, 9, 20);
  const buffer = new CellBuffer(60, 9, UI_INK);
  panel.render(buffer);
  const rows = getPlainText(buffer).split('\n');
  const x = rows[3].indexOf('1. Yes');

  expect(panel.width).toBe(60);
  expect(panel.height).toBe(9);
  expect(rows[1].indexOf('Reset the shelves?')).toBe(2);
  expect(rows[2][2]).toBe('┌');
  expect(rows[5][2]).toBe('┌');
  expect(rows[6].indexOf('2. No')).toBe(x);
  expect(panel.getChoiceAt(x, 1)).toBeUndefined();
  expect(panel.getChoiceAt(x, 3)).toBe(0);
  expect(panel.getChoiceAt(x, 6)).toBe(1);
  expect(panel.getChoiceAt(x, 8)).toBeUndefined();
});

it('stacks all nine choices as clickable compact buttons in the minimum viewport', () => {
  const panel = new ChoicePanel();
  panel.setChoices({
    question: 'What now?',
    options: ['Up', 'Down', 'Left', 'Right', 'Wait', 'Push', 'Pull', 'Stay', 'No'],
  });
  panel.resize(40, 5, 14);
  const buffer = new CellBuffer(40, 14, UI_INK);
  panel.render(buffer);
  const rows = getPlainText(buffer).split('\n');

  expect(panel.width).toBe(40);
  expect(panel.height).toBe(12);
  for (let index = 0; index < 9; index++) {
    const y = index + 2;
    const x = rows[y].indexOf(`${index + 1}. `);
    expect(x).toBeGreaterThan(0);
    expect(rows[y][2]).toBe('[');
    expect(panel.getChoiceAt(x, y)).toBe(index);
  }
  expect(panel.getChoiceAt(0, 1)).toBeUndefined();
  panel.setChoices(undefined);
  expect(panel.visible).toBe(false);
  expect(panel.getChoiceAt(6, 2)).toBeUndefined();
});

it('wraps the question and hit-tests choices after scrolling', () => {
  const panel = new ChoicePanel();
  panel.setChoices({ question: 'This long question must wrap on a narrow screen.', options: ['Yes', 'No'] });
  panel.resize(24, 5, 5);
  const buffer = new CellBuffer(24, 5, UI_INK);
  panel.render(buffer);
  const rows = getPlainText(buffer).split('\n');
  expect(rows[1]).toContain('This long question');
  expect(rows[2]).toContain('must wrap on a');
  expect(rows[3]).toContain('narrow screen.');

  panel.scrollToEnd();
  panel.render(buffer);
  const scrolled = getPlainText(buffer).split('\n');
  const x = scrolled[3].indexOf('2. No');
  expect(x).toBeGreaterThan(0);
  expect(panel.getChoiceAt(x, 3)).toBe(1);
});
