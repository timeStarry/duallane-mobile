import { TextDecoder, TextEncoder } from 'node:util';
import { fetch } from 'expo/fetch';
import { fetchLatestGitHubRelease, GitHubReleaseError } from '../src/data/github-releases';
import { githubReleaseSchema, isNewerGitHubRelease, type GitHubRelease } from '../src/domain/github-releases';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
const fetchMock = jest.mocked(fetch);
const latestUrl = 'https://api.github.com/repos/timeStarry/duallane-mobile/releases/latest';
const downloadPrefix = 'https://github.com/timeStarry/duallane-mobile/releases/download/v0.2.3/';
const provenanceUrl = `${downloadPrefix}build-provenance.json`;
const apkSha256 = '8eefc7cd5aca5addcd1ff63ae07ed83ebf6a567370cac51ed7643e75af633f88';
const encoder = new TextEncoder();
const manifest = {
  schemaVersion: 1, appVersion: '0.2.3', versionCode: 36, packageId: 'com.timestarry.duallane',
  runtimeVersion: 'android-5', protocolMajor: 1, releaseTag: 'v0.2.3',
  signingCertificateSha256: '3a6441fb4015f9377a3781de3484d9af0f6eddc3bd52e64cb0641dbdaf811db9',
  apk: { name: 'DualLane-Android-v0.2.3.apk', bytes: 128020107, sha256: apkSha256 },
  // Existing provenance documents contain unrelated audit/build fields.
  buildSourceCommit: 'c5630df6bf54bc592070f13b59cd081362c32583', otaEnabled: false,
};
const expectedRelease: GitHubRelease = {
  appVersion: '0.2.3', versionCode: 36, runtimeVersion: 'android-5', releaseId: 'github-406340009',
  releaseNotes: ['### 更新内容', '- 支持图片选择', '<script>plain text only</script>'],
  apkUrl: `${downloadPrefix}${manifest.apk.name}`, apkSha256, apkBytes: manifest.apk.bytes,
};

function releasePayload(provenance: unknown = manifest) {
  return {
    id: 406340009, url: 'https://api.github.com/repos/timeStarry/duallane-mobile/releases/406340009',
    html_url: 'https://github.com/timeStarry/duallane-mobile/releases/tag/v0.2.3',
    tag_name: 'v0.2.3', draft: false, prerelease: false,
    body: '\n### 更新内容\r\n\n- 支持图片选择\n<script>plain text only</script>\n',
    assets: [
      { name: 'DualLane-Android-v0.2.3.aab', size: 83637546, browser_download_url: `${downloadPrefix}DualLane-Android-v0.2.3.aab` },
      { name: manifest.apk.name, size: manifest.apk.bytes, browser_download_url: `${downloadPrefix}${manifest.apk.name}`, digest: `sha256:${apkSha256}` },
      { name: 'build-provenance.json', size: encoder.encode(JSON.stringify(provenance)).byteLength, browser_download_url: provenanceUrl },
    ],
  };
}

function responseBytes(bytes: Uint8Array, url: string, status = 200, options: { chunkBytes?: number; contentLength?: string; redirected?: boolean } = {}) {
  let offset = 0;
  const reader = {
    read: jest.fn(async () => {
      if (offset >= bytes.byteLength) return { done: true, value: undefined };
      const value = bytes.slice(offset, offset + (options.chunkBytes ?? bytes.byteLength));
      offset += value.byteLength;
      return { done: false, value };
    }),
    cancel: jest.fn(async (): Promise<void> => undefined), releaseLock: jest.fn(),
  };
  const result = {
    url, status, ok: status === 200, redirected: options.redirected ?? false,
    headers: new Headers(options.contentLength === undefined ? {} : { 'content-length': options.contentLength }),
    body: { getReader: () => reader },
  } as unknown as Awaited<ReturnType<typeof fetch>>;
  return { response: result, reader };
}

function response(payload: unknown, url: string, status = 200, options: { chunkBytes?: number; contentLength?: string; redirected?: boolean } = {}) {
  return responseBytes(encoder.encode(JSON.stringify(payload)), url, status, options);
}

