import { AppState } from 'react-native';
import { fetch } from 'expo/fetch';
import { Runtime } from '../src/data/runtime';
import { fetchLatestGitHubRelease, GitHubReleaseError } from '../src/data/github-releases';
import { useWorkspace } from '../src/domain/store';
import { cache, credentials } from '../src/platform/storage';
import type { GitHubRelease } from '../src/domain/github-releases';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../src/data/github-releases', () => ({ ...jest.requireActual('../src/data/github-releases'), fetchLatestGitHubRelease: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(async () => ({ type:'cancel' })) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'fixture-uuid', digestStringAsync: async () => 'challenge', CryptoDigestAlgorithm:{SHA256:'SHA256'}, CryptoEncoding:{BASE64:'base64'} }));
jest.mock('../src/platform/config', () => ({ installed:{appVersion:'0.2.3',versionCode:36}, config:{apiOrigin:'https://workspace.example'}, redirectUri:'com.timestarry.duallane://oauth', validateOrigin:(s:string)=>s }));
jest.mock('../src/platform/storage', () => ({ cache:{get:jest.fn(),set:jest.fn(),remove:jest.fn(),clearAccount:jest.fn()}, credentials:{read:jest.fn(),save:jest.fn(async()=>undefined),clear:jest.fn(async()=>undefined)} }));
jest.mock('../src/platform/notifications', () => ({ clearNotifications:jest.fn(async()=>undefined),showMessageNotification:jest.fn() }));
jest.mock('../src/data/transfers', () => ({ clearAccountFiles:jest.fn() }));

const release:GitHubRelease={appVersion:'0.2.4',versionCode:42,runtimeVersion:'android-5',releaseId:'github-123',releaseNotes:['Synthetic update'],apkUrl:'https://github.com/timeStarry/duallane-mobile/releases/download/v0.2.4/app-release.apk',apkSha256:'a'.repeat(64),apkBytes:1234};
const policy={schemaVersion:1,platform:'android',channel:'internal',latest:{appVersion:'0.1.0',versionCode:1,releaseId:'old',releaseNotes:[]},minimum:{appVersion:'0.1.0',versionCode:1},recommendation:'none',apkUrl:null,protocol:{eventMajor:1,contentFormats:['duallane.message+json;v=1']}};
const session={accessToken:'fixture-access-token',refreshToken:'fixture-refresh-token',accessTokenExpiresAt:'2099-01-01T00:00:00Z',refreshTokenExpiresAt:'2099-02-01T00:00:00Z'};
const bootstrap={auth:{currentUser:{id:'u1',displayName:'Fixture'}},space:{id:'s1',name:'Fixture'},eventCursor:1,policy:{dailyQuotaBytes:100,remainingQuotaBytes:100,messageRetentionCount:50},permissions:{canReadConversations:true},members:[],conversations:[],files:[]};
const publicCheck=jest.mocked(fetchLatestGitHubRelease);
const fetchMock=jest.mocked(fetch);
const response=(body:unknown)=>({ok:true,status:200,json:async()=>body}) as Awaited<ReturnType<typeof fetch>>;
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
let runtime:Runtime;

beforeEach(()=>{
  jest.useFakeTimers();jest.spyOn(AppState,'addEventListener').mockReturnValue({remove:jest.fn()});
  useWorkspace.getState().reset();jest.mocked(cache.get).mockReturnValue(null);
  jest.mocked(credentials.read).mockResolvedValue({origin:'https://workspace.example',refreshToken:'fixture-refresh'});
  publicCheck.mockResolvedValue(release);
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    return response(path.endsWith('/release-policy')?policy:path.endsWith('/refresh')?session:path.endsWith('/start')?{authorizationUrl:`${new URL(path).origin}/api/auth/mobile/github/authorize`}:path.endsWith('/topics/mine')?{topics:[]}:path.endsWith('/me/emote-settings')?{settings:{clickImageEmoteToSend:false,replyAutoMention:false,autoHideMessages:false,autoHideMessageTypes:[]}}:bootstrap);
  });
  runtime=new Runtime();jest.spyOn(runtime,'connect').mockImplementation(()=>undefined);
});
afterEach(()=>{runtime.dispose();jest.restoreAllMocks();jest.useRealTimers();});

test('a slow public release check does not block credential restore or chat',async()=>{
  const pending=deferred<GitHubRelease>();publicCheck.mockReturnValueOnce(pending.promise);
  await runtime.start();expect(useWorkspace.getState().ready).toBe(true);expect(useWorkspace.getState().releaseCheck.status).toBe('checking');
  pending.resolve(release);await runtime.checkRelease();expect(useWorkspace.getState().release).toEqual(release);
  expect(useWorkspace.getState().policy?.latest.appVersion).toBe('0.1.0');
});

test('automatic requests are throttled, manual checks bypass the interval',async()=>{
  await runtime.start();await runtime.checkRelease();expect(publicCheck).toHaveBeenCalledTimes(1);
  await runtime.checkRelease();expect(publicCheck).toHaveBeenCalledTimes(1);
  await runtime.checkUpdates();expect(publicCheck).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(15*60*1000+1);await runtime.checkRelease();expect(publicCheck).toHaveBeenCalledTimes(3);
});

