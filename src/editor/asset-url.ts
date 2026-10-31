export function editorAssetUrl(href: string, id: string | null): string {
  const url = new URL(href);
  if (id === null) url.searchParams.delete('id');
  else url.searchParams.set('id', id);
  return `${url.pathname}${url.search}${url.hash}`;
}
