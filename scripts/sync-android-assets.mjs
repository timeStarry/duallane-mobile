import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));

const appVersion = process.env.DUALLANE_APP_VERSION || pkg.version || "1.0.4";
const [maj = 1, min = 0, pat = 4] = appVersion.split(".").map((n) => Number(n) || 0);
const defaultVersionCode = maj * 10000 + min * 100 + pat;
const versionCode = Number(process.env.DUALLANE_ANDROID_VERSION_CODE || defaultVersionCode);
const apiOrigin = (
  process.env.EXPO_PUBLIC_API_ORIGIN ||
  process.env.DUALLANE_API_ORIGIN ||
  "https://duallane.tsio.top"
)
  .trim()
  .replace(/\/+$/, "");

const assetsDir = path.join(ROOT, "android", "app", "src", "main", "assets");
await mkdir(assetsDir, { recursive: true });

const appConfig = {
  name: "DualLane",
  slug: "duallane",
  version: appVersion,
  runtimeVersion: "native-v1",
  android: {
    package: "com.timestarry.duallane",
    versionCode,
  },
  updates: {
    enabled: false,
  },
  extra: {
    protocolMajor: 1,
    apiOrigin,
  },
};

await writeFile(path.join(assetsDir, "app.config"), `${JSON.stringify(appConfig, null, 2)}\n`);
process.stdout.write(
  `Synced Android assets/app.config (v${appVersion}, versionCode=${versionCode}, origin=${apiOrigin})\n`
);