test('concurrent manual checks share the in-flight public request',async()=>{
  await runtime.start();const pending=deferred<GitHubRelease>();publicCheck.mockReturnValueOnce(pending.promise);
  const a=runtime.checkRelease(true),b=runtime.checkRelease(true);expect(a).toBe(b);expect(publicCheck).toHaveBeenCalledTimes(2);
  pending.resolve(release);await Promise.all([a,b]);expect(useWorkspace.getState().releaseCheck.status).toBe('checked');
});

test('public release failures preserve chat errors and do not claim current version',async()=>{
  await runtime.start();useWorkspace.setState({error:'Synthetic send failure'});
  publicCheck.mockRejectedValueOnce(new GitHubReleaseError('request.failed',403,'http.403'));
  await runtime.checkUpdates();expect(useWorkspace.getState().error).toBe('Synthetic send failure');
  expect(useWorkspace.getState().releaseCheck).toMatchObject({status:'failed',error:expect.stringContaining('http.403')});
  expect(useWorkspace.getState().ready).toBe(true);expect(runtime.forced()).toBe(false);
  await runtime.checkRelease();expect(publicCheck).toHaveBeenCalledTimes(2);
});

test('GitHub success cannot override a server minimum version or protocol gate',async()=>{
  await runtime.start();fetchMock.mockResolvedValue(response({...policy,latest:{...policy.latest,appVersion:'9.0.0',versionCode:999},minimum:{appVersion:'9.0.0',versionCode:999}}));
  await runtime.checkUpdates();expect(runtime.forced()).toBe(true);expect(useWorkspace.getState().release).toEqual(release);
  publicCheck.mockRejectedValueOnce(new Error('offline'));await runtime.checkUpdates();expect(runtime.forced()).toBe(true);
});

test('a failed policy refresh retains cached forced policy and its own error',async()=>{
  await runtime.start();const forced={...policy,latest:{...policy.latest,appVersion:'9.0.0',versionCode:999},minimum:{appVersion:'9.0.0',versionCode:999}};
  jest.mocked(cache.get).mockImplementation(key=>key==='policy:https://workspace.example'?forced:null);
  fetchMock.mockRejectedValue(new Error('offline'));jest.spyOn(console,'warn').mockImplementation(()=>undefined);
  await runtime.checkUpdates();expect(runtime.forced()).toBe(true);expect(useWorkspace.getState().policyError).toContain('服务兼容性');
});

test('only validated recent public cache can skip a network check',async()=>{
  jest.mocked(cache.get).mockImplementation(key=>key.startsWith('github-release:')?{release,checkedAt:Date.now()-1000}:null);
  await runtime.start();expect(publicCheck).not.toHaveBeenCalled();expect(useWorkspace.getState().release).toEqual(release);
  await runtime.checkUpdates();expect(publicCheck).toHaveBeenCalledTimes(1);
});

test('future-dated or foreign download cache is rejected',async()=>{
  jest.mocked(cache.get).mockImplementation(key=>key.startsWith('github-release:')?{release:{...release,apkUrl:'https://foreign.example/installer.apk'},checkedAt:Date.now()+1000}:null);
  await runtime.start();await runtime.checkRelease();expect(publicCheck).toHaveBeenCalledTimes(1);expect(useWorkspace.getState().release?.apkUrl).toBe(release.apkUrl);
});

test('logout aborts public fetch and discards late results and cache writes',async()=>{
  const pending=deferred<GitHubRelease>();publicCheck.mockReturnValueOnce(pending.promise);await runtime.start();
  const signal=publicCheck.mock.calls[0]?.[0];await runtime.logout(false);expect(signal?.aborted).toBe(true);
  jest.mocked(cache.set).mockClear();pending.resolve(release);await Promise.resolve();await Promise.resolve();
  expect(useWorkspace.getState().release).toBeNull();expect(cache.set).not.toHaveBeenCalled();
});

test('changing service cancels the old invocation without changing the new result',async()=>{
  const old=deferred<GitHubRelease>();publicCheck.mockReturnValueOnce(old.promise);await runtime.start();
  const signal=publicCheck.mock.calls[0]?.[0];publicCheck.mockResolvedValueOnce({...release,versionCode:43});
  await runtime.login('https://other.example');expect(signal?.aborted).toBe(true);
  old.resolve({...release,versionCode:44});await Promise.resolve();await Promise.resolve();
  expect(useWorkspace.getState().release?.versionCode).toBe(43);
});

test('dispose cancels requests and repeated Strict Mode start can check again',async()=>{
  const old=deferred<GitHubRelease>();publicCheck.mockReturnValueOnce(old.promise);await runtime.start();
  runtime.dispose();expect(publicCheck.mock.calls[0]?.[0]?.aborted).toBe(true);
  await runtime.start();await runtime.checkRelease();old.resolve({...release,versionCode:44});await Promise.resolve();
  expect(useWorkspace.getState().release?.versionCode).toBe(42);
});
