import { CONNECTION_CATEGORY, connectionBannerText, connectionCategory } from '../src/ui/connection';

test('connection banner categories map live store strings 1:1 and never offer reconnect', () => {
  expect(connectionCategory('已连接')).toBe('connected');
  expect(connectionBannerText('已连接')).toBeNull();
  expect(connectionCategory('实时未接通，已用 HTTP 同步')).toBe('http_sync');
  expect(connectionBannerText('实时未接通，已用 HTTP 同步')).toBe('实时未接通，已用 HTTP 同步');
  expect(connectionCategory('正在重新连接')).toBe('reconnecting');
  expect(connectionCategory('离线缓存，恢复连接后同步')).toBe('offline_cache');
  expect(connectionCategory('同步未完成')).toBe('sync_incomplete');
  expect(connectionCategory('连接暂时不可用')).toBe('connection_unavailable');
  expect(connectionCategory('正在连接')).toBe('connecting');
  expect(connectionCategory('同步未完成')).not.toBe('http_sync');
  expect(connectionCategory('连接暂时不可用')).not.toBe('http_sync');
  expect(Object.values(CONNECTION_CATEGORY)).toEqual([
    'connected',
    'http_sync',
    'reconnecting',
    'offline_cache',
    'sync_incomplete',
    'connection_unavailable',
    'connecting',
  ]);
  expect(connectionBannerText('实时未接通，已用 HTTP 同步')).not.toContain('重新连接');
});
