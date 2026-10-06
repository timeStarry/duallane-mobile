import { attachmentPreviewUri, emoteSource, isPreviewableImage, localMediaText, localMediaUri, rememberEmotes, resolveMediaUrl, setMediaAccount, setMediaClient, splitCatalogEmotes } from '../src/data/media';
import { ApiClient } from '../src/data/client';
import { fetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import { attachmentSchema, bootstrapSchema, parseMessage } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { composerEmotePacks, catalogImage, catalogUnicodeGlyph, enabledCatalogPacks, splitImageEmotes } from '../src/domain/emote-catalog';
import { botAssetAvatar, isAllowedSameOriginMediaPath, sanitizeWorkspaceAvatarUrl } from '../src/domain/media-path';
import { recalledNotice } from '../src/domain/recall';

const mockFiles=new Map<string,Uint8Array>();
jest.mock('expo-file-system', () => ({
  File: class { uri:string;constructor(...parts:(string|{uri:string})[]){this.uri=parts.map(p=>typeof p==='string'?p:p.uri).join('/');}get exists(){return mockFiles.has(this.uri);}get size(){return mockFiles.get(this.uri)?.length??0;}create(){mockFiles.set(this.uri,new Uint8Array());}delete(){mockFiles.delete(this.uri);}open(){return {writeBytes:(bytes:Uint8Array)=>mockFiles.set(this.uri,bytes),close:()=>undefined};} },
  Directory: class { uri:string;constructor(...parts:(string|{uri:string})[]){this.uri=parts.map(p=>typeof p==='string'?p:p.uri).join('/');}get exists(){return [...mockFiles.keys()].some(key=>key.startsWith(this.uri+'/'));}create(){}delete(){for(const key of mockFiles.keys())if(key.startsWith(this.uri+'/'))mockFiles.delete(key);} },
  Paths: { cache: 'file:///cache' },
}));
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn(async()=> 'synthetic-digest'), CryptoDigestAlgorithm: { SHA256: 'SHA-256' } }));
jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.2.2',versionCode:20}}));

test('relative emote and avatar paths resolve against the API origin', () => {
  expect(resolveMediaUrl('/api/workspace/emotes/e1/content', 'https://duallane.tsio.top')).toBe('https://duallane.tsio.top/api/workspace/emotes/e1/content');
  expect(resolveMediaUrl('/emotes/bili/doge.png', 'https://duallane.tsio.top')).toBe('https://duallane.tsio.top/emotes/bili/doge.png');
  expect(resolveMediaUrl('https://avatars.githubusercontent.com/u/1', 'https://duallane.tsio.top')).toBe('https://avatars.githubusercontent.com/u/1');
});

