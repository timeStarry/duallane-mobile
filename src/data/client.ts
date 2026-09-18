import { z } from 'zod';
import { sessionSchema, type Session } from '../domain/contracts';
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
  'request.network': '无法连接到服务器，请检查网络后重试',
  'response.invalid': '服务器返回了无法识别的数据',
};
const classified = new Set(['request.timeout', 'request.network', 'response.invalid', 'request.failed', 'mobile.not_configured']);

export class ApiError extends Error {
  diagnostic: string;
  constructor(public code: string, public status: number, diagnostic?: string) {
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
  if (name === 'AbortError' || lower.includes('aborted') || lower.includes('timed out') || lower.includes('timeout')) return 'net.timeout';
  if (/(ssl|tls|cert|handshake|trust anchor|certpath)/i.test(text)) return 'net.tls';
  if (lower.includes('cleartext')) return 'net.cleartext';
  if (lower.includes('enotfound') || lower.includes('unable to resolve') || lower.includes('unknown host')) return 'net.dns';
  if (lower.includes('econnrefused') || lower.includes('failed to connect') || lower.includes('connection refused')) return 'net.refused';
  if (lower.includes('econnreset') || lower.includes('connection reset') || lower.includes('connection was reset') || lower.includes('recv failure') || lower.includes('err_connection_reset') || lower.includes('net_error -101')) return 'net.reset';
  if (lower.includes('network request failed') || lower.includes('network error') || lower.includes('failed to fetch')) return 'net.failed';
  return 'net.unknown';
}

function routeKind(path: string): string {
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
  constructor(public origin: string, private persist: (session: Session) => Promise<void>, private expired: () => void, private allowed: () => boolean = () => true) {}
  invalidate() { this.generation++; this.session = null; for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
  async openMedia(url: string): Promise<Response> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new ApiError('response.invalid', 0, 'body.non_json'); }
    if (parsed.protocol !== 'https:') throw new ApiError('permission.denied', 403);
    const origin = new URL(this.origin);
    if (parsed.origin === origin.origin) {
      const path = `${parsed.pathname}${parsed.search}`;
      if (!path.startsWith('/api/')) throw new ApiError('permission.denied', 403);
      return this.raw(path, {}, true);
    }
    const headers = new Headers();
    headers.set('X-DualLane-Client', 'android');
    headers.set('X-DualLane-Client-Version', installed.appVersion);
    headers.set('X-DualLane-Protocol-Version', '1');
    const started = Date.now();
    try {
      const response = await fetch(parsed.toString(), { headers, credentials: 'omit', redirect: 'error' });
      if (!response.ok) {
        const wrapped = new ApiError('request.failed', response.status, `http.${response.status}`);
        logApiError('media', wrapped, Date.now() - started);
        throw wrapped;
      }
      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const wrapped = new ApiError(classifyTransport(error) === 'net.timeout' ? 'request.timeout' : 'request.network', 0, classifyTransport(error));
      logApiError('media', wrapped, Date.now() - started);
      throw wrapped;
    }
  }
  async raw(path: string, init: RequestInit = {}, authenticated = true, retry = true): Promise<Response> {
    if (!path.startsWith('/api/') && !path.startsWith('/ws/')) throw new Error('Invalid API path');
    const generation = this.generation;
    if (authenticated && (!this.allowed() || !this.session)) throw new ApiError('auth.required', 401);
    if (authenticated && this.session && Date.parse(this.session.accessTokenExpiresAt) < Date.now() + 15000) await this.refresh();
    if (generation !== this.generation) throw new Error('Stale session');
    if (authenticated && !this.allowed()) throw new Error('Session unavailable');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30000);
    this.controllers.add(controller);
    const headers = new Headers(init.headers); headers.set('X-DualLane-Client', 'android'); headers.set('X-DualLane-Client-Version', installed.appVersion); headers.set('X-DualLane-Protocol-Version', '1');
    if (authenticated && this.session) headers.set('Authorization', `Bearer ${this.session.accessToken}`);
    const started = Date.now();
    let response: Response;
    try {
      try {
        response = await fetch(`${this.origin}${path}`, { ...init, body: init.body ?? undefined, headers, signal: controller.signal, credentials: 'omit', redirect: 'error' });
      } catch (error) {
        if (generation !== this.generation) throw new Error('Stale session');
        const wrapped = new ApiError(classifyTransport(error) === 'net.timeout' ? 'request.timeout' : 'request.network', 0, classifyTransport(error));
        logApiError(path, wrapped, Date.now() - started);
        throw wrapped;
      }
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
    if (generation !== this.generation) throw new Error('Stale session');
    if (response.status === 401 && authenticated && retry && this.session) { await this.refresh(); return this.raw(path, init, authenticated, false); }
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(error);
      if (response.status === 401 && authenticated) { this.invalidate(); this.expired(); }
      const code = (response.status === 404 || response.status === 405) && isMobileSetup(path) ? 'mobile.not_configured' : parsed.success ? parsed.data.error.code : 'request.failed';
      const wrapped = new ApiError(code, response.status, `http.${response.status}`);
      logApiError(path, wrapped, Date.now() - started);
      throw wrapped;
    }
    return response;
  }
  async json<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, body?: unknown, method?: string, authenticated = true): Promise<T> {
    const generation = this.generation;
    const started = Date.now();
    const res = await this.raw(path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, authenticated);
    let payload: unknown;
    try { payload = await res.json(); }
    catch {
      if (generation !== this.generation) throw new Error('Stale session');
      const wrapped = new ApiError('response.invalid', res.status, 'body.non_json');
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
