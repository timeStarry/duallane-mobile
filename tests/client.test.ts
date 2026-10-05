import { z } from 'zod';
import { fetch } from 'expo/fetch';
import { ApiClient, ApiError, errorDiagnostic, errorText } from '../src/data/client';

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
  fetchMock.mockRejectedValueOnce(Object.assign(new Error('Exception in CronetUrlRequest: net::ERR_CONNECTION_RESET, ErrorCode=10, InternalErrorCode=-101'),{name:'IOException'}));
  await expect(client.json('/api/mobile/release-policy',z.unknown(),undefined,'GET',false)).rejects.toMatchObject({code:'request.network',diagnostic:'net.reset',status:0});
  fetchMock.mockRejectedValueOnce(Object.assign(new Error('Network request failed'),{name:'TypeError'}));
  await expect(client.json('/api/auth/mobile/github/start',z.object({authorizationUrl:z.string()}),{codeChallenge:'secret-challenge'},'POST',false)).rejects.toMatchObject({code:'request.network',diagnostic:'net.failed',status:0});
  expect(errorText(new ApiError('request.network',0,'net.failed'))).toBe('无法连接到服务器，请检查网络后重试（net.failed）');
  const logged=JSON.parse(String(warn.mock.calls.at(-1)?.[0]));
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

test.each([
  { nativeCode: 'ERR_TIMED_OUT', diagnostic: 'net.timeout' },
  { nativeCode: 'ERR_CONNECTION_TIMED_OUT', diagnostic: 'net.timeout' },
  { nativeCode: 'ERR_NAME_NOT_RESOLVED', diagnostic: 'net.dns' },
  { nativeCode: 'ERR_CONNECTION_RESET', diagnostic: 'net.reset' },
  { nativeCode: 'ERR_CONNECTION_REFUSED', diagnostic: 'net.refused' },
  { nativeCode: 'ERR_HTTP2_PROTOCOL_ERROR', diagnostic: 'net.http2' },
  { nativeCode: 'ERR_QUIC_PROTOCOL_ERROR', diagnostic: 'net.quic' },
  { nativeCode: 'ERR_QUIC_HANDSHAKE_FAILED', diagnostic: 'net.quic' },
  { nativeCode: 'ERR_SSL_PROTOCOL_ERROR', diagnostic: 'net.tls' },
  { nativeCode: 'ERR_CERT_AUTHORITY_INVALID', diagnostic: 'net.tls' },
  { nativeCode: 'ERR_CERT_DATE_INVALID', diagnostic: 'net.tls' },
])('Cronet $nativeCode has a fixed diagnostic without retrying or disclosing native details', async ({ nativeCode, diagnostic }) => {
  const privateDetail = 'synthetic-private-body';
  const nativeError = new Error(`fetch failed: java.io.IOException: java.util.concurrent.ExecutionException: Exception in CronetUrlRequest: net::${nativeCode}, InternalErrorCode=-7, URL=https://synthetic.example/private?token=synthetic-secret, Authorization=synthetic-secret, body=${privateDetail}`);
  fetchMock.mockRejectedValueOnce(nativeError);
  const client = new ApiClient('https://workspace.example', jest.fn(), jest.fn());
  client.session = session;
  const failure = await client.json('/api/workspace/messages', z.unknown(), { content: privateDetail }, 'POST').catch((error: unknown) => error);
  const code = diagnostic === 'net.timeout' ? 'request.timeout' : 'request.network';
  expect(failure).toMatchObject({ code, diagnostic, status: 0 });
  expect(errorText(failure)).toBe(`${diagnostic === 'net.timeout' ? '连接超时，请重试' : '无法连接到服务器，请检查网络后重试'}（${diagnostic}）`);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const logged = JSON.parse(String(jest.mocked(console.warn).mock.calls.at(-1)?.[0]));
  expect(logged).toMatchObject({ event: 'api_error', route: 'workspace', code, diagnostic, status: 0 });
  expect(Object.keys(logged).sort()).toEqual(['appVersion', 'code', 'diagnostic', 'event', 'ms', 'route', 'src', 'status', 'versionCode']);
  expect(JSON.stringify(logged)).not.toMatch(/synthetic-private-body|synthetic-secret|synthetic\.example|Authorization|InternalErrorCode|ExecutionException|\/messages|access-token-for-test/i);
});

test('explicit Cronet codes take precedence over generic wrapper words without treating a QUIC handshake as TLS', () => {
  expect(errorDiagnostic(new Error('Network error: net::ERR_NAME_NOT_RESOLVED'))).toBe('net.dns');
  expect(errorDiagnostic(new Error('Handshake failed: net::ERR_QUIC_HANDSHAKE_FAILED'))).toBe('net.quic');
  expect(errorDiagnostic(new Error('net::err_http2_protocol_error'))).toBe('net.http2');
  expect(errorDiagnostic(Object.assign(new Error('net::ERR_QUIC_PROTOCOL_ERROR'), { name: 'AbortError' }))).toBe('net.timeout');
});

test('unrecognized transport causes remain unknown and nested causes are not guessed', () => {
  expect(errorDiagnostic(new Error('net::ERR_UNRECOGNIZED_NATIVE_FAILURE'))).toBe('net.unknown');
  expect(errorDiagnostic(new Error('fetch failed', { cause: new Error('net::ERR_QUIC_PROTOCOL_ERROR') }))).toBe('net.unknown');
  expect(errorDiagnostic(new Error('java.io.IOException: java.util.concurrent.ExecutionException'))).toBe('net.unknown');
});

test('workflow conflict errors retain only the validated active ID, never raw server error details', async () => {
  const client = new ApiClient('https://workspace.example', jest.fn(), jest.fn()); client.session = session;
  fetchMock.mockResolvedValueOnce(response({ error: { code: 'workflow.active_conflict', message: 'synthetic-private-message', details: { activeWorkflowId: 'wf_synthetic-1', source: 'synthetic-private-content', token: 'synthetic-secret' } } }, 409));
  const failure = await client.json('/api/workspace/workflows', z.unknown(), {}, 'POST').catch((error: unknown) => error);
  expect(failure).toMatchObject({ code: 'workflow.active_conflict', status: 409, details: { activeWorkflowId: 'wf_synthetic-1' } });
  expect(Object.keys((failure as ApiError).details!)).toEqual(['activeWorkflowId']);
  expect(JSON.stringify(failure)).not.toMatch(/synthetic-private|synthetic-secret/);
  expect(String(jest.mocked(console.warn).mock.calls.at(-1)?.[0])).not.toMatch(/wf_synthetic|activeWorkflowId|synthetic-private|synthetic-secret/);
});

test.each([null, {}, { activeWorkflowId: 'https://synthetic.example/private?secret=x' }, { activeWorkflowId: 'x'.repeat(257) }, { activeWorkflowId: 123 }])('invalid workflow error metadata is discarded while preserving the HTTP code', async details => {
  const client = new ApiClient('https://workspace.example', jest.fn(), jest.fn()); client.session = session;
  fetchMock.mockResolvedValueOnce(response({ error: { code: 'workflow.active_conflict', details } }, 409));
  await expect(client.json('/api/workspace/workflows', z.unknown(), {}, 'POST')).rejects.toMatchObject({ code: 'workflow.active_conflict', details: undefined });
});
