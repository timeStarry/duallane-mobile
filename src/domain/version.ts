import { z } from 'zod';

export const semanticVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .refine(value => value.split('.').every(part => Number.isSafeInteger(Number(part))));

export function compareVersion(a: string, b: string): number {
  const aa = semanticVersion.parse(a).split('.').map(Number), bb = semanticVersion.parse(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return (aa[i] ?? 0) > (bb[i] ?? 0) ? 1 : -1;
  return 0;
}
