import { describe, expect, it } from 'vitest';
import { parseRpgScript, ScriptRunner } from './test-support.js';

describe('item commands and conditions', () => {
  it('negates hasItem for an exact item name in a braced condition', () => {
    const scripts = parseRpgScript(`@start
+?isnot(func(hasItem, OfficeEnvelope)):{
  +setStorage(doorBlocked, true)
}
+?else:{
  +setStorage(doorOpen, true)
}`, 'items.rpgscript');
    const withoutItem = new ScriptRunner(scripts);
    withoutItem.start('start');
    expect(withoutItem.getGlobal('doorBlocked')).toBe(true);
    expect(withoutItem.getGlobal('doorOpen')).toBeUndefined();

    const withItem = new ScriptRunner(scripts);
    withItem.setGlobal('vars.inventory', ['OfficeEnvelope']);
    withItem.start('start');
    expect(withItem.getGlobal('doorBlocked')).toBeUndefined();
    expect(withItem.getGlobal('doorOpen')).toBe(true);
  });

  it('acquires unique items, checks membership, removes items and keeps inventory per player', () => {
    const scripts = parseRpgScript(`@start(item)
+acquireItem([item])
+acquireItem([item])
+?func(hasItem, [item]):A: "Owned"
+removeItem([item])
+?func(hasItem, [item]):A: "Still owned"
+?isnot(func(hasItem, [item])):A: "Removed"`, 'items.rpgscript');
    const first = new ScriptRunner(scripts);
    const second = new ScriptRunner(scripts);
    first.start('start', ['key']);
    expect(first.getGlobal('vars.inventory')).toEqual(['key']);
    expect(first.dialogue?.text).toBe('Owned');
    expect(second.getGlobal('vars.inventory')).toBeUndefined();
    first.advance();
    expect(first.getGlobal('vars.inventory')).toEqual([]);
    expect(first.dialogue?.text).toBe('Removed');
    first.advance();
    expect(first.isIdle()).toBe(true);
    second.start('start', ['coin']);
    expect(second.getGlobal('vars.inventory')).toEqual(['coin']);
  });

  it('treats bare item names as literals, supports interpolation and checks existing inventory', () => {
    const scripts = parseRpgScript(`@start
+acquireItem(key)
+acquireItem(coin)
+?func(hasItem, key):A: "Key"
+?func(hasItem, {wanted}):A: "Wanted"
+?func(hasItem, "{wanted}"):A: "Interpolated"`, 'items.rpgscript');
    const runner = new ScriptRunner(scripts);
    runner.setGlobal('key', 'coin');
    runner.setGlobal('wanted', 'coin');
    runner.start('start');
    expect(runner.getGlobal('vars.inventory')).toEqual(['key', 'coin']);
    expect(runner.dialogue?.text).toBe('Key');
    runner.advance();
    expect(runner.dialogue?.text).toBe('Wanted');
    runner.advance();
    expect(runner.dialogue?.text).toBe('Interpolated');
  });

  it('logs removal of a missing item and continues', () => {
    const scripts = parseRpgScript('@start\n+removeItem(key)\n+acquireItem(coin)', 'items.rpgscript');
    const logs: string[] = [];
    const runner = new ScriptRunner(scripts, (message) => logs.push(message));
    runner.start('start');
    expect(runner.getGlobal('vars.inventory')).toEqual(['coin']);
    expect(logs).toEqual(['[RPGSCRIPT] removeItem: item key is not in vars.inventory (items.rpgscript:2)']);
  });

  it('rejects unsupported functions and invalid item names', () => {
    expect(() => parseRpgScript('@start\n+?func(other, key):A: "No"', 'items.rpgscript'))
      .toThrow('items.rpgscript:2: Invalid arguments for condition func');
    const scripts = parseRpgScript('@start\n+acquireItem(3)', 'items.rpgscript');
    expect(() => new ScriptRunner(scripts).start('start')).toThrow('acquireItem requires an item name');
  });
});
