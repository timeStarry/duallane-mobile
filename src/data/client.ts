import { z } from 'zod';
import { sessionSchema, type Session } from '../domain/contracts';
import { isAllowedSameOriginMediaPath } from '../domain/media-path';
import { installed } from '../platform/config';
import { fetch } from 'expo/fetch';

const messages: Record<string, string> = {
  'auth.required': '请重新登录',
  'auth.not_invited': '此账号尚未加入共享空间',
  'workspace.disabled': '共享空间暂未开放',
  'quota.insufficient': '今日传输额度不足',
  'permission.denied': '你当前不能执行此操作',
  'conversation.not_found': '你无法访问此会话',
  'message.idempotency_conflict': '消息内容已变化，请重新发送',
  'mobile.not_configured': '服务器尚未开放 Android 登录',
  'request.timeout': '连接超时，请重试',
  'request.cancelled': '操作已取消',
  'request.network': '无法连接到服务器，请检查网络后重试',
  'response.invalid': '服务器返回了无法识别的数据',
};
const classified = new Set(['request.timeout', 'request.network', 'response.invalid', 'request.failed', 'mobile.not_configured']);

export class ApiError extends Error {
  diagnostic: string;
  constructor(public code: string, public status: number, diagnostic?: string, public details?: { activeWorkflowId: string }) {
    super(code);
    this.diagnostic = diagnostic ?? code;
  }
}

export function errorDiagnostic(error: unknown): string {
  if (error instanceof ApiError) return error.diagnostic;
  return classifyTransport(error);
}

export function errorText(error: unknown): string {
  const message = error instanceof ApiError ? (messages[error.code] ?? '操作未完成，请重试') : messages[classifyTransport(error) === 'net.timeout' ? 'request.timeout' : 'request.network'] ?? '无法连接到服务器，请检查网络后重试';
  const code = errorDiagnostic(error);
  return error instanceof ApiError && !classified.has(error.code) ? message : `${message}（${code}）`;
}

function classifyTransport(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const text = error instanceof Error ? error.message : String(error ?? '');
  const lower = text.toLowerCase();
  if (name === 'AbortError') return 'net.timeout';
  // Prefer Cronet's explicit code over incidental wrapper text, such as a QUIC handshake.
  const cronetCode = text.match(/\bnet::(ERR_[A-Z0-9_]+)\b/i)?.[1]?.toUpperCase();
  switch (cronetCode) {
    case 'ERR_TIMED_OUT':
    case 'ERR_CONNECTION_TIMED_OUT': return 'net.timeout';
    case 'ERR_NAME_NOT_RESOLVED': return 'net.dns';
    case 'ERR_CONNECTION_RESET': return 'net.reset';
    case 'ERR_CONNECTION_REFUSED': return 'net.refused';
    case 'ERR_HTTP2_PROTOCOL_ERROR': return 'net.http2';
    case 'ERR_QUIC_PROTOCOL_ERROR':
    case 'ERR_QUIC_HANDSHAKE_FAILED': return 'net.quic';
  }
  if (cronetCode?.startsWith('ERR_SSL_') || cronetCode?.startsWith('ERR_CERT_')) return 'net.tls';
  if (lower.includes('aborted') || lower.includes('timed out') || lower.includes('timeout')) return 'net.timeout';
  if (/(ssl|tls|cert|handshake|trust anchor|certpath)/i.test(text)) return 'net.tls';
  if (lower.includes('cleartext')) return 'net.cleartext';
  if (lower.includes('enotfound') || lower.includes('unable to resolve') || lower.includes('unknown host')) return 'net.dns';
  if (lower.includes('econnrefused') || lower.includes('failed to connect') || lower.includes('connection refused')) return 'net.refused';
  if (lower.includes('econnreset') || lower.includes('connection reset') || lower.includes('connection was reset') || lower.includes('recv failure') || lower.includes('err_connection_reset') || lower.includes('net_error -101')) return 'net.reset';
  if (lower.includes('network request failed') || lower.includes('network error') || lower.includes('failed to fetch')) return 'net.failed';
  return 'net.unknown';
}

