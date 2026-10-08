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

test.each([
  ['image.selection_invalid', '请选择有效图片后重试'],
  ['image.too_many', '一次最多发送 9 张图片，请重新选择'],
  ['image.unavailable', '所选图片无法读取，请重新选择'],
])('local photo rejection %s explains how to recover', (code, text) => {
  expect(errorText(new ApiError(code, 0))).toBe(text);
});

test('concurrent requests share one token rotation and send the installed protocol headers',async()=>{
  const rotation=deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockImplementationOnce(()=>rotation.promise).mockResolvedValue(response({ok:true}));
  const persist=jest.fn().mockResolvedValue(undefined);
  const client=new ApiClient('https://workspace.example',persist,jest.fn());
  client.session={...session,accessTokenExpiresAt:'2000-01-01T00:00:00.000Z'};
  const a=client.json('/api/workspace/bootstrap',z.unknown()),b=client.json('/api/workspace/bootstrap',z.unknown());
  rotation.resolve(response(session));await Promise.all([a,b]);
  expect(fetchMock.mock.calls.filter(([url])=>typeof url==='string'&&url.endsWith('/refresh'))).toHaveLength(1);
  expect(persist).toHaveBeenCalledTimes(1);
  const request=fetchMock.mock.calls.find(([url])=>typeof url==='string'&&url.endsWith('/bootstrap'))?.[1];
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

test('the client deadline reports timeout even when native cancellation has a generic error',async()=>{
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementationOnce((_url,init)=>new Promise((_resolve,reject)=>{
      init?.signal?.addEventListener('abort',()=>reject(new Error('Native request cancelled')),{once:true});
    }));
    const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn());
    const result=expect(client.raw('/api/workspace/files/synthetic/download',{},false)).rejects.toMatchObject({code:'request.timeout',diagnostic:'net.timeout',status:0});
    await jest.advanceTimersByTimeAsync(30000);
    await result;
    const logged=JSON.parse(jest.mocked(console.warn).mock.calls.at(-1)?.[0] as string);
    expect(logged).toMatchObject({event:'api_error',route:'file_download_content',code:'request.timeout',diagnostic:'net.timeout',ms:30000});
    expect(logged).not.toHaveProperty('path');
  } finally { jest.useRealTimers(); }
});

test.each([
  ['/api/workspace/files/synthetic-object-secret/downloads/reserve','file_download_reserve'],
  ['/api/workspace/files/synthetic-object-secret/download?downloadId=synthetic-transfer-secret','file_download_content'],
])('download failure logs only the stage for %s',async(path,route)=>{
  fetchMock.mockRejectedValueOnce(new Error('Network request failed'));
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn());
  await expect(client.raw(path,{},false)).rejects.toMatchObject({diagnostic:'net.failed'});
  const logged=jest.mocked(console.warn).mock.calls.at(-1)?.[0] as string;
  expect(JSON.parse(logged)).toMatchObject({event:'api_error',route,diagnostic:'net.failed'});
  expect(logged).not.toContain('synthetic-object-secret');
  expect(logged).not.toContain('synthetic-transfer-secret');
  expect(logged).not.toContain('downloadId');
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

test('an already aborted caller scope never sends a request',async()=>{
  const scope=new AbortController();scope.abort();
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn());
  await expect(client.raw('/api/workspace/files/a/download',{signal:scope.signal},false)).rejects.toMatchObject({code:'request.cancelled',diagnostic:'net.cancelled'});
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each(['caller','invalidate'] as const)('a %s cancellation after headers reaches the original native fetch signal',async cause=>{
  const cancel=jest.fn();let nativeSignal:AbortSignal|null|undefined;
  fetchMock.mockImplementationOnce(async(_url,init)=>{
    nativeSignal=init?.signal;nativeSignal?.addEventListener('abort',cancel);
    return response({});
  });
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn()),scope=new AbortController();
  await client.raw('/api/workspace/files/a/download',{signal:scope.signal},false);
  expect(nativeSignal?.aborted).toBe(false);
  if(cause==='caller')scope.abort();else client.invalidate();
  expect(nativeSignal?.aborted).toBe(true);expect(cancel).toHaveBeenCalledTimes(1);
  scope.abort();client.invalidate();expect(cancel).toHaveBeenCalledTimes(1);
});

test('caller cancellation is distinct from the client deadline and stale generation',async()=>{
  jest.useFakeTimers();
  fetchMock.mockImplementationOnce((_url,init)=>new Promise((_resolve,reject)=>{
    init?.signal?.addEventListener('abort',()=>reject(new Error('Native request cancelled')));
  }));
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn()),scope=new AbortController();
  let settled=false;
  const failure=client.raw('/api/workspace/files/a/download',{signal:scope.signal},false).catch((error:unknown)=>{settled=true;return error;});
  try {
    scope.abort();await jest.advanceTimersByTimeAsync(0);expect(settled).toBe(true);
    expect(await failure).toMatchObject({code:'request.cancelled',diagnostic:'net.cancelled'});
    expect(String(jest.mocked(console.warn).mock.calls.at(-1)?.[0])).not.toContain('net.timeout');
  } finally { await jest.advanceTimersByTimeAsync(30001);await failure;jest.useRealTimers(); }
});

