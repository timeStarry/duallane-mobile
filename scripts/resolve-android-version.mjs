import { appendFileSync } from 'node:fs';

const tagged = process.env.GITHUB_REF?.startsWith('refs/tags/v');
const version = tagged ? process.env.GITHUB_REF_NAME?.slice(1) : process.env.INPUT_APP_VERSION;
const versionCode = (!tagged && process.env.INPUT_VERSION_CODE) || process.env.GITHUB_RUN_NUMBER;

if (!version || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
  throw new Error('Android app version must use MAJOR.MINOR.PATCH without leading zeros');
}
if (!versionCode || !/^[1-9][0-9]*$/.test(versionCode) || Number(versionCode) > 2_100_000_000) {
  throw new Error('Android versionCode must be an integer from 1 to 2100000000');
}
if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV is required');
appendFileSync(process.env.GITHUB_ENV, `DUALLANE_APP_VERSION=${version}\nDUALLANE_ANDROID_VERSION_CODE=${versionCode}\n`);
