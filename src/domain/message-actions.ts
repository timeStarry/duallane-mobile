import type { Message } from './contracts';

export function messageActions(message: Message, flags: { own: boolean; group: boolean; canSend: boolean }): { id: string; title: string; danger?: boolean }[] {
  if (message.status === 'failed') return [{ id: 'copy', title: '复制' }];
  if (message.recalledAt || message.deletedAt) return [{ id: 'copy', title: '复制' }];
  const actions: { id: string; title: string; danger?: boolean }[] = [{ id: 'copy', title: '复制' }];
  if (flags.canSend && message.kind !== 'system') actions.push({ id: 'reply', title: '回复' });
  if (message.kind !== 'system') actions.push({ id: 'hide', title: message.hiddenByCurrentUser ? '恢复显示' : '仅自己隐藏' });
  if (flags.own && message.kind === 'user') actions.push({ id: 'recall', title: '撤回', danger: true });
  if (flags.group && message.kind === 'user' && !message.topicId) actions.push({ id: 'pin', title: message.pin ? '取消常驻' : '常驻' });
  return actions;
}
