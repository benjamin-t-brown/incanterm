import { describe, expect, it } from 'vitest';
import { DialoguePanel } from '../dialogue-panel.js';

describe('DialoguePanel', () => {
  it('uses a dark green background throughout the dialogue UI', () => {
    const panel = new DialoguePanel('dialogue', 0, 0, 40, 10);
    const green = { r: 16, g: 25, b: 20 };
    expect(panel.bg).toEqual(green);
    expect(panel.message.bg).toEqual(green);
    expect(panel.advanceHint.bg).toEqual(green);
    expect(panel.speakerBox.bg).toEqual(green);
    expect(panel.rightSpeakerBox.bg).toEqual(green);
    expect(panel.portraitBox.bg).toEqual(green);
    expect(panel.rightPortraitBox.bg).toEqual(green);
  });

  it('aligns only the right participant’s dialogue to the right', () => {
    const panel = new DialoguePanel('dialogue', 0, 0, 40, 10);
    panel.setSpeakers('Left', 'Right', 'Left');
    expect(panel.message.alignRight).toBe(false);
    expect(panel.advanceHint.x).toBe(panel.message.x);
    panel.setSpeakers('Left', 'Right', 'Right');
    expect(panel.message.alignRight).toBe(true);
    expect(panel.advanceHint.x + panel.advanceHint.width).toBe(panel.message.x + panel.message.width);
    panel.setSpeaker('Right');
    expect(panel.message.alignRight).toBe(false);
    expect(panel.advanceHint.x).toBe(panel.message.x);
  });
});
