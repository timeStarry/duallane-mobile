import { z } from 'zod';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { saveFileToDevice } from '../src/platform/save-file';
import { Transfers, clearAccountFiles, uploadStatusSchema, type UploadTask } from '../src/data/transfers';
import { useWorkspace } from '../src/domain/store';
import { attachmentSchema, bootstrapSchema } from '../src/domain/contracts';
import { cache } from '../src/platform/storage';
import { ApiClient } from '../src/data/client';
import { fetch } from 'expo/fetch';

const mockDisk = new Map<string,Uint8Array>();
const mockDirs = new Set<string>();
const mockCache = new Map<string,unknown>();
jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.2.2',versionCode:20}}));
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
  return { File:MockFile, Directory:class { uri:string; constructor(parent:{uri:string},name:string){this.uri=`${parent.uri}/${name}`;} get exists(){return mockDirs.has(this.uri);} create(){mockDirs.add(this.uri);} delete(){mockDirs.delete(this.uri);} }, Paths:{ document:{ uri:'file:///document' }, cache:{ uri:'file:///cache' } } };
});
jest.mock('expo-document-picker', () => ({ getDocumentAsync:jest.fn() }));
jest.mock('expo-sharing', () => ({ shareAsync:jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/platform/save-file', () => ({ saveFileToDevice:jest.fn().mockResolvedValue(true) }));
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
  const json = jest.fn(async (_path:string, schema:z.ZodType, _body?:unknown) => schema.parse(responses.shift()));
  const raw = jest.fn().mockResolvedValue({ ok:true });
  return { api:{ json, raw } as unknown as ApiClient, json, raw };
}
const reserved = { id:'up1', attachment, upload:{ partSize:4194304, partCount:1 } };
const status = { uploadId:'up1', mode:'single', partSize:4194304, partCount:1, parts:[] };
beforeEach(() => {
  mockDisk.clear(); mockDirs.clear(); mockCache.clear();
  jest.mocked(DocumentPicker.getDocumentAsync).mockReset();
  useWorkspace.getState().reset(); useWorkspace.setState({ accountKey:key });
  jest.mocked(Crypto.digest).mockImplementation(async () => new Uint8Array(32).buffer);
});

test('topic upload reserves private staging without a parent conversation scope', async () => {
  const picked='file:///cache/topic.txt';
  mockDisk.set(picked,new Uint8Array([1,2,3]));
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled:false, assets:[{ uri:picked, name:'topic.txt', mimeType:'text/plain', size:3, lastModified:0 }] });
  const transfers=new Transfers();
  const chosen=await transfers.choose(key,undefined,'private_staging');
  expect(chosen).toMatchObject({ visibility:'private_staging', conversationId:undefined });
  const { api,json }=apiWith([reserved,status,{ attachment }]);
  await transfers.run(api,key,chosen!,jest.fn());
  expect(json.mock.calls.find(([path])=>path.endsWith('/reserve'))?.[2]).toEqual({ fileName:'topic.txt',mimeType:'text/plain',byteSize:3,visibility:'private_staging' });
});

