/**
 * Client-side catalog filter.
 *
 * Same fields as `filterCatalogEntries` in `@camelia/agent`: id, name,
 * description, and tags. The UI does not import the agent package.
 * @module
 */

export interface CatalogEntryView {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  repo?: string;
  url?: string;
  path?: string;
}

export function matchesCatalogQuery(
  entry: { id: string; name: string; description?: string; tags?: readonly string[] },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [entry.id, entry.name, entry.description ?? '', ...(entry.tags ?? [])]
    .join('\n')
    .toLowerCase()
    .includes(needle);
}