function arrange(provenance: unknown = manifest, payload: unknown = releasePayload(provenance), assetUrl = provenanceUrl) {
  const api = response(payload, latestUrl, 200, { chunkBytes: 19 });
  const metadata = response(provenance, assetUrl, 200, { chunkBytes: 7, redirected: assetUrl !== provenanceUrl });
  fetchMock.mockResolvedValueOnce(api.response).mockResolvedValueOnce(metadata.response);
  return { api, metadata };
}

beforeAll(() => { globalThis.TextDecoder ??= TextDecoder as unknown as typeof globalThis.TextDecoder; });
beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('official release uses declared assets and bounded UTF-8 chunks, with no Workspace credentials', async () => {
  const { api, metadata } = arrange();
  expect(await fetchLatestGitHubRelease()).toEqual(expectedRelease);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([latestUrl, provenanceUrl]);
  for (const [, init] of fetchMock.mock.calls) {
    const headers = new Headers(init?.headers);
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit' });
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('cookie')).toBeNull();
    expect([...headers.keys()].some(key => key.startsWith('x-duallane'))).toBe(false);
    expect(init?.signal?.aborted).toBe(true);
  }
  expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('error');
  expect(fetchMock.mock.calls[1]?.[1]?.redirect).toBe('follow');
  expect(api.reader.releaseLock).toHaveBeenCalledTimes(1);
  expect(metadata.reader.releaseLock).toHaveBeenCalledTimes(1);
});

test('APK matching tolerates reordered assets and the automated app-release.apk basename', async () => {
  const provenance = { ...manifest, apk: { ...manifest.apk, name: 'app-release.apk' } };
  const payload = releasePayload(provenance);
  payload.assets = [...payload.assets].reverse().map(asset => asset.name === manifest.apk.name ? { ...asset, name: 'app-release.apk', browser_download_url: `${downloadPrefix}app-release.apk` } : asset);
  arrange(provenance, payload);
  expect(await fetchLatestGitHubRelease()).toEqual({ ...expectedRelease, apkUrl: `${downloadPrefix}app-release.apk` });
});

test.each([
  'https://release-assets.githubusercontent.com/github-production-release-asset/123/file?download=1&signature=public-provider-query',
  'https://objects.githubusercontent.com/github-production-release-asset/123/file',
  'https://github-releases.githubusercontent.com/123/file',
])('provenance may follow a public GitHub CDN redirect: %s', async url => {
  arrange(manifest, releasePayload(), url);
  expect(await fetchLatestGitHubRelease()).toEqual(expectedRelease);
});

test('latest API 404 is the only missing resource treated as no official release', async () => {
  const missing = response({}, latestUrl, 404);
  fetchMock.mockResolvedValueOnce(missing.response);
  expect(await fetchLatestGitHubRelease()).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(missing.reader.read).not.toHaveBeenCalled();
  arrange();
  fetchMock.mockReset().mockResolvedValueOnce(response(releasePayload(), latestUrl).response).mockResolvedValueOnce(response({}, provenanceUrl, 404).response);
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ code: 'request.failed', status: 404, diagnostic: 'http.404' });
});

test.each([403, 429, 500])('HTTP %s stays a safe request failure without reading provider content', async status => {
  const failed = response({ message: 'provider-internal-secret' }, latestUrl, status);
  fetchMock.mockResolvedValueOnce(failed.response);
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ code: 'request.failed', status, diagnostic: `http.${status}`, message: 'request.failed' });
  expect(failed.reader.read).not.toHaveBeenCalled();
});

