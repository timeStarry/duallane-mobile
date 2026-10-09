const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const implementation = import(pathToFileURL(join(__dirname, '../scripts/create-android-release-manifest.mjs')).href);
const certificate = '3a'.repeat(32);
const sourceCommit = 'b'.repeat(40);
const apkBytes = Buffer.from([0x50, 0x4b, 3, 4, 0, 0xff, 0x41]);
const aabBytes = Buffer.from([0x50, 0x4b, 3, 4, 1, 0xfe, 0x42]);
const sha256 = value => createHash('sha256').update(value).digest('hex');

function environment(overrides = {}) {
  return {
    DUALLANE_APP_VERSION: '0.2.4', DUALLANE_ANDROID_VERSION_CODE: '37',
    ANDROID_PACKAGE: 'com.timestarry.duallane', EXPO_PUBLIC_API_ORIGIN: 'https://duallane.example',
    GITHUB_REF: 'refs/tags/v0.2.4', GITHUB_REF_NAME: 'v0.2.4', GITHUB_SHA: sourceCommit,
    GITHUB_REPOSITORY: 'timeStarry/duallane-mobile', GITHUB_RUN_ID: '37632412579', GITHUB_RUN_ATTEMPT: '1',
    ...overrides,
  };
}

function inspection(overrides = {}) {
  const appConfig = {
    version: '0.2.4', android: { package: 'com.timestarry.duallane', versionCode: 37 },
    runtimeVersion: 'android-5', extra: { protocolMajor: 1, apiOrigin: 'https://duallane.example' },
    updates: { enabled: false },
  };
  return {
    packageId: 'com.timestarry.duallane', appVersion: '0.2.4', versionCode: 37,
    apkCertificateSha256: certificate, aabCertificateSha256: certificate,
    appConfig, aabConfig: structuredClone(appConfig),
    ...overrides,
  };
}

