import { afterEach, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { createItemAsset, createItemScene, ITEM_INK } from '../../game/__tests__/item-fixture.js';
import { Character } from '../../game/character.js';
import { AnimatedProp } from '../../game/animated-prop.js';
import { WorldItem } from '../../game/items.js';
import { parseRpgScript } from '../../game/rpgscript/runtime.js';
import { commands } from '../../game/scene-commands.js';
import { getPlainText } from '../../game/terminal.js';
import { createGameSession } from '../game-session.js';
import { Scene } from '../../game/scene.js';

afterEach(() => vi.useRealTimers());

function createItemSession() {
  vi.useFakeTimers();
  const scene = createItemScene();
  const key = scene.itemAssets.get('key');
  if (!key) throw new Error('Missing fixture key');
  scene.entities.push(
    new AnimatedProp(
      'door',
      6,
      2,
      0,
      0,
      key.sprite,
      new Map([['default', key.clip]]),
      'default',
      'Door',
      'lock',
    ),
    new Character('guard', 8, 2, 0, key.sprite, 'guard', 'Guard', 'idle', 'down'),
    new Character('other', 10, 2, 0, key.sprite, 'stranger', 'Stranger', 'idle', 'down'),
  );
  const scripts = parseRpgScript(
    `@examineKey
+showCenterToast(INSPECTED)
@combineCoin
+removeItem(key)
+showCenterToast(COMBINED)
@unlockDoor
+showCenterToast(UNLOCKED)
@giveKey
+showCenterToast(GIVEN)
@failKey
+showCenterToast(FAILED)
`,
    'items.rpgscript',
    { commands },
  );
  const screen = new TerminalScreen();
  const session = createGameSession(
    scene,
    (text, cols, rows) => screen.apply(text, cols, rows),
    scripts,
  );
  session.resize(120, 40);
  session.open();
  function clickAt(x: number, y: number, right = false): void {
    session.input(`\x1b[<${right ? 2 : 0};${x + 1};${y + 1}M`);
  }
  function clickInventory(itemId: string, action = 'Use'): void {
    const label = scene.itemAssets.get(itemId)?.definition.label;
    const button = `[ ${action} ]`;
    const rows = getPlainText(screen.buffer).split('\n');
    const y = rows.findIndex((row) => row.includes(` ${label} `) && row.includes(button));
    if (y < 0) throw new Error(`No ${button} button for ${itemId}`);
    clickAt(rows[y].indexOf(button) + 2, y);
  }
  return { scene, session, screen, clickAt, clickInventory };
}

it('picks up items per player, examines them in world/inventory, and combines inventory items', () => {
  const first = createItemSession();
  const second = createItemSession();
  try {
    first.clickAt(2, 2, true);
    expect(getPlainText(first.screen.buffer)).toContain('INSPECTED');
    first.session.input(' ');
    first.clickAt(2, 2);
    first.clickAt(4, 2);
    expect(first.screen.buffer.get(2, 2).ch).toBe(' ');
    expect(second.screen.buffer.get(2, 2).ch).toBe('K');
    expect(first.scene.entities.filter((entity) => entity instanceof WorldItem)).toHaveLength(2);
    first.session.input('\t');
    expect(getPlainText(first.screen.buffer)).toMatch(/1\..* COIN/);
    expect(getPlainText(first.screen.buffer)).toMatch(/2\..* KEY/);
    expect(getPlainText(first.screen.buffer)).toContain('[ Examine ] [ Use ]');
    first.clickInventory('key', 'Examine');
    expect(getPlainText(first.screen.buffer)).toContain('INSPECTED');
    first.session.input(' ');
    first.clickInventory('coin');
    expect(getPlainText(first.screen.buffer)).toMatch(/^│> \d+\..* COIN .*\[ Cancel \]/m);
    first.clickInventory('coin', 'Cancel');
    expect(getPlainText(first.screen.buffer)).toContain('[ Examine ] [ Use ]');
    first.clickInventory('coin');
    first.clickInventory('key', 'Combine With This Item');
    expect(getPlainText(first.screen.buffer)).toContain('COMBINED');
    first.session.input(' ');
    expect(getPlainText(first.screen.buffer)).not.toContain('KEY');
  } finally {
    first.session.close();
    second.session.close();
  }
});

it('uses selected items on props/characters and calls the failed-combination hook without consuming items', () => {
  const game = createItemSession();
  try {
    game.clickAt(2, 2);
    game.session.input('\t');
    game.clickInventory('key');
    game.clickAt(6, 2);
    expect(getPlainText(game.screen.buffer)).toContain('UNLOCKED');
    game.session.input(' ');
    game.clickInventory('key');
    game.clickAt(8, 2);
    expect(getPlainText(game.screen.buffer)).toContain('GIVEN');
    game.session.input(' ');
    game.clickInventory('key');
    game.clickAt(10, 2);
    expect(getPlainText(game.screen.buffer)).toContain('FAILED');
    game.session.input(' ');
    expect(getPlainText(game.screen.buffer)).toContain('KEY');
    game.clickInventory('key');
    game.session.input('\x1b');
    expect(getPlainText(game.screen.buffer)).toMatch(/^│ {2}1\..* KEY/m);
  } finally {
    game.session.close();
  }
});

it('selects numbered items and supports keyboard examine, combine, and Escape', () => {
  const game = createItemSession();
  const getText = () => getPlainText(game.screen.buffer);
  try {
    game.clickAt(2, 2);
    game.clickAt(4, 2);
    game.session.input('2');
    game.session.input('e');
    expect(getText()).not.toContain('INSPECTED');

    game.session.input('\t');
    game.session.input('2');
    expect(getText()).toMatch(/^│> 2\..* KEY/m);
    vi.advanceTimersByTime(510);
    expect(getText()).toMatch(/^│ >2\..* KEY/m);
    expect(getText()).toContain('[ Examine ] [ Use ]');
    game.session.input('\x1b');
    game.session.input('e');
    expect(getText()).not.toMatch(/^│ ?>/m);
    expect(getText()).not.toContain('INSPECTED');
    game.session.input('2');
    game.session.input('e');
    expect(getText()).toContain('INSPECTED');
    game.session.input(' ');

    game.session.input('c');
    expect(getText()).toMatch(/^│> 2\..* KEY .*\[ Cancel \]/m);
    expect(getText()).toContain('[ Combine With This Item ]');
    game.session.input('\x1b');
    expect(getText()).not.toMatch(/^│ ?>/m);
    expect(getText()).toContain('[ Examine ] [ Use ]');

    game.session.input('2');
    game.session.input('c');
    game.session.input('\x1b[A');
    expect(getText()).toMatch(/^│> 1\..* COIN .*\[ Combine With This Item \]/m);
    game.session.input('c');
    expect(getText()).toContain('COMBINED');
  } finally {
    game.session.close();
  }
});

it('moves selection across inventory pages with arrows and Page Up and Page Down', () => {
  vi.useFakeTimers();
  const assets = Array.from({ length: 22 }, (_, index) => createItemAsset(`asset${index + 1}`));
  assets[10].definition.examineScript = 'inspectEleventh';
  const scene = new Scene(
    'pages',
    120,
    40,
    'regular-z',
    ITEM_INK,
    [],
    ['entry'],
    new Set(),
    [],
    [],
    [],
    undefined,
    new Map(assets.map((asset) => [asset.definition.id, asset])),
  );
  const sources = assets.map((asset) => `+addItem(${asset.definition.id})`).join('\n');
  const scripts = parseRpgScript(
    `#entry\nload,start\n@start\n${sources}\n@inspectEleventh\n+showCenterToast(INSPECTED ELEVENTH)`,
    'pages.rpgscript',
    { commands },
  );
  const screen = new TerminalScreen();
  const session = createGameSession(
    scene,
    (text, cols, rows) => screen.apply(text, cols, rows),
    scripts,
  );
  const getText = () => getPlainText(screen.buffer);
  session.resize(120, 40);
  try {
    session.open();
    session.input('\t');
    expect(getText()).toContain('Page 1/3');
    expect(getText()).toMatch(/\b1\..* ASSET1\b/);
    expect(getText()).not.toContain('ASSET11');
    session.input('9');
    expect(getText()).toMatch(/^│> {2}9\..* ASSET9\b/m);
    session.input('\x1b[B');
    expect(getText()).toContain('Page 1/3');
    expect(getText()).toMatch(/^│> 10\..* ASSET10\b/m);
    session.input('\x1b[B');
    expect(getText()).toContain('Page 2/3');
    expect(getText()).toMatch(/^│> 11\..* ASSET11\b/m);
    session.input('\x1b[6~');
    session.input('\x1b[6~');
    expect(getText()).toContain('Page 3/3');
    expect(getText()).toMatch(/^│> 21\..* ASSET21\b/m);
    expect(getText()).toMatch(/22\..* ASSET22/);
    session.input('\x1b[5~');
    const rows = getText().split('\n');
    const y = rows.findIndex((row) => row.includes('ASSET11'));
    expect(rows.some((row) => row.includes('Page 2/3'))).toBe(true);
    expect(y).toBeGreaterThanOrEqual(0);
    const x = rows[y].indexOf('Examine');
    expect(x).toBeGreaterThanOrEqual(0);
    session.input(`\x1b[<0;${x + 1};${y + 1}M`);
    expect(getText()).toContain('INSPECTED ELEVENTH');
    session.input(' ');
    session.input('1');
    expect(getText()).toContain('Page 1/3');
    expect(getText()).toMatch(/^│> {2}1\..* ASSET1\b/m);
  } finally {
    session.close();
  }
});

it('keeps consumed items collected across scene changes while retaining the item catalog', async () => {
  vi.useFakeTimers();
  const loaded = createItemScene();
  const asset = loaded.itemAssets.get('key');
  if (!asset) throw new Error('Missing key fixture');
  const player = new Character('hero', 0, 0, 0, asset.sprite, 'hero', 'Hero', 'idle', 'down');
  const first = new Scene(
    'first',
    120,
    40,
    'regular-z',
    loaded.clear,
    [player],
    ['entry'],
    new Set(),
    [],
    [],
    [],
    undefined,
    loaded.itemAssets,
  );
  const scripts = parseRpgScript(
    `#entry
load,start
@start
+setPlayerWalkCh(hero)
+addItem(OfficeKey)
+removeItem(OfficeKey)
+changeScene(next)
+?isnot(func(hasItem, OfficeKey)):+log("Key consumed")
`,
    'travel.rpgscript',
    { commands },
  );
  const screen = new TerminalScreen();
  const session = createGameSession(
    first,
    (text, cols, rows) => screen.apply(text, cols, rows),
    scripts,
    undefined,
    undefined,
    undefined,
    undefined,
    async () => loaded,
  );
  session.resize(120, 40);
  try {
    session.open();
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.buffer.get(2, 2).ch).toBe(' ');
    expect(screen.buffer.get(4, 2).ch).toBe('$');
    expect(getPlainText(screen.buffer)).toContain('Key consumed');
    expect(loaded.entities.filter((entity) => entity instanceof WorldItem)).toHaveLength(2);
  } finally {
    session.close();
  }
});
