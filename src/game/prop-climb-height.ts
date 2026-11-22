/** The floor is one row below the lowest cell of the slide footprint. */
export function getPropClimbHeight(
  lowestBaseRow: number,
  lowestRoofRow: number | undefined,
  override?: number,
): number | undefined {
  const height = override ?? (lowestRoofRow === undefined ? 0 : lowestBaseRow + 1 - lowestRoofRow);
  return height > 0 ? height : undefined;
}