test.each([
  { draft: true }, { prerelease: true }, { tag_name: 'v01.2.3' }, { tag_name: '0.2.3' },
  { tag_name: 'v0.2.3-beta.1' }, { tag_name: 'v0.2.3+metadata' }, { tag_name: 'v9007199254740992.2.3' },
  { id: 0 }, { id: 1.5 }, { body: 32 },
])('invalid release fields are rejected: %j', async patch => {
  arrange(manifest, { ...releasePayload(), ...patch });
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ code: 'response.invalid', diagnostic: 'body.schema' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test.each([
  { url: 'https://api.github.com/repos/other/duallane-mobile/releases/406340009' },
  { html_url: 'https://github.com/timeStarry/other/releases/tag/v0.2.3' },
])('release source links bind the fixed repository: %j', async patch => {
  arrange(manifest, { ...releasePayload(), ...patch });
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ diagnostic: 'body.source' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test.each([
  { schemaVersion: 2 }, { appVersion: '0.2.4' }, { releaseTag: 'v0.2.4' }, { versionCode: 0 },
  { versionCode: 1.5 }, { versionCode: 2100000001 }, { packageId: 'com.other.app' },
  { protocolMajor: 2 }, { runtimeVersion: '' }, { signingCertificateSha256: 'invalid' },
  { apk: { ...manifest.apk, bytes: 0 } }, { apk: { ...manifest.apk, bytes: 1024 * 1024 * 1024 + 1 } },
  { apk: { ...manifest.apk, sha256: 'invalid' } }, { apk: { ...manifest.apk, name: '../app.apk' } },
])('invalid or incompatible provenance is rejected: %j', async patch => {
  arrange({ ...manifest, ...patch });
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ diagnostic: 'body.schema' });
});

test.each(['missing-provenance', 'duplicate-provenance', 'oversized-provenance', 'missing-apk', 'duplicate-apk', 'apk-size', 'apk-digest'])('declared asset identity is enforced for %s', async cause => {
  const payload = releasePayload();
  if (cause === 'missing-provenance') payload.assets = payload.assets.filter(asset => asset.name !== 'build-provenance.json');
  if (cause === 'duplicate-provenance') payload.assets.push({ ...payload.assets[2]! });
  if (cause === 'oversized-provenance') payload.assets[2]!.size = 65537;
  if (cause === 'missing-apk') payload.assets = payload.assets.filter(asset => asset.name !== manifest.apk.name);
  if (cause === 'duplicate-apk') payload.assets.push({ ...payload.assets[1]! });
  if (cause === 'apk-size') payload.assets[1]!.size++;
  if (cause === 'apk-digest') payload.assets[1]!.digest = `sha256:${'0'.repeat(64)}`;
  arrange(manifest, payload);
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ diagnostic: 'body.schema' });
});

test('older GitHub assets without an API digest accept the declared provenance digest', async () => {
  const payload = releasePayload();
  delete payload.assets[1]!.digest;
  arrange(manifest, payload);
  expect(await fetchLatestGitHubRelease()).toEqual(expectedRelease);
});

test.each([
  'http://github.com/timeStarry/duallane-mobile/releases/download/v0.2.3/',
  'https://github.com/other/duallane-mobile/releases/download/v0.2.3/',
  'https://github.com/timeStarry/duallane-mobile/releases/download/v0.2.4/',
  'https://github.com.evil.example/timeStarry/duallane-mobile/releases/download/v0.2.3/',
])('declared provenance and APK URLs reject untrusted prefixes: %s', async prefix => {
  for (const assetName of ['build-provenance.json', manifest.apk.name]) {
    const payload = releasePayload();
    const asset = payload.assets.find(value => value.name === assetName)!;
    asset.browser_download_url = `${prefix}${assetName}`;
    arrange(manifest, payload);
    await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ diagnostic: 'body.source' });
    fetchMock.mockReset();
  }
});

test.each(['?token=not-allowed', '#fragment', '/../build-provenance.json', '%2Fbuild-provenance.json'])('canonical provenance URL rejects suffix %s', async suffix => {
  const payload = releasePayload();
  payload.assets[2]!.browser_download_url += suffix;
  arrange(manifest, payload);
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ diagnostic: 'body.source' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test.each([
  'http://release-assets.githubusercontent.com/file', 'https://release-assets.githubusercontent.com.evil.example/file',
  'https://evil.example/file', 'https://github.com/other/repo/file',
  'https://user:password@release-assets.githubusercontent.com/file', 'https://release-assets.githubusercontent.com:444/file',
])('unexpected provenance redirect is rejected: %s', async url => {
  arrange(manifest, releasePayload(), url);
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ diagnostic: 'body.source' });
});

