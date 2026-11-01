export function filterSprites(
  files: readonly string[],
  labels: ReadonlyMap<string, string>,
  query: string,
): string[] {
  const search = query.trim().toLowerCase();
  return files.filter(
    (id) =>
      id.toLowerCase().includes(search) || (labels.get(id) ?? id).toLowerCase().includes(search),
  );
}
