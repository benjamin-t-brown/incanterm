import { isAssetId } from './schema.js';

export function addOpenTab(tabs: readonly string[], id: string): string[] {
  if (!isAssetId(id) || tabs.includes(id)) return [...tabs];
  return [id, ...tabs];
}

export function moveOpenTab(
  tabs: readonly string[],
  id: string,
  target: string,
  side: 'before' | 'after',
): string[] {
  if (id === target || !tabs.includes(id) || !tabs.includes(target)) return [...tabs];
  const next = tabs.filter((tab) => tab !== id);
  const index = next.indexOf(target) + (side === 'after' ? 1 : 0);
  next.splice(index, 0, id);
  return next;
}
