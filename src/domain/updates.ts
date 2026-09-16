import { z } from 'zod';
export const semanticVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
export const releaseSchema = z.object({ schemaVersion: z.literal(1), platform: z.literal('android'), channel: z.literal('internal'), latest: z.object({ appVersion: semanticVersion, versionCode: z.number().int().positive(), releaseId: z.string(), releaseNotes: z.array(z.string()) }), minimum: z.object({ appVersion: semanticVersion, versionCode: z.number().int().positive() }), recommendation: z.enum(['none','soft','strong']), apkUrl: z.string().url().refine(v => v.startsWith('https://')).nullable(), protocol: z.object({ eventMajor: z.number().int(), contentFormats: z.array(z.string()) }) }).superRefine((p, ctx) => {
  if (compareVersion(p.minimum.appVersion, p.latest.appVersion) > 0 || p.minimum.versionCode > p.latest.versionCode) ctx.addIssue({code: 'custom', message: 'Invalid release range'});
});
export type ReleasePolicy = z.infer<typeof releaseSchema>;
export type UpdateDecision = 'none'|'soft'|'strong'|'forced';
export function compareVersion(a: string, b: string): number {
  const aa = semanticVersion.parse(a).split('.').map(Number), bb = semanticVersion.parse(b).split('.').map(Number);
  for (let i=0;i<3;i++) if (aa[i] !== bb[i]) return (aa[i] ?? 0) > (bb[i] ?? 0) ? 1 : -1;
  return 0;
}
export function updateDecision(p: ReleasePolicy, installed = { appVersion: '0.1.0', versionCode: 1 }): UpdateDecision {
  if (compareVersion(installed.appVersion, p.minimum.appVersion) < 0 || installed.versionCode < p.minimum.versionCode || p.protocol.eventMajor !== 1 || !p.protocol.contentFormats.includes('duallane.message+json;v=1')) return 'forced';
  if (compareVersion(installed.appVersion, p.latest.appVersion) >= 0 && installed.versionCode >= p.latest.versionCode) return 'none';
  return p.recommendation;
}