test.each([
  { url: latestUrl, redirected: true },
  { url: 'https://api.github.com/repos/other/repo/releases/latest', redirected: false },
])('API responses cannot change the canonical endpoint: %j', async options => {
  fetchMock.mockResolvedValueOnce(response(releasePayload(), options.url, 200, options).response);
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ diagnostic: 'body.source' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('non-JSON, invalid UTF-8, and empty bodies get a stable parsing diagnostic', async () => {
  for (const bytes of [encoder.encode('<html>provider secret</html>'), new Uint8Array([255]), new Uint8Array()]) {
    fetchMock.mockResolvedValueOnce(responseBytes(bytes, latestUrl).response);
    await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ code: 'response.invalid', diagnostic: 'body.non_json' });
  }
});

test('API body bounds apply with or without a Content-Length header and stop reading overages', async () => {
  const oversized = responseBytes(new Uint8Array(256 * 1024 + 1), latestUrl);
  fetchMock.mockResolvedValueOnce(oversized.response);
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ diagnostic: 'body.too_large' });
  expect(oversized.reader.read).toHaveBeenCalledTimes(1);
  expect(oversized.reader.cancel).toHaveBeenCalledTimes(1);
  const declared = response({}, latestUrl, 200, { contentLength: '262145' });
  fetchMock.mockResolvedValueOnce(declared.response);
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ diagnostic: 'body.too_large' });
  expect(declared.reader.read).not.toHaveBeenCalled();
});

test('provenance body must match the declared asset bytes and stay below 64 KiB', async () => {
  const payload = releasePayload();
  payload.assets[2]!.size++;
  arrange(manifest, payload);
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ diagnostic: 'body.schema' });
  fetchMock.mockReset().mockResolvedValueOnce(response(releasePayload(), latestUrl).response).mockResolvedValueOnce(responseBytes(new Uint8Array(65537), provenanceUrl).response);
  await expect(fetchLatestGitHubRelease()).rejects.toMatchObject({ diagnostic: 'body.too_large' });
});

test('native errors expose only a stable public diagnostic', async () => {
  fetchMock.mockRejectedValueOnce(new Error('provider-secret https://private.example/?access_token=secret'));
  const failure = await fetchLatestGitHubRelease().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubReleaseError);
  expect(failure).toMatchObject({ code: 'request.network', status: 0, diagnostic: 'net.failed', message: 'request.network' });
  expect(String(failure)).not.toContain('provider-secret');
});