test('topic private staging cannot accidentally inherit the parent conversation', async () => {
  await expect(new Transfers().choose(key,'group-1','private_staging')).rejects.toThrow('Topic upload cannot use a conversation scope');
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
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

test('a lost completion response recovers the authorized completed attachment without reserving or uploading again', async () => {
  saveTask({ ...task, uploadId:'up1', attachmentId:'a1' });
  const transfers = new Transfers();
  const { api, json, raw } = apiWith([{ ...status, status:'completed', attachment }]);
  json.mockResolvedValueOnce(status).mockRejectedValueOnce(new Error('response lost'));
  await expect(transfers.run(api, key, task, jest.fn())).rejects.toThrow('response lost');
  expect(mockDisk.has(task.uri)).toBe(true);
  expect(await transfers.run(api, key, task, jest.fn())).toEqual(attachment);
  expect(raw).toHaveBeenCalledTimes(1);
  expect(json.mock.calls.filter(([path]) => path.endsWith('/reserve'))).toHaveLength(0);
  expect(transfers.tasks(key)[0]?.complete).toBe(true);
  expect(mockDisk.has(task.uri)).toBe(false);
});

test('completed status can recover even when Android removed the local upload copy', async () => {
  saveTask({ ...task, uploadId:'up1', attachmentId:'a1' });
  mockDisk.delete(task.uri);
  const { api, raw } = apiWith([{ ...status, status:'completed', attachment }]);
  expect(await new Transfers().run(api, key, task, jest.fn())).toEqual(attachment);
  expect(raw).not.toHaveBeenCalled();
});

test.each([
  { id:'another-attachment' }, { byteSize:4 }, { fileName:'different.bin' }, { mimeType:'text/plain' }, { status:'removed' },
])('completed status must match the exact attachment reserved by this task', async difference => {
  saveTask({ ...task, uploadId:'up1', attachmentId:'a1' });
  const transfers = new Transfers();
  const { api, raw } = apiWith([{ ...status, status:'completed', attachment:{ ...attachment, ...difference } }]);
  await expect(transfers.run(api, key, task, jest.fn())).rejects.toThrow('Invalid completed upload');
  expect(transfers.tasks(key)[0]?.complete).toBe(false);
  expect(raw).not.toHaveBeenCalled();
  expect(mockDisk.has(task.uri)).toBe(true);
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

test('download reserves quota, streams file chunks and opens Android save with the original name', async () => {
  const { api, raw, arrayBuffer, reader } = downloadApi([new Uint8Array([1]), new Uint8Array([2, 3])]);
  jest.mocked(saveFileToDevice).mockImplementationOnce(async (uri, name) => {
    expect(new File(uri).size).toBe(3);
    expect(name).toBe('example.bin');
    return true;
  });
  await new Transfers().download(api, key, attachment);
  expect(raw).toHaveBeenCalledWith('/api/workspace/files/a1/download?downloadId=download1', { signal:expect.any(AbortSignal) });
  expect(arrayBuffer).not.toHaveBeenCalled();
  expect(reader.cancel).toHaveBeenCalled();
  expect(mockDisk.size).toBe(0);
  expect(mockDirs.size).toBe(0);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

test('canceling Android save does not claim success or retain a cache file', async () => {
  const { api } = downloadApi([new Uint8Array([1, 2, 3])]);
  jest.mocked(saveFileToDevice).mockResolvedValueOnce(false);
  await new Transfers().download(api, key, attachment);
  expect(mockDisk.size).toBe(0);
  expect(mockDirs.size).toBe(0);
});

test('sharing preserves the file name without a random prefix', async () => {
  const { api } = downloadApi([new Uint8Array([1, 2, 3])]);
  jest.mocked(Sharing.shareAsync).mockImplementationOnce(async uri => {
    expect(uri).toMatch(/\/example\.bin$/);
    expect(new File(uri).size).toBe(3);
  });
  await new Transfers().download(api, key, attachment, 'share');
  expect(saveFileToDevice).not.toHaveBeenCalled();
  expect(mockDisk.size).toBe(0);
  expect(mockDirs.size).toBe(0);
});

test.each([[new Uint8Array([1])], [new Uint8Array([1, 2, 3, 4])]])('truncated and oversized downloads cannot be saved and partial content is removed', async chunk => {
  const { api } = downloadApi([chunk]);
  await expect(new Transfers().download(api, key, attachment)).rejects.toThrow();
  expect(saveFileToDevice).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(mockDisk.size).toBe(0);
  expect(mockDirs.size).toBe(0);
});

test('a stalled download times out, cancels its stream and deletes partial content', async () => {
  jest.useFakeTimers();
  try {
    const { api, reader } = downloadApi([new Uint8Array([1])]);
    reader.read.mockImplementationOnce(async () => ({ done:false, value:new Uint8Array([1]) }));
    reader.read.mockImplementationOnce(() => new Promise(() => undefined));
    const downloaded = new Transfers().download(api, key, attachment);
    const rejected = expect(downloaded).rejects.toThrow('Download timed out');
    await jest.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(reader.cancel).toHaveBeenCalled();
    expect(saveFileToDevice).not.toHaveBeenCalled();
    expect(mockDisk.size).toBe(0);
  } finally { jest.useRealTimers(); }
});

test('receiving chunks renews the download timeout instead of imposing a total duration limit', async () => {
  jest.useFakeTimers();
  try {
    const { api, reader } = downloadApi([]);
    const values = [new Uint8Array([1]), new Uint8Array([2, 3])];
    reader.read.mockImplementation(() => new Promise(resolve => setTimeout(() => {
      const value = values.shift();
      resolve(value ? { done:false, value } : { done:true });
    }, 25000)));
    const downloaded = new Transfers().download(api, key, attachment);
    await jest.advanceTimersByTimeAsync(75001);
    await downloaded;
    expect(saveFileToDevice).toHaveBeenCalledTimes(1);
    expect(mockDisk.size).toBe(0);
  } finally { jest.useRealTimers(); }
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

test.each(['inactivity','account','permission','reader-cleanup'] as const)('real ApiClient cancels a blocked native download on %s instead of only cancelling the JS reader',async cause=>{
  jest.useFakeTimers();
  const nativeCancel=jest.fn();let finish!:(value:{done:boolean;value?:Uint8Array})=>void;
  const blocked=new Promise<{done:boolean;value?:Uint8Array}>(resolve=>{finish=resolve;});
  let finishCancel!:()=>void;
  const cleanup=new Promise<void>(resolve=>{finishCancel=resolve;});
  const reader={read:jest.fn().mockResolvedValueOnce({done:false,value:new Uint8Array([1])}).mockReturnValue(blocked),cancel:jest.fn().mockImplementation(()=>cause==='reader-cleanup'?cleanup:Promise.resolve())};
  jest.mocked(fetch).mockResolvedValueOnce({ok:true,status:200,json:async()=>({id:'synthetic-reservation'})} as Awaited<ReturnType<typeof fetch>>);
  jest.mocked(fetch).mockImplementationOnce(async(_url,init)=>{
    init?.signal?.addEventListener('abort',nativeCancel);
    return {ok:true,status:200,body:{getReader:()=>reader}} as unknown as Awaited<ReturnType<typeof fetch>>;
  });
  const client=new ApiClient('https://workspace.test',jest.fn(),jest.fn());
  const bootstrap=bootstrapSchema.parse({auth:{currentUser:{id:'u1',displayName:'Synthetic'}},space:{id:'s1',name:'Synthetic'},eventCursor:0,policy:{dailyQuotaBytes:10,remainingQuotaBytes:10,messageRetentionCount:50},permissions:{canReadConversations:true,canDownload:true},members:[],conversations:[],files:[attachment]});
  useWorkspace.getState().applyBootstrap(bootstrap,key);
  client.session={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};
  let settled=false;
  const result=new Transfers().download(client,key,attachment).catch((error:unknown)=>{settled=true;return error;});
  try{
    await jest.advanceTimersByTimeAsync(0);expect(reader.read).toHaveBeenCalledTimes(2);
    if(cause==='inactivity'||cause==='reader-cleanup')await jest.advanceTimersByTimeAsync(30001);
    else if(cause==='account')clearAccountFiles(key);
    else useWorkspace.getState().applyBootstrap({...bootstrap,permissions:{...bootstrap.permissions,canDownload:false}},key);
    await jest.advanceTimersByTimeAsync(0);expect(settled).toBe(true);expect(nativeCancel).toHaveBeenCalledTimes(1);
    expect(saveFileToDevice).not.toHaveBeenCalled();expect(Sharing.shareAsync).not.toHaveBeenCalled();
  }finally{
    finishCancel();finish({done:true});await result;jest.useRealTimers();
  }
  expect(mockDisk.size).toBe(0);
});

test.each(['late-bytes','stalled-body','new-session'] as const)('native invalidate cannot save %s while the old account projection still exists',async cause=>{
  jest.useFakeTimers();let finish!:(value:{done:boolean;value?:Uint8Array})=>void;
  const blocked=new Promise<{done:boolean;value?:Uint8Array}>(resolve=>{finish=resolve;});
  const reader={read:jest.fn().mockReturnValueOnce(blocked).mockResolvedValue({done:true}),cancel:jest.fn().mockResolvedValue(undefined)};
  const nativeCancel=jest.fn();
  jest.mocked(fetch).mockResolvedValueOnce({ok:true,status:200,json:async()=>({id:'synthetic-reservation'})} as Awaited<ReturnType<typeof fetch>>);
  jest.mocked(fetch).mockImplementationOnce(async(_url,init)=>{init?.signal?.addEventListener('abort',nativeCancel);return {ok:true,status:200,body:{getReader:()=>reader}} as unknown as Awaited<ReturnType<typeof fetch>>;});
  const client=new ApiClient('https://workspace.test',jest.fn(),jest.fn());client.session={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};
  let settled=false;
  const pending=new Transfers().download(client,key,attachment).then(()=>{settled=true;return null;},(error:unknown)=>{settled=true;return error;});
  try {
    await jest.advanceTimersByTimeAsync(0);expect(reader.read).toHaveBeenCalledTimes(1);client.invalidate();expect(nativeCancel).toHaveBeenCalledTimes(1);
    if(cause==='new-session'){
      client.session={accessToken:'synthetic-new-access',refreshToken:'synthetic-new-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};
      await jest.advanceTimersByTimeAsync(0);expect(settled).toBe(true);
    }
    if(cause==='late-bytes')finish({done:false,value:new Uint8Array([1,2,3])});else await jest.advanceTimersByTimeAsync(30001);
    await jest.advanceTimersByTimeAsync(0);
    expect(await pending).toEqual(new Error(cause==='new-session'?'Download cancelled':'Account changed'));expect(saveFileToDevice).not.toHaveBeenCalled();expect(mockDisk.size).toBe(0);
  } finally { finish({done:true});await pending;jest.useRealTimers(); }
});
