export function shouldDirectSendWorkspaceEmote(
  item: { kind: string },
  packId: string,
  enabled: boolean,
): boolean {
  return enabled && packId === 'custom' && item.kind === 'image';
}
