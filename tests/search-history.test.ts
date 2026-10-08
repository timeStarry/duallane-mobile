import { cache } from '../src/platform/storage';
import { clearSearchHistory, deleteSearchHistory, readSearchHistory, recordSearchHistory, searchHistoryKey } from '../src/data/search-history';

jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn(), remove: jest.fn() } }));
const scope = { accountKey: 'https://synthetic.test:u1', spaceId: 's1' };
let values: Map<string, unknown>;

beforeEach(() => {
  values = new Map();
  jest.mocked(cache.get).mockReset().mockImplementation(key => values.get(key));
  jest.mocked(cache.set).mockReset().mockImplementation((key, value) => { values.set(key, value); return { changes: 1, lastInsertRowId: 1 }; });
  jest.mocked(cache.remove).mockReset().mockImplementation(key => { values.delete(key); return { changes: 1, lastInsertRowId: 1 }; });
});

test('history key belongs to logout account prefix and separates account, origin and space', () => {
  expect(searchHistoryKey(scope)).toBe(`${scope.accountKey}:search-history:s1`);
  recordSearchHistory(scope, 'Design');
  for (const other of [{ ...scope, spaceId: 's2' }, { ...scope, accountKey: 'https://synthetic.test:u2' }, { ...scope, accountKey: 'https://other.test:u1' }]) expect(readSearchHistory(other)).toEqual([]);
  expect(readSearchHistory(scope)).toEqual(['Design']);
});

test('record is deduplicated most recent first; delete and clear operate only on the selected scope', () => {
  const other = { ...scope, spaceId: 'other' };
  recordSearchHistory(other, 'Keep');
  for (let i = 0; i < 15; i++) recordSearchHistory(scope, `Term${i}`);
  expect(readSearchHistory(scope)).toHaveLength(12);
  expect(recordSearchHistory(scope, ' term10 ')[0]).toBe('term10');
  expect(deleteSearchHistory(scope, 'TERM10')).not.toContain('term10');
  clearSearchHistory(scope);
  expect(readSearchHistory(scope)).toEqual([]);
  expect(readSearchHistory(other)).toEqual(['Keep']);
});

test('empty account or space neither reads nor writes cache', () => {
  for (const invalid of [{ ...scope, accountKey: '' }, { ...scope, accountKey: ' ' }, { ...scope, spaceId: '' }]) {
    expect(readSearchHistory(invalid)).toEqual([]);
    expect(recordSearchHistory(invalid, 'Design')).toEqual([]);
    expect(deleteSearchHistory(invalid, 'Design')).toEqual([]);
    clearSearchHistory(invalid);
  }
  expect(cache.get).not.toHaveBeenCalled(); expect(cache.set).not.toHaveBeenCalled(); expect(cache.remove).not.toHaveBeenCalled();
});

test('scope lost during read does not return old values or persist a late command', () => {
  let current = true;
  jest.mocked(cache.get).mockImplementation(() => { current = false; return ['Old account']; });
  expect(recordSearchHistory(scope, 'New query', () => current)).toEqual([]);
  expect(cache.set).not.toHaveBeenCalled();
  current = true;
  expect(readSearchHistory(scope, () => current)).toEqual([]);
  clearSearchHistory(scope, () => false);
  expect(cache.remove).not.toHaveBeenCalled();
});

test('malformed cache is safely bounded and blank submit is not stored', () => {
  values.set(searchHistoryKey(scope)!, { invalid: true });
  expect(readSearchHistory(scope)).toEqual([]);
  recordSearchHistory(scope, '  ');
  expect(cache.set).not.toHaveBeenCalled();
  values.set(searchHistoryKey(scope)!, ['Valid', 5, 'valid', ...Array.from({ length: 20 }, (_, i) => `Term${i}`)]);
  expect(readSearchHistory(scope)).toHaveLength(12);
});