test('a pre-aborted caller does not start the public request or retain its listener', async () => {
  jest.useFakeTimers();
  const caller = new AbortController(); caller.abort();
  const remove = jest.spyOn(caller.signal, 'removeEventListener');
  await expect(fetchLatestGitHubRelease(caller.signal)).rejects.toMatchObject({ diagnostic: 'net.cancelled' });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['headers', 'api-body', 'provenance-body'] as const)('caller cancellation settles hanging %s and native cancellation need not resolve', async stage => {
  jest.useFakeTimers();
  const caller = new AbortController(), cancel = jest.fn(() => new Promise<void>(() => undefined)), nativeCancel = jest.fn();
  const blockedResponse = response({}, stage === 'api-body' ? latestUrl : provenanceUrl);
  blockedResponse.reader.read.mockImplementation(() => new Promise(() => undefined));
  blockedResponse.reader.cancel.mockImplementation(cancel);
  fetchMock.mockImplementationOnce((_url, init) => {
    init?.signal?.addEventListener('abort', nativeCancel);
    return stage === 'headers' ? new Promise(() => undefined) : Promise.resolve(stage === 'api-body' ? blockedResponse.response : response(releasePayload(), latestUrl).response);
  });
  if (stage === 'provenance-body') fetchMock.mockResolvedValueOnce(blockedResponse.response);
  const remove = jest.spyOn(caller.signal, 'removeEventListener');
  const pending = fetchLatestGitHubRelease(caller.signal).catch((error: unknown) => error);
  await jest.advanceTimersByTimeAsync(0);
  caller.abort();
  expect(await pending).toMatchObject({ code: 'request.cancelled', diagnostic: 'net.cancelled' });
  expect(nativeCancel).toHaveBeenCalledTimes(1);
  if (stage !== 'headers') expect(cancel).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['headers', 'api-body', 'provenance-body'] as const)('one 15-second deadline settles hanging %s and cancels the native request', async stage => {
  jest.useFakeTimers();
  const nativeCancel = jest.fn();
  const blocked = response({}, stage === 'api-body' ? latestUrl : provenanceUrl);
  blocked.reader.read.mockImplementation(() => new Promise(() => undefined));
  blocked.reader.cancel.mockImplementation(() => new Promise(() => undefined));
  fetchMock.mockImplementationOnce((_url, init) => {
    init?.signal?.addEventListener('abort', nativeCancel);
    return stage === 'headers' ? new Promise(() => undefined) : Promise.resolve(stage === 'api-body' ? blocked.response : response(releasePayload(), latestUrl).response);
  });
  if (stage === 'provenance-body') fetchMock.mockResolvedValueOnce(blocked.response);
  let settled = false;
  const pending = fetchLatestGitHubRelease().catch((error: unknown) => { settled = true; return error; });
  await jest.advanceTimersByTimeAsync(14999);
  expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ code: 'request.timeout', diagnostic: 'net.timeout' });
  expect(nativeCancel).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('two network requests share a single overall deadline, and late native rejection is consumed', async () => {
  jest.useFakeTimers();
  let finishApi!: (value: Awaited<ReturnType<typeof fetch>>) => void;
  let rejectMetadata!: (error: Error) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishApi = resolve; }));
  fetchMock.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectMetadata = reject; }));
  const pending = fetchLatestGitHubRelease().catch((error: unknown) => error);
  await jest.advanceTimersByTimeAsync(14000);
  finishApi(response(releasePayload(), latestUrl).response);
  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(1000);
  expect(await pending).toMatchObject({ diagnostic: 'net.timeout' });
  rejectMetadata(new Error('late provider failure'));
  await jest.advanceTimersByTimeAsync(0);
  expect(jest.getTimerCount()).toBe(0);
});

test('successful requests clear deadlines and remove the caller listener', async () => {
  jest.useFakeTimers();
  const caller = new AbortController(), remove = jest.spyOn(caller.signal, 'removeEventListener');
  arrange();
  expect(await fetchLatestGitHubRelease(caller.signal)).toEqual(expectedRelease);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(jest.getTimerCount()).toBe(0);
  caller.abort();
  await jest.advanceTimersByTimeAsync(15000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test.each([
  ['0.2.2', 35, true], ['0.2.3', 35, true], ['0.2.2', 36, true], ['0.2.3', 36, false],
  ['0.2.4', 41, false], ['0.2.2', 37, false], ['0.2.4', 35, false],
  ['invalid', 1, false], ['0.02.2', 1, false], ['0.2.2', 0, false], ['0.2.2', 1.5, false],
])('SemVer and code cannot downgrade installed %s/code%s', (appVersion, versionCode, newer) => {
  expect(isNewerGitHubRelease(expectedRelease, { appVersion, versionCode })).toBe(newer);
});

test('cached release schema retains only validated public metadata and binds the APK version path', () => {
  expect(githubReleaseSchema.parse({ ...expectedRelease, extra: 'discarded' })).toEqual(expectedRelease);
  for (const apkUrl of [
    `${downloadPrefix}../app.apk`, `${downloadPrefix}app.apk?token=secret`,
    'https://github.com/timeStarry/duallane-mobile/releases/download/v0.2.4/app.apk',
    'https://evil.example/app.apk',
  ]) expect(githubReleaseSchema.safeParse({ ...expectedRelease, apkUrl }).success).toBe(false);
  expect(githubReleaseSchema.safeParse({ ...expectedRelease, apkSha256: 'invalid' }).success).toBe(false);
  expect(githubReleaseSchema.safeParse({ ...expectedRelease, releaseId: 'provider-secret' }).success).toBe(false);
});
