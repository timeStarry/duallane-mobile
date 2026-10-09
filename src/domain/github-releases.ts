import { z } from 'zod';
import { compareVersion, semanticVersion } from './version';

const releaseDownloadPrefix = 'https://github.com/timeStarry/duallane-mobile/releases/download/';
export const githubReleaseVersionSchema = z.string().max(64).refine(value => semanticVersion.safeParse(value).success);
export const githubRuntimeVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
export const githubApkNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.apk$/);
export const githubApkBytesSchema = z.number().int().positive().max(1024 * 1024 * 1024);
export const githubSha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/).transform(value => value.toLowerCase());
export const githubVersionCodeSchema = z.number().int().positive().max(2100000000);

export function githubReleaseDownloadUrl(appVersion: string, name: string): string {
  return `${releaseDownloadPrefix}v${appVersion}/${name}`;
}

export const githubReleaseSchema = z.object({
  appVersion: githubReleaseVersionSchema,
  versionCode: githubVersionCodeSchema,
  runtimeVersion: githubRuntimeVersionSchema,
  releaseId: z.string().regex(/^github-[1-9]\d{0,15}$/).refine(value => Number.isSafeInteger(Number(value.slice(7)))),
  releaseNotes: z.array(z.string().max(4096)).max(200).refine(lines => lines.reduce((total, line) => total + line.length, 0) <= 65536),
  apkUrl: z.string().max(512),
  apkSha256: githubSha256Schema,
  apkBytes: githubApkBytesSchema,
}).refine(release => {
  const prefix = githubReleaseDownloadUrl(release.appVersion, '');
  if (!release.apkUrl.startsWith(prefix)) return false;
  const name = release.apkUrl.slice(prefix.length);
  return githubApkNameSchema.safeParse(name).success && release.apkUrl === githubReleaseDownloadUrl(release.appVersion, name);
});

export type GitHubRelease = z.infer<typeof githubReleaseSchema>;

export function isNewerGitHubRelease(release: GitHubRelease, installed: { appVersion: string; versionCode: number }): boolean {
  if (!githubReleaseVersionSchema.safeParse(release.appVersion).success || !githubReleaseVersionSchema.safeParse(installed.appVersion).success || !githubVersionCodeSchema.safeParse(release.versionCode).success || !githubVersionCodeSchema.safeParse(installed.versionCode).success) return false;
  const versionOrder = compareVersion(release.appVersion, installed.appVersion);
  return versionOrder >= 0 && release.versionCode >= installed.versionCode && (versionOrder > 0 || release.versionCode > installed.versionCode);
}