test('a 401 attempt is cancelled before rotation and retry retains the caller scope',async()=>{
  const firstCancel=jest.fn(),retryCancel=jest.fn();
  fetchMock.mockImplementationOnce(async(_url,init)=>{init?.signal?.addEventListener('abort',firstCancel);return response({},401);});
  fetchMock.mockImplementationOnce(async()=>{expect(firstCancel).toHaveBeenCalledTimes(1);return response(session);});
  fetchMock.mockImplementationOnce(async(_url,init)=>{init?.signal?.addEventListener('abort',retryCancel);return response({});});
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn()),scope=new AbortController();client.session=session;
  const release=client.bindAbortScope(scope);
  await client.raw('/api/workspace/files/a/download',{signal:scope.signal});
  expect(scope.signal.aborted).toBe(false);
  scope.abort();release();release();client.invalidate();expect(firstCancel).toHaveBeenCalledTimes(1);expect(retryCancel).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test.each(['caller','invalidate','unscoped-invalidate','deadline'] as const)('a blocked error body is bounded and cancels the native Call on %s',async cause=>{
  jest.useFakeTimers();const scope=new AbortController(),nativeCancel=jest.fn();
  let finish!:(value:unknown)=>void;
  const blocked=new Promise<unknown>(resolve=>{finish=resolve;});
  fetchMock.mockImplementationOnce(async(_url,init)=>{
    init?.signal?.addEventListener('abort',nativeCancel);
    return {...response({},403),json:()=>blocked} as Awaited<ReturnType<typeof fetch>>;
  });
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn());
  let settled=false;
  const pending=client.raw('/api/workspace/files/a/download',cause==='unscoped-invalidate'?{}:{signal:scope.signal},false).catch((error:unknown)=>{settled=true;return error;});
  try {
    await jest.advanceTimersByTimeAsync(0);
    if(cause==='caller')scope.abort();else if(cause==='invalidate'||cause==='unscoped-invalidate')client.invalidate();else await jest.advanceTimersByTimeAsync(30001);
    await jest.advanceTimersByTimeAsync(0);expect(settled).toBe(true);expect(nativeCancel).toHaveBeenCalledTimes(1);
    const error=await pending;
    if(cause==='invalidate'||cause==='unscoped-invalidate'){expect(error).toEqual(new Error('Stale session'));expect(console.warn).not.toHaveBeenCalled();}
    else expect(error).toMatchObject({code:cause==='deadline'?'request.timeout':'request.cancelled',diagnostic:cause==='deadline'?'net.timeout':'net.cancelled'});
  } finally { scope.abort();finish({});await jest.advanceTimersByTimeAsync(30001);await pending;jest.useRealTimers(); }
});

test.each(['invalidate','deadline'] as const)('ordinary JSON cancels and settles a blocked body on %s without relying on the SDK promise',async cause=>{
  jest.useFakeTimers();const nativeCancel=jest.fn();let finish!:(value:unknown)=>void;
  const blocked=new Promise<unknown>(resolve=>{finish=resolve;});let bodyStarted=false;
  fetchMock.mockImplementationOnce(async(_url,init)=>{
    init?.signal?.addEventListener('abort',nativeCancel);
    return {...response({}),json:()=>{bodyStarted=true;return blocked;}} as Awaited<ReturnType<typeof fetch>>;
  });
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn());client.session=session;
  let settled=false;
  const pending=client.json('/api/workspace/bootstrap',z.object({value:z.literal('synthetic')})).catch((error:unknown)=>{settled=true;return error;});
  try {
    await jest.advanceTimersByTimeAsync(0);expect(bodyStarted).toBe(true);
    if(cause==='invalidate')client.invalidate();else await jest.advanceTimersByTimeAsync(30001);
    await jest.advanceTimersByTimeAsync(0);expect(settled).toBe(true);expect(nativeCancel).toHaveBeenCalledTimes(1);
    const error=await pending;
    if(cause==='invalidate'){expect(error).toEqual(new Error('Stale session'));expect(console.warn).not.toHaveBeenCalled();}
    else expect(error).toMatchObject({code:'request.timeout',diagnostic:'net.timeout'});
  } finally { finish({value:'synthetic'});await pending;jest.useRealTimers(); }
});