async function withPackages(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'duallane-release-manifest-'));
  const options = {
    apkPath: join(directory, 'app-release.apk'), aabPath: join(directory, 'app-release.aab'),
    outputDirectory: join(directory, 'output'), environment: environment(),
  };
  try {
    await Promise.all([writeFile(options.apkPath, apkBytes), writeFile(options.aabPath, aabBytes)]);
    return await callback(options);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('tag release stages the exact package bytes and compatible provenance with verifiable sums', async () => {
  const { createAndroidReleaseManifest } = await implementation;
  await withPackages(async options => {
    const manifest = await createAndroidReleaseManifest(options, async () => inspection());
    assert.deepEqual(manifest, {
      schemaVersion: 1, appVersion: '0.2.4', versionCode: 37, packageId: 'com.timestarry.duallane',
      runtimeVersion: 'android-5', protocolMajor: 1, defaultService: 'https://duallane.example', otaEnabled: false,
      releaseTag: 'v0.2.4', releaseCommit: sourceCommit, buildSourceCommit: sourceCommit, sourceDifference: [],
      buildRun: 'https://github.com/timeStarry/duallane-mobile/actions/runs/37632412579', buildRunAttempt: 1,
      signingCertificateSha256: certificate,
      apk: { name: 'app-release.apk', bytes: apkBytes.length, sha256: sha256(apkBytes) },
      aab: { name: 'app-release.aab', bytes: aabBytes.length, sha256: sha256(aabBytes) },
    });
    assert.deepEqual((await readdir(options.outputDirectory)).sort(), ['SHA256SUMS', 'app-release.aab', 'app-release.apk', 'build-provenance.json']);
    const json = await readFile(join(options.outputDirectory, 'build-provenance.json'));
    assert.deepEqual(JSON.parse(json.toString()), manifest);
    assert.deepEqual(await readFile(join(options.outputDirectory, 'app-release.apk')), apkBytes);
    assert.deepEqual(await readFile(join(options.outputDirectory, 'app-release.aab')), aabBytes);
    assert.equal(await readFile(join(options.outputDirectory, 'SHA256SUMS'), 'utf8'),
      `${sha256(apkBytes)}  app-release.apk\n${sha256(aabBytes)}  app-release.aab\n${sha256(json)}  build-provenance.json\n`);
  });
});

test('manual candidates have no release tag and use packaged runtime and optional service fields', async () => {
  const { createAndroidReleaseManifest } = await implementation;
  await withPackages(async options => {
    options.environment = environment({ GITHUB_REF: 'refs/heads/candidate', GITHUB_REF_NAME: 'candidate', GITHUB_RUN_ATTEMPT: '2' });
    const actual = inspection();
    actual.appConfig.runtimeVersion = 'android-99';
    delete actual.appConfig.extra.apiOrigin;
    actual.aabConfig = structuredClone(actual.appConfig);
    const manifest = await createAndroidReleaseManifest(options, async () => actual);
    assert.equal(manifest.releaseTag, null);
    assert.equal(manifest.releaseCommit, null);
    assert.equal(manifest.runtimeVersion, 'android-99');
    assert.equal(manifest.buildRunAttempt, 2);
    assert.equal(Object.hasOwn(manifest, 'defaultService'), false);
  });
});

test('same-signer stale AAB and differing native or service configuration cannot be paired with the APK', async () => {
  const { createAndroidReleaseManifest } = await implementation;
  for (const change of [config => { config.version = '0.2.3'; }, config => { config.android.versionCode = 36; },
    config => { config.android.package = 'com.example.other'; }, config => { config.runtimeVersion = 'android-4'; },
    config => { config.extra.protocolMajor = 2; }, config => { config.extra.apiOrigin = 'https://other.example'; },
    config => { delete config.extra.apiOrigin; }, config => { config.updates.enabled = true; }]) {
    await withPackages(async options => {
      const actual = inspection();
      change(actual.aabConfig);
      assert.equal(actual.apkCertificateSha256, actual.aabCertificateSha256);
      await assert.rejects(createAndroidReleaseManifest(options, async () => actual), /AAB packaged configuration does not match the APK/);
      await assert.rejects(readFile(join(options.outputDirectory, 'build-provenance.json')), { code: 'ENOENT' });
    });
  }
  await withPackages(async options => {
    await assert.rejects(createAndroidReleaseManifest(options, async () => inspection({ aabConfig: undefined })),
      /AAB packaged Expo configuration must be an object/);
  });
});

test('APK package inspection rejects missing identity and malformed numeric versions', async () => {
  const { parseApkBadging } = await implementation;
  const badging = "package: name='com.timestarry.duallane' versionCode='37' versionName='0.2.4' platformBuildVersionName='16'\n";
  assert.deepEqual(parseApkBadging(badging), { packageId: 'com.timestarry.duallane', appVersion: '0.2.4', versionCode: 37 });
  for (const output of ['', badging + badging, badging.replace("'37'", "'1.5'"),
    badging.replace("'37'", "'037'"), badging.replace("'37'", "'2100000001'"), badging.replace("'0.2.4'", "'0.2.4-beta'")]) {
    assert.throws(() => parseApkBadging(output));
  }
});

test('certificate parsers reject missing, malformed, or multiple signing identities', async () => {
  const { parseApkCertificate, parseAabCertificate } = await implementation;
  const apk = `Signer #1 certificate SHA-256 digest: ${certificate.toUpperCase()}\n`;
  const aab = `Signer #1:\nCertificate #1:\nCertificate fingerprints:\n\t SHA256: ${certificate.toUpperCase().match(/../g).join(':')}\n`;
  assert.equal(parseApkCertificate(apk), certificate);
  assert.equal(parseAabCertificate(aab), certificate);
  for (const output of ['', apk + apk.replace('#1', '#2'), apk.replace(certificate.toUpperCase(), '3A')]) {
    assert.throws(() => parseApkCertificate(output));
  }
  for (const output of ['', aab + aab.replace('#1:', '#2:'), aab.replace('SHA256:', 'SHA1:')]) {
    assert.throws(() => parseAabCertificate(output));
  }
});

test('mismatched identities, signatures and unsafe packaged configuration cannot create provenance', async () => {
  const { createAndroidReleaseManifest } = await implementation;
  const invalid = [
    inspection({ packageId: 'com.example.other' }), inspection({ packageId: undefined }),
    inspection({ appVersion: '0.2.5' }), inspection({ versionCode: 38 }), inspection({ versionCode: 37.5 }),
    inspection({ apkCertificateSha256: '' }), inspection({ aabCertificateSha256: '4b'.repeat(32) }),
  ];
  for (const change of [config => { config.version = '0.2.5'; }, config => { config.android.versionCode = '37'; },
    config => { config.runtimeVersion = { policy: 'appVersion' }; }, config => { config.extra.protocolMajor = 1.5; },
    config => { config.extra.protocolMajor = '1'; }, config => { config.extra.protocolMajor = 2; },
    config => { config.updates.enabled = 'false'; }, config => { config.extra.apiOrigin = 'https://other.example'; },
    config => { config.extra.apiOrigin = 'https://user:secret@duallane.example'; }]) {
    const actual = inspection();
    change(actual.appConfig);
    invalid.push(actual);
  }
  for (const actual of invalid) {
    await withPackages(async options => {
      await assert.rejects(createAndroidReleaseManifest(options, async () => actual));
      await assert.rejects(readFile(join(options.outputDirectory, 'build-provenance.json')), { code: 'ENOENT' });
    });
  }
});

test('incorrect release tags, noninteger environment fields and empty packages fail closed', async () => {
  const { createAndroidReleaseManifest } = await implementation;
  for (const overrides of [
    { GITHUB_REF_NAME: 'v0.2.5' }, { DUALLANE_ANDROID_VERSION_CODE: '37.0' }, { DUALLANE_ANDROID_VERSION_CODE: '037' },
    { GITHUB_RUN_ID: '1.5' }, { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_SHA: 'unknown' },
    { GITHUB_REPOSITORY: 'owner/repo?secret' },
  ]) {
    await withPackages(async options => {
      options.environment = environment(overrides);
      await assert.rejects(createAndroidReleaseManifest(options, async () => inspection()));
    });
  }
  await withPackages(async options => {
    await writeFile(options.apkPath, Buffer.alloc(0));
    await assert.rejects(createAndroidReleaseManifest(options, async () => inspection()), /APK must be a nonempty file/);
    await assert.rejects(readFile(join(options.outputDirectory, 'build-provenance.json')), { code: 'ENOENT' });
  });
});
