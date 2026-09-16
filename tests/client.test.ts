import { z } from 'zod';
import { fetch } from 'expo/fetch';
import { ApiClient } from '../src/data/client';

jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.2.3',versionCode:4}}));
const fetchMock=jest.mocked(fetch);
const session={accessToken:'access-token-for-test',refreshToken:'refresh-token-for-test',accessTokenExpiresAt:'2099-01-01T00:00:00.000Z',refreshTokenExpiresAt:'2099-02-01T00:00:00.000Z'};
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function response(body:unknown,status=200){return {ok:status<400,status,json:async()=>body} as Awaited<ReturnType<typeof fetch>>;}

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
