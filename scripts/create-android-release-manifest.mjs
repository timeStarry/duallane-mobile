import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const digest = /^[a-f0-9]{64}$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value, maximum, label) {
  requireValue(Number.isSafeInteger(value) && value > 0 && value <= maximum, `${label} must be a positive integer`);
  return value;
}

function environmentInteger(value, maximum, label) {
  requireValue(typeof value === 'string' && /^[1-9]\d*$/.test(value), `${label} must be a positive integer`);
  return positiveInteger(Number(value), maximum, label);
}

function command(executable, args, label) {
  try {
    return execFileSync(executable, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // Tool output may include runner paths; only expose a stable diagnostic.
    throw new Error(`${label} failed`);
  }
}

export function parseApkBadging(output) {
  const packages = [...output.matchAll(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/gm)];
  requireValue(packages.length === 1, 'APK package identity is missing or ambiguous');
  const [, packageId, code, appVersion] = packages[0];
  requireValue(semver.test(appVersion), 'APK appVersion must use MAJOR.MINOR.PATCH');
  return { packageId, appVersion, versionCode: environmentInteger(code, 2_100_000_000, 'APK versionCode') };
}

export function parseApkCertificate(output) {
  const certificates = [...output.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)\s*$/gm)];
  requireValue(certificates.length === 1, 'APK signing certificate is missing or ambiguous');
  const sha256 = certificates[0][1].toLowerCase();
  requireValue(digest.test(sha256), 'APK signing certificate SHA-256 is invalid');
  return sha256;
}

