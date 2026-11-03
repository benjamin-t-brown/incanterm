export type PaletteColor = {
  id: string;
  rgb: string;
};

export type PaletteDocument = {
  format: 'incanterm-palette';
  version: 1;
  colors: PaletteColor[];
};

export const PALETTE_COLORS: readonly PaletteColor[] = [
  { id: 'black', rgb: '#000000' },
  { id: 'red', rgb: '#aa0000' },
  { id: 'green', rgb: '#00aa00' },
  { id: 'yellow', rgb: '#aa5500' },
  { id: 'blue', rgb: '#0000aa' },
  { id: 'magenta', rgb: '#aa00aa' },
  { id: 'cyan', rgb: '#00aaaa' },
  { id: 'white', rgb: '#aaaaaa' },
  { id: 'bright-black', rgb: '#555555' },
  { id: 'bright-red', rgb: '#ff5555' },
  { id: 'bright-green', rgb: '#55ff55' },
  { id: 'bright-yellow', rgb: '#ffff55' },
  { id: 'bright-blue', rgb: '#5555ff' },
  { id: 'bright-magenta', rgb: '#ff55ff' },
  { id: 'bright-cyan', rgb: '#55ffff' },
  { id: 'bright-white', rgb: '#ffffff' },
];

export const PALETTE_IDS = PALETTE_COLORS.map((color) => color.id);

export function parseHexColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex))
    return `#${[...hex].map((digit) => digit.repeat(2)).join('').toLowerCase()}`;
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : null;
}

export function isSpriteColor(value: string): boolean {
  return PALETTE_IDS.includes(value) || /^#[0-9a-fA-F]{6}$/.test(value);
}

export function getDefaultPalette(): PaletteDocument {
  return {
    format: 'incanterm-palette',
    version: 1,
    colors: PALETTE_COLORS.map((color) => ({ ...color })),
  };
}

export function getPaletteRgb(palette: PaletteDocument, id: string): string | undefined {
  if (/^#[0-9a-fA-F]{6}$/.test(id)) return id.toLowerCase();
  return palette.colors.find((color) => color.id === id)?.rgb;
}
