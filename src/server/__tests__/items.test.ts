import { afterEach, expect, it, vi } from 'vitest';
import { TerminalScreen } from '../../client/terminal-screen.js';
import { createItemScene } from '../../game/__tests__/item-fixture.js';
import { CellBuffer } from '../../game/cell-buffer.js';
import { Character } from '../../game/character.js';
import { AnimatedProp } from '../../game/animated-prop.js';
import { WorldItem } from '../../game/items.js';
import { parseRpgScript } from '../../game/rpgscript/runtime.js';
import { commands } from '../../game/scene-commands.js';
import { getPlainText } from '../../game/terminal.js';
import {
  LayoutStandardScene,
  STANDARD_BACKGROUND,
} from '../../renderer/ui/layout-standard-scene.js';
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
  function clickInventory(itemId: string, examine = false, inventory = ['key', 'coin']): void {
    const layout = new LayoutStandardScene(scene);
    layout.tabs.select('inventory');
    layout.inventory.items = inventory.flatMap((id) => {
      const asset = scene.itemAssets.get(id);
      return asset ? [asset] : [];
    });
    layout.render(new CellBuffer(120, 40, STANDARD_BACKGROUND));
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 120; x++) {
        const action = layout.getInventoryActionAt(x, y);
        if (action?.itemId === itemId && action.examine === examine) {
          clickAt(x, y);
          return;
        }
      }
    throw new Error(`No inventory action for ${itemId}`);
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
    expect(getPlainText(first.screen.buffer)).toContain('KEY');
    expect(getPlainText(first.screen.buffer)).toContain('COIN');
    first.clickInventory('key', true);
    expect(getPlainText(first.screen.buffer)).toContain('INSPECTED');
    first.session.input(' ');
    first.clickInventory('coin');
    first.clickInventory('key');
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
    game.clickInventory('key', false, ['key']);
    game.clickAt(6, 2);
    expect(getPlainText(game.screen.buffer)).toContain('UNLOCKED');
    game.session.input(' ');
    game.clickInventory('key', false, ['key']);
    game.clickAt(8, 2);
    expect(getPlainText(game.screen.buffer)).toContain('GIVEN');
    game.session.input(' ');
    game.clickInventory('key', false, ['key']);
    game.clickAt(10, 2);
    expect(getPlainText(game.screen.buffer)).toContain('FAILED');
    game.session.input(' ');
    expect(getPlainText(game.screen.buffer)).toContain('KEY');
    game.clickInventory('key', false, ['key']);
    game.session.input('\x1b');
    expect(getPlainText(game.screen.buffer)).toContain('Click an item to use it');
  } finally {
    game.session.close();
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