test('openMedia invalidation preserves stale generation instead of logging a network failure',async()=>{
  const started=deferred<void>(),nativeCancel=jest.fn();
  fetchMock.mockImplementationOnce((_url,init)=>new Promise((_resolve,reject)=>{
    init?.signal?.addEventListener('abort',()=>{nativeCancel();reject(new Error('Native request cancelled'));});started.resolve();
  }));
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn()),scope=new AbortController();
  const pending=client.openMedia('/emotes/bili/doge.png',scope.signal);await started.promise;client.invalidate();
  await expect(pending).rejects.toEqual(new Error('Stale session'));expect(nativeCancel).toHaveBeenCalledTimes(1);expect(console.warn).not.toHaveBeenCalled();
});

test('a successful ordinary JSON body releases its native scope once and clears body timers',async()=>{
  jest.useFakeTimers();const nativeCancel=jest.fn();
  fetchMock.mockImplementationOnce(async(_url,init)=>{init?.signal?.addEventListener('abort',nativeCancel);return response({value:'synthetic'});});
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn());
  try {
    expect(await client.json('/api/mobile/release-policy',z.object({value:z.string()}),undefined,'GET',false)).toEqual({value:'synthetic'});
    expect(nativeCancel).toHaveBeenCalledTimes(1);await jest.advanceTimersByTimeAsync(30001);client.invalidate();
    expect(nativeCancel).toHaveBeenCalledTimes(1);expect(console.warn).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

test('caller scope registration cleans up idempotently after success, abort or pre-aborted input',()=>{
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn());
  const finished=new AbortController(),finishedAbort=jest.fn();finished.signal.addEventListener('abort',finishedAbort);
  const releaseFinished=client.bindAbortScope(finished);releaseFinished();releaseFinished();
  const active=new AbortController(),activeAbort=jest.fn();active.signal.addEventListener('abort',activeAbort);
  const releaseActive=client.bindAbortScope(active);client.invalidate();releaseActive();releaseActive();client.invalidate();
  expect(activeAbort).toHaveBeenCalledTimes(1);expect(finishedAbort).not.toHaveBeenCalled();
  const prior=new AbortController();prior.abort();const releasePrior=client.bindAbortScope(prior);releasePrior();releasePrior();client.invalidate();
});

test('JSON checks generation between a real raw header return and starting the consumer body',async()=>{
  jest.useFakeTimers();const nativeCancel=jest.fn();let finish!:(value:unknown)=>void;
  const blocked=new Promise<unknown>(resolve=>{finish=resolve;});const read=jest.fn(()=>blocked);
  fetchMock.mockImplementationOnce(async(_url,init)=>{init?.signal?.addEventListener('abort',nativeCancel);return {...response({}),json:read} as unknown as Awaited<ReturnType<typeof fetch>>;});
  const client=new ApiClient('https://workspace.example',jest.fn(),jest.fn());client.session=session;
  const actualRaw=client.raw.bind(client);
  jest.spyOn(client,'raw').mockImplementation(async(...args)=>{
    const res=await actualRaw(...args);client.invalidate();client.session={...session,accessToken:'synthetic-new-access'};return res;
  });
  let settled=false;
  const pending=client.json('/api/workspace/bootstrap',z.object({value:z.string()})).catch((error:unknown)=>{settled=true;return error;});
  try {
    await jest.advanceTimersByTimeAsync(0);expect(settled).toBe(true);
    expect(await pending).toEqual(new Error('Stale session'));expect(read).not.toHaveBeenCalled();expect(nativeCancel).toHaveBeenCalledTimes(1);expect(console.warn).not.toHaveBeenCalled();
  } finally {finish({value:'synthetic'});await pending;jest.useRealTimers();}
});