function routeKind(path: string): string {
  const pathname = path.split('?')[0] ?? '';
  if (/^\/api\/workspace\/files\/[^/]+\/downloads\/reserve$/.test(pathname)) return 'file_download_reserve';
  if (/^\/api\/workspace\/files\/[^/]+\/download$/.test(pathname)) return 'file_download_content';
  if (path.startsWith('/api/mobile/release-policy')) return 'release_policy';
  if (path.startsWith('/api/auth/mobile/github/start')) return 'github_start';
  if (path.startsWith('/api/auth/mobile/github/exchange')) return 'github_exchange';
  if (path.startsWith('/api/auth/mobile/refresh')) return 'mobile_refresh';
  if (path.startsWith('/api/auth/mobile/logout')) return 'mobile_logout';
  if (path.startsWith('/api/workspace/bootstrap')) return 'bootstrap';
  if (path.startsWith('/api/workspace/')) return 'workspace';
  if (path.startsWith('/api/auth/mobile/')) return 'mobile_auth';
  if (path.startsWith('/api/')) return 'api';
  if (path === 'media') return 'media';
  return 'unknown';
}

function isMobileSetup(path: string): boolean {
  return path.startsWith('/api/mobile/release-policy') || path.startsWith('/api/auth/mobile/github/');
}

export function logApiError(path: string, error: ApiError, ms: number): void {
  console.warn(JSON.stringify({
    src: 'duallane',
    event: 'api_error',
    route: routeKind(path),
    code: error.code,
    diagnostic: error.diagnostic,
    status: error.status,
    ms,
    appVersion: installed.appVersion,
    versionCode: installed.versionCode,
  }));
}

