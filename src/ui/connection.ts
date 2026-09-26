export const CONNECTION_CATEGORY = {
  '已连接': 'connected',
  '实时未接通，已用 HTTP 同步': 'http_sync',
  '正在重新连接': 'reconnecting',
  '离线缓存，恢复连接后同步': 'offline_cache',
  '同步未完成': 'sync_incomplete',
  '连接暂时不可用': 'connection_unavailable',
  '正在连接': 'connecting',
} as const;

export type ConnectionCategory = (typeof CONNECTION_CATEGORY)[keyof typeof CONNECTION_CATEGORY];

export function connectionCategory(connection: string): ConnectionCategory | undefined {
  return CONNECTION_CATEGORY[connection as keyof typeof CONNECTION_CATEGORY];
}

export function connectionBannerText(connection: string): string | null {
  const category = connectionCategory(connection);
  if (!category || category === 'connected') return null;
  return connection;
}