export function parseAabCertificate(output) {
  const signers = [...output.matchAll(/^Signer #\d+:/gm)];
  requireValue(signers.length === 1, 'AAB signing certificate is missing or ambiguous');
  const certificate = output.match(/^\s*SHA256:\s*([A-Fa-f0-9:]+)\s*$/m);
  const sha256 = certificate?.[1].replaceAll(':', '').toLowerCase();
  requireValue(typeof sha256 === 'string' && digest.test(sha256), 'AAB signing certificate SHA-256 is invalid');
  return sha256;
}

function packagedConfiguration(path, entry, packageType) {
  try {
    return JSON.parse(command('unzip', ['-p', path, entry], `${packageType} packaged Expo configuration inspection`));
  } catch {
    throw new Error(`${packageType} packaged Expo configuration is missing or invalid`);
  }
}

function inspectPackages({ apkPath, aabPath, aapt, apksigner }) {
  const apk = parseApkBadging(command(aapt, ['dump', 'badging', apkPath], 'APK identity inspection'));
  const apkCertificateSha256 = parseApkCertificate(command(apksigner, ['verify', '--verbose', '--print-certs', apkPath], 'APK signature verification'));
  const aabVerification = command('jarsigner', ['-J-Duser.language=en', '-J-Duser.country=US', '-verify', '-certs', aabPath], 'AAB signature verification');
  requireValue(/^jar verified\.\s*$/m.test(aabVerification), 'AAB signature could not be verified');
  const aabCertificateSha256 = parseAabCertificate(command('keytool', ['-J-Duser.language=en', '-J-Duser.country=US', '-printcert', '-jarfile', aabPath], 'AAB certificate inspection'));
  const appConfig = packagedConfiguration(apkPath, 'assets/app.config', 'APK');
  const aabConfig = packagedConfiguration(aabPath, 'base/assets/app.config', 'AAB');
  return { ...apk, apkCertificateSha256, aabCertificateSha256, appConfig, aabConfig };
}

async function packageFile(path, extension) {
  const name = basename(path);
  requireValue(new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]*\\.${extension}$`).test(name), `Invalid ${extension.toUpperCase()} asset name`);
  const info = await stat(path);
  requireValue(info.isFile() && Number.isSafeInteger(info.size) && info.size > 0, `${extension.toUpperCase()} must be a nonempty file`);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  requireValue(bytes === info.size, `${extension.toUpperCase()} changed while hashing`);
  return { name, bytes, sha256: hash.digest('hex') };
}

export async function createAndroidReleaseManifest(options, inspect = inspectPackages) {
  const { apkPath, aabPath, outputDirectory, environment } = options;
  requireValue(typeof environment.DUALLANE_APP_VERSION === 'string' && semver.test(environment.DUALLANE_APP_VERSION), 'Expected appVersion must use MAJOR.MINOR.PATCH');
  const expectedCode = environmentInteger(environment.DUALLANE_ANDROID_VERSION_CODE, 2_100_000_000, 'Expected versionCode');
  requireValue(environment.ANDROID_PACKAGE === 'com.timestarry.duallane', 'Expected Android package must be com.timestarry.duallane');
  const actual = await inspect(options);
  requireValue(actual.packageId === environment.ANDROID_PACKAGE, 'APK package does not match the expected package');
  requireValue(actual.appVersion === environment.DUALLANE_APP_VERSION && actual.versionCode === expectedCode, 'APK version does not match the resolved release version');
  positiveInteger(actual.versionCode, 2_100_000_000, 'APK versionCode');
  requireValue(digest.test(actual.apkCertificateSha256) && actual.apkCertificateSha256 === actual.aabCertificateSha256, 'APK and AAB signing certificates must match');
  const config = actual.appConfig;
  requireValue(config && typeof config === 'object' && !Array.isArray(config), 'Packaged Expo configuration must be an object');
  requireValue(config.version === actual.appVersion && config.android?.versionCode === actual.versionCode && config.android?.package === actual.packageId, 'Packaged Expo identity does not match the APK');
  requireValue(typeof config.runtimeVersion === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.runtimeVersion), 'Packaged runtimeVersion is invalid');
  positiveInteger(config.extra?.protocolMajor, 2_147_483_647, 'Packaged protocolMajor');
  requireValue(config.extra.protocolMajor === 1, 'Only protocolMajor 1 is supported for this release manifest');
  requireValue(typeof config.updates?.enabled === 'boolean', 'Packaged OTA enabled flag is invalid');
  const defaultService = config.extra.apiOrigin;
  if (defaultService !== undefined) {
    let origin;
    try { origin = new URL(defaultService); } catch { throw new Error('Packaged defaultService is invalid'); }
    requireValue(typeof defaultService === 'string' && origin.protocol === 'https:' && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash, 'Packaged defaultService must be an HTTPS origin');
    requireValue(defaultService === environment.EXPO_PUBLIC_API_ORIGIN, 'Packaged defaultService does not match the configured service');
  }
  const aabConfig = actual.aabConfig;
  requireValue(aabConfig && typeof aabConfig === 'object' && !Array.isArray(aabConfig), 'AAB packaged Expo configuration must be an object');
  requireValue(aabConfig.version === config.version && aabConfig.android?.package === config.android.package &&
    aabConfig.android?.versionCode === config.android.versionCode && aabConfig.runtimeVersion === config.runtimeVersion &&
    aabConfig.extra?.protocolMajor === config.extra.protocolMajor && aabConfig.extra?.apiOrigin === defaultService &&
    aabConfig.updates?.enabled === config.updates.enabled, 'AAB packaged configuration does not match the APK');
  const tagged = environment.GITHUB_REF?.startsWith('refs/tags/');
  const releaseTag = tagged ? environment.GITHUB_REF_NAME : null;
  requireValue(!tagged || releaseTag === `v${actual.appVersion}`, 'Release tag does not match the APK version');
  requireValue(typeof environment.GITHUB_SHA === 'string' && /^[a-f0-9]{40}$/.test(environment.GITHUB_SHA), 'Build source commit is invalid');
  requireValue(typeof environment.GITHUB_REPOSITORY === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(environment.GITHUB_REPOSITORY), 'Build repository is invalid');
  environmentInteger(environment.GITHUB_RUN_ID, Number.MAX_SAFE_INTEGER, 'Build run ID');
  environmentInteger(environment.GITHUB_RUN_ATTEMPT, Number.MAX_SAFE_INTEGER, 'Build run attempt');

  await mkdir(outputDirectory, { recursive: true });
  const stagedApk = resolve(outputDirectory, basename(apkPath));
  const stagedAab = resolve(outputDirectory, basename(aabPath));
  await copyFile(apkPath, stagedApk);
  await copyFile(aabPath, stagedAab);
  const [apk, aab] = await Promise.all([packageFile(stagedApk, 'apk'), packageFile(stagedAab, 'aab')]);
  const manifest = {
    schemaVersion: 1,
    appVersion: actual.appVersion,
    versionCode: actual.versionCode,
    packageId: actual.packageId,
    runtimeVersion: config.runtimeVersion,
    protocolMajor: config.extra.protocolMajor,
    ...(defaultService === undefined ? {} : { defaultService }),
    otaEnabled: config.updates.enabled,
    releaseTag,
    releaseCommit: tagged ? environment.GITHUB_SHA : null,
    buildSourceCommit: environment.GITHUB_SHA,
    sourceDifference: [],
    buildRun: `https://github.com/${environment.GITHUB_REPOSITORY}/actions/runs/${environment.GITHUB_RUN_ID}`,
    buildRunAttempt: Number(environment.GITHUB_RUN_ATTEMPT),
    signingCertificateSha256: actual.apkCertificateSha256,
    apk,
    aab,
  };
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestHash = createHash('sha256').update(json).digest('hex');
  await writeFile(resolve(outputDirectory, 'build-provenance.json'), json);
  await writeFile(resolve(outputDirectory, 'SHA256SUMS'), `${apk.sha256}  ${apk.name}\n${aab.sha256}  ${aab.name}\n${manifestHash}  build-provenance.json\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      apk: { type: 'string' }, aab: { type: 'string' }, 'output-dir': { type: 'string' },
      aapt: { type: 'string' }, apksigner: { type: 'string' },
    } });
    requireValue(Object.values(values).length === 5 && Object.values(values).every(value => typeof value === 'string' && value.length > 0), 'Required arguments: --apk --aab --output-dir --aapt --apksigner');
    await createAndroidReleaseManifest({ apkPath: resolve(values.apk), aabPath: resolve(values.aab),
      outputDirectory: resolve(values['output-dir']), aapt: values.aapt, apksigner: values.apksigner, environment: process.env });
    process.stdout.write('Verified Android packages and generated build-provenance.json and SHA256SUMS.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
