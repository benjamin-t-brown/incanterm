import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSingleWidthGlyph } from './glyph.js';
import { PALETTE_IDS, defaultPalette } from './palette.js';
import {
  createAnimation,
  createSprite,
  DEFAULT_ANIMATION_DURATION_MS,
  exportAscii,
  exportTruecolor,
  flattenSprite,
  importEdAscii,
  MAX_FRAMES,
  parseAnimation,
  parsePalette,
  parseSprite,
} from './schema.js';

describe('editor schema', () => {
  it('keeps the sixteen ed-ascii colors and rejects palette changes to the set', () => {
    const palette = defaultPalette();
    expect(palette.colors.map((color) => color.id)).toEqual(PALETTE_IDS);
    expect(parsePalette(palette).ok).toBe(true);

    const recolored = structuredClone(palette);
    recolored.colors[1].rgb = '#112233';
    expect(parsePalette(recolored)).toMatchObject({
      ok: true,
      value: { colors: expect.arrayContaining([{ id: 'red', rgb: '#112233' }]) },
    });

    const extra = structuredClone(palette);
    extra.colors.push({ id: 'new', rgb: '#000000' });
    expect(parsePalette(extra).ok).toBe(false);

    const renamed = structuredClone(palette);
    renamed.colors[0].id = 'ink';
    expect(parsePalette(renamed).ok).toBe(false);
  });

  it('accepts a sprite of palette ids and rejects wide glyphs and inline colors', () => {
    const sprite = createSprite('crate-mark', 1, 1);
    sprite.sprites[0].layers[0].cells[0] = { ch: '█', fg: 'bright-white', bg: 'black' };
    expect(parseSprite(sprite)).toMatchObject({
      ok: true,
      value: { id: 'crate-mark', version: 3 },
    });

    const wide = structuredClone(sprite);
    const wideCell = wide.sprites[0].layers[0].cells[0];
    if (!wideCell) throw new Error('expected a painted cell');
    wideCell.ch = '你';
    expect(parseSprite(wide).ok).toBe(false);
    expect(isSingleWidthGlyph('😀')).toBe(false);

    const hex = structuredClone(sprite);
    const hexCell = hex.sprites[0].layers[0].cells[0];
    if (!hexCell) throw new Error('expected a painted cell');
    hexCell.fg = '#ffffff';
    expect(parseSprite(hex).ok).toBe(false);
  });

  it('loads a version 1 sprite as one opaque layer and flattens a stack when drawing', () => {
    const legacy = parseSprite({
      format: 'incanterm-sprite',
      version: 1,
      id: 'old',
      width: 1,
      height: 1,
      originX: 0,
      originY: 0,
      cells: [{ ch: ' ', fg: 'white', bg: 'blue' }],
    });
    expect(legacy).toMatchObject({
      ok: true,
      value: {
        version: 3,
        sprites: [
          {
            layers: [
              {
                id: 'layer-1',
                name: 'Layer 1',
                visible: true,
                cells: [{ ch: ' ', fg: 'white', bg: 'blue' }],
              },
            ],
          },
        ],
      },
    });

    const sprite = createSprite('stack', 1, 2);
    expect(sprite.sprites[0].layers[0].cells).toEqual([null, null]);
    sprite.sprites[0].layers[0].cells[0] = { ch: 'A', fg: 'white', bg: 'black' };
    sprite.sprites[0].layers.push({
      id: 'layer-2',
      name: 'Front',
      visible: true,
      locked: false,
      cells: [{ ch: 'B', fg: 'red', bg: 'black' }, null],
    });
    expect(flattenSprite(sprite)).toEqual([
      { ch: 'B', fg: 'red', bg: 'black' },
      { ch: ' ', fg: 'white', bg: 'black' },
    ]);
    sprite.sprites[0].layers[1].visible = false;
    expect(flattenSprite(sprite)[0]).toEqual({ ch: 'A', fg: 'white', bg: 'black' });

    const saved = parseSprite(sprite);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.sprites[0].layers).toHaveLength(2);
    expect(saved.value.sprites[0].layers.every((layer) => layer.locked === false)).toBe(true);
    expect('cells' in saved.value).toBe(false);
    expect('layers' in saved.value).toBe(false);
    const lockedFile = structuredClone(sprite);
    lockedFile.sprites[0].layers[0].locked = true;
    const locked = parseSprite(lockedFile);
    expect(locked.ok && locked.value.sprites[0].layers[0].locked).toBe(true);
    const omitted = structuredClone(sprite) as {
      sprites: Array<{ layers: Array<Record<string, unknown>> }>;
    };
    delete omitted.sprites[0].layers[0].locked;
    const unlocked = parseSprite(omitted);
    expect(unlocked.ok && unlocked.value.sprites[0].layers[0].locked).toBe(false);
    const invalid = structuredClone(sprite);
    invalid.sprites[0].layers[0].locked = 'yes' as unknown as boolean;
    expect(parseSprite(invalid).ok).toBe(false);

    expect(
      parseSprite({
        ...sprite,
        sprites: [
          {
            layers: Array.from({ length: 33 }, (_, index) => ({
              id: `layer-${index + 1}`,
              name: `Layer ${index + 1}`,
              visible: true,
              cells: [null, null],
            })),
          },
        ],
      }).ok,
    ).toBe(false);
    const repeated = structuredClone(sprite);
    repeated.sprites[0].layers[1].id = repeated.sprites[0].layers[0].id;
    expect(parseSprite(repeated).ok).toBe(false);
  });

  it('migrates a version 2 sprite and flattens a selected frame', () => {
    const migrated = parseSprite({
      format: 'incanterm-sprite',
      version: 2,
      id: 'mark',
      width: 1,
      height: 1,
      originX: 0,
      originY: 0,
      layers: [
        {
          id: 'layer-1',
          name: 'Layer 1',
          visible: true,
          locked: false,
          cells: [{ ch: 'A', fg: 'white', bg: 'black' }],
        },
      ],
    });
    expect(migrated).toMatchObject({
      ok: true,
      value: { version: 3, sprites: [{ layers: [{ id: 'layer-1' }] }] },
    });

    const sheet = createSprite('walk', 1, 1);
    sheet.sprites[0].layers[0].cells[0] = { ch: '1', fg: 'white', bg: 'black' };
    sheet.sprites.push({
      layers: [
        {
          id: 'layer-1',
          name: 'Layer 1',
          visible: true,
          locked: false,
          cells: [{ ch: '2', fg: 'red', bg: 'black' }],
        },
      ],
    });
    expect(flattenSprite(sheet, 1)).toEqual([{ ch: '2', fg: 'red', bg: 'black' }]);
    expect(parseSprite(sheet)).toMatchObject({
      ok: true,
      value: { version: 3, sprites: [{}, {}] },
    });
    expect(parseSprite({ ...sheet, sprites: [] }).ok).toBe(false);
  });

  it('imports ed-ascii indices onto palette ids', () => {
    const imported = importEdAscii('stamp', {
      format: 'ed-ascii',
      version: 1,
      width: 2,
      height: 1,
      cells: [
        { ch: '█', fg: 15, bg: 0 },
        { ch: ' ', fg: 7, bg: 4 },
      ],
    });
    expect(imported).toMatchObject({
      ok: true,
      value: {
        id: 'stamp',
        version: 3,
        sprites: [
          {
            layers: [
              {
                cells: [
                  { ch: '█', fg: 'bright-white', bg: 'black' },
                  { ch: ' ', fg: 'white', bg: 'blue' },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(
      importEdAscii('stamp', {
        format: 'ed-ascii',
        version: 1,
        width: 1,
        height: 1,
        cells: [{ ch: '\u001b', fg: 15, bg: 0 }],
      }).ok,
    ).toBe(false);
  });

  it('imports the ed-ascii fixture', async () => {
    const file = path.join(process.cwd(), 'ed-ascii', 'data', 'test1.json');
    const document = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    const imported = importEdAscii('test-art', document);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.width).toBe(64);
    expect(imported.value.height).toBe(32);
  });

  it('describes a flat animation clip', () => {
    expect(createAnimation('blink')).toEqual({
      format: 'incanterm-animation',
      version: 1,
      id: 'blink',
      loop: true,
      defaultDurationMs: DEFAULT_ANIMATION_DURATION_MS,
      frames: [],
    });
    const parsed = parseAnimation({
      format: 'incanterm-animation',
      version: 1,
      id: 'blink',
      loop: true,
      frames: [
        { sprite: 'lamp-on', index: 0, durationMs: 120 },
        { sprite: 'lamp-off', index: 2, durationMs: 80 },
      ],
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        defaultDurationMs: DEFAULT_ANIMATION_DURATION_MS,
        frames: [
          { sprite: 'lamp-on', index: 0, durationMs: 120 },
          { sprite: 'lamp-off', index: 2, durationMs: 80 },
        ],
      },
    });
    expect(
      parseAnimation({
        format: 'incanterm-animation',
        version: 1,
        id: 'blink',
        loop: true,
        frames: [{ invisible: true, durationMs: 120 }],
      }),
    ).toMatchObject({
      ok: true,
      value: { frames: [{ invisible: true, durationMs: 120 }] },
    });
    expect(
      parseAnimation({
        format: 'incanterm-animation',
        version: 1,
        id: 'blink',
        loop: 'yes',
        frames: [],
      }).ok,
    ).toBe(false);
    expect(
      parseAnimation({
        format: 'incanterm-animation',
        version: 1,
        id: 'blink',
        loop: true,
        frames: [{ sprite: 'lamp-on', durationMs: 120 }],
      }).ok,
    ).toBe(false);
    expect(
      parseAnimation({
        format: 'incanterm-animation',
        version: 1,
        id: 'blink',
        loop: true,
        frames: Array.from({ length: MAX_FRAMES + 1 }, () => ({
          sprite: 'lamp-on',
          index: 0,
          durationMs: 100,
        })),
      }).ok,
    ).toBe(false);
  });

  it('defaults a missing spritesheet font and rejects an unknown typeface', () => {
    const sprite = createSprite('sign', 1, 1);
    expect(sprite.font).toBe('consolas');
    expect(parseSprite({ ...sprite, font: undefined })).toMatchObject({
      ok: true,
      value: { font: 'consolas' },
    });
    expect(parseSprite({ ...sprite, font: 'courier-new' })).toMatchObject({
      ok: true,
      value: { font: 'courier-new' },
    });
    expect(parseSprite({ ...sprite, font: 'msdos-80x25' })).toMatchObject({
      ok: true,
      value: { font: 'msdos-80x25' },
    });
    expect(parseSprite({ ...sprite, font: 'comic-sans' }).ok).toBe(false);
  });

  it('exports flattened glyphs as notepad text', () => {
    const sprite = createSprite('sign', 3, 2);
    sprite.sprites[0].layers[0].cells[0] = { ch: '╔', fg: 'white', bg: 'black' };
    sprite.sprites[0].layers[0].cells[1] = { ch: '═', fg: 'white', bg: 'black' };
    sprite.sprites[0].layers[0].cells[2] = { ch: '╗', fg: 'white', bg: 'black' };
    sprite.sprites.push({
      layers: [
        {
          id: 'layer-1',
          name: 'Layer 1',
          visible: true,
          locked: false,
          cells: [{ ch: 'A', fg: 'red', bg: 'black' }, { ch: 'B', fg: 'red', bg: 'black' }, null],
        },
      ],
    });
    expect(exportAscii(sprite)).toBe('╔═╗\r\n   \r\n');
    expect(exportAscii(sprite, 1)).toBe('AB \r\n   \r\n');
  });

  it('exports truecolor SGR from palette rgb', () => {
    const sprite = createSprite('dot', 1, 1);
    sprite.sprites[0].layers[0].cells[0] = { ch: '█', fg: 'bright-white', bg: 'black' };
    const exported = exportTruecolor(sprite, defaultPalette());
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value).toBe('\u001b[38;2;255;255;255;48;2;0;0;0m█\u001b[0m\r\n');
  });
});
