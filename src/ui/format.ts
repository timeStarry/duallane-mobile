export { formatMessageDayLabel, getMessageDayKey } from '../domain/message-grouping';

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatListTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = startOf(now) - startOf(date);
  if (diff === 0) return formatClock(iso);
  if (diff === 86400000) return '昨天';
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}/${date.getDate()}`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MiB`;
}

export function stableTone(id: string): 0 | 1 {
  let hash = 0;
  for (const char of id) hash = (hash + char.charCodeAt(0)) % 2;
  return hash === 0 ? 0 : 1;
}
