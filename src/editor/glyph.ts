const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
];

export function isSingleWidthGlyph(value: string): boolean {
  const points = [...value];
  if (points.length !== 1) return false;
  const codePoint = points[0].codePointAt(0);
  if (codePoint === undefined) return false;
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return false;
  if (codePoint === 0x303f) return true;
  return !WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}
