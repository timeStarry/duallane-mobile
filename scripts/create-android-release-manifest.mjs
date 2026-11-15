import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const digest = /^[a-f0-9]{64}$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value, maximum, label) {
  requireValue(
    Number.isSafeInteger(value) && value > 0 && value <= maximum,
    `${label} must be a positive integer`
  );
  return value;
}

function environmentInteger(value, maximum, label) {
  requireValue(
    typeof value === "string" && /^[1-9]\d*$/.test(value),
    `${label} must be a positive integer`
  );
  return positiveInteger(Number(value), maximum, label);
}

function command(executable, args, label) {
  try {
    return execFileSync(executable, args, {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`${label} failed`);
  }
}

export function parseApkBadging(output) {
  const packages = [
    ...output.matchAll(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/gm),
  ];
  requireValue(packages.length === 1, "APK package identity is missing or ambiguous");
  const [, packageId, code, appVersion] = packages[0];
  requireValue(semver.test(appVersion), "APK appVersion must use MAJOR.MINOR.PATCH");
  return {
    packageId,
    appVersion,
    versionCode: environmentInteger(code, 2_100_000_000, "APK versionCode"),
  };
}

export function parseApkCertificate(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const counts = lines.filter((line) => line.startsWith("Number of signers:"));
  requireValue(
    lines.includes("Verifies") &&
      !lines.includes("DOES NOT VERIFY") &&
      counts.length > 0 &&
      counts.every((line) => line === "Number of signers: 1"),
    "APK must verify with one signing identity"
  );
  const records = lines.filter(
    (line) => line.startsWith("Signer ") && line.includes(" certificate SHA-256 digest:")
  );
  requireValue(records.length > 0, "APK signing certificate is missing or ambiguous");
  const certificates = new Set();
  for (const record of records) {
    const fields = record.match(/^Signer (.+) certificate SHA-256 digest: ([A-Fa-f0-9]{64})$/);
    requireValue(fields, "APK signing certificate format is invalid");
    certificates.add(fields[2].toLowerCase());
  }
  requireValue(certificates.size === 1, "APK signing certificate is missing or ambiguous");
  return [...certificates][0];
}

export function parseAabCertificate(output) {
  const signers = [...output.matchAll(/^Signer #\d+:/gm)];
  requireValue(signers.length === 1, "AAB signing certificate is missing or ambiguous");
  const certificate = output.match(/^\s*SHA256:\s*([A-Fa-f0-9:]+)\s*$/m);
  const sha256 = certificate?.[1].replaceAll(":", "").toLowerCase();
  requireValue(
    typeof sha256 === "string" && digest.test(sha256),
    "AAB signing certificate SHA-256 is invalid"
  );
  return sha256;
}

function packagedConfiguration(pkgPath, entry, packageType) {
  try {
    return JSON.parse(
      command("unzip", ["-p", pkgPath, entry], `${packageType} packaged configuration inspection`)
    );
  } catch {
    throw new Error(`${packageType} packaged configuration is missing or invalid`);
  }
}

function inspectPackages({ apkPath, aabPath, aapt, apksigner }) {
  const apk = parseApkBadging(command(aapt, ["dump", "badging", apkPath], "APK identity inspection"));
  const apkCertificateSha256 = parseApkCertificate(
    command(apksigner, ["verify", "--verbose", "--print-certs", apkPath], "APK signature verification")
  );
  const aabVerification = command(
    "jarsigner",
    ["-J-Duser.language=en", "-J-Duser.country=US", "-verify", "-certs", aabPath],
    "AAB signature verification"
  );
  requireValue(/^jar verified\.\s*$/m.test(aabVerification), "AAB signature could not be verified");
  const aabCertificateSha256 = parseAabCertificate(
    command(
      "keytool",
      ["-J-Duser.language=en", "-J-Duser.country=US", "-printcert", "-jarfile", aabPath],
      "AAB certificate inspection"
    )
  );
  const appConfig = packagedConfiguration(apkPath, "assets/app.config", "APK");
  const aabConfig = packagedConfiguration(aabPath, "base/assets/app.config", "AAB");
  return { ...apk, apkCertificateSha256, aabCertificateSha256, appConfig, aabConfig };
}

async function packageFile(filePath, extension) {
  const name = basename(filePath);
  const info = await stat(filePath);
  requireValue(
    info.isFile() && Number.isSafeInteger(info.size) && info.size > 0,
    `${extension.toUpperCase()} must be a nonempty file`
  );
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  requireValue(bytes === info.size, `${extension.toUpperCase()} changed while hashing`);
  return { name, bytes, sha256: hash.digest("hex") };
}

export async function createAndroidReleaseManifest(options, inspect = inspectPackages) {
  const { apkPath, aabPath, outputDirectory, environment } = options;
  requireValue(
    typeof environment.DUALLANE_APP_VERSION === "string" &&
      semver.test(environment.DUALLANE_APP_VERSION),
    "Expected appVersion must use MAJOR.MINOR.PATCH"
  );
  const expectedCode = environmentInteger(
    environment.DUALLANE_ANDROID_VERSION_CODE,
    2_100_000_000,
    "Expected versionCode"
  );
  requireValue(
    environment.ANDROID_PACKAGE === "com.timestarry.duallane",
    "Expected Android package must be com.timestarry.duallane"
  );
  const actual = await inspect(options);
  requireValue(
    actual.packageId === environment.ANDROID_PACKAGE,
    "APK package does not match expected package"
  );
  requireValue(
    actual.appVersion === environment.DUALLANE_APP_VERSION && actual.versionCode === expectedCode,
    "APK version does not match resolved release version"
  );
  requireValue(
    digest.test(actual.apkCertificateSha256) &&
      actual.apkCertificateSha256 === actual.aabCertificateSha256,
    "APK and AAB signing certificates must match"
  );
  const config = actual.appConfig;
  requireValue(
    config.version === actual.appVersion &&
      config.android?.versionCode === actual.versionCode &&
      config.android?.package === actual.packageId,
    "Packaged app.config identity does not match APK"
  );
  const aabConfig = actual.aabConfig;
  requireValue(
    aabConfig.version === config.version &&
      aabConfig.android?.package === config.android.package &&
      aabConfig.android?.versionCode === config.android.versionCode,
    "AAB packaged configuration does not match APK"
  );

  const tagged = environment.GITHUB_REF?.startsWith("refs/tags/");
  const releaseTag = tagged ? environment.GITHUB_REF_NAME : null;

  await mkdir(outputDirectory, { recursive: true });
  const stagedApk = resolve(outputDirectory, basename(apkPath));
  const stagedAab = resolve(outputDirectory, basename(aabPath));
  await copyFile(apkPath, stagedApk);
  await copyFile(aabPath, stagedAab);
  const [apk, aab] = await Promise.all([
    packageFile(stagedApk, "apk"),
    packageFile(stagedAab, "aab"),
  ]);

  const manifest = {
    schemaVersion: 1,
    architecture: "native-kotlin-webview-v1",
    appVersion: actual.appVersion,
    versionCode: actual.versionCode,
    packageId: actual.packageId,
    runtimeVersion: config.runtimeVersion,
    protocolMajor: config.extra.protocolMajor,
    defaultService: config.extra.apiOrigin,
    otaEnabled: false,
    releaseTag,
    releaseCommit: tagged ? environment.GITHUB_SHA : null,
    buildSourceCommit: environment.GITHUB_SHA || "local",
    buildRun: environment.GITHUB_REPOSITORY
      ? `https://github.com/${environment.GITHUB_REPOSITORY}/actions/runs/${environment.GITHUB_RUN_ID}`
      : "local",
    buildRunAttempt: Number(environment.GITHUB_RUN_ATTEMPT || 1),
    signingCertificateSha256: actual.apkCertificateSha256,
    apk,
    aab,
  };
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestHash = createHash("sha256").update(json).digest("hex");
  await writeFile(resolve(outputDirectory, "build-provenance.json"), json);
  await writeFile(
    resolve(outputDirectory, "SHA256SUMS"),
    `${apk.sha256}  ${apk.name}\n${aab.sha256}  ${aab.name}\n${manifestHash}  build-provenance.json\n`
  );
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({
      options: {
        apk: { type: "string" },
        aab: { type: "string" },
        "output-dir": { type: "string" },
        aapt: { type: "string" },
        apksigner: { type: "string" },
      },
    });
    requireValue(
      values.apk && values.aab && values["output-dir"] && values.aapt && values.apksigner,
      "Required arguments: --apk --aab --output-dir --aapt --apksigner"
    );
    await createAndroidReleaseManifest({
      apkPath: resolve(values.apk),
      aabPath: resolve(values.aab),
      outputDirectory: resolve(values["output-dir"]),
      aapt: values.aapt,
      apksigner: values.apksigner,
      environment: process.env,
    });
    process.stdout.write("Verified Android packages and generated build-provenance.json and SHA256SUMS.\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
