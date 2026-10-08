import { normalizeSearchHistory, normalizeSearchTerm, rememberSearchTerm } from '../domain/search';
import { cache } from '../platform/storage';

export type SearchHistoryScope = { accountKey: string; spaceId: string };
type CurrentScope = () => boolean;

export function searchHistoryKey(scope: SearchHistoryScope): string | null {
  if (!scope.accountKey.trim() || !scope.spaceId.trim()) return null;
  // Keep the account prefix consumed by cache.clearAccount on logout.
  return `${scope.accountKey}:search-history:${encodeURIComponent(scope.spaceId)}`;
}

export function readSearchHistory(scope: SearchHistoryScope, current: CurrentScope = () => true): string[] {
  const key = searchHistoryKey(scope);
  if (!key || !current()) return [];
  const value = cache.get(key);
  return current() && Array.isArray(value) ? normalizeSearchHistory(value) : [];
}

export function recordSearchHistory(scope: SearchHistoryScope, query: string, current: CurrentScope = () => true): string[] {
  const key = searchHistoryKey(scope);
  if (!key || !current() || !normalizeSearchTerm(query)) return [];
  const next = rememberSearchTerm(readSearchHistory(scope, current), query);
  if (!current()) return [];
  cache.set(key, next);
  return next;
}

export function deleteSearchHistory(scope: SearchHistoryScope, query: string, current: CurrentScope = () => true): string[] {
  const key = searchHistoryKey(scope);
  if (!key || !current()) return [];
  const term = normalizeSearchTerm(query).toLowerCase();
  const next = readSearchHistory(scope, current).filter(value => value.toLowerCase() !== term);
  if (!current()) return [];
  cache.set(key, next);
  return next;
}

export function clearSearchHistory(scope: SearchHistoryScope, current: CurrentScope = () => true): void {
  const key = searchHistoryKey(scope);
  if (key && current()) cache.remove(key);
}
