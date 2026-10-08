import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { ApiError, errorText } from './client';

export const avatarMaxBytes = 5 * 1024 * 1024;
const avatarMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AvatarMimeType = typeof avatarMimeTypes[number];
export type AvatarSelection = {
  uri: string;
  mimeType: AvatarMimeType;
  byteSize: number;
  dispose: () => void;
};
const selections = new Map<string, Set<AvatarSelection>>();
const disposedSelections = new WeakSet<AvatarSelection>();

export class AvatarSelectionError extends Error {
  constructor(message: string) { super(message); }
}

export function avatarErrorText(error: unknown): string {
  if (error instanceof AvatarSelectionError) return error.message;
  if (error instanceof ApiError) {
    if (error.code === 'avatar.unsupported_format') return '请选择 JPEG、PNG 或 WebP 图片';
    if (error.code === 'avatar.invalid_size') return '图片不能为空，且不能超过 5 MiB';
    if (error.code === 'avatar.invalid_image') return '这张图片无法处理，请选择其他图片';
    if (error.code === 'avatar.processing_unavailable') return '头像处理暂时不可用，请稍后重试';
  }
  return errorText(error);
}

function validSize(size: number): boolean {
  return Number.isSafeInteger(size) && size > 0 && size <= avatarMaxBytes;
}

// Only the picker-created cache copy is disposable. Never delete a user's source URI.
function cacheCopy(uri: string): boolean {
  try {
    const source = new URL(uri), root = new URL(Paths.cache.uri);
    if (source.protocol !== 'file:' || source.host !== root.host || source.search || source.hash) return false;
    const path = decodeURIComponent(source.pathname), base = decodeURIComponent(root.pathname).replace(/\/$/, '');
    if (path.split('/').some(part => part === '.' || part === '..') || path.includes('\\')) return false;
    // URL normalizes literal traversal; also reject it in the original spelling.
    if (decodeURIComponent(uri).split('/').some(part => part === '.' || part === '..')) return false;
    return path.startsWith(`${base}/`) && path.length > base.length + 1;
  } catch { return false; }
}

function removeCopy(uri: string): void {
  if (!cacheCopy(uri)) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Cache eviction can race cleanup. */ }
}

function avatarRoot(): Directory { return new Directory(Paths.cache, 'duallane-avatar-selections'); }
async function accountDirectory(account: string): Promise<Directory> {
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, account);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid avatar cache scope');
  return new Directory(avatarRoot(), hash);
}
function ownedCopy(uri: string): boolean {
  if (!cacheCopy(uri)) return false;
  const root = avatarRoot().uri.replace(/\/$/, '');
  if (!uri.startsWith(`${root}/`)) return false;
  return /^[a-f0-9]{64}\/[0-9a-f-]{36}$/.test(uri.slice(root.length + 1));
}
function removeOwnedCopy(uri: string): void { if (ownedCopy(uri)) removeCopy(uri); }
function cleanDirectory(directory: Directory): void {
  if (!directory.exists) return;
  const active = new Set([...selections.values()].flatMap(owned => [...owned].map(selection => selection.uri)));
  for (const entry of directory.list()) {
    if (entry instanceof File && !active.has(entry.uri)) removeOwnedCopy(entry.uri);
  }
  if (!directory.list().length) directory.delete();
}

// Avatar previews are never restored. Recover their bounded ownership from the directory,
// not the process Map; a second start must still preserve selections alive in this process.
export function cleanupAvatarCopies(): void {
  try {
    const root = avatarRoot();
    if (!root.exists) return;
    const prefix = `${root.uri.replace(/\/$/, '')}/`;
    for (const entry of root.list()) {
      if (entry instanceof Directory && entry.uri.startsWith(prefix) && /^[a-f0-9]{64}\/?$/.test(entry.uri.slice(prefix.length))) {
        try { cleanDirectory(entry); } catch { /* Retry this account's cache on the next start. */ }
      }
    }
  } catch { /* Cache eviction/IO must not block session restoration. */ }
}

export async function clearAvatarSelections(account: string): Promise<void> {
  for (const selection of selections.get(account) ?? []) selection.dispose();
  selections.delete(account);
  if (!avatarRoot().exists) return;
  // A new session may pick an image while hashing; cleanDirectory preserves those live copies.
  cleanDirectory(await accountDirectory(account));
}

export async function chooseAvatar(account: string, current: () => boolean): Promise<AvatarSelection | null> {
  if (!current()) throw new Error('Stale session');
  const result = await DocumentPicker.getDocumentAsync({ type: [...avatarMimeTypes], copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  let keep = false;
  let copy: File | undefined;
  try {
    if (!current()) throw new Error('Stale session');
    if (!cacheCopy(asset.uri)) throw new AvatarSelectionError('无法读取所选图片，请重新选择');
    const mimeType = avatarMimeTypes.find(type => type === asset.mimeType?.toLowerCase());
    if (!mimeType) throw new AvatarSelectionError('请选择 JPEG、PNG 或 WebP 图片');
    if (asset.size !== undefined && !validSize(asset.size)) throw new AvatarSelectionError('图片不能为空，且不能超过 5 MiB');
    const file = new File(asset.uri);
    const byteSize = file.size;
    if (!file.exists || !validSize(byteSize)) throw new AvatarSelectionError('图片不能为空，且不能超过 5 MiB');
    const directory = await accountDirectory(account);
    if (!current()) throw new Error('Stale session');
    if (!file.exists || file.size !== byteSize) throw new AvatarSelectionError('图片已变化，请重新选择');
    directory.create({ intermediates: true, idempotent: true });
    copy = new File(directory, Crypto.randomUUID());
    if (!ownedCopy(copy.uri)) throw new Error('Invalid avatar cache path');
    file.copy(copy);
    if (!current()) throw new Error('Stale session');
    if (!copy.exists || copy.size !== byteSize) throw new AvatarSelectionError('无法读取所选图片，请重新选择');
    const copyUri = copy.uri;
    const selection: AvatarSelection = {
      uri: copyUri, mimeType, byteSize,
      dispose: () => {
        if (disposedSelections.has(selection)) return;
        disposedSelections.add(selection); removeOwnedCopy(copyUri);
        const owned = selections.get(account);
        owned?.delete(selection);
        if (!owned?.size) selections.delete(account);
      },
    };
    const owned = selections.get(account) ?? new Set<AvatarSelection>();
    owned.add(selection); selections.set(account, owned); keep = true;
    return selection;
  } finally {
    removeCopy(asset.uri);
    if (!keep && copy) removeOwnedCopy(copy.uri);
  }
}

export function readAvatarBytes(selection: AvatarSelection): Uint8Array<ArrayBuffer> {
  if (disposedSelections.has(selection) || !ownedCopy(selection.uri) || !avatarMimeTypes.includes(selection.mimeType) || !validSize(selection.byteSize)) {
    throw new AvatarSelectionError('无法读取所选图片，请重新选择');
  }
  const file = new File(selection.uri);
  if (!file.exists || file.size !== selection.byteSize) throw new AvatarSelectionError('图片已变化，请重新选择');
  const handle = file.open();
  try {
    const bytes = handle.readBytes(selection.byteSize);
    if (bytes.length !== selection.byteSize) throw new AvatarSelectionError('无法读取所选图片，请重新选择');
    return new Uint8Array(bytes);
  } finally { handle.close(); }
}
