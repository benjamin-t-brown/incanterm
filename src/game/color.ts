export type Rgb = {
  r: number;
  g: number;
  b: number;
};

export function parseHexColor(value: string): Rgb {
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}
