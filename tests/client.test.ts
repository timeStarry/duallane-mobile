import { z } from 'zod';
import { fetch } from 'expo/fetch';
import { ApiClient, ApiError, errorText } from '../src/data/client';

jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.2.3',versionCode:4}}));
const fetchMock=jest.mocked(fetch);
const session={accessToken:'access-token-for-test',refreshToken:'refresh-token-for-test',accessTokenExpiresAt:'2099-01-01T00:00:00.000Z',refreshTokenExpiresAt:'2099-02-01T00:00:00.000Z'};
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function response(body:unknown,status=200){return {ok:status<400,status,json:async()=>body} as Awaited<ReturnType<typeof fetch>>;}
beforeEach(()=>{jest.spyOn(console,'warn').mockImplementation(()=>undefined);});
afterEach(()=>{jest.restoreAllMocks();});

test('concurrent requests share one token rotation and send the installed protocol headers',async()=>{
  const rotation=deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockImplementationOnce(()=>rotation.promise).mockResolvedValue(response({ok:true}));
  const persist=jest.fn().mockResolvedValue(undefined);
  const client=new ApiClient('https://workspace.example',persist,jest.fn());
  client.session={...session,accessTokenExpiresAt:'2000-01-01T00:00:00.000Z'};
  const a=client.json('/api/workspace/bootstrap',z.unknown()),b=client.json('/api/workspace/bootstrap',z.unknown());
  rotation.resolve(response(session));await Promise.all([a,b]);
  expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/refresh'))).toHaveLength(1);
  expect(persist).toHaveBeenCalledTimes(1);
  const request=fetchMock.mock.calls.find(([url])=>url.endsWith('/bootstrap'))?.[1];
  expect(new Headers(request?.headers).get('Authorization')).toBe(`Bearer ${session.accessToken}`);
  expect(new Headers(request?.headers).get('X-DualLane-Client-Version')).toBe('0.2.3');
  expect(new Headers(request?.headers).get('X-DualLane-Protocol-Version')).toBe('1');
  expect(request).toMatchObject({credentials:'omit',redirect:'error'});
});

test('logout during native token persistence cannot resurrect a session',async()=>{
  fetchMock.mockResolvedValue(response(session));
  const writing=deferred<void>(),started=deferred<void>();
  const client=new ApiClient('https://workspace.example',()=>{started.resolve();return writing.promise;},jest.fn());
  client.session=session;
  const refreshing=client.refresh();await started.promise;client.invalidate();writing.resolve();
  await expect(refreshing).rejects.toThrow('Stale session');expect(client.session).toBeNull();
});

test('late JSON bodies cannot write into the next account',async()=>{
  const body=deferred<unknown>(),reading=deferred<void>();
  fetchMock.mockResolvedValue({...response(null),json:()=>{reading.resolve();return body.promise;}} as Awaited<ReturnType<typeof fetch>>);
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn());client.session=session;
  const request=client.json('/api/workspace/files',z.unknown());await reading.promise;client.invalidate();body.resolve({files:[]});
  await expect(request).rejects.toThrow('Stale session');
});

test('forced update gate blocks authenticated requests before network access',async()=>{
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn(),()=>false);client.session=session;
  await expect(client.raw('/api/workspace/files')).rejects.toMatchObject({status:401});
  expect(fetchMock).not.toHaveBeenCalled();
});

test('transient refresh errors preserve credentials; invalid refresh expires once',async()=>{
  const expired=jest.fn();const client=new ApiClient('https://workspace.example',jest.fn(),expired);client.session=session;
  fetchMock.mockResolvedValueOnce(response({error:{code:'internal.error'}},500));
  await expect(client.refresh()).rejects.toMatchObject({status:500});expect(client.session).toEqual(session);expect(expired).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(response({error:{code:'auth.mobile_invalid'}},401));
  await expect(client.refresh()).rejects.toMatchObject({status:401});expect(client.session).toBeNull();expect(expired).toHaveBeenCalledTimes(1);
});

test('transport failures become classified network errors and never log secrets',async()=>{
  const warn=jest.spyOn(console,'warn').mockImplementation(()=>undefined);
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn());
  fetchMock.mockRejectedValueOnce(Object.assign(new Error('Network request failed'),{name:'TypeError'}));
  await expect(client.json('/api/auth/mobile/github/start',z.object({authorizationUrl:z.string()}),{codeChallenge:'secret-challenge'},'POST',false)).rejects.toMatchObject({code:'request.network',diagnostic:'net.failed',status:0});
  expect(errorText(new ApiError('request.network',0,'net.failed'))).toBe('无法连接到服务器，请检查网络后重试（net.failed）');
  const logged=JSON.parse(String(warn.mock.calls[0]?.[0]));
  expect(logged).toMatchObject({src:'duallane',event:'api_error',route:'github_start',code:'request.network',diagnostic:'net.failed',status:0,appVersion:'0.2.3',versionCode:4});
  expect(JSON.stringify(logged)).not.toMatch(/secret-challenge|workspace\.example|Authorization|refresh/i);
  warn.mockRestore();
});

test('timeouts, missing mobile routes and non-JSON bodies stay distinct from a generic network failure',async()=>{
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn());
  fetchMock.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted.'),{name:'AbortError'}));
  await expect(client.json('/api/mobile/release-policy',z.unknown(),undefined,'GET',false)).rejects.toMatchObject({code:'request.timeout',diagnostic:'net.timeout'});
  fetchMock.mockResolvedValueOnce(response('<html>not found</html>',404));
  await expect(client.json('/api/auth/mobile/github/start',z.object({authorizationUrl:z.string()}),{}, 'POST',false)).rejects.toMatchObject({code:'mobile.not_configured',diagnostic:'http.404',status:404});
  expect(errorText(new ApiError('mobile.not_configured',404,'http.404'))).toBe('服务器尚未开放 Android 登录（http.404）');
  fetchMock.mockResolvedValueOnce({...response({}),json:async():Promise<unknown>=>{throw new SyntaxError('Unexpected token <');}} as unknown as Awaited<ReturnType<typeof fetch>>);
  await expect(client.json('/api/mobile/release-policy',z.object({schemaVersion:z.literal(1)}),undefined,'GET',false)).rejects.toMatchObject({code:'response.invalid',diagnostic:'body.non_json'});
  fetchMock.mockResolvedValueOnce(response({schemaVersion:2}));
  await expect(client.json('/api/mobile/release-policy',z.object({schemaVersion:z.literal(1)}),undefined,'GET',false)).rejects.toMatchObject({code:'response.invalid',diagnostic:'body.schema'});
});