export class ApiClient {
  session: Session | null = null;
  private refreshTask: Promise<void> | null = null;
  private generation = 0;
  private controllers = new Set<AbortController>();
  private responseScopes = new WeakMap<Response, { abort: () => void; signal: AbortSignal }>();
  constructor(public origin: string, private persist: (session: Session) => Promise<void>, private expired: () => void, private allowed: () => boolean = () => true) {}
  invalidate() { this.generation++; this.session = null; for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
  bindAbortScope(controller: AbortController): () => void {
    const release = () => { this.controllers.delete(controller); controller.signal.removeEventListener('abort', release); };
    if (!controller.signal.aborted) {
      this.controllers.add(controller);
      controller.signal.addEventListener('abort', release, { once: true });
    }
    return release;
  }
  async openMedia(url: string, signal?: AbortSignal): Promise<Response> {
    const generation = this.generation;
    let parsed: URL;
    try { parsed = new URL(url.startsWith('/') ? `${this.origin}${url}` : url); } catch { throw new ApiError('response.invalid', 0, 'body.non_json'); }
    if (parsed.protocol !== 'https:') throw new ApiError('permission.denied', 403);
    const origin = new URL(this.origin);
    if (parsed.origin === origin.origin) {
      const path = `${parsed.pathname}${parsed.search}`;
      if (path.startsWith('/api/')) return this.raw(path, { signal }, true);
      if (!isAllowedSameOriginMediaPath(path)) throw new ApiError('permission.denied', 403);
      const headers = new Headers();
      headers.set('X-DualLane-Client', 'android');
      headers.set('X-DualLane-Client-Version', installed.appVersion);
      headers.set('X-DualLane-Protocol-Version', '1');
      if (this.session) headers.set('Authorization', `Bearer ${this.session.accessToken}`);
      const started = Date.now();
      try {
        const response = await this.fetchResponse(`${this.origin}${path}`, { headers, signal }, 'media');
        if (!response.ok) {
          this.releaseResponse(response);
          const wrapped = new ApiError('request.failed', response.status, `http.${response.status}`);
          logApiError('media', wrapped, Date.now() - started);
          throw wrapped;
        }
        if (!signal) this.responseScopes.delete(response);
        return response;
      } catch (error) {
        if (generation !== this.generation) throw new Error('Stale session');
        if (error instanceof ApiError) throw error;
        const wrapped = new ApiError(classifyTransport(error) === 'net.timeout' ? 'request.timeout' : 'request.network', 0, classifyTransport(error));
        logApiError('media', wrapped, Date.now() - started);
        throw wrapped;
      }
    }
    const headers = new Headers();
    headers.set('X-DualLane-Client', 'android');
    headers.set('X-DualLane-Client-Version', installed.appVersion);
    headers.set('X-DualLane-Protocol-Version', '1');
    const started = Date.now();
    try {
      const response = await this.fetchResponse(parsed.toString(), { headers, signal }, 'media');
      if (!response.ok) {
        this.releaseResponse(response);
        const wrapped = new ApiError('request.failed', response.status, `http.${response.status}`);
        logApiError('media', wrapped, Date.now() - started);
        throw wrapped;
      }
      if (!signal) this.responseScopes.delete(response);
      return response;
    } catch (error) {
      if (generation !== this.generation) throw new Error('Stale session');
      if (error instanceof ApiError) throw error;
      const wrapped = new ApiError(classifyTransport(error) === 'net.timeout' ? 'request.timeout' : 'request.network', 0, classifyTransport(error));
      logApiError('media', wrapped, Date.now() - started);
      throw wrapped;
    }
  }
  private releaseResponse(response: Response) {
    this.responseScopes.get(response)?.abort();
    this.responseScopes.delete(response);
  }
  private async readResponseBody<T>(response: Response, read: () => Promise<T>): Promise<T> {
    const scope = this.responseScopes.get(response);
    let reject!: (error: ApiError) => void;
    const interrupted = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise; });
    const cancel = () => reject(new ApiError('request.cancelled', 0, 'net.cancelled'));
    scope?.signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(() => {
      reject(new ApiError('request.timeout', 0, 'net.timeout'));
      this.releaseResponse(response);
    }, 30000);
    try {
      if (scope?.signal.aborted) throw new ApiError('request.cancelled', 0, 'net.cancelled');
      return await Promise.race([read(), interrupted]);
    } finally {
      clearTimeout(timeout); scope?.signal.removeEventListener('abort', cancel); this.releaseResponse(response);
    }
  }
  private async fetchResponse(url: string, init: RequestInit, path: string): Promise<Response> {
    const generation = this.generation;
    if (init.signal?.aborted) throw new ApiError('request.cancelled', 0, 'net.cancelled');
    const controller = new AbortController();
    let deadlineFired = false, response: Response | undefined;
    const forwardAbort = () => controller.abort();
    const cleanup = () => {
      init.signal?.removeEventListener('abort', forwardAbort);
      controller.signal.removeEventListener('abort', cleanup);
      this.controllers.delete(controller);
      if (response) this.responseScopes.delete(response);
    };
    this.controllers.add(controller);
    controller.signal.addEventListener('abort', cleanup, { once: true });
    init.signal?.addEventListener('abort', forwardAbort, { once: true });
    const timeout = setTimeout(() => { deadlineFired = true; controller.abort(); }, 30000);
    const started = Date.now();
    try {
      response = await fetch(url, { ...init, body: init.body ?? undefined, signal: controller.signal, credentials: 'omit', redirect: 'error' });
      if (generation !== this.generation) throw new Error('Stale session');
      if (deadlineFired) throw new ApiError('request.timeout', 0, 'net.timeout');
      if (init.signal?.aborted) throw new ApiError('request.cancelled', 0, 'net.cancelled');
      // An explicit caller scope owns the response body until its finally aborts.
      // Only successful unscoped callers retain the headers-only lifetime;
      // an error body still needs invalidation and a bounded read.
      if (!init.signal && response.ok) cleanup();
      this.responseScopes.set(response, { abort: forwardAbort, signal: controller.signal });
      return response;
    } catch (error) {
      controller.abort();
      if (generation !== this.generation) throw new Error('Stale session');
      const diagnostic = deadlineFired ? 'net.timeout' : init.signal?.aborted ? 'net.cancelled' : classifyTransport(error);
      const code = diagnostic === 'net.timeout' ? 'request.timeout' : diagnostic === 'net.cancelled' ? 'request.cancelled' : 'request.network';
      const wrapped = new ApiError(code, 0, diagnostic);
      logApiError(path, wrapped, Date.now() - started);
      throw wrapped;
    } finally { clearTimeout(timeout); }
  }
  async raw(path: string, init: RequestInit = {}, authenticated = true, retry = true): Promise<Response> {
    if (!path.startsWith('/api/') && !path.startsWith('/ws/')) throw new Error('Invalid API path');
    const generation = this.generation;
    if (init.signal?.aborted) throw new ApiError('request.cancelled', 0, 'net.cancelled');
    if (authenticated && (!this.allowed() || !this.session)) throw new ApiError('auth.required', 401);
    if (authenticated && this.session && Date.parse(this.session.accessTokenExpiresAt) < Date.now() + 15000) await this.refresh();
    if (generation !== this.generation) throw new Error('Stale session');
    if (authenticated && !this.allowed()) throw new Error('Session unavailable');
    if (init.signal?.aborted) throw new ApiError('request.cancelled', 0, 'net.cancelled');
    const headers = new Headers(init.headers); headers.set('X-DualLane-Client', 'android'); headers.set('X-DualLane-Client-Version', installed.appVersion); headers.set('X-DualLane-Protocol-Version', '1');
    if (authenticated && this.session) headers.set('Authorization', `Bearer ${this.session.accessToken}`);
    const started = Date.now();
    const response = await this.fetchResponse(`${this.origin}${path}`, { ...init, headers }, path);
    if (generation !== this.generation) throw new Error('Stale session');
    if (response.status === 401 && authenticated && retry && this.session) { this.releaseResponse(response); await this.refresh(); return this.raw(path, init, authenticated, false); }
    if (!response.ok) {
      let error: unknown;
      try { error = await this.readResponseBody(response, () => response.json()); }
      catch (failure) {
        if (generation !== this.generation) throw new Error('Stale session');
        if (failure instanceof ApiError) { logApiError(path, failure, Date.now() - started); throw failure; }
        error = null;
      }
      if (generation !== this.generation) throw new Error('Stale session');
      if (init.signal?.aborted) throw new ApiError('request.cancelled', 0, 'net.cancelled');
      const parsed = z.object({ error: z.object({ code: z.string(), details: z.unknown().optional() }) }).safeParse(error);
      const details = z.object({ activeWorkflowId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/) }).safeParse(parsed.success ? parsed.data.error.details : undefined);
      if (response.status === 401 && authenticated) { this.invalidate(); this.expired(); }
      const code = (response.status === 404 || response.status === 405) && isMobileSetup(path) ? 'mobile.not_configured' : parsed.success ? parsed.data.error.code : 'request.failed';
      const wrapped = new ApiError(code, response.status, `http.${response.status}`, details.success ? details.data : undefined);
      logApiError(path, wrapped, Date.now() - started);
      throw wrapped;
    }
    if (!init.signal) this.responseScopes.delete(response);
    return response;
  }
  async json<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, body?: unknown, method?: string, authenticated = true): Promise<T> {
    const generation = this.generation;
    const started = Date.now();
    const controller = new AbortController();
    try {
      const res = await this.raw(path, { signal: controller.signal, method: method ?? (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, authenticated);
      if (generation !== this.generation) throw new Error('Stale session');
      let payload: unknown;
      try { payload = await this.readResponseBody(res, () => res.json()); }
      catch (error) {
        if (generation !== this.generation) throw new Error('Stale session');
        const wrapped = error instanceof ApiError ? error : new ApiError('response.invalid', res.status, 'body.non_json');
        logApiError(path, wrapped, Date.now() - started);
        throw wrapped;
      }
      try {
        const result = schema.parse(payload);
        if (generation !== this.generation) throw new Error('Stale session');
        if (authenticated && !this.allowed()) throw new Error('Session unavailable');
        return result;
      } catch (error) {
        if (generation !== this.generation) throw new Error('Stale session');
        if (error instanceof z.ZodError) {
          const wrapped = new ApiError('response.invalid', res.status, 'body.schema');
          logApiError(path, wrapped, Date.now() - started);
          throw wrapped;
        }
        throw error;
      }
    } finally { controller.abort(); }
  }
  async refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    const generation = this.generation, token = this.session?.refreshToken;
    if (!this.allowed()) throw new ApiError('auth.required', 401);
    if (!token) throw new ApiError('auth.required', 401);
    this.refreshTask = (async () => {
      try {
        const session = await this.json('/api/auth/mobile/refresh', sessionSchema, { refreshToken: token }, 'POST', false);
        if (generation !== this.generation) throw new Error('Stale session');
        // Persist rotated token before exposing it to another request.
        await this.persist(session); if (generation !== this.generation) throw new Error('Stale session'); this.session = session;
      } catch (error) { if (error instanceof ApiError && error.status === 401) { this.invalidate(); this.expired(); } throw error; }
    })().finally(() => { this.refreshTask = null; });
    return this.refreshTask;
  }
}
