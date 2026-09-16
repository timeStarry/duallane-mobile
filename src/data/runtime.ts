import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { z } from 'zod';
import { ApiClient, ApiError, errorText } from './client';
import { bootstrapSchema, conversationSchema, sessionSchema, parseMessage, type Message, type WorkspaceEvent } from '../domain/contracts';
import { clearAccountFiles } from './transfers';
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
  private starting:Promise<void>|null=null;
  private resuming:Promise<void>|null=null;
  private active=false;
  private foreground=true;
  private stopAppState:(()=>void)|null=null;
  private attach(){this.active=true;this.foreground=AppState.currentState==='active';if(this.stopAppState)return;const sub=AppState.addEventListener('change',state=>{const previous=this.foreground;this.foreground=state==='active';if(this.foreground&&!previous)void this.resume();});this.stopAppState=()=>sub.remove();}
  private current(epoch:number){return this.active&&epoch===this.epoch;}
  private requireApi(){if(!this.api)throw new ApiError('auth.required',401);return this.api;}
  private createApi(origin:string){
    this.api?.invalidate();const epoch=this.epoch;
    useWorkspace.setState({policy:null});
    const api:ApiClient=new ApiClient(origin,async session=>{
      const existing=await credentials.read();
      if(this.api!==api||epoch!==this.epoch)throw new Error('Stale session');
      await credentials.save({origin,refreshToken:session.refreshToken,userId:existing?.origin===origin?existing.userId:undefined});
    },()=>{if(this.api===api)void this.logout(false);},()=>this.api===api&&epoch===this.epoch&&!this.forced());
    this.api=api;return api;
  }
  start(){this.attach();if(this.starting)return this.starting;const task=this.restore();this.starting=task;void task.finally(()=>{if(this.starting===task)this.starting=null;});return task;}
  private async restore(){
    const epoch=this.epoch;
    useWorkspace.setState({busy:true});
    try{const saved=await credentials.read();if(!this.current(epoch))return;if(saved){const api=this.createApi(validateOrigin(saved.origin));
      await this.checkPolicy();if(!this.current(epoch)||this.forced())return;
      api.session={accessToken:'expired-session-placeholder',refreshToken:saved.refreshToken,accessTokenExpiresAt:new Date(0).toISOString(),refreshTokenExpiresAt:new Date(0).toISOString()};
      try{await api.refresh();if(!this.current(epoch))return;await this.bootstrap();this.connect();}catch(error){
        if(!this.current(epoch))return;
        if(error instanceof ApiError&&([401,403].includes(error.status)||error.code==='workspace.disabled')){await this.logout(false);useWorkspace.setState({error:errorText(error)});return;}
        if(saved.userId){const key=`${saved.origin}:${saved.userId}`;const b=bootstrapSchema.safeParse(cache.get(`${key}:bootstrap`));if(b.success&&b.data.auth.currentUser.id===saved.userId){useWorkspace.getState().applyBootstrap(b.data,key);this.restoreLocal(key,true);useWorkspace.setState({connection:'离线缓存，恢复连接后同步'});}}
        this.scheduleRetry();
        throw error;
      }
    }else if(config.apiOrigin){this.createApi(validateOrigin(config.apiOrigin));await this.checkPolicy();}
    }catch(error){if(this.current(epoch))useWorkspace.setState({error:errorText(error)});}finally{if(this.current(epoch))useWorkspace.setState({busy:false});}
  }
  async login(originInput:string,inviteCode?:string){
    const origin=validateOrigin(originInput);this.attach();const epoch=++this.epoch;this.disconnect();
    const api=this.createApi(origin);await this.checkPolicy();if(!this.current(epoch)||this.forced())return;
    const verifier=Crypto.randomUUID().replaceAll('-','')+Crypto.randomUUID().replaceAll('-','');const state=Crypto.randomUUID();
    const challenge=(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,verifier,{encoding:Crypto.CryptoEncoding.BASE64})).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    const start=await api.json('/api/auth/mobile/github/start',z.object({authorizationUrl:z.string().url()}),{codeChallenge:challenge,state,redirectUri,inviteCode},'POST',false);
    if(!this.current(epoch))return;
    const authUrl=new URL(start.authorizationUrl);if(authUrl.protocol!=='https:'||(authUrl.origin!==origin&&authUrl.origin!=='https://github.com'))throw new Error('Invalid OAuth URL');
    const result=await WebBrowser.openAuthSessionAsync(start.authorizationUrl,redirectUri);
    if(!this.current(epoch)||result.type!=='success')return;
    const callback=new URL(result.url);
    if(`${callback.protocol}//${callback.host}${callback.pathname}`!==redirectUri||callback.searchParams.get('state')!==state)throw new Error('Invalid callback');
    const code=callback.searchParams.get('code');if(!code)throw new Error('Login incomplete');
    const session=await api.json('/api/auth/mobile/github/exchange',sessionSchema,{code,codeVerifier:verifier,redirectUri},'POST',false);
    if(!this.current(epoch))return;
    await credentials.save({origin,refreshToken:session.refreshToken});if(!this.current(epoch))return;api.session=session;await this.bootstrap();this.connect();
  }
  async checkPolicy(){
    const api=this.api,epoch=this.epoch;if(!api)return;
    const key=`policy:${api.origin}`;
    const saved=releaseSchema.safeParse(cache.get(key));if(saved.success)useWorkspace.setState({policy:saved.data});
    try{const p=await api.json('/api/mobile/release-policy',releaseSchema,undefined,'GET',false);if(!this.current(epoch)||this.api!==api)return;cache.set(key,p);useWorkspace.setState({policy:p});if(this.forced())this.disconnect();}
    catch{if(this.current(epoch)&&this.api===api)useWorkspace.setState({error:'暂时无法检查更新，请稍后重试'});}
  }
  forced(){const p=useWorkspace.getState().policy;return p?updateDecision(p,installed)==='forced':false;}
  private restoreLocal(key:string,restoreMessages=false){
    const visible=useWorkspace.getState().conversations;
    const drafts=z.record(z.string()).safeParse(cache.get(`${key}:drafts`));
    if(drafts.success){const allowed=Object.fromEntries(Object.entries(drafts.data).filter(([id])=>!!visible[id]));useWorkspace.setState({drafts:allowed});cache.set(`${key}:drafts`,allowed);}
    if(restoreMessages)for(const id of Object.keys(visible)){
      const rows=z.array(z.record(z.unknown())).safeParse(cache.get(`${key}:messages:${id}`));
      if(!rows.success)continue;
      const messages=rows.data.map(row=>parseMessage({...row,content:{format:'duallane.message+json;v=1',blocks:row.blocks}})).filter((message):message is Message=>!!message&&message.conversationId===id);
      useWorkspace.getState().setMessages(id,messages);
    }
  }
  async bootstrap(refreshMessages=false){const api=this.requireApi(),epoch=this.epoch;if(this.forced())return;
    const loaded=Object.keys(useWorkspace.getState().messages);
    const b=await api.json('/api/workspace/bootstrap',bootstrapSchema);if(!this.current(epoch))return;
    const key=`${api.origin}:${b.auth.currentUser.id}`;
    const previous=bootstrapSchema.safeParse(cache.get(`${key}:bootstrap`));
    if(previous.success)for(const conversation of previous.data.conversations)if(!b.permissions.canReadConversations||!b.conversations.some(item=>item.id===conversation.id))cache.remove(`${key}:messages:${conversation.id}`);
    useWorkspace.getState().applyBootstrap(b,key);cache.set(`${key}:bootstrap`,b);this.restoreLocal(key);
    if(api.session)await credentials.save({origin:api.origin,refreshToken:api.session.refreshToken,userId:b.auth.currentUser.id});
    if(!this.current(epoch))return;
    if(refreshMessages)await Promise.all(loaded.filter(id=>!!useWorkspace.getState().conversations[id]).map(id=>this.messages(id)));
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
  async markRead(id:string,messageId:string){if(!this.foreground)return;const epoch=this.epoch;const result=await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}/read`,z.object({conversation:conversationSchema}),{messageId});if(this.current(epoch))useWorkspace.setState(s=>({conversations:{...s.conversations,[id]:result.conversation}}));}
  async notification(id:string,level:'all'|'mentions'|'muted'){await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}/notification`,z.unknown(),{level},'PATCH');await this.bootstrap();}
  async direct(userId:string){const epoch=this.epoch;const r=await this.requireApi().json('/api/workspace/conversations',z.object({conversation:conversationSchema}),{type:'direct',memberIds:[userId]});if(!this.current(epoch))throw new Error('Stale session');useWorkspace.setState(s=>({conversations:{...s.conversations,[r.conversation.id]:r.conversation}}));return r.conversation.id;}
  private async applyEvent(event:WorkspaceEvent,replay:boolean){const s=useWorkspace.getState();if(!s.bootstrap||event.spaceId!==s.bootstrap.space.id)return;
    if(event.type==='message.created'){const message=parseMessage(event.payload.message);if(!message)return;
      const conversation=s.conversations[message.conversationId];s.upsertMessage(message);
      if(conversation)useWorkspace.setState(v=>({conversations:{...v.conversations,[conversation.id]:{...conversation,lastMessagePlainText:message.plainText,lastActivityAt:message.createdAt}}}));
      if(shouldNotify({background:!this.foreground,replay,message,userId:s.bootstrap.auth.currentUser.id,conversation})&&!this.notified.has(message.id)){
        this.notified.add(message.id);if(this.notified.size>2000)this.notified.delete(this.notified.values().next().value??'');
        await showMessageNotification({origin:this.requireApi().origin,userId:s.bootstrap.auth.currentUser.id,conversationId:message.conversationId,messageId:message.id});
      }
    }else{await this.bootstrap(true);}
  }
  connect(){if(!this.active||this.forced()||!this.api?.session||!useWorkspace.getState().ready)return;this.disconnect();const api=this.api,epoch=this.epoch;
    const tracker=new ReplayTracker(useWorkspace.getState().cursor);
    const socket=new NativeWebSocket(api.origin.replace(/^https:/,'wss:')+'/ws/workspace',undefined,{headers:{Authorization:`Bearer ${api.session!.accessToken}`}});this.socket=socket;
    const hello=()=>socket.readyState===WebSocket.OPEN&&socket.send(JSON.stringify({type:'hello',version:1,lastSeq:tracker.cursor}));
    socket.onopen=()=>{hello();};
    socket.onmessage=e=>{this.queue=this.queue.then(async()=>{if(!this.current(epoch)||this.socket!==socket)return;let raw:unknown;try{raw=JSON.parse(String(e.data));}catch{this.scheduleSync();return;}
      const result=tracker.accept(raw);if(result.sync){this.scheduleSync();return;}if(result.event)await this.applyEvent(result.event,!!result.replay);if(!this.current(epoch)||this.socket!==socket)return;
      this.attempts=0;useWorkspace.setState({cursor:tracker.cursor,connection:'已连接'});if(result.hello)hello();
    }).catch(()=>{if(!this.current(epoch)||this.socket!==socket)return;useWorkspace.setState({connection:'同步未完成'});this.scheduleSync();});};
    socket.onerror=()=>socket.close();socket.onclose=()=>{if(this.socket!==socket||!this.current(epoch))return;this.disconnect();useWorkspace.setState({connection:'正在重新连接'});this.scheduleRetry();};
    this.refreshTimer=setTimeout(()=>void this.resume(),Math.max(1000,Date.parse(api.session!.accessTokenExpiresAt)-Date.now()-15000));
  }
  private scheduleRetry(){if(!this.active||!this.api?.session||this.forced()||this.retry)return;this.retry=setTimeout(()=>{this.retry=null;void this.resume();},Math.min(30000,1000*2**Math.min(this.attempts++,5)));}
  private scheduleSync(){if(this.syncing)return;this.disconnect();this.syncing=this.resume().finally(()=>{this.syncing=null;});}
  resume(){if(this.resuming)return this.resuming;const task=this.reconnect();this.resuming=task;void task.finally(()=>{if(this.resuming===task)this.resuming=null;});return task;}
  private async reconnect(){const epoch=this.epoch,api=this.api;if(!this.current(epoch)||!api)return;this.disconnect();try{await this.checkPolicy();if(!this.current(epoch)||this.forced())return;if(api.session){await this.bootstrap(true);this.connect();}}catch(error){if(!this.current(epoch))return;if(error instanceof ApiError&&([401,403].includes(error.status)||error.code==='workspace.disabled')){await this.logout(false);useWorkspace.setState({error:errorText(error)});return;}useWorkspace.setState({connection:'连接暂时不可用',error:errorText(error)});this.scheduleRetry();}}
  disconnect(){if(this.retry)clearTimeout(this.retry);if(this.heartbeat)clearInterval(this.heartbeat);if(this.refreshTimer)clearTimeout(this.refreshTimer);this.retry=null;this.heartbeat=null;this.refreshTimer=null;const socket=this.socket;this.socket=null;if(socket)socket.close();}
  async logout(remote=true){const api=this.api,session=api?.session;this.epoch++;api?.invalidate();this.disconnect();this.api=null;this.notified.clear();this.inFlight.clear();this.resuming=null;this.starting=null;const key=useWorkspace.getState().accountKey;useWorkspace.getState().reset();if(key){clearAccountFiles(key);cache.clearAccount(key);}await credentials.clear();await clearNotifications();
    if(remote&&api&&session){try{await api.raw('/api/auth/mobile/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:session.refreshToken})},false);}catch{/* Local logout must still complete offline. */}}api?.invalidate();
  }
  dispose(){this.active=false;this.disconnect();this.stopAppState?.();this.stopAppState=null;}
}
