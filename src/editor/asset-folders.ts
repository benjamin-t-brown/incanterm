import { isAssetId } from './schema.js';

export type AssetFolders = {
  folders: string[];
  placements: Record<string, string>;
};

export function isFolderPath(value: string): boolean {
  return value.length <= 256 && value.split('/').every(isAssetId);
}

export function getParentFolder(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

export function getFolderAncestors(path: string): string[] {
  const parts = path.split('/');
  return parts.map((_part, index) => parts.slice(0, index + 1).join('/'));
}

export function parseAssetFolders(value: unknown): AssetFolders | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.folders) || source.folders.length > 1000) return null;
  if (
    !source.placements ||
    typeof source.placements !== 'object' ||
    Array.isArray(source.placements)
  )
    return null;
  const folders = source.folders;
  if (folders.some((path) => typeof path !== 'string' || !isFolderPath(path))) return null;
  if (new Set(folders).size !== folders.length) return null;
  const known = new Set(folders);
  if (folders.some((path) => getParentFolder(path) !== '' && !known.has(getParentFolder(path))))
    return null;
  const placements = source.placements as Record<string, unknown>;
  if (
    Object.entries(placements).some(
      ([id, folder]) => !isAssetId(id) || !known.has(folder as string),
    )
  )
    return null;
  return { folders: [...folders], placements: { ...placements } as Record<string, string> };
}
