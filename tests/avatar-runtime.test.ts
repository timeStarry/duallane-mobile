import { AppState } from 'react-native';
import { Runtime } from '../src/data/runtime';
import { ApiClient } from '../src/data/client';
import { bootstrapSchema, parseMessage } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { cache, credentials } from '../src/platform/storage';
import { cleanupAvatarCopies, clearAvatarSelections } from '../src/data/avatar';

jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('expo-web-browser',()=>({openAuthSessionAsync:jest.fn()}));
jest.mock('expo-crypto',()=>({randomUUID:()=> 'synthetic-id'}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.1.0',versionCode:1},config:{apiOrigin:''},redirectUri:'com.timestarry.duallane://oauth',validateOrigin:(s:string)=>s}));
jest.mock('../src/platform/storage',()=>({cache:{get:jest.fn(),set:jest.fn(),remove:jest.fn(),clearAccount:jest.fn()},credentials:{read:jest.fn(async()=>null),save:jest.fn(async()=>undefined),clear:jest.fn(async()=>undefined)}}));
jest.mock('../src/platform/notifications',()=>({clearNotifications:jest.fn(async()=>undefined),showMessageNotification:jest.fn(async()=>undefined)}));
jest.mock('../src/data/transfers',()=>({clearAccountFiles:jest.fn()}));
jest.mock('../src/data/avatar',()=>({readAvatarBytes:jest.fn(()=>new Uint8Array([1,2,3])),clearAvatarSelections:jest.fn(async()=>undefined),cleanupAvatarCopies:jest.fn()}));

const origin='https://workspace.example',account=`${origin}:u1`;
const user={id:'u1',displayName:'Original',nickname:'Original',avatarUrl:'/api/workspace/avatars/u1/old',searchDiscoverable:true};
const snapshot=bootstrapSchema.parse({auth:{currentUser:user},space:{id:'s1',name:'Synthetic'},eventCursor:0,policy:{dailyQuotaBytes:100,remainingQuotaBytes:100,messageRetentionCount:50},permissions:{canReadConversations:true,canDownload:true},members:[user],conversations:[{id:'c1',displayTitle:'Synthetic',type:'group',lastActivityAt:'2026-01-01T00:00:00.000Z'}],files:[]});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const picked={uri:'file:///cache/synthetic.png',mimeType:'image/png' as const,byteSize:3,dispose:jest.fn()};
let runtime:Runtime;
let raw:jest.Mock;
let json:jest.Mock;
beforeEach(async()=>{
  jest.spyOn(AppState,'addEventListener').mockReturnValue({remove:jest.fn()});
  useWorkspace.getState().reset();jest.mocked(cache.get).mockReturnValue(null);jest.mocked(cache.set).mockClear();
  runtime=new Runtime();await runtime.start();
  useWorkspace.getState().applyBootstrap(snapshot,account);
  raw=jest.fn(async()=>({status:200,json:async()=>({user:{...user,avatarUrl:'/api/workspace/avatars/u1/new'}})}));
  json=jest.fn(async()=>snapshot);
  runtime.api={origin,raw,json,session:null,invalidate:jest.fn()} as unknown as ApiClient;
  jest.spyOn(runtime,'chatSettings').mockRejectedValue(new Error('unused'));
  jest.spyOn(runtime,'listTopics').mockResolvedValue([]);
});
afterEach(()=>{runtime.dispose();jest.restoreAllMocks();});

test('avatar ACK patches only the avatar field and uses a raw image request',async()=>{
  const pending=deferred<{status:number;json:()=>Promise<unknown>}>();raw.mockReturnValueOnce(pending.promise);
  const uploading=runtime.updateAvatar(picked);
  const current={...snapshot.auth.currentUser,nickname:'New nickname',searchDiscoverable:false};
  useWorkspace.setState({bootstrap:{...snapshot,auth:{currentUser:current},members:[current]}});
  pending.resolve({status:200,json:async()=>({user:{...user,avatarUrl:'/api/workspace/avatars/u1/new'}})});
  await uploading;
  expect(raw).toHaveBeenCalledWith('/api/workspace/me/avatar',{method:'PUT',headers:{'Content-Type':'image/png'},body:new Uint8Array([1,2,3])});
  expect(useWorkspace.getState().bootstrap?.auth.currentUser).toMatchObject({nickname:'New nickname',searchDiscoverable:false,avatarUrl:'/api/workspace/avatars/u1/new'});
  expect(useWorkspace.getState().bootstrap?.members[0]).toMatchObject({nickname:'New nickname',searchDiscoverable:false,avatarUrl:'/api/workspace/avatars/u1/new'});
});

test('an old bootstrap retains a completed avatar but still applies permission revocation and removes content',async()=>{
  const pending=deferred<typeof snapshot>();json.mockReturnValueOnce(pending.promise);
  useWorkspace.getState().upsertMessage(parseMessage({id:'m1',conversationId:'c1',authorId:'u1',authorName:'Synthetic',kind:'user',createdAt:'2026-01-01T00:00:00.000Z',plainText:'Synthetic'})!);
  useWorkspace.getState().setDraft('c1','Synthetic draft');
  const refreshing=runtime.bootstrap();
  await runtime.updateAvatar(picked);
  pending.resolve({...snapshot,permissions:{...snapshot.permissions,canReadConversations:false,canDownload:false},conversations:[]});
  await refreshing;
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBe('/api/workspace/avatars/u1/new');
  expect(useWorkspace.getState().bootstrap?.permissions.canReadConversations).toBe(false);
  expect(useWorkspace.getState().messages.c1).toBeUndefined();
  expect(useWorkspace.getState().drafts.c1).toBeUndefined();
  expect(jest.mocked(cache.set).mock.calls.filter(([key])=>key===`${account}:bootstrap`).at(-1)?.[1]).toMatchObject({permissions:{canReadConversations:false},auth:{currentUser:{avatarUrl:'/api/workspace/avatars/u1/new'}}});
});

test('a newer bootstrap remains authoritative for a later Web avatar change',async()=>{
  await runtime.updateAvatar(picked);
  json.mockResolvedValueOnce({...snapshot,auth:{currentUser:{...snapshot.auth.currentUser,avatarUrl:'/api/workspace/avatars/u1/web'}}});
  await runtime.bootstrap();
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBe('/api/workspace/avatars/u1/web');
});

test('an old profile response cannot roll back a completed avatar',async()=>{
  const pending=deferred<{user:typeof user}>();json.mockReturnValueOnce(pending.promise);
  const saving=runtime.updateProfile({nickname:'Saved nickname'});
  await runtime.updateAvatar(picked);
  pending.resolve({user:{...user,nickname:'Saved nickname'}});await saving;
  expect(useWorkspace.getState().bootstrap?.auth.currentUser).toMatchObject({nickname:'Saved nickname',avatarUrl:'/api/workspace/avatars/u1/new'});
});

test('clear returns the canonical GitHub avatar without rolling back other profile fields',async()=>{
  raw.mockResolvedValueOnce({status:200,json:async()=>({user:{...user,avatarUrl:'https://avatars.githubusercontent.com/u/1'}})});
  await runtime.clearAvatar();
  expect(raw).toHaveBeenCalledWith('/api/workspace/me/avatar',{method:'DELETE'});
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBe('https://avatars.githubusercontent.com/u/1');
});

test.each(['account','api','disposed','route'])('late avatar response cannot write after %s invalidation',async kind=>{
  const pending=deferred<unknown>();let route=true;
  raw.mockResolvedValueOnce({status:200,json:()=>pending.promise});
  const uploading=runtime.updateAvatar(picked,()=>route);await Promise.resolve();
  if(kind==='account')useWorkspace.setState({accountKey:`${origin}:u2`});
  if(kind==='api')runtime.api={origin,raw:jest.fn(),json:jest.fn()} as unknown as ApiClient;
  if(kind==='disposed')runtime.dispose();
  if(kind==='route')route=false;
  pending.resolve({user:{...user,avatarUrl:'/api/workspace/avatars/u1/new'}});
  await expect(uploading).rejects.toThrow('Stale session');
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBe(user.avatarUrl);
});

test('a stale confirmation makes no request and disposes the preview copy',async()=>{
  await expect(runtime.updateAvatar(picked,()=>false)).rejects.toThrow('Stale session');
  expect(raw).not.toHaveBeenCalled();expect(picked.dispose).toHaveBeenCalled();
});

test('transport failure retains the original avatar and clears the selected copy',async()=>{
  raw.mockRejectedValueOnce(new Error('synthetic failure'));
  await expect(runtime.updateAvatar(picked)).rejects.toThrow('synthetic failure');
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBe(user.avatarUrl);
  expect(picked.dispose).toHaveBeenCalled();
});

test.each([{user:{...user,id:'u2'}},{user:{id:'u1',displayName:'Synthetic'}},{user:{...user,avatarUrl:42}}])('rejects a malformed or foreign canonical response',async payload=>{
  raw.mockResolvedValueOnce({status:200,json:async()=>payload});
  await expect(runtime.clearAvatar()).rejects.toMatchObject({code:'response.invalid',diagnostic:'body.schema'});
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBe(user.avatarUrl);
});

test('a slow earlier avatar command cannot overwrite a later command',async()=>{
  const pending=deferred<{status:number;json:()=>Promise<unknown>}>();raw.mockReturnValueOnce(pending.promise);
  const first=runtime.updateAvatar(picked);await runtime.clearAvatar();
  pending.resolve({status:200,json:async()=>({user:{...user,avatarUrl:'/api/workspace/avatars/u1/earlier'}})});
  await expect(first).rejects.toThrow('Stale session');
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBe('/api/workspace/avatars/u1/new');
});

test('logout and a new same-account session cannot resurrect an old avatar ACK',async()=>{
  const pending=deferred<{status:number;json:()=>Promise<unknown>}>();raw.mockReturnValueOnce(pending.promise);
  const uploading=runtime.updateAvatar(picked);
  await runtime.logout(false);runtime.api={origin,raw,json,session:null,invalidate:jest.fn()} as unknown as ApiClient;
  useWorkspace.getState().applyBootstrap(snapshot,account);
  pending.resolve({status:200,json:async()=>({user:{...user,avatarUrl:'/api/workspace/avatars/u1/new'}})});
  await expect(uploading).rejects.toThrow('Stale session');
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBe(user.avatarUrl);
});

test('start delegates stale avatar cleanup and logout delegates account cleanup',async()=>{
  jest.mocked(cleanupAvatarCopies).mockClear();jest.mocked(clearAvatarSelections).mockClear();
  await runtime.start();expect(cleanupAvatarCopies).toHaveBeenCalledTimes(1);
  await runtime.logout(false);expect(clearAvatarSelections).toHaveBeenCalledWith(account);
});

test('avatar cache cleanup failure cannot block local credential removal',async()=>{
  jest.mocked(credentials.clear).mockClear();jest.mocked(clearAvatarSelections).mockRejectedValueOnce(new Error('synthetic cache failure'));
  await runtime.logout(false);expect(credentials.clear).toHaveBeenCalled();expect(useWorkspace.getState().accountKey).toBe('');
});

test('avatar startup cleanup failure cannot block restore or remove persisted credentials',async()=>{
  jest.mocked(credentials.read).mockClear();jest.mocked(credentials.clear).mockClear();
  jest.mocked(credentials.read).mockResolvedValueOnce({origin,refreshToken:'synthetic-refresh',userId:'u1'});
  jest.spyOn(runtime,'checkPolicy').mockResolvedValueOnce(undefined);
  jest.spyOn(ApiClient.prototype,'refresh').mockImplementationOnce(async function(this:ApiClient){
    this.session={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00.000Z',refreshTokenExpiresAt:'2099-02-01T00:00:00.000Z'};
  });
  const bootstrap=jest.spyOn(runtime,'bootstrap').mockResolvedValueOnce(undefined);
  jest.spyOn(runtime,'connect').mockImplementation(()=>undefined);
  jest.mocked(cleanupAvatarCopies).mockImplementationOnce(()=>{throw new Error('Synthetic avatar startup IO failure');});
  await expect(runtime.start()).resolves.toBeUndefined();
  expect(credentials.read).toHaveBeenCalledTimes(1);expect(credentials.clear).not.toHaveBeenCalled();
  expect(bootstrap).toHaveBeenCalledTimes(1);expect(runtime.api?.session?.refreshToken).toBe('synthetic-refresh');
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.id).toBe('u1');
});
