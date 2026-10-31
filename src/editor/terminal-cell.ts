export type SpriteFontDefinition = {
  id: string;
  label: string;
  family: string;
  nativePx: number;
};

export const SPRITE_FONTS = [
  {
    id: 'consolas',
    label: 'Consolas',
    family: "Consolas, 'Cascadia Mono', ui-monospace, monospace",
    nativePx: 16,
  },
  {
    id: 'cascadia-mono',
    label: 'Cascadia Mono',
    family: "'Cascadia Mono', Consolas, ui-monospace, monospace",
    nativePx: 16,
  },
  {
    id: 'cascadia-code',
    label: 'Cascadia Code',
    family: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    nativePx: 16,
  },
  {
    id: 'courier-new',
    label: 'Courier New',
    family: "'Courier New', Courier, monospace",
    nativePx: 16,
  },
  {
    id: 'mono',
    label: 'Mono',
    family: 'Monospace, monospace',
    nativePx: 16,
  },
  {
    id: 'lucida-console',
    label: 'Lucida Console',
    family: "'Lucida Console', Consolas, monospace",
    nativePx: 16,
  },
  {
    id: 'fixedsys',
    label: 'Fixedsys',
    family: 'Fixedsys, monospace',
    nativePx: 16,
  },
  {
    id: 'msdos-80x25',
    label: 'MS-DOS 80x25',
    family: "'Incanterm VGA 8x16', monospace",
    nativePx: 16,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    family: "Terminal, 'Incanterm EGA 8x14', monospace",
    nativePx: 14,
  },
] as const satisfies readonly SpriteFontDefinition[];

export type SpriteFontId = (typeof SPRITE_FONTS)[number]['id'];
export const DEFAULT_SPRITE_FONT: SpriteFontId = 'consolas';
export const TERMINAL_FONT_STACK: string = SPRITE_FONTS[0].family;
export const TERMINAL_FONT_PX = 16;

/** Classic VT / Windows Terminal virtual cell at a 16px em, used if the font cannot be measured. */
export const FALLBACK_CELL = { width: 10, height: 20, ascent: 16 } as const;

export type TerminalCell = {
  width: number;
  height: number;
  ascent: number;
  /** Native font, scaled by the canvas transform rather than resized independently. */
  font: string;
  scale: number;
};

export type TextMeasurer = {
  font: string;
  measureText(text: string): {
    width: number;
    fontBoundingBoxAscent?: number;
    fontBoundingBoxDescent?: number;
  };
};

export function isSpriteFontId(value: string): value is SpriteFontId {
  return SPRITE_FONTS.some((font) => font.id === value);
}

export function spriteFontFamily(id: SpriteFontId = DEFAULT_SPRITE_FONT): string {
  return SPRITE_FONTS.find((font) => font.id === id)?.family ?? SPRITE_FONTS[0].family;
}

export function spriteFontNativePx(id: SpriteFontId = DEFAULT_SPRITE_FONT): number {
  return SPRITE_FONTS.find((font) => font.id === id)?.nativePx ?? TERMINAL_FONT_PX;
}

export function terminalFont(fontPx: number, family = TERMINAL_FONT_STACK): string {
  return `${fontPx}px ${family}`;
}

export function measureTerminalCell(
  measurer: TextMeasurer,
  fontPx: number,
  family = TERMINAL_FONT_STACK,
): TerminalCell {
  const font = terminalFont(fontPx, family);
  measurer.font = font;
  const metrics = measurer.measureText('M');
  const width = metrics.width;
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent;
  if (
    !(width > 0) ||
    !Number.isFinite(width) ||
    !(ascent !== undefined && ascent > 0 && Number.isFinite(ascent)) ||
    !(descent !== undefined && descent >= 0 && Number.isFinite(descent))
  ) {
    const scale = fontPx / TERMINAL_FONT_PX;
    return {
      width: FALLBACK_CELL.width * scale,
      height: FALLBACK_CELL.height * scale,
      ascent: FALLBACK_CELL.ascent * scale,
      font,
      scale: 1,
    };
  }
  return { width, height: ascent + descent, ascent, font, scale: 1 };
}

export function terminalCellAtZoom(
  measurer: TextMeasurer,
  zoom: number,
  fontId: SpriteFontId = DEFAULT_SPRITE_FONT,
): TerminalCell {
  const family = spriteFontFamily(fontId);
  const nativePx = spriteFontNativePx(fontId);
  const base = measureTerminalCell(measurer, nativePx, family);
  return {
    width: base.width * zoom,
    height: base.height * zoom,
    ascent: base.ascent * zoom,
    font: base.font,
    scale: zoom,
  };
}

export function applyTerminalGlyphStyle(
  context: {
    font: string;
    textAlign: 'left' | 'right' | 'center' | 'start' | 'end';
    textBaseline: 'alphabetic' | 'top' | 'hanging' | 'middle' | 'ideographic' | 'bottom';
  },
  cell: TerminalCell,
): void {
  context.font = cell.font;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
}

export function preloadSpriteFonts(): Promise<void> {
  const fonts = (
    globalThis as {
      document?: { fonts?: { load(font: string): Promise<unknown> } };
    }
  ).document?.fonts;
  if (!fonts) return Promise.resolve();
  return Promise.all(
    SPRITE_FONTS.map((font) =>
      fonts
        .load(`${font.nativePx}px ${font.family}`)
        .then(() => undefined)
        .catch(() => undefined),
    ),
  ).then(() => undefined);
}
