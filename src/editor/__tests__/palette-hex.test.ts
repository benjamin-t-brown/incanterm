import { expect, it } from 'vitest';
import { parseHexColor } from '../palette.js';

it('accepts pasted short and full hex colors with or without a hash', () => {
  expect(parseHexColor(' #aBc ')).toBe('#aabbcc');
  expect(parseHexColor('ABC')).toBe('#aabbcc');
  expect(parseHexColor('FF8800')).toBe('#ff8800');
  expect(parseHexColor('#123456')).toBe('#123456');
  expect(parseHexColor('#12')).toBeNull();
  expect(parseHexColor('#12345678')).toBeNull();
  expect(parseHexColor('red')).toBeNull();
});
