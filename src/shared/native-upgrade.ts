export const NATIVE_VERSION_HEADER = "X-DualLane-Native-Version-Code";
export const NATIVE_UPGRADE_CODE = "mobile.native_upgrade_required";
export const NATIVE_POLICY_CHANGED = "duallane:native-policy-changed";
export const NATIVE_POLICY_REFRESH = "duallane:native-policy-refresh";

export interface NativeUpgradePolicy {
  minimumSupportedNativeVersionCode: number;
  latestNativeVersionCode: number;
}

const cachePrefix = "duallane.native-policy.v1:";
const memoryPolicies = new Map<string, NativeUpgradePolicy>();
const validCode = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_100_000_000;

export function readNativeUpgradePolicy(origin: string): NativeUpgradePolicy | null {
  const remembered = memoryPolicies.get(origin);
  if (remembered) return remembered;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(cachePrefix + origin) || "null");
    if (!raw || typeof raw !== "object") return null;
    const policy = raw as Record<string, unknown>;
    if (!validCode(policy.minimumSupportedNativeVersionCode) || !validCode(policy.latestNativeVersionCode) ||
      policy.minimumSupportedNativeVersionCode > policy.latestNativeVersionCode) return null;
    const decoded = { minimumSupportedNativeVersionCode: policy.minimumSupportedNativeVersionCode, latestNativeVersionCode: policy.latestNativeVersionCode };
    memoryPolicies.set(origin, decoded);
    return decoded;
  } catch { return null; }
}

export function saveNativeUpgradePolicy(origin: string, minimum: unknown, latest: unknown): NativeUpgradePolicy | null {
  if (!validCode(minimum) || !validCode(latest) || minimum > latest) return null;
  const policy = { minimumSupportedNativeVersionCode: minimum, latestNativeVersionCode: latest };
  memoryPolicies.set(origin, policy);
  try { localStorage.setItem(cachePrefix + origin, JSON.stringify(policy)); } catch { /* Private browsing may deny persistence. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(NATIVE_POLICY_CHANGED));
  return policy;
}

export function nativeUpgradeRequired(code: number, policy: NativeUpgradePolicy | null): boolean {
  return Boolean(policy && policy.minimumSupportedNativeVersionCode > 0 &&
    (!validCode(code) || code === 0 || code < policy.minimumSupportedNativeVersionCode));
}

export function isNativeBusinessPath(path: string): boolean {
  return path.startsWith("/api/workspace/") ||
    (path.startsWith("/api/v1/") && !path.startsWith("/api/v1/mobile/") && !path.startsWith("/api/v1/auth/")) ||
    path.split("?")[0] === "/ws/workspace";
}

export function recordNativeUpgradeResponse(origin: string, body: string): void {
  try {
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object" || !("error" in payload)) return;
    const error = payload.error;
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== NATIVE_UPGRADE_CODE) return;
    const details = error as Record<string, unknown>;
    saveNativeUpgradePolicy(origin, details.minimumSupportedNativeVersionCode, details.latestNativeVersionCode);
  } catch { /* Error bodies are untrusted and never retained. */ }
}
