import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { z } from 'zod';
import { ApiClient, ApiError, errorText } from './client';
import { bootstrapSchema, conversationSchema, sessionSchema, parseMessage, type Session, type Message, type WorkspaceEvent } from '../domain/contracts';
import { useWorkspace } from '../domain/store';
import { releaseSchema, updateDecision } from '../domain/updates';
import { ReplayTracker } from '../domain/replay';
import { shouldNotify } from '../domain/notifications';
import { cache, credentials } from '../platform/storage';
import { config, installed, redirectUri, validateOrigin } from '../platform/config';
import { clearNotifications, showMessageNotification } from '../platform/notifications';

const NativeWebSocket: new (url:string, protocols?:string[], options?:{headers:Record<string,string>}) => WebSocket = WebSocket;
export class Runtime {
  api:ApiClient|null=null;
  private epoch=0;
  private socket:WebSocket|null=null;
  private retry:ReturnType<typeof setTimeout>|null=null;
  private heartbeat:ReturnType<typeof setInterval>|null=null;
  private refreshTimer:ReturnType<typeof setTimeout>|null=null;
  private attempts=0;
  private inFlight=new Set<string>();
  private notified=new Set<string>();
  private queue:Promise<void>=Promise.resolve();
  private syncing:Promise<void>|null=null;
  private foreground=true;
  private stopAppState:(()=>void)|null=null;
  constructor(){const sub=AppState.addEventListener('change',state=>{const previous=this.foreground;this.foreground=state==='active';if(this.foreground&&!previous)void this.resume();});this.stopAppState=()=>sub.remove();}
  private current(epoch:number){return epoch===this.epoch;}
  private requireApi(){if(!this.api)throw new ApiError('auth.required',401);return this.api;}
  private persist=async(session:Session)=>{if(!this.api)return;const existing=await credentials.read();await credentials.save({origin:this.api.origin,refreshToken:session.refreshToken,userId:existing?.origin===this.api.origin?existing.userId:undefined});};
  async start(){
    useWorkspace.setState({busy:true});
    try{const saved=await credentials.read();if(saved){this.api=new ApiClient(saved.origin,this.persist,()=>void this.logout(false));
      await this.checkPolicy();if(this.forced())return;
      this.api.session={accessToken:'expired-session-placeholder',refreshToken:saved.refreshToken,accessTokenExpiresAt:new Date(0).toISOString(),refreshTokenExpiresAt:new Date(0).toISOString()};
      try{await this.api.refresh();await this.bootstrap();this.connect();}catch(error){
        if(error instanceof ApiError&&[401,403].includes(error.status))throw error;
        if(saved.userId){const key=`${saved.origin}:${saved.userId}`;const b=bootstrapSchema.safeParse(cache.get(`${key}:bootstrap`));if(b.success&&b.data.auth.currentUser.id===saved.userId){useWorkspace.getState().applyBootstrap(b.data,key);this.restoreLocal(key);useWorkspace.setState({connection:'离线缓存，恢复连接后同步'});}}
        throw error;
      }
    }else if(config.apiOrigin){this.api=new ApiClient(config.apiOrigin,this.persist,()=>void this.logout(false));await this.checkPolicy();}
    }catch(error){useWorkspace.setState({error:errorText(error)});}finally{useWorkspace.setState({busy:false});}
  }
  async login(originInput:string,inviteCode?:string){
    const origin=validateOrigin(originInput);const epoch=++this.epoch;this.disconnect();
    this.api=new ApiClient(origin,this.persist,()=>void this.logout(false));await this.checkPolicy();if(this.forced())return;
    const verifier=Crypto.randomUUID().replaceAll('-','')+Crypto.randomUUID().replaceAll('-','');const state=Crypto.randomUUID();
    const challenge=(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,verifier,{encoding:Crypto.CryptoEncoding.BASE64})).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    const start=await this.api.json('/api/auth/mobile/github/start',z.object({authorizationUrl:z.string().url()}),{codeChallenge:challenge,state,redirectUri,inviteCode},'POST',false);
    const authUrl=new URL(start.authorizationUrl);if(authUrl.protocol!=='https:'||(authUrl.origin!==origin&&authUrl.origin!=='https://github.com'))throw new Error('Invalid OAuth URL');
    const result=await WebBrowser.openAuthSessionAsync(start.authorizationUrl,redirectUri);
    if(!this.current(epoch)||result.type!=='success')return;
    const callback=new URL(result.url);
    if(`${callback.protocol}//${callback.host}${callback.pathname}`!==redirectUri||callback.searchParams.get('state')!==state)throw new Error('Invalid callback');
    const code=callback.searchParams.get('code');if(!code)throw new Error('Login incomplete');
    const session=await this.api.json('/api/auth/mobile/github/exchange',sessionSchema,{code,codeVerifier:verifier,redirectUri},'POST',false);
    if(!this.current(epoch))return;
    await this.persist(session);this.api.session=session;await this.bootstrap();this.connect();
  }
  async checkPolicy(){
    if(!this.api)return;
    const key=`policy:${this.api.origin}`;
    const saved=releaseSchema.safeParse(cache.get(key));if(saved.success)useWorkspace.setState({policy:saved.data});
    try{const p=await this.api.json('/api/mobile/release-policy',releaseSchema,undefined,'GET',false);cache.set(key,p);useWorkspace.setState({policy:p});if(this.forced())this.disconnect();}
    catch{useWorkspace.setState({error:'暂时无法检查更新，请稍后重试'});}
  }
  forced(){const p=useWorkspace.getState().policy;return p?updateDecision(p,installed)==='forced':false;}
  private restoreLocal(key:string){const drafts=z.record(z.string()).safeParse(cache.get(`${key}:drafts`));if(drafts.success)useWorkspace.setState({drafts:drafts.data});}
  async bootstrap(){const api=this.requireApi(),epoch=this.epoch;if(this.forced())return;
    const b=await api.json('/api/workspace/bootstrap',bootstrapSchema);if(!this.current(epoch))return;
    const key=`${api.origin}:${b.auth.currentUser.id}`;
    useWorkspace.getState().applyBootstrap(b,key);cache.set(`${key}:bootstrap`,b);this.restoreLocal(key);
    if(api.session)await credentials.save({origin:api.origin,refreshToken:api.session.refreshToken,userId:b.auth.currentUser.id});
  }
  draft(id:string,text:string){useWorkspace.getState().setDraft(id,text);const s=useWorkspace.getState();cache.set(`${s.accountKey}:drafts`,s.drafts);}
  async messages(id:string,before?:string){const epoch=this.epoch;const result=await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}/messages?limit=50${before?`&before=${encodeURIComponent(before)}`:''}`,z.object({messages:z.array(z.unknown())}));const messages=result.messages.map(parseMessage).filter((m):m is Message=>!!m&&m.conversationId===id);if(this.current(epoch)){useWorkspace.getState().setMessages(id,messages,!!before);cache.set(`${useWorkspace.getState().accountKey}:messages:${id}`,useWorkspace.getState().messages[id]);}return messages.length;}
  async open(id:string){const epoch=this.epoch;const result=await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}`,z.object({conversation:conversationSchema}));if(!this.current(epoch))return;useWorkspace.setState(s=>({conversations:{...s.conversations,[id]:result.conversation}}));await this.messages(id);}
  async send(id:string,text:string,existing?:Message,attachmentId?:string){
    const s=useWorkspace.getState();if(!s.bootstrap||!s.conversations[id]?.capabilities.canSendMessage||this.forced())throw new Error('Cannot send');
    const clientMessageId=existing?.clientMessageId??Crypto.randomUUID();if(this.inFlight.has(clientMessageId))return;
    const m:Message=existing??{id:clientMessageId,conversationId:id,authorId:s.bootstrap.auth.currentUser.id,authorName:s.bootstrap.auth.currentUser.displayName,kind:'user',clientMessageId,createdAt:new Date().toISOString(),plainText:text,hiddenByCurrentUser:false,attachments:[],blocks:[...(text.trim()?[{type:'text' as const,text}]:[]),...(attachmentId?[{type:'attachment' as const,attachmentId}]:[])],fallback:false};
    if(!m.blocks.length)return;this.inFlight.add(clientMessageId);s.upsertMessage({...m,status:'sending'});if(!existing)this.draft(id,'');const epoch=this.epoch;
    try{const r=await this.requireApi().json('/api/workspace/messages',z.object({message:z.unknown()}),{conversationId:id,clientMessageId,content:{format:'duallane.message+json;v=1',blocks:m.blocks},replyToMessageId:null});const parsed=parseMessage(r.message);if(!parsed)throw new Error('Invalid message');if(this.current(epoch))useWorkspace.getState().upsertMessage(parsed);}
    catch(error){if(this.current(epoch))useWorkspace.getState().upsertMessage({...m,status:'failed',error:errorText(error)});throw error;}finally{this.inFlight.delete(clientMessageId);}
  }
  isForced(){ return this.forced(); }
  async markRead(id:string,messageId:string){if(!this.foreground)return;await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}/read`,z.unknown(),{messageId});}
  async notification(id:string,level:'all'|'mentions'|'muted'){await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}/notification`,z.unknown(),{level},'PATCH');await this.bootstrap();}
  async direct(userId:string){const r=await this.requireApi().json('/api/workspace/conversations',z.object({conversation:conversationSchema}),{type:'direct',memberIds:[userId]});useWorkspace.setState(s=>({conversations:{...s.conversations,[r.conversation.id]:r.conversation}}));return r.conversation.id;}
  private async applyEvent(event:WorkspaceEvent,replay:boolean){const s=useWorkspace.getState();if(!s.bootstrap||event.spaceId!==s.bootstrap.space.id)return;
    if(event.type==='message.created'){const message=parseMessage(event.payload.message);if(!message)return;
      const conversation=s.conversations[message.conversationId];s.upsertMessage(message);
      if(conversation)useWorkspace.setState(v=>({conversations:{...v.conversations,[conversation.id]:{...conversation,lastMessagePlainText:message.plainText,lastActivityAt:message.createdAt}}}));
      if(shouldNotify({background:!this.foreground,replay,message,userId:s.bootstrap.auth.currentUser.id,conversation})&&!this.notified.has(message.id)){
        this.notified.add(message.id);if(this.notified.size>2000)this.notified.delete(this.notified.values().next().value??'');
        await showMessageNotification({origin:this.requireApi().origin,userId:s.bootstrap.auth.currentUser.id,conversationId:message.conversationId,messageId:message.id});
      }
    }else{await this.bootstrap();if(event.conversationId&&useWorkspace.getState().conversations[event.conversationId])await this.messages(event.conversationId);}
  }
  connect(){if(this.forced()||!this.api?.session||!useWorkspace.getState().ready)return;this.disconnect();const api=this.api,epoch=this.epoch;
    const tracker=new ReplayTracker(useWorkspace.getState().cursor);
    const socket=new NativeWebSocket(api.origin.replace(/^https:/,'wss:')+'/ws/workspace',undefined,{headers:{Authorization:`Bearer ${api.session!.accessToken}`}});this.socket=socket;
    const hello=()=>socket.readyState===WebSocket.OPEN&&socket.send(JSON.stringify({type:'hello',version:1,lastSeq:tracker.cursor}));
    socket.onopen=()=>{this.attempts=0;hello();};
    socket.onmessage=e=>{this.queue=this.queue.then(async()=>{if(!this.current(epoch)||this.socket!==socket)return;let raw:unknown;try{raw=JSON.parse(String(e.data));}catch{this.scheduleSync();return;}
      const result=tracker.accept(raw);if(result.sync){this.scheduleSync();return;}if(result.event)await this.applyEvent(result.event,!!result.replay);if(!this.current(epoch)||this.socket!==socket)return;
      useWorkspace.setState({cursor:tracker.cursor,connection:'已连接'});if(result.hello)hello();
    }).catch(()=>{useWorkspace.setState({connection:'同步未完成'});this.scheduleSync();});};
    socket.onerror=()=>socket.close();socket.onclose=()=>{if(this.socket!==socket||!this.current(epoch))return;this.disconnect();useWorkspace.setState({connection:'正在重新连接'});this.retry=setTimeout(()=>void this.resume(),Math.min(30000,1000*2**Math.min(this.attempts++,5)));};
    this.refreshTimer=setTimeout(()=>void this.resume(),Math.max(1000,Date.parse(api.session!.accessTokenExpiresAt)-Date.now()-15000));
  }
  private scheduleSync(){if(this.syncing)return;this.disconnect();this.syncing=this.bootstrap().then(()=>{this.connect();}).catch(()=>useWorkspace.setState({connection:'同步失败，请重新连接'})).finally(()=>{this.syncing=null;});}
  async resume(){try{await this.checkPolicy();if(this.forced())return;if(this.api?.session){await this.api.refresh();await this.bootstrap();this.connect();}}catch(error){useWorkspace.setState({connection:'连接暂时不可用',error:errorText(error)});}}
  disconnect(){if(this.retry)clearTimeout(this.retry);if(this.heartbeat)clearInterval(this.heartbeat);if(this.refreshTimer)clearTimeout(this.refreshTimer);this.retry=null;this.heartbeat=null;this.refreshTimer=null;const socket=this.socket;this.socket=null;if(socket)socket.close();}
  async logout(remote=true){const api=this.api,session=api?.session;this.epoch++;this.disconnect();this.api=null;this.notified.clear();const key=useWorkspace.getState().accountKey;useWorkspace.getState().reset();await credentials.clear();if(key)cache.clearAccount(key);await clearNotifications();
    if(remote&&api&&session){try{await api.raw('/api/auth/mobile/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:session.refreshToken})},false);}catch{/* Local logout must still complete offline. */}}api?.invalidate();
  }
  dispose(){this.epoch++;this.disconnect();this.stopAppState?.();}
}
