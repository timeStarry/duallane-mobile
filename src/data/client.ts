import { z } from 'zod';
import { sessionSchema, type Session } from '../domain/contracts';
import { installed } from '../platform/config';
import { fetch } from 'expo/fetch';
export class ApiError extends Error { constructor(public code:string, public status:number) { super(code); } }
export function errorText(error:unknown):string {
  if(error instanceof ApiError) return ({'auth.required':'请重新登录','auth.not_invited':'此账号尚未加入共享空间','workspace.disabled':'共享空间暂未开放','quota.insufficient':'今日传输额度不足','permission.denied':'你当前不能执行此操作','conversation.not_found':'你无法访问此会话','message.idempotency_conflict':'消息内容已变化，请重新发送','mobile.not_configured':'服务器尚未开放 Android 登录'} as Record<string,string>)[error.code] ?? '操作未完成，请重试';
  return '连接或数据暂时不可用，请重试';
}
export class ApiClient {
  session:Session|null=null;
  private refreshTask:Promise<void>|null=null;
  private generation=0;
  private controllers=new Set<AbortController>();
  constructor(public origin:string,private persist:(session:Session)=>Promise<void>,private expired:()=>void,private allowed:()=>boolean=()=>true) {}
  invalidate() {this.generation++;this.session=null;for(const controller of this.controllers)controller.abort();this.controllers.clear();}
  async raw(path:string,init:RequestInit={},authenticated=true,retry=true):Promise<Response> {
    if(!path.startsWith('/api/')&&!path.startsWith('/ws/')) throw new Error('Invalid API path');
    const generation=this.generation;
    if(authenticated&&(!this.allowed()||!this.session))throw new ApiError('auth.required',401);
    if(authenticated && this.session && Date.parse(this.session.accessTokenExpiresAt)<Date.now()+15000) await this.refresh();
    if(generation!==this.generation)throw new Error('Stale session');
    if(authenticated&&!this.allowed())throw new Error('Session unavailable');
    const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),30000);
    this.controllers.add(controller);
    const headers=new Headers(init.headers);headers.set('X-DualLane-Client','android');headers.set('X-DualLane-Client-Version',installed.appVersion);headers.set('X-DualLane-Protocol-Version','1');
    if(authenticated&&this.session)headers.set('Authorization',`Bearer ${this.session.accessToken}`);
    let response:Response;
    try {response=await fetch(`${this.origin}${path}`,{...init,body:init.body??undefined,headers,signal:controller.signal,credentials:'omit',redirect:'error'});}finally{clearTimeout(timeout);this.controllers.delete(controller);}
    if(generation!==this.generation) throw new Error('Stale session');
    if(response.status===401&&authenticated&&retry&&this.session) {await this.refresh();return this.raw(path,init,authenticated,false);}
    if(!response.ok){const error=await response.json().catch(()=>null);const parsed=z.object({error:z.object({code:z.string()})}).safeParse(error);if(response.status===401&&authenticated){this.invalidate();this.expired();}throw new ApiError(parsed.success?parsed.data.error.code:'request.failed',response.status);}
    return response;
  }
  async json<T>(path:string,schema:z.ZodType<T,z.ZodTypeDef,unknown>,body?:unknown,method?:string,authenticated=true):Promise<T>{
    const generation=this.generation;
    const res=await this.raw(path,{method:method??(body===undefined?'GET':'POST'),headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},authenticated);
    const result=schema.parse(await res.json());if(generation!==this.generation)throw new Error('Stale session');if(authenticated&&!this.allowed())throw new Error('Session unavailable');return result;
  }
  async refresh():Promise<void>{
    if(this.refreshTask)return this.refreshTask;
    const generation=this.generation, token=this.session?.refreshToken;
    if(!this.allowed())throw new ApiError('auth.required',401);
    if(!token)throw new ApiError('auth.required',401);
    this.refreshTask=(async()=>{
      try {const session=await this.json('/api/auth/mobile/refresh',sessionSchema,{refreshToken:token},'POST',false);
        if(generation!==this.generation)throw new Error('Stale session');
        // Persist rotated token before exposing it to another request.
        await this.persist(session);if(generation!==this.generation)throw new Error('Stale session');this.session=session;
      }catch(error){if(error instanceof ApiError&&error.status===401){this.invalidate();this.expired();}throw error;}
    })().finally(()=>{this.refreshTask=null;});
    return this.refreshTask;
  }
}
