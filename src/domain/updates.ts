import { z } from 'zod';
import { isNewerGitHubRelease, type GitHubRelease } from './github-releases';
import { compareVersion, semanticVersion } from './version';
export { compareVersion, semanticVersion } from './version';
export const releaseSchema = z.object({ schemaVersion: z.literal(1), platform: z.literal('android'), channel: z.literal('internal'), latest: z.object({ appVersion: semanticVersion, versionCode: z.number().int().positive(), releaseId: z.string(), releaseNotes: z.array(z.string()) }), minimum: z.object({ appVersion: semanticVersion, versionCode: z.number().int().positive() }), recommendation: z.enum(['none','soft','strong']), apkUrl: z.string().url().refine(v => v.startsWith('https://')).nullable(), protocol: z.object({ eventMajor: z.number().int(), contentFormats: z.array(z.string()) }) }).superRefine((p, ctx) => {
  if (compareVersion(p.minimum.appVersion, p.latest.appVersion) > 0 || p.minimum.versionCode > p.latest.versionCode) ctx.addIssue({code: 'custom', message: 'Invalid release range'});
});
export type ReleasePolicy = z.infer<typeof releaseSchema>;
export type UpdateDecision = 'none'|'soft'|'strong'|'forced';
export function updateDecision(p: ReleasePolicy | null, installed = { appVersion: '0.1.0', versionCode: 1 }, release: GitHubRelease | null = null): UpdateDecision {
  if (p && (compareVersion(installed.appVersion, p.minimum.appVersion) < 0 || installed.versionCode < p.minimum.versionCode || p.protocol.eventMajor !== 1 || !p.protocol.contentFormats.includes('duallane.message+json;v=1'))) return 'forced';
  return release && isNewerGitHubRelease(release, installed) ? 'soft' : 'none';
}
export function updateTarget(p: ReleasePolicy | null, release: GitHubRelease | null, installed: {appVersion:string;versionCode:number}) {
  const decision = updateDecision(p, installed, release);
  if (decision === 'none') return null;
  const meetsMinimum = !p || (!!release && compareVersion(release.appVersion, p.minimum.appVersion) >= 0 && release.versionCode >= p.minimum.versionCode);
  const supportedProtocol = !p || (p.protocol.eventMajor === 1 && p.protocol.contentFormats.includes('duallane.message+json;v=1'));
  if (release && isNewerGitHubRelease(release, installed) && (decision !== 'forced' || (meetsMinimum && supportedProtocol))) return release;
  return p ? {...p.latest, apkUrl:p.apkUrl} : null;
}
