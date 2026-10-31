import type { CharacterDocument } from '../../schema.js';

export function characterListEntries(
  files: string[],
  labels: Record<string, string>,
  current: CharacterDocument | null,
  search: string,
): { id: string; label: string }[] {
  const query = search.trim().toLowerCase();
  const ids = current && !files.includes(current.id) ? [current.id, ...files] : files;
  return ids
    .map((id) => ({ id, label: current?.id === id ? current.label : (labels[id] ?? id) }))
    .filter(
      ({ id, label }) => id.toLowerCase().includes(query) || label.toLowerCase().includes(query),
    );
}
