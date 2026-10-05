import { AppState } from 'react-native';
import { fetch } from 'expo/fetch';
import { Runtime } from '../src/data/runtime';
import { ApiClient } from '../src/data/client';
import { useWorkspace } from '../src/domain/store';
import { type Attachment } from '../src/domain/contracts';
import { cache, credentials } from '../src/platform/storage';

jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('expo-web-browser',()=>({openAuthSessionAsync:jest.fn()}));
jest.mock('expo-crypto',()=>({randomUUID:()=> 'synthetic-id',digestStringAsync:async()=> 'synthetic-digest',CryptoDigestAlgorithm:{SHA256:'SHA256'},CryptoEncoding:{BASE64:'base64'}}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.1.0',versionCode:1},config:{apiOrigin:''},redirectUri:'com.timestarry.duallane://oauth',validateOrigin:(s:string)=>s}));
jest.mock('../src/platform/storage',()=>({cache:{get:jest.fn(),set:jest.fn(),remove:jest.fn(),clearAccount:jest.fn()},credentials:{read:jest.fn(),save:jest.fn(async()=>undefined),clear:jest.fn(async()=>undefined)}}));
jest.mock('../src/platform/notifications',()=>({clearNotifications:jest.fn(async()=>undefined),showMessageNotification:jest.fn(async()=>undefined)}));
jest.mock('../src/data/transfers',()=>({clearAccountFiles:jest.fn()}));

const fetchMock=jest.mocked(fetch);
const session={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00.000Z',refreshTokenExpiresAt:'2099-02-01T00:00:00.000Z'};
const policy={schemaVersion:1,platform:'android',channel:'internal',latest:{appVersion:'0.1.0',versionCode:1,releaseId:'r1',releaseNotes:[]},minimum:{appVersion:'0.1.0',versionCode:1},recommendation:'none',apkUrl:null,protocol:{eventMajor:1,contentFormats:['duallane.message+json;v=1']}};
const conversation={id:'c1',displayTitle:'Test',type:'group',lastActivityAt:'2026-01-01T00:00:00Z',notificationLevel:'all',capabilities:{canSendMessage:true,canUploadFile:true}};
const bootstrap={auth:{currentUser:{id:'u1',displayName:'Test'}},space:{id:'s1',name:'Test'},eventCursor:4,policy:{dailyQuotaBytes:100,remainingQuotaBytes:100,messageRetentionCount:50},permissions:{canReadConversations:true,canDownload:true},members:[],conversations:[conversation],files:[]};
const topic={id:'t1',conversationId:'c1',title:'Topic',status:'open',joined:true,canJoin:false,allowSyncToGroup:true,participantCount:2,unreadCount:0,notificationLevel:'all' as const,revision:1};
const attachment:Attachment={id:'a1',fileName:'synthetic.png',mimeType:'image/png',byteSize:3,status:'available',capabilities:{canDownload:true}};
const message={id:'canonical-id',clientMessageId:'synthetic-id',conversationId:'c1',authorId:'u1',authorName:'Test',kind:'user',createdAt:'2026-01-01T00:00:00Z',plainText:'synthetic text',attachments:[],content:{format:'duallane.message+json;v=1',blocks:[{type:'text',text:'synthetic text'}]}};

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
function response(body:unknown,status=200){return {ok:status<400,status,json:async()=>body} as Awaited<ReturnType<typeof fetch>>;}
function fallback(url:string){return response(url.endsWith('/release-policy')?policy:url.endsWith('/refresh')?session:bootstrap);}
function revoke(isTopic:boolean){const state=useWorkspace.getState();if(isTopic)state.upsertTopic({...topic,joined:false});else state.applyBootstrap({...state.bootstrap!,conversations:[]},state.accountKey);}
function bucket(isTopic:boolean){return isTopic?'topic:t1':'c1';}
function options(isTopic:boolean){return isTopic?{topicId:'t1'}:undefined;}

let runtime:Runtime;
beforeEach(async()=>{
  jest.spyOn(console,'warn').mockImplementation(()=>undefined);
  jest.spyOn(AppState,'addEventListener').mockReturnValue({remove:jest.fn()});
  useWorkspace.getState().reset();jest.mocked(cache.get).mockReturnValue(null);
  jest.mocked(credentials.read).mockResolvedValue({origin:'https://workspace.example',refreshToken:'synthetic-refresh',userId:'u1'});
  fetchMock.mockImplementation(async url=>fallback(String(url)));
  runtime=new Runtime();jest.spyOn(runtime,'connect').mockImplementation(()=>undefined);jest.spyOn(runtime,'listTopics').mockResolvedValue([]);await runtime.start();
  useWorkspace.getState().upsertTopic(topic);fetchMock.mockClear();
});
afterEach(()=>{runtime.dispose();jest.restoreAllMocks();});

test.each([false,true])('a late send acknowledgement cannot restore a revoked stream (topic=%s)',async isTopic=>{
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>();fetchMock.mockImplementation(()=>pending.promise);
  const sending=runtime.send('c1','synthetic text',undefined,undefined,options(isTopic));
  expect(useWorkspace.getState().messages[bucket(isTopic)]?.[0]?.status).toBe('sending');
  revoke(isTopic);pending.resolve(response({message:{...message,...(isTopic?{topicId:'t1'}:{})}}));await sending;
  expect(useWorkspace.getState().messages[bucket(isTopic)]).toBeUndefined();
});

test.each([false,true])('a late failed send cannot restore a revoked pending message (topic=%s)',async isTopic=>{
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>();fetchMock.mockImplementation(()=>pending.promise);
  const sending=runtime.send('c1','synthetic text',undefined,undefined,options(isTopic));
  revoke(isTopic);pending.reject(new Error('offline'));await expect(sending).rejects.toThrow();
  expect(useWorkspace.getState().messages[bucket(isTopic)]).toBeUndefined();
});

test.each([false,true])('a late upload cannot restore attachments or send after stream revocation (topic=%s)',async isTopic=>{
  const pending=deferred<Attachment|null>();fetchMock.mockResolvedValue(response({message:{...message,...(isTopic?{topicId:'t1'}:{})}}));
  const sending=runtime.send('c1','synthetic text',undefined,undefined,{...options(isTopic),upload:()=>pending.promise});
  revoke(isTopic);pending.resolve(attachment);await sending;
  expect(fetchMock).not.toHaveBeenCalled();
  expect(useWorkspace.getState().messages[bucket(isTopic)]).toBeUndefined();
});

test.each([false,true])('a late upload failure cannot restore a revoked pending message (topic=%s)',async isTopic=>{
  const pending=deferred<Attachment|null>();
  const sending=runtime.send('c1','synthetic text',undefined,undefined,{...options(isTopic),upload:()=>pending.promise});
  revoke(isTopic);pending.reject(new Error('offline'));await expect(sending).rejects.toThrow('offline');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(useWorkspace.getState().messages[bucket(isTopic)]).toBeUndefined();
});

test('a late acknowledgement cannot enter a replacement account even when its conversation is readable',async()=>{
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>();fetchMock.mockImplementation(()=>pending.promise);
  const sending=runtime.send('c1','synthetic text');const state=useWorkspace.getState();
  state.applyBootstrap({...state.bootstrap!,auth:{currentUser:{...state.bootstrap!.auth.currentUser,id:'u2',displayName:'Next'}}},'https://workspace.example:u2');
  pending.resolve(response({message}));await sending;
  expect(useWorkspace.getState().messages).toEqual({});
});

test.each([false,true])('an acknowledgement or failure from a replaced API cannot write back (failure=%s)',async failure=>{
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>();fetchMock.mockImplementation(()=>pending.promise);
  const sending=runtime.send('c1','synthetic text');
  runtime.api=new ApiClient('https://next.example',async()=>undefined,()=>undefined);
  if(failure){pending.reject(new Error('offline'));await expect(sending).rejects.toThrow();}
  else{pending.resolve(response({message}));await expect(sending).rejects.toThrow('Session unavailable');}
  expect(useWorkspace.getState().messages.c1?.[0]).toMatchObject({id:'synthetic-id',status:'sending'});
});

test('an upload completing after logout cannot dispatch or write back',async()=>{
  const pending=deferred<Attachment|null>();
  const sending=runtime.send('c1','synthetic text',undefined,undefined,{upload:()=>pending.promise});
  await runtime.logout(false);pending.resolve(attachment);await sending;
  expect(fetchMock).not.toHaveBeenCalled();
  expect(useWorkspace.getState().messages).toEqual({});
});

test('global reading permission loss blocks a late acknowledgement even when the server still lists the group',async()=>{
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>();fetchMock.mockImplementation(()=>pending.promise);
  const sending=runtime.send('c1','synthetic text');const state=useWorkspace.getState();
  state.applyBootstrap({...state.bootstrap!,permissions:{...state.bootstrap!.permissions,canReadConversations:false}},state.accountKey);
  pending.resolve(response({message}));await sending;
  expect(useWorkspace.getState().messages).toEqual({});
});

test('upload completion cannot dispatch after sending capability is revoked while reading remains allowed',async()=>{
  const pending=deferred<Attachment|null>();fetchMock.mockResolvedValue(response({message}));
  const sending=runtime.send('c1','synthetic text',undefined,undefined,{upload:()=>pending.promise});
  useWorkspace.setState(state=>({conversations:{...state.conversations,c1:{...state.conversations.c1!,capabilities:{...state.conversations.c1!.capabilities,canSendMessage:false}}}}));
  pending.resolve(attachment);await expect(sending).rejects.toThrow('Cannot send');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('upload completion cannot dispatch after a topic closes while its messages remain readable',async()=>{
  const pending=deferred<Attachment|null>();
  const sending=runtime.send('c1','synthetic text',undefined,undefined,{topicId:'t1',upload:()=>pending.promise});
  useWorkspace.getState().upsertTopic({...topic,status:'closed'});pending.resolve(attachment);
  await expect(sending).rejects.toThrow('Cannot send');expect(fetchMock).not.toHaveBeenCalled();
});

test('an authorized successful acknowledgement still replaces the pending message',async()=>{
  fetchMock.mockResolvedValue(response({message}));await runtime.send('c1','synthetic text');
  expect(useWorkspace.getState().messages.c1).toHaveLength(1);
  expect(useWorkspace.getState().messages.c1?.[0]).toMatchObject({id:'canonical-id',plainText:'synthetic text'});
  expect(useWorkspace.getState().messages.c1?.[0]?.status).toBeUndefined();
});

test('a temporary network failure keeps an authorized message available for retry',async()=>{
  fetchMock.mockRejectedValue(new Error('offline'));await expect(runtime.send('c1','synthetic text')).rejects.toThrow();
  const pending=useWorkspace.getState().messages.c1?.[0];expect(pending).toMatchObject({status:'failed',plainText:'synthetic text'});
  fetchMock.mockResolvedValue(response({message}));await runtime.send('c1','synthetic text',pending);
  expect(useWorkspace.getState().messages.c1?.[0]).toMatchObject({id:'canonical-id'});
  expect(useWorkspace.getState().messages.c1?.[0]?.status).toBeUndefined();
});
