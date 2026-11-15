import { appendFileSync } from "node:fs";

const tagged = process.env.GITHUB_REF?.startsWith("refs/tags/v");
const version = tagged ? process.env.GITHUB_REF_NAME?.slice(1) : process.env.INPUT_APP_VERSION;

if (!version || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
  throw new Error("Android app version must use MAJOR.MINOR.PATCH without leading zeros");
}

const [major, minor, patch] = version.split(".").map(Number);
const semanticCode = major * 10000 + minor * 100 + patch;
const explicitCode = !tagged && process.env.INPUT_VERSION_CODE ? process.env.INPUT_VERSION_CODE : "";
const runOffset = Number(process.env.GITHUB_RUN_NUMBER || 0);
const computedCode = explicitCode || String(Math.max(semanticCode, 10000 + runOffset));

if (!/^[1-9][0-9]*$/.test(computedCode) || Number(computedCode) > 2_100_000_000) {
  throw new Error("Android versionCode must be an integer from 1 to 2100000000");
}
if (!process.env.GITHUB_ENV) {
  throw new Error("GITHUB_ENV is required");
}

appendFileSync(
  process.env.GITHUB_ENV,
  `DUALLANE_APP_VERSION=${version}\nDUALLANE_ANDROID_VERSION_CODE=${computedCode}\n`
);
process.stdout.write(`Resolved Android release v${version} (versionCode=${computedCode})\n`);
