import { fetch } from 'expo/fetch';
import { z } from 'zod';
import {
  githubApkBytesSchema, githubApkNameSchema, githubReleaseDownloadUrl, githubReleaseSchema,
  githubReleaseVersionSchema, githubRuntimeVersionSchema, githubSha256Schema,
  githubVersionCodeSchema, type GitHubRelease,
} from '../domain/github-releases';

const latestReleaseUrl = 'https://api.github.com/repos/timeStarry/duallane-mobile/releases/latest';
const apiReleasePrefix = 'https://api.github.com/repos/timeStarry/duallane-mobile/releases/';
const releasePagePrefix = 'https://github.com/timeStarry/duallane-mobile/releases/tag/';
const provenanceName = 'build-provenance.json';
const deadlineMs = 15000;
const apiBodyLimit = 256 * 1024;
const provenanceBodyLimit = 64 * 1024;
const githubAssetHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);

type GitHubReleaseErrorCode = 'request.timeout' | 'request.cancelled' | 'request.network' | 'request.failed' | 'response.invalid';
export class GitHubReleaseError extends Error {
  constructor(public readonly code: GitHubReleaseErrorCode, public readonly status: number, public readonly diagnostic: string) {
    super(code);
    this.name = 'GitHubReleaseError';
  }
}

const assetSchema = z.object({
  name: z.string().min(1).max(256),
  size: z.number().int().positive().max(1024 * 1024 * 1024),
  browser_download_url: z.string().max(1024),
  digest: z.string().max(128).nullish(),
});
const releaseSchema = z.object({
  id: z.number().int().positive().safe(),
  url: z.string().max(512),
  html_url: z.string().max(512),
  tag_name: z.string().max(65),
  draft: z.literal(false),
  prerelease: z.literal(false),
  body: z.string().max(65536).nullable(),
  assets: z.array(assetSchema).min(1).max(100),
});
const provenanceSchema = z.object({
  schemaVersion: z.literal(1),
  appVersion: githubReleaseVersionSchema,
  versionCode: githubVersionCodeSchema,
  packageId: z.literal('com.timestarry.duallane'),
  runtimeVersion: githubRuntimeVersionSchema,
  protocolMajor: z.literal(1),
  releaseTag: z.string().max(65),
  signingCertificateSha256: githubSha256Schema,
  apk: z.object({ name: githubApkNameSchema, bytes: githubApkBytesSchema, sha256: githubSha256Schema }),
});

/** Public release discovery has no relationship to a Workspace session. */
export async function fetchLatestGitHubRelease(signal?: AbortSignal): Promise<GitHubRelease | null> {
  const scope = new ReleaseRequestScope(signal);
  try {
    const response = await scope.request(latestReleaseUrl, false);
    if (response.status === 404) return null;
    requireSuccess(response);
    const release = parse(releaseSchema, await readBoundedJson(response, apiBodyLimit, scope));
    if (!release.tag_name.startsWith('v')) throw invalid('body.schema');
    const appVersion = parse(githubReleaseVersionSchema, release.tag_name.slice(1));
    if (release.url !== `${apiReleasePrefix}${release.id}` || release.html_url !== `${releasePagePrefix}${release.tag_name}`) throw invalid('body.source');
    const provenanceAssets = release.assets.filter(asset => asset.name === provenanceName);
    const provenanceAsset = provenanceAssets[0];
    if (provenanceAssets.length !== 1 || !provenanceAsset || provenanceAsset.size > provenanceBodyLimit) throw invalid('body.schema');
    const provenanceUrl = githubReleaseDownloadUrl(appVersion, provenanceName);
    if (provenanceAsset.browser_download_url !== provenanceUrl) throw invalid('body.source');
    const provenanceResponse = await scope.request(provenanceUrl, true);
    requireSuccess(provenanceResponse);
    const provenance = parse(provenanceSchema, await readBoundedJson(provenanceResponse, provenanceBodyLimit, scope, provenanceAsset.size));
    if (provenance.appVersion !== appVersion || provenance.releaseTag !== release.tag_name) throw invalid('body.schema');
    const apkAssets = release.assets.filter(asset => asset.name === provenance.apk.name);
    const apkAsset = apkAssets[0];
    if (apkAssets.length !== 1 || !apkAsset || apkAsset.size !== provenance.apk.bytes) throw invalid('body.schema');
    const apkUrl = githubReleaseDownloadUrl(appVersion, provenance.apk.name);
    if (apkAsset.browser_download_url !== apkUrl) throw invalid('body.source');
    if (apkAsset.digest != null && apkAsset.digest.toLowerCase() !== `sha256:${provenance.apk.sha256}`) throw invalid('body.schema');
    scope.check();
    return parse(githubReleaseSchema, {
      appVersion, versionCode: provenance.versionCode, runtimeVersion: provenance.runtimeVersion,
      releaseId: `github-${release.id}`, releaseNotes: releaseNotes(release.body),
      apkUrl, apkSha256: provenance.apk.sha256, apkBytes: provenance.apk.bytes,
    });
  } catch (error) {
    if (error instanceof GitHubReleaseError) throw error;
    throw new GitHubReleaseError('request.network', 0, 'net.failed');
  } finally { scope.dispose(); }
}

