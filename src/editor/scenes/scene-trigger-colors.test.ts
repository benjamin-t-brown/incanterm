import { describe, expect, it } from 'vitest';
import { sceneTriggerColors } from './scene-trigger-colors.js';

const region = {
  id: 'test',
  trigger: 'test',
  event: 'action' as const,
  x: 0,
  y: 0,
  width: 2,
  height: 2,
};

describe('scene trigger colors', () => {
  it('keeps the existing action color for older regions', () => {
    expect(sceneTriggerColors(region)).toMatchObject({
      fill: 'rgba(235, 88, 79, 0.2)',
      stroke: '#ec7e77',
      selected: '#ffae95',
    });
  });

  it('distinguishes step-only, both, and disabled regions', () => {
    const action = sceneTriggerColors(region);
    const step = sceneTriggerColors({ ...region, actionEnabled: false, stepEnabled: true });
    const both = sceneTriggerColors({ ...region, actionEnabled: true, stepEnabled: true });
    const disabled = sceneTriggerColors({ ...region, actionEnabled: false, stepEnabled: false });
    expect(step.stroke).toBe('#78c795');
    expect(both.stroke).toBe('#c79564');
    expect(new Set([action.stroke, step.stroke, both.stroke, disabled.stroke]).size).toBe(4);
  });
});