test('custom emoji shortcodes map to the authorized content path', () => {
  expect(emoteSource('custom:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe('/api/workspace/emotes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/content');
});

test('personal emote mappings are discarded when the account changes or logs out', () => {
  setMediaAccount('account-a');
  rememberEmotes([{ id: 'private', kind: 'image', label: 'private', token: ':private:', src: '/api/workspace/emotes/private/content' }]);
  expect(emoteSource(':private:')).toBe('/api/workspace/emotes/private/content');
  setMediaAccount('account-b');
  expect(emoteSource(':private:')).toBeUndefined();
  rememberEmotes([{ id: 'private', kind: 'image', label: 'private', token: ':private:', src: '/api/workspace/emotes/private/content' }]);
  setMediaClient(null);
  expect(emoteSource(':private:')).toBeUndefined();
});

test('catalog emote tokens use the web catalog src instead of guessing filenames', () => {
  expect(splitCatalogEmotes('手机的[feishu:glance]表情')).toEqual([
    { text: '手机的' },
    { token: '[feishu:glance]', src: '/emotes/feishu/glance.png' },
    { text: '表情' },
  ]);
  expect(catalogImage('[bili:melon]')?.src).toBe('/emotes/bili/melon.png');
  expect(catalogImage('[wechat:微笑]')?.src).toBe('/emotes/wechat/u5fae-u7b11.png');
  expect(catalogImage('qq:smile')?.src).toBe('/emotes/qq/smile.gif');
  expect(splitImageEmotes(':[bili:melon]:')).toEqual([{ token: '[bili:melon]', src: '/emotes/bili/melon.png' }]);
  expect(splitImageEmotes('未知 [bili:nope]')).toEqual([{ text: '未知 [bili:nope]' }]);
  expect(catalogUnicodeGlyph('emoji:grinning')).toBe('😀');
});

test('same-origin bot and catalog assets are allowed media paths', () => {
  expect(isAllowedSameOriginMediaPath('/assets/beacon-avatar.png')).toBe(true);
  expect(isAllowedSameOriginMediaPath('/assets/echo-avatar.svg')).toBe(true);
  expect(isAllowedSameOriginMediaPath('/assets/../secret')).toBe(false);
  expect(sanitizeWorkspaceAvatarUrl('/assets/beacon-avatar.png')).toBe('/assets/beacon-avatar.png');
  expect(sanitizeWorkspaceAvatarUrl('https://duallane.tsio.top/api/workspace/avatars/other/2')).toBe('/api/workspace/avatars/other/2');
  expect(botAssetAvatar('信标')).toBe('/assets/beacon-avatar.png');
  expect(botAssetAvatar('回声')).toBe('/assets/echo-avatar.svg');
});

test('composer packs put custom collections beside enabled catalog packs', () => {
  const packs = composerEmotePacks({
    entries: [{ type: 'emote', emote: { id: 'e1', kind: 'image', label: '猫', token: '[custom:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]', src: '/api/workspace/emotes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/content' } }],
    emotes: [],
    collections: [{ id: 'col1', name: '妙脆角', items: [{ id: 'e2', kind: 'image', label: '角', token: '[custom:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee]', src: '/api/workspace/emotes/bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee/content' }] }],
  }, ['feishu']);
  expect(packs.map(pack => pack.id)).toEqual(['custom', 'collection:col1', 'feishu']);
  expect(packs[0]?.label).toBe('收藏');
  expect(enabledCatalogPacks(['bili']).every(pack => pack.id === 'bili')).toBe(true);
});

test('recalled notices keep the server sentence instead of a generic unavailable label', () => {
  expect(recalledNotice({ recalledAt: '2026-09-16T01:00:00Z', authorName: 'Member', recallReason: '内容有误', plainText: 'Member因内容有误撤回了一条消息' })).toBe('Member因内容有误撤回了一条消息');
  expect(recalledNotice({ recalledAt: '2026-09-16T01:00:00Z', authorName: 'Member', recallReason: '写错了', plainText: '消息已不可用' })).toBe('Member因写错了撤回了一条消息');
});

test('previewable image types match the web allow-list', () => {
  expect(isPreviewableImage({ mimeType: 'image/png' })).toBe(true);
  expect(isPreviewableImage({ mimeType: 'application/octet-stream', fileName: 'shot.webp' })).toBe(true);
  expect(isPreviewableImage({ mimeType: 'application/pdf', fileName: 'doc.pdf' })).toBe(false);
});

test.each(['deadline','account','API','invalidate','invalidate-new-session'] as const)('real ApiClient media %s cancellation settles even when the SDK body promise ignores abort',async cause=>{
  jest.useFakeTimers();
  const nativeCancel=jest.fn();let finish!:(value:string)=>void;
  const blocked=new Promise<string>(resolve=>{finish=resolve;});
  let bodyStarted=false;
  jest.mocked(fetch).mockImplementationOnce(async(_url,init)=>{
    init?.signal?.addEventListener('abort',nativeCancel);
    return {ok:true,status:200,text:()=>{bodyStarted=true;return blocked;}} as Awaited<ReturnType<typeof fetch>>;
  });
  const client=new ApiClient('https://workspace.test',jest.fn(),jest.fn());
  client.session={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};
  setMediaClient(client);setMediaAccount('synthetic-account');
  let settled=false;
  const loading=localMediaText('/api/workspace/emotes/synthetic/content').then(()=>{settled=true;return null;},(error:unknown)=>{settled=true;return error;});
  try{
    await jest.advanceTimersByTimeAsync(0);expect(bodyStarted).toBe(true);
    if(cause==='deadline')await jest.advanceTimersByTimeAsync(30001);
    else if(cause==='account')setMediaAccount('synthetic-new-account');
    else if(cause==='API')setMediaClient(new ApiClient('https://other.test',jest.fn(),jest.fn()));
    else {client.invalidate();if(cause==='invalidate-new-session')client.session={accessToken:'synthetic-new-access',refreshToken:'synthetic-new-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};}
    await jest.advanceTimersByTimeAsync(0);
    expect(nativeCancel).toHaveBeenCalledTimes(1);expect(settled).toBe(true);
    if(cause==='invalidate'||cause==='invalidate-new-session')expect(await loading).toEqual(new Error('Stale media session'));
  }finally{finish('synthetic-late-text');await loading;setMediaClient(null);jest.useRealTimers();}
});

test.each(['deadline','permission','hidden'] as const)('an authorized blocked preview is cancelled on %s and late bytes never create a cache file',async cause=>{
  jest.useFakeTimers();mockFiles.clear();
  const nativeCancel=jest.fn();let finish!:(value:ArrayBuffer)=>void;
  const blocked=new Promise<ArrayBuffer>(resolve=>{finish=resolve;});let bodyStarted=false;
  const file=attachmentSchema.parse({id:'synthetic-file',fileName:'synthetic.png',mimeType:'image/png',byteSize:3,status:'available',capabilities:{canDownload:true}});
  const bootstrap=bootstrapSchema.parse({auth:{currentUser:{id:'u1',displayName:'Synthetic'}},space:{id:'s1',name:'Synthetic'},eventCursor:0,policy:{dailyQuotaBytes:10,remainingQuotaBytes:10,messageRetentionCount:50},permissions:{canReadConversations:true,canDownload:true},members:[],conversations:[{id:'c1',type:'group',displayTitle:'Synthetic',lastActivityAt:'2026-01-01T00:00:00Z',notificationLevel:'all'}],files:[file]});
  useWorkspace.getState().applyBootstrap(bootstrap,'synthetic-account');
  useWorkspace.getState().upsertMessage(parseMessage({id:'synthetic-message',conversationId:'c1',authorName:'Synthetic',kind:'user',createdAt:'2026-01-01T00:00:00Z',plainText:'synthetic',attachments:[file],content:{format:'duallane.message+json;v=1',blocks:[{type:'attachment',attachmentId:file.id}]}})!);
  jest.mocked(fetch).mockImplementationOnce(async(_url,init)=>{
    init?.signal?.addEventListener('abort',nativeCancel);
    return {ok:true,status:200,arrayBuffer:()=>{bodyStarted=true;return blocked;}} as Awaited<ReturnType<typeof fetch>>;
  });
  const client=new ApiClient('https://workspace.test',jest.fn(),jest.fn());client.session={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};
  setMediaClient(client);setMediaAccount('synthetic-account');let settled=false;
  const loading=attachmentPreviewUri(file,{accountKey:'synthetic-account',conversationId:'c1',messageId:'synthetic-message'}).then(()=>{settled=true;return null;},(error:unknown)=>{settled=true;return error;});
  try{
    await jest.advanceTimersByTimeAsync(0);expect(bodyStarted).toBe(true);
    if(cause==='deadline')await jest.advanceTimersByTimeAsync(30001);
    else if(cause==='permission')useWorkspace.getState().applyBootstrap({...bootstrap,permissions:{...bootstrap.permissions,canDownload:false}},'synthetic-account');
    else useWorkspace.getState().patchMessage('c1','synthetic-message',{hiddenByCurrentUser:true});
    await jest.advanceTimersByTimeAsync(0);expect(settled).toBe(true);expect(nativeCancel).toHaveBeenCalledTimes(1);
    expect(await loading).not.toBeNull();finish(new Uint8Array([1,2,3]).buffer);await jest.advanceTimersByTimeAsync(0);expect(mockFiles.size).toBe(0);
  }finally{finish(new Uint8Array([1,2,3]).buffer);await loading;setMediaClient(null);useWorkspace.getState().reset();jest.useRealTimers();}
});

test('successful media releases the native scope once without retaining a deadline or losing bytes',async()=>{
  mockFiles.clear();const nativeCancel=jest.fn();
  jest.mocked(fetch).mockImplementationOnce(async(_url,init)=>{init?.signal?.addEventListener('abort',nativeCancel);return {ok:true,status:200,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer} as Awaited<ReturnType<typeof fetch>>;});
  const client=new ApiClient('https://workspace.test',jest.fn(),jest.fn());setMediaClient(client);setMediaAccount('synthetic-account');
  try {
    const uri=await localMediaUri('/emotes/bili/doge.png');expect(mockFiles.get(uri)).toEqual(new Uint8Array([1,2,3]));expect(nativeCancel).toHaveBeenCalledTimes(1);
    client.invalidate();setMediaClient(null);expect(nativeCancel).toHaveBeenCalledTimes(1);
  }finally{setMediaClient(null);mockFiles.clear();}
});

test.each(['logged-out','new-session'] as const)('invalidating the same ApiClient with %s rejects late image bytes before any cache write',async cause=>{
  jest.useFakeTimers();mockFiles.clear();let finish!:(value:ArrayBuffer)=>void;
  const blocked=new Promise<ArrayBuffer>(resolve=>{finish=resolve;});let bodyStarted=false;const nativeCancel=jest.fn();
  jest.mocked(fetch).mockImplementationOnce(async(_url,init)=>{init?.signal?.addEventListener('abort',nativeCancel);return {ok:true,status:200,arrayBuffer:()=>{bodyStarted=true;return blocked;}} as Awaited<ReturnType<typeof fetch>>;});
  const client=new ApiClient('https://workspace.test',jest.fn(),jest.fn());client.session={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};
  setMediaClient(client);setMediaAccount('synthetic-account');
  const pending=localMediaUri('/api/workspace/emotes/synthetic/content').then(()=>null,(error:unknown)=>error);
  try {
    await jest.advanceTimersByTimeAsync(0);expect(bodyStarted).toBe(true);client.invalidate();expect(nativeCancel).toHaveBeenCalledTimes(1);
    if(cause==='new-session')client.session={accessToken:'synthetic-new-access',refreshToken:'synthetic-new-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};
    finish(new Uint8Array([1,2,3]).buffer);await jest.advanceTimersByTimeAsync(0);
    expect(await pending).toEqual(new Error('Stale media session'));expect(mockFiles.size).toBe(0);
  } finally { finish(new Uint8Array([1,2,3]).buffer);await pending;setMediaClient(null);jest.useRealTimers(); }
});

test('a normal token rotation preserves the authorized media body and releases its scope on success',async()=>{
  jest.useFakeTimers();mockFiles.clear();let finish!:(value:ArrayBuffer)=>void;
  const blocked=new Promise<ArrayBuffer>(resolve=>{finish=resolve;});let bodyStarted=false;const nativeCancel=jest.fn();
  jest.mocked(fetch).mockImplementationOnce(async(_url,init)=>{init?.signal?.addEventListener('abort',nativeCancel);return {ok:true,status:200,arrayBuffer:()=>{bodyStarted=true;return blocked;}} as Awaited<ReturnType<typeof fetch>>;});
  const client=new ApiClient('https://workspace.test',jest.fn(),jest.fn());client.session={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};
  setMediaClient(client);setMediaAccount('synthetic-account');
  const pending=localMediaUri('/api/workspace/emotes/synthetic/content');
  try {
    await jest.advanceTimersByTimeAsync(0);expect(bodyStarted).toBe(true);
    client.session={...client.session,accessToken:'synthetic-rotated-access',refreshToken:'synthetic-rotated-refresh'};
    expect(nativeCancel).not.toHaveBeenCalled();finish(new Uint8Array([1,2,3]).buffer);const uri=await pending;
    expect(mockFiles.get(uri)).toEqual(new Uint8Array([1,2,3]));expect(nativeCancel).toHaveBeenCalledTimes(1);
    client.invalidate();expect(nativeCancel).toHaveBeenCalledTimes(1);
  } finally {finish(new Uint8Array([1,2,3]).buffer);await pending;setMediaClient(null);mockFiles.clear();jest.useRealTimers();}
});

test.each(['invalidate-new-session','token-rotation'] as const)('a completed media body with a pending digest remains scoped through %s',async cause=>{
  jest.useFakeTimers();mockFiles.clear();let finishDigest!:(value:string)=>void;
  const digest=new Promise<string>(resolve=>{finishDigest=resolve;});let digestStarted=false;const nativeCancel=jest.fn();
  jest.mocked(Crypto.digestStringAsync).mockImplementationOnce(()=>{digestStarted=true;return digest;});
  jest.mocked(fetch).mockImplementationOnce(async(_url,init)=>{init?.signal?.addEventListener('abort',nativeCancel);return {ok:true,status:200,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer} as Awaited<ReturnType<typeof fetch>>;});
  const client=new ApiClient('https://workspace.test',jest.fn(),jest.fn());client.session={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};
  setMediaClient(client);setMediaAccount('synthetic-account');
  const pending=localMediaUri('/api/workspace/emotes/synthetic-digest/content').then(value=>value,(error:unknown)=>error);
  try {
    await jest.advanceTimersByTimeAsync(0);expect(digestStarted).toBe(true);
    if(cause==='invalidate-new-session')client.invalidate();
    client.session={accessToken:'synthetic-rotated-access',refreshToken:'synthetic-rotated-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};
    finishDigest('synthetic-delayed-digest');await jest.advanceTimersByTimeAsync(0);const result=await pending;
    if(cause==='invalidate-new-session'){expect(result).toEqual(new Error('Stale media session'));expect(mockFiles.size).toBe(0);}
    else {expect(typeof result).toBe('string');expect(mockFiles.get(result as string)).toEqual(new Uint8Array([1,2,3]));}
    expect(nativeCancel).toHaveBeenCalledTimes(1);
  } finally {finishDigest('synthetic-delayed-digest');await pending;setMediaClient(null);mockFiles.clear();jest.useRealTimers();}
});