class ReleaseRequestScope {
  private readonly controller = new AbortController();
  private rejectPending: ((error: GitHubReleaseError) => void) | null = null;
  private failure: GitHubReleaseError | null = null;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly cancel = () => this.interrupt(new GitHubReleaseError('request.cancelled', 0, 'net.cancelled'));

  constructor(private readonly caller?: AbortSignal) {
    this.timer = setTimeout(() => this.interrupt(new GitHubReleaseError('request.timeout', 0, 'net.timeout')), deadlineMs);
    caller?.addEventListener('abort', this.cancel, { once: true });
    if (caller?.aborted) this.cancel();
  }

  check(): void { if (this.failure) throw this.failure; }

  async race<T>(operation: () => Promise<T>): Promise<T> {
    this.check();
    let rejectOperation!: (error: GitHubReleaseError) => void;
    try {
      const result = await new Promise<T>((resolve, reject) => {
        rejectOperation = reject;
        this.rejectPending = rejectOperation;
        // Both handlers consume a late native outcome after cancellation. A single
        // pending reject avoids retaining a promise subscriber for every body chunk.
        void operation().then(resolve, reject);
      });
      this.check();
      return result;
    } finally {
      if (this.rejectPending === rejectOperation) this.rejectPending = null;
    }
  }

  async request(url: string, asset: boolean): Promise<Response> {
    const response = await this.race(() => fetch(url, {
      method: 'GET', credentials: 'omit', redirect: asset ? 'follow' : 'error', signal: this.controller.signal,
      headers: asset ? { Accept: 'application/json' } : { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    }));
    if (asset ? !isAssetResponseUrl(response.url, url) : response.redirected || response.url !== latestReleaseUrl) throw invalid('body.source');
    return response;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.caller?.removeEventListener('abort', this.cancel);
    this.controller.abort();
  }

  private interrupt(error: GitHubReleaseError): void {
    if (this.failure) return;
    this.failure = error;
    this.rejectPending?.(error);
    this.controller.abort();
  }
}

async function readBoundedJson(response: Response, limit: number, scope: ReleaseRequestScope, expectedBytes?: number): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length != null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > limit)) throw invalid('body.too_large');
  const reader = response.body?.getReader();
  if (!reader) throw invalid('body.non_json');
  const chunks: Uint8Array[] = [];
  let bytes = 0, finished = false;
  try {
    while (true) {
      const chunk = await scope.race(() => reader.read());
      if (chunk.done) { finished = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw invalid('body.too_large');
      chunks.push(chunk.value);
    }
    if (expectedBytes !== undefined && bytes !== expectedBytes) throw invalid('body.schema');
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as unknown; }
    catch { throw invalid('body.non_json'); }
  } finally {
    // Native stream cancellation can itself hang; it must never delay settlement.
    if (!finished) { try { void reader.cancel().catch(() => undefined); } catch { /* Native cancellation is best effort. */ } }
    try { reader.releaseLock(); } catch { /* A cancelled native read can still own the lock. */ }
  }
}

function isAssetResponseUrl(value: string, requested: string): boolean {
  if (value === requested) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash && !parsed.port && githubAssetHosts.has(parsed.hostname);
  } catch { return false; }
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid('body.schema');
  return result.data;
}

function requireSuccess(response: Response): void {
  if (response.status !== 200) throw new GitHubReleaseError('request.failed', response.status, `http.${response.status}`);
}

function invalid(diagnostic: string): GitHubReleaseError { return new GitHubReleaseError('response.invalid', 0, diagnostic); }

function releaseNotes(body: string | null): string[] {
  // These strings are rendered as text; GitHub Markdown is never interpreted here.
  return (body ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 200).map(line => line.slice(0, 4096));
}
