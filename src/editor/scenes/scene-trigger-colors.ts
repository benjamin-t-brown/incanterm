import type { SceneTrigger } from '../schema.js';

type RegionTrigger = Exclude<SceneTrigger, string>;

export function getSceneTriggerColors(trigger: RegionTrigger): {
  fill: string;
  stroke: string;
  selected: string;
} {
  if (trigger.event === 'load')
    return { fill: 'rgba(236, 180, 80, 0.25)', stroke: '#e6bc74', selected: '#ffe1a1' };
  const action = trigger.actionEnabled ?? true;
  const step = trigger.stepEnabled ?? false;
  if (action && step)
    return { fill: 'rgba(170, 112, 66, 0.28)', stroke: '#c79564', selected: '#e3b789' };
  if (step) return { fill: 'rgba(76, 174, 107, 0.23)', stroke: '#78c795', selected: '#a8e2b0' };
  if (action) return { fill: 'rgba(235, 88, 79, 0.2)', stroke: '#ec7e77', selected: '#ffae95' };
  return { fill: 'rgba(150, 150, 150, 0.12)', stroke: '#888888', selected: '#bbbbbb' };
}
