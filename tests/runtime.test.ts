import { AppState } from 'react-native';
import { fetch } from 'expo/fetch';
import { Runtime } from '../src/data/runtime';
import { useWorkspace } from '../src/domain/store';
import { parseMessage } from '../src/domain/contracts';
import { cache, credentials } from '../src/platform/storage';
import { releaseSchema } from '../src/domain/updates';
import { config } from '../src/platform/config';

jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('expo-web-browser',()=>({openAuthSessionAsync:jest.fn(async()=>({type:'cancel'}))}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '12345678-1234-1234-1234-123456789012',digestStringAsync:async()=> 'test-challenge',CryptoDigestAlgorithm:{SHA256:'SHA256'},CryptoEncoding:{BASE64:'base64'}}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.1.0',versionCode:1},config:{apiOrigin:''},redirectUri:'com.timestarry.duallane://oauth',validateOrigin:(s:string)=>s}));
jest.mock('../src/platform/storage',()=>({cache:{get:jest.fn(),set:jest.fn(),remove:jest.fn(),clearAccount:jest.fn()},credentials:{read:jest.fn(),save:jest.fn(async()=>undefined),clear:jest.fn(async()=>undefined)}}));
jest.mock('../src/platform/notifications',()=>({clearNotifications:jest.fn(async()=>undefined),showMessageNotification:jest.fn(async()=>undefined)}));
jest.mock('../src/data/transfers',()=>({clearAccountFiles:jest.fn()}));
const fetchMock=jest.mocked(fetch),read=jest.mocked(credentials.read);
const session={accessToken:'access-token-for-test',refreshToken:'rotated-token-for-test',accessTokenExpiresAt:'2099-01-01T00:00:00.000Z',refreshTokenExpiresAt:'2099-02-01T00:00:00.000Z'};
const saved={origin:'https://workspace.example',refreshToken:'refresh-token-for-test',userId:'u1'};
const policy={schemaVersion:1,platform:'android',channel:'internal',latest:{appVersion:'0.1.0',versionCode:1,releaseId:'r1',releaseNotes:[]},minimum:{appVersion:'0.1.0',versionCode:1},recommendation:'none',apkUrl:null,protocol:{eventMajor:1,contentFormats:['duallane.message+json;v=1']}};
const conversation={id:'c1',displayTitle:'Test',type:'direct',lastActivityAt:'2026-01-01T00:00:00Z',notificationLevel:'all',capabilities:{canSendMessage:true,canUploadFile:true}};
const bootstrap={auth:{currentUser:{id:'u1',displayName:'Test'}},space:{id:'s1',name:'Test'},eventCursor:4,policy:{dailyQuotaBytes:100,remainingQuotaBytes:100,messageRetentionCount:50},permissions:{canReadConversations:true},members:[],conversations:[conversation],files:[]};
const message={id:'m1',conversationId:'c1',authorId:'u1',authorName:'Test',kind:'user',createdAt:'2026-01-01T00:00:00Z',plainText:'old',content:{format:'duallane.message+json;v=1',blocks:[{type:'text',text:'old'}]}};
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function response(body:unknown,status=200){return {ok:status<400,status,json:async()=>body} as Awaited<ReturnType<typeof fetch>>;}
function serve(){fetchMock.mockImplementation(async url=>response(url.endsWith('/release-policy')?policy:url.endsWith('/refresh')?session:url.endsWith('/bootstrap')?bootstrap:url.includes('/messages?')?{messages:[{...message,plainText:'edited'}]}:{authorizationUrl:`${new URL(url).origin}/api/auth/mobile/github/authorize?flow=test`}));}
let runtime:Runtime;
beforeEach(()=>{config.apiOrigin='';jest.spyOn(AppState,'addEventListener').mockReturnValue({remove:jest.fn()});useWorkspace.getState().reset();jest.mocked(cache.get).mockReturnValue(null);read.mockResolvedValue(saved);serve();runtime=new Runtime();jest.spyOn(runtime,'connect').mockImplementation(()=>undefined);});
afterEach(()=>{runtime.dispose();jest.restoreAllMocks();jest.useRealTimers();});

test('a pending credential read cannot restore content after logout',async()=>{
  const pending=deferred<typeof saved>();read.mockImplementationOnce(()=>pending.promise);
  const start=runtime.start();await runtime.logout(false);pending.resolve(saved);await start;
  expect(runtime.api).toBeNull();expect(useWorkspace.getState().ready).toBe(false);expect(fetchMock).not.toHaveBeenCalled();
});

test('a slow version check does not block login for a preconfigured service',async()=>{
  config.apiOrigin='https://workspace.example';read.mockResolvedValue(null);
  const policyCheck=deferred<void>();jest.spyOn(runtime,'checkPolicy').mockReturnValue(policyCheck.promise);
  const starting=runtime.start();await Promise.resolve();
  const loginWasBlocked=useWorkspace.getState().busy;
  policyCheck.resolve();await starting;
  expect(loginWasBlocked).toBe(false);expect(runtime.api?.origin).toBe(config.apiOrigin);
});

test('Strict Mode cleanup and setup share one refresh and restore the AppState listener',async()=>{
  const pending=deferred<typeof saved>();read.mockImplementationOnce(()=>pending.promise);
  const listener=jest.spyOn(AppState,'addEventListener');
  const a=runtime.start();runtime.dispose();const b=runtime.start();expect(b).toBe(a);pending.resolve(saved);await b;
  expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/refresh'))).toHaveLength(1);
  expect(listener).toHaveBeenCalledTimes(2);expect(useWorkspace.getState().ready).toBe(true);
});

test('reconnect refetches loaded messages before advancing to a fresh snapshot',async()=>{
  await runtime.start();useWorkspace.getState().upsertMessage(parseMessage(message)!);
  await runtime.resume();expect(useWorkspace.getState().messages.c1?.[0]?.plainText).toBe('edited');
  expect(fetchMock.mock.calls.some(([url])=>url.includes('/c1/messages?'))).toBe(true);
  expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/refresh'))).toHaveLength(1);
});

test('a transient reconnect failure schedules another attempt without user intervention',async()=>{
  jest.useFakeTimers();await runtime.start();fetchMock.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
  await runtime.resume();const requests=fetchMock.mock.calls.length;
  await jest.advanceTimersByTimeAsync(1000);expect(fetchMock.mock.calls.length).toBeGreaterThan(requests);
});

test('disabled Workspace clears retained content instead of restoring cached authorization',async()=>{
  await runtime.start();useWorkspace.getState().upsertMessage(parseMessage(message)!);
  fetchMock.mockImplementation(async url=>url.endsWith('/bootstrap')?response({error:{code:'workspace.disabled'}},503):response(url.endsWith('/refresh')?session:policy));
  await runtime.resume();expect(useWorkspace.getState().ready).toBe(false);expect(useWorkspace.getState().messages).toEqual({});expect(credentials.clear).toHaveBeenCalled();
});

test('changing service origin does not inherit the old forced-update policy',async()=>{
  read.mockResolvedValue(null);await runtime.start();
  useWorkspace.setState({policy:releaseSchema.parse({...policy,latest:{...policy.latest,appVersion:'9.0.0',versionCode:9},minimum:{appVersion:'9.0.0',versionCode:9}})});
  fetchMock.mockRejectedValueOnce(new Error('new policy unavailable'));
  await runtime.login('https://other.example');expect(useWorkspace.getState().policy).toBeNull();
  expect(fetchMock.mock.calls.some(([url])=>url==='https://other.example/api/auth/mobile/github/start')).toBe(true);
});

test('offline startup restores only this account and its visible conversation cache',async()=>{
  jest.mocked(cache.get).mockImplementation(key=>key.endsWith(':bootstrap')?bootstrap:key.endsWith(':drafts')?{c1:'allowed',removed:'private'}:key.endsWith(':messages:c1')?[parseMessage(message),{...parseMessage(message),conversationId:'removed'}]:null);
  fetchMock.mockRejectedValue(new Error('offline'));await runtime.start();
  expect(useWorkspace.getState().drafts).toEqual({c1:{text:'allowed',mentionIds:[]}});expect(useWorkspace.getState().messages.c1).toHaveLength(1);expect(useWorkspace.getState().messages.c1?.[0]?.plainText).toBe('old');
});
