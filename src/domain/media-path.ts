export function isAllowedSameOriginMediaPath(path: string): boolean {
  if (path.startsWith('/api/')) return true;
  if (path.startsWith('/emotes/')) return true;
  return /^\/assets\/[a-z0-9][a-z0-9._/-]*$/i.test(path) && !path.includes('..');
}

export function sanitizeWorkspaceAvatarUrl(value?: string | null): string {
  if (!value) return '';
  const candidate = value.trim();
  if (/^\/assets\/[a-z0-9][a-z0-9._/-]*$/i.test(candidate) && !candidate.includes('..')) return candidate;
  if (/^\/api\/workspace\/avatars\/[a-z0-9_-]+\/[a-z0-9-]+$/i.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    if (url.username || url.password || url.port || url.protocol !== 'https:') return '';
    if (url.hostname === 'avatars.githubusercontent.com') return url.href;
    if (/^\/api\/workspace\/avatars\/[a-z0-9_-]+\/[a-z0-9-]+$/i.test(url.pathname)) return url.pathname;
    return '';
  } catch {
    return '';
  }
}

export function botAssetAvatar(name: string): string | undefined {
  if (name === '信标') return '/assets/beacon-avatar.png';
  if (name === '回声') return '/assets/echo-avatar.svg';
  return undefined;
}
