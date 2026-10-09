export function shouldDirectSendWorkspaceEmote(
  item: { kind: string },
  packId: string,
  enabled: boolean,
): boolean {
  const collected = packId === 'custom' || (packId.startsWith('collection:') && packId.length > 'collection:'.length);
  // The API distinguishes uploaded and saved built-in images; the catalog
  // uses image for the same picker surface.
  const image = item.kind === 'image' || item.kind === 'custom' || item.kind === 'builtin';
  return enabled && collected && image;
}
