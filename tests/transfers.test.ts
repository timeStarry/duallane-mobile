import { z } from 'zod';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import { Transfers, clearAccountFiles, uploadStatusSchema, type UploadTask } from '../src/data/transfers';
import { useWorkspace } from '../src/domain/store';
import { attachmentSchema } from '../src/domain/contracts';
import { cache } from '../src/platform/storage';
import type { ApiClient } from '../src/data/client';

const mockDisk = new Map<string,Uint8Array>();
const mockCache = new Map<string,unknown>();
jest.mock('../src/platform/storage', () => ({ cache:{
  get:(key:string) => mockCache.get(key),
  set:(key:string, value:unknown) => mockCache.set(key, value),
  remove:(key:string) => mockCache.delete(key),
} }));
jest.mock('expo-file-system', () => {
  class MockFile {
    uri:string;
    constructor(...parts:(string|{uri:string})[]) { this.uri = parts.map(p => typeof p === 'string' ? p : p.uri).join('/'); }
    get exists() { return mockDisk.has(this.uri); }
    get size() { return mockDisk.get(this.uri)?.length ?? 0; }
    create() { mockDisk.set(this.uri, new Uint8Array()); }
    delete() { mockDisk.delete(this.uri); }
    copy(file:MockFile) { mockDisk.set(file.uri, mockDisk.get(this.uri)!.slice()); }
    open() {
      const uri = this.uri;
      return {
        offset:0, close:jest.fn(),
        readBytes(n:number) { const bytes = mockDisk.get(uri)!.slice(this.offset, this.offset + n); this.offset += bytes.length; return bytes; },
        writeBytes(bytes:Uint8Array) { const before = mockDisk.get(uri)!; const after = new Uint8Array(before.length + bytes.length); after.set(before); after.set(bytes, before.length); mockDisk.set(uri, after); },
      };
    }
  }
  return { File:MockFile, Directory:class { create() {} }, Paths:{ document:{ uri:'file:///document' }, cache:{ uri:'file:///cache' } } };
});
jest.mock('expo-document-picker', () => ({ getDocumentAsync:jest.fn() }));
jest.mock('expo-sharing', () => ({ shareAsync:jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-crypto', () => ({ randomUUID:() => '11111111-1111-4111-8111-111111111111', CryptoDigestAlgorithm:{ SHA256:'SHA256' }, digest:jest.fn().mockImplementation(async () => new Uint8Array(32).buffer) }));

const key = 'https://workspace.test:user';
const id = '22222222-2222-4222-8222-222222222222';
const task:UploadTask = { id, uri:`file:///document/uploads/${id}`, fileName:'example.bin', mimeType:'application/octet-stream', byteSize:3, complete:false };
const attachment = attachmentSchema.parse({ id:'a1', fileName:'example.bin', mimeType:'application/octet-stream', byteSize:3, status:'available', capabilities:{ canDownload:true } });
const hash = '0'.repeat(64);
function saveTask(value:UploadTask = task) {
  cache.set(`${key}:uploads`, [value]);
  mockDisk.set(value.uri, new Uint8Array(value.byteSize));
}
function apiWith(responses:unknown[]) {
  const json = jest.fn(async (_path:string, schema:z.ZodType) => schema.parse(responses.shift()));
  const raw = jest.fn().mockResolvedValue({ ok:true });
  return { api:{ json, raw } as unknown as ApiClient, json, raw };
}
const reserved = { id:'up1', attachment, upload:{ partSize:4194304, partCount:1 } };
const status = { uploadId:'up1', mode:'single', partSize:4194304, partCount:1, parts:[] };
beforeEach(() => {
  mockDisk.clear(); mockCache.clear();
  useWorkspace.getState().reset(); useWorkspace.setState({ accountKey:key });
  jest.mocked(Crypto.digest).mockImplementation(async () => new Uint8Array(32).buffer);
});

test('deployed Go upload status parses existing parts and skips their retransmission', async () => {
  const goStatus = { ...status, parts:[{ UploadID:'up1', PartNumber:1, ByteSize:3, SHA256:hash, CreatedAt:'2026-09-16T00:00:00Z', UpdatedAt:'2026-09-16T00:00:00Z' }] };
  expect(uploadStatusSchema.parse(goStatus).parts).toEqual([{ partNumber:1, byteSize:3, sha256:hash }]);
  saveTask({ ...task, uploadId:'up1', attachmentId:'a1' });
  const { api, raw } = apiWith([goStatus, { attachment }]);
  expect(await new Transfers().run(api, key, task, jest.fn())).toEqual(attachment);
  expect(raw).not.toHaveBeenCalled();
  expect(mockDisk.has(task.uri)).toBe(false);
});

test('retry reloads reservation persisted after a network failure instead of reserving quota twice', async () => {
  saveTask();
  const transfers = new Transfers();
  const { api, json, raw } = apiWith([reserved, status, status, { attachment }]);
  raw.mockRejectedValueOnce(new Error('network'));
  await expect(transfers.run(api, key, task, jest.fn())).rejects.toThrow('network');
  await transfers.run(api, key, task, jest.fn());
  expect(json.mock.calls.filter(([path]) => path.endsWith('/reserve'))).toHaveLength(1);
  expect(raw.mock.calls[1]?.[1]).toMatchObject({ method:'PUT', headers:{ 'X-DualLane-Part-SHA256':hash } });
});

test('empty files use the single binary endpoint, not impossible chunked completion', async () => {
  saveTask({ ...task, byteSize:0, uploadId:'up1' });
  const { api, raw, json } = apiWith([{ ...status, partCount:0 }]);
  raw.mockResolvedValue({ json:async () => ({ attachment:{ ...attachment, byteSize:0 } }) });
  await new Transfers().run(api, key, task, jest.fn());
  expect(raw).toHaveBeenCalledWith('/api/workspace/files/uploads/up1/content', expect.objectContaining({ method:'PUT', body:new Uint8Array(0) }));
  expect(json).toHaveBeenCalledTimes(1);
});

test('logout during hashing stops the upload before sending bytes and deletes its local content', async () => {
  saveTask({ ...task, uploadId:'up1' });
  jest.mocked(Crypto.digest).mockImplementationOnce(async () => { clearAccountFiles(key); return new Uint8Array(32).buffer; });
  const { api, raw } = apiWith([status]);
  await expect(new Transfers().run(api, key, task, jest.fn())).rejects.toThrow('Account changed');
  expect(raw).not.toHaveBeenCalled();
  expect(mockDisk.has(task.uri)).toBe(false);
  expect(cache.get(`${key}:uploads`)).toBeUndefined();
});

test('changed part hashes are rejected before upload or completion', async () => {
  saveTask({ ...task, uploadId:'up1' });
  const { api, raw, json } = apiWith([{ ...status, parts:[{ PartNumber:1, ByteSize:3, SHA256:'a'.repeat(64) }] }]);
  await expect(new Transfers().run(api, key, task, jest.fn())).rejects.toThrow('Part conflict');
  expect(raw).not.toHaveBeenCalled();
  expect(json).toHaveBeenCalledTimes(1);
});

function downloadApi(chunks:Uint8Array[]) {
  const { api, raw, json } = apiWith([{ id:'download1' }]);
  const reader = { read:jest.fn(async () => { const value = chunks.shift(); return value ? { done:false, value } : { done:true }; }), cancel:jest.fn().mockResolvedValue(undefined) };
  const arrayBuffer = jest.fn();
  raw.mockResolvedValue({ body:{ getReader:() => reader }, arrayBuffer });
  return { api, raw, json, reader, arrayBuffer };
}

test('download reserves quota and streams file chunks without loading the entire body', async () => {
  const { api, raw, arrayBuffer, reader } = downloadApi([new Uint8Array([1]), new Uint8Array([2, 3])]);
  jest.mocked(Sharing.shareAsync).mockImplementationOnce(async uri => { expect(new File(uri).size).toBe(3); });
  await new Transfers().download(api, key, attachment);
  expect(raw).toHaveBeenCalledWith('/api/workspace/files/a1/download?downloadId=download1');
  expect(arrayBuffer).not.toHaveBeenCalled();
  expect(reader.cancel).toHaveBeenCalled();
  expect(mockDisk.size).toBe(0);
});

test.each([[new Uint8Array([1])], [new Uint8Array([1, 2, 3, 4])]])('truncated and oversized downloads cannot be shared and partial content is removed', async chunk => {
  const { api } = downloadApi([chunk]);
  await expect(new Transfers().download(api, key, attachment)).rejects.toThrow();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(mockDisk.size).toBe(0);
});

test('account cleanup removes only managed upload files belonging to that account', () => {
  saveTask();
  const otherId = '33333333-3333-4333-8333-333333333333';
  const other = { ...task, id:otherId, uri:`file:///document/uploads/${otherId}` };
  cache.set('other:uploads', [other]); mockDisk.set(other.uri, new Uint8Array(3));
  clearAccountFiles(key);
  expect(mockDisk.has(task.uri)).toBe(false);
  expect(mockDisk.has(other.uri)).toBe(true);
});
