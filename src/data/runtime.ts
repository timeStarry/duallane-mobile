import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { z } from 'zod';
import { ApiClient, ApiError, errorDiagnostic, errorText } from './client';
import { hideResultSchema, reactionResultSchema, topicCreatedRef } from '../domain/command-results';
import { setMediaAccount, setMediaClient, clearAccountPreviewCache, rememberEmotes } from './media';
import { topicReadResultSchema } from './inbox-read';
import { bootstrapSchema, cardResolutionSchema, chatSettingsResponseSchema, conversationSchema, draftSchema, emoteCollectionSchema, emoteLibrarySchema, emoteListSchema, emoteSchema, parseMessage, profileResponseSchema, sessionSchema, topicSchema, type Attachment, type ChatSettingsPatch, type Draft, type Message, type WorkspaceEvent } from '../domain/contracts';
import { composeBlocks } from '../domain/compose';
import { assertAllowedCardAction } from '../domain/actions';
import { clearAccountFiles } from './transfers';
import { useWorkspace } from '../domain/store';
import { releaseSchema, updateDecision } from '../domain/updates';
import { ReplayTracker } from '../domain/replay';
import { shouldNotify } from '../domain/notifications';
import { cache, credentials } from '../platform/storage';
import { config, installed, redirectUri, validateOrigin } from '../platform/config';
import { clearNotifications, showMessageNotification } from '../platform/notifications';

const NativeWebSocket: new (url:string, protocols?:string[], options?:{headers:Record<string,string>}) => WebSocket = WebSocket;
const emoteShareSchema=z.object({
  id:z.string().min(1),name:z.string(),itemCount:z.number().int().nonnegative(),
  revokedAt:z.string().nullish(),
  sharedBy:z.object({id:z.string(),displayName:z.string()}),
  originalCreator:z.object({id:z.string(),displayName:z.string()}),
  canSubscribeToSourceChanges:z.boolean().default(false),
  items:z.array(emoteSchema),
});
export type EmoteShare=z.infer<typeof emoteShareSchema>;
export class Runtime {
  api:ApiClient|null=null;
  private epoch=0;
  private socket:WebSocket|null=null;
  private retry:ReturnType<typeof setTimeout>|null=null;
  private heartbeat:ReturnType<typeof setInterval>|null=null;
  private poll:ReturnType<typeof setInterval>|null=null;
  private refreshTimer:ReturnType<typeof setTimeout>|null=null;
  private attempts=0;
  private inFlight=new Set<string>();
  private refreshingConversations=new Set<string>();
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
    this.api?.invalidate();setMediaClient(null);const epoch=this.epoch;
    useWorkspace.setState({policy:null});
    const api:ApiClient=new ApiClient(origin,async session=>{
      const existing=await credentials.read();
      if(this.api!==api||epoch!==this.epoch)throw new Error('Stale session');
      await credentials.save({origin,refreshToken:session.refreshToken,userId:existing?.origin===origin?existing.userId:undefined});
    },()=>{if(this.api===api)void this.logout(false);},()=>this.api===api&&epoch===this.epoch&&!this.forced());
    this.api=api;setMediaClient(api);setMediaAccount(useWorkspace.getState().accountKey);return api;
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
        if(saved.userId){const key=`${saved.origin}:${saved.userId}`;const b=bootstrapSchema.safeParse(cache.get(`${key}:bootstrap`));if(b.success&&b.data.auth.currentUser.id===saved.userId){useWorkspace.getState().applyBootstrap(b.data,key);setMediaAccount(key);this.restoreLocal(key,true);useWorkspace.setState({connection:'离线缓存，恢复连接后同步'});}}
        this.scheduleRetry();
        throw error;
      }
    }else if(config.apiOrigin){this.createApi(validateOrigin(config.apiOrigin));void this.checkPolicy();}
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
    try{const p=await api.json('/api/mobile/release-policy',releaseSchema,undefined,'GET',false);if(!this.current(epoch)||this.api!==api)return;cache.set(key,p);useWorkspace.setState({policy:p,error:''});if(this.forced())this.disconnect();}
    catch(error){if(this.current(epoch)&&this.api===api)useWorkspace.setState({error:`暂时无法检查更新，请稍后重试（${errorDiagnostic(error)}）`});}
  }
  forced(){const p=useWorkspace.getState().policy;return p?updateDecision(p,installed)==='forced':false;}
  private restoreLocal(key:string,restoreMessages=false){
    const visible=useWorkspace.getState().conversations;
    const raw=cache.get(`${key}:drafts`);
    const asDrafts=z.record(draftSchema).safeParse(raw);
    const asStrings=z.record(z.string()).safeParse(raw);
    const parsed=asDrafts.success?asDrafts.data:asStrings.success?Object.fromEntries(Object.entries(asStrings.data).map(([id,text])=>[id,{text,mentionIds:[] as string[]}])):null;
    if(parsed){const allowed=Object.fromEntries(Object.entries(parsed).filter(([id])=>id.startsWith('topic:')||!!visible[id]));useWorkspace.setState({drafts:allowed});cache.set(`${key}:drafts`,allowed);}
    if(restoreMessages)for(const id of Object.keys(visible)){
      const rows=z.array(z.record(z.unknown())).safeParse(cache.get(`${key}:messages:${id}`));
      if(!rows.success)continue;
      const messages=rows.data.map(row=>parseMessage(row.content?row:{...row,content:{format:'duallane.message+json;v=1',blocks:row.blocks}})).filter((message):message is Message=>!!message&&message.conversationId===id);
      useWorkspace.getState().setMessages(id,messages);
    }
  }
  async bootstrap(refreshMessages=false){const api=this.requireApi(),epoch=this.epoch;if(this.forced())return;
    const loaded=Object.keys(useWorkspace.getState().messages);
    const b=await api.json('/api/workspace/bootstrap',bootstrapSchema);if(!this.current(epoch))return;
    const key=`${api.origin}:${b.auth.currentUser.id}`;
    const previous=bootstrapSchema.safeParse(cache.get(`${key}:bootstrap`));
    if(previous.success)for(const conversation of previous.data.conversations)if(!b.permissions.canReadConversations||!b.conversations.some(item=>item.id===conversation.id))cache.remove(`${key}:messages:${conversation.id}`);
    useWorkspace.getState().applyBootstrap(b,key);setMediaAccount(key);cache.set(`${key}:bootstrap`,b);this.restoreLocal(key);
    if(api.session)await credentials.save({origin:api.origin,refreshToken:api.session.refreshToken,userId:b.auth.currentUser.id});
    if(!this.current(epoch))return;
    void this.chatSettings().then(result=>{if(this.current(epoch))useWorkspace.getState().setChatSettings(result.settings);}).catch(()=>undefined);
    void this.listTopics().catch(()=>undefined);
    if(refreshMessages)await Promise.all(loaded.filter(id=>!!useWorkspace.getState().conversations[id]||id.startsWith('topic:')).map(id=>id.startsWith('topic:')?this.topicMessages(id.slice(6)):this.messages(id)));
  }
  draft(id:string,text:string){this.patchDraft(id,{text});}
  patchDraft(id:string,patch:Partial<Draft>){useWorkspace.getState().setDraft(id,patch);const s=useWorkspace.getState();cache.set(`${s.accountKey}:drafts`,s.drafts);}
  async messages(id:string,before?:string){const epoch=this.epoch;const result=await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}/messages?limit=50${before?`&before=${encodeURIComponent(before)}`:''}`,z.object({messages:z.array(z.unknown())}));const messages=result.messages.map(parseMessage).filter((m):m is Message=>!!m&&m.conversationId===id&&!m.topicId);if(this.current(epoch)){useWorkspace.getState().setMessages(id,messages,!!before);cache.set(`${useWorkspace.getState().accountKey}:messages:${id}`,useWorkspace.getState().messages[id]);}return messages.length;}
  async topicMessages(id:string,before?:string){const epoch=this.epoch;const bucket=`topic:${id}`;const result=await this.requireApi().json(`/api/workspace/topics/${encodeURIComponent(id)}/messages?limit=50${before?`&before=${encodeURIComponent(before)}`:''}`,z.object({messages:z.array(z.unknown())}));const messages=result.messages.map(parseMessage).filter((m):m is Message=>!!m&&m.topicId===id);if(this.current(epoch)){useWorkspace.getState().setMessages(bucket,messages,!!before);cache.set(`${useWorkspace.getState().accountKey}:messages:${bucket}`,useWorkspace.getState().messages[bucket]);}return messages.length;}
  async open(id:string){const epoch=this.epoch;const result=await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}`,z.object({conversation:conversationSchema}));if(!this.current(epoch))return;useWorkspace.setState(s=>({conversations:{...s.conversations,[id]:result.conversation}}));return this.messages(id);}
  async openTopic(id:string){const epoch=this.epoch;const result=await this.requireApi().json(`/api/workspace/topics/${encodeURIComponent(id)}`,z.object({topic:topicSchema}));if(!this.current(epoch))return;useWorkspace.getState().upsertTopic(result.topic);if(result.topic.joined)return this.topicMessages(id);}
  async send(id:string,text:string,existing?:Message,attachmentId?:string,options?:{topicId?:string;replyToMessageId?:string|null;mentionIds?:string[];upload?:()=>Promise<Attachment|null>;uploadTaskId?:string;syncToGroup?:boolean;}){
    const s=useWorkspace.getState();const topicId=options?.topicId??existing?.topicId;const conversationId=existing?.conversationId??id;
    const topic=topicId?s.topics[topicId]:undefined;
    const canSend=topicId?!!topic&&topic.joined&&topic.status==='open':!!s.conversations[conversationId]?.capabilities.canSendMessage;
    if(!s.bootstrap||!canSend||this.forced())throw new Error('Cannot send');
    const clientMessageId=existing?.clientMessageId??Crypto.randomUUID();if(this.inFlight.has(clientMessageId))return;
    const members=s.conversations[conversationId]?.members??s.bootstrap.members;
    const replyTo=options?.replyToMessageId===undefined?existing?.replyToMessageId??null:options.replyToMessageId;
    const mentionIds=options?.mentionIds??[];
    let fileId=attachmentId??existing?.attachments[0]?.id;
    const uploadTaskId=options?.uploadTaskId??existing?.pendingUploadTaskId;
    const syncToGroup=existing?.pendingSyncToGroup??options?.syncToGroup??false;
    let blocks=existing?.blocks.length?existing.blocks:composeBlocks(text,members,mentionIds,fileId);
    if(!blocks.length&&!options?.upload&&!uploadTaskId)return;
    let pending:Message=existing??{id:clientMessageId,conversationId,topicId,authorId:s.bootstrap.auth.currentUser.id,authorName:s.bootstrap.auth.currentUser.displayName,kind:'user',clientMessageId,createdAt:new Date().toISOString(),plainText:text,replyToMessageId:replyTo,hiddenByCurrentUser:false,attachments:[],reactions:[],blocks,fallback:false};
    pending={...pending,pendingUploadTaskId:uploadTaskId,pendingSyncToGroup:topicId?syncToGroup:undefined};
    this.inFlight.add(clientMessageId);s.upsertMessage({...pending,status:'sending'});if(!existing)this.patchDraft(topicId?`topic:${topicId}`:conversationId,{text:'',mentionIds:[],replyToMessageId:undefined,pendingAttachment:undefined});const epoch=this.epoch;
    try{
      if(uploadTaskId&&!fileId&&!options?.upload)throw new Error('Upload unavailable');
      if(options?.upload&&!fileId){
        const file=await options.upload();
        if(!this.current(epoch))return;
        if(!file)throw new Error('Upload paused');
        fileId=file.id;
        blocks=existing?.blocks.length?[...existing.blocks.filter(block=>block.type!=='attachment'),{type:'attachment',attachmentId:file.id}]:composeBlocks(text,members,mentionIds,file.id);
        pending={...pending,attachments:[file],blocks,plainText:text||file.fileName};
        useWorkspace.getState().upsertMessage({...pending,status:'sending'});
      }
      if(!blocks.length)throw new Error('Cannot send');
      const body={clientMessageId,content:{format:'duallane.message+json;v=1',blocks},replyToMessageId:replyTo,...(topicId?{syncToGroup}:{conversationId})};
      const path=topicId?`/api/workspace/topics/${encodeURIComponent(topicId)}/messages`:'/api/workspace/messages';
      const r=await this.requireApi().json(path,z.object({message:z.unknown()}).passthrough(),body);const parsed=parseMessage('message' in r?r.message:r);if(!parsed)throw new Error('Invalid message');if(this.current(epoch))useWorkspace.getState().upsertMessage(parsed);}
    catch(error){if(this.current(epoch))useWorkspace.getState().upsertMessage({...pending,status:'failed',error:errorText(error)});throw error;}finally{this.inFlight.delete(clientMessageId);}
  }
  isForced(){ return this.forced(); }
  async markRead(id:string,messageId:string,topic=false){
    if(!this.foreground)return;const epoch=this.epoch;
    if(topic){
      const result=await this.requireApi().json(`/api/workspace/topics/${encodeURIComponent(id)}/read`,topicReadResultSchema,{messageId},'POST');
      if(this.current(epoch))useWorkspace.setState(s=>{const current=s.topics[id];return current?{topics:{...s.topics,[id]:{...current,lastReadMessageId:result.read.lastReadMessageId,unreadCount:result.read.unreadCount??0}}}:s;});
      return;
    }
    const result=await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}/read`,z.object({conversation:conversationSchema}),{messageId});
    if(this.current(epoch))useWorkspace.setState(s=>({conversations:{...s.conversations,[id]:result.conversation}}));
  }
  async notification(id:string,level:'all'|'mentions'|'muted'){await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}/notification`,z.unknown(),{level},'PATCH');await this.bootstrap();}
  async updateProfile(patch:{nickname?:string|null;searchDiscoverable?:boolean;recallReason?:string}){
    const epoch=this.epoch;
    const result=await this.requireApi().json('/api/workspace/me/profile',profileResponseSchema,patch,'PATCH');
    if(!this.current(epoch))throw new Error('Stale session');
    useWorkspace.setState(s=>{
      if(!s.bootstrap||s.bootstrap.auth.currentUser.id!==result.user.id)return s;
      const bootstrap={...s.bootstrap,auth:{...s.bootstrap.auth,currentUser:{...s.bootstrap.auth.currentUser,...result.user}},members:s.bootstrap.members.map(member=>member.id===result.user.id?{...member,...result.user}:member)};
      cache.set(`${s.accountKey}:bootstrap`,bootstrap);
      return {bootstrap};
    });
    return result.user;
  }
  async chatSettings(){
    return this.requireApi().json('/api/workspace/me/emote-settings',chatSettingsResponseSchema);
  }
  async saveChatSettings(patch:ChatSettingsPatch){
    const epoch=this.epoch;
    const result=await this.requireApi().json('/api/workspace/me/emote-settings',chatSettingsResponseSchema,patch,'PUT');
    if(!this.current(epoch))throw new Error('Stale session');
    useWorkspace.getState().setChatSettings(result.settings);
    return result.settings;
  }
  async listTopics(conversationId?:string){
    const epoch=this.epoch;
    const path=conversationId?`/api/workspace/conversations/${encodeURIComponent(conversationId)}/topics`:'/api/workspace/topics/mine';
    const result=await this.requireApi().json(path,z.object({topics:z.array(topicSchema)}));
    if(this.current(epoch)){
      if(conversationId)useWorkspace.setState(s=>({topics:{...s.topics,...Object.fromEntries(result.topics.map(topic=>[topic.id,topic]))}}));
      else {
        useWorkspace.getState().setTopics(result.topics);
        useWorkspace.getState().pruneTopics(new Set(result.topics.map(topic=>topic.id)));
      }
    }
    return result.topics;
  }
  async createTopic(conversationId:string,title:string,description=''){
    const epoch=this.epoch;
    const result=await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(conversationId)}/topics`,z.object({topic:topicSchema}),{title,description,source:'form',idempotencyKey:Crypto.randomUUID()});
    if(!this.current(epoch))throw new Error('Stale session');
    useWorkspace.getState().upsertTopic(result.topic);
    return result.topic;
  }
  async joinTopic(id:string){const epoch=this.epoch;const result=await this.requireApi().json(`/api/workspace/topics/${encodeURIComponent(id)}/join`,z.object({topic:topicSchema}),{});if(!this.current(epoch))throw new Error('Stale session');useWorkspace.getState().upsertTopic(result.topic);return result.topic;}
  async leaveTopic(id:string){const epoch=this.epoch;const result=await this.requireApi().json(`/api/workspace/topics/${encodeURIComponent(id)}/leave`,z.object({topic:topicSchema}),{});if(!this.current(epoch))throw new Error('Stale session');useWorkspace.getState().upsertTopic(result.topic);useWorkspace.setState(s=>{const drafts={...s.drafts};delete drafts[`topic:${id}`];return {drafts};});return result.topic;}
  async topicNotification(id:string,level:'all'|'mentions'|'muted'){const result=await this.requireApi().json(`/api/workspace/topics/${encodeURIComponent(id)}/notification`,z.object({topic:topicSchema}),{level},'PATCH');useWorkspace.getState().upsertTopic(result.topic);}
  async recall(messageId:string){const r=await this.requireApi().json(`/api/workspace/messages/${encodeURIComponent(messageId)}/recall`,z.object({message:z.unknown()}),{},'POST');const parsed=parseMessage(r.message);if(parsed)useWorkspace.getState().upsertMessage(parsed);}
  async hide(messageId:string,hidden:boolean,bucket?:string){
    const r=await this.requireApi().json(`/api/workspace/messages/${encodeURIComponent(messageId)}/hidden`,hideResultSchema,hidden?{}:undefined,hidden?'PUT':'DELETE');
    const key=bucket??this.messageBucketById(r.messageId);
    if(key)useWorkspace.getState().patchMessage(key,r.messageId,{hiddenByCurrentUser:r.hidden});
  }
  async react(messageId:string,emoteKey:string,remove=false,bucket?:string){
    const path=`/api/workspace/messages/${encodeURIComponent(messageId)}/reactions${remove?`/${encodeURIComponent(emoteKey)}`:''}`;
    const r=await this.requireApi().json(path,reactionResultSchema,remove?undefined:{emoteKey},remove?'DELETE':'POST');
    const key=bucket??this.messageBucketById(r.messageId);
    if(key)useWorkspace.getState().patchMessage(key,r.messageId,{reactions:r.reactions});
  }
  async pin(conversationId:string,messageId:string,remove=false){
    if(remove)await this.requireApi().json(`/api/workspace/groups/${encodeURIComponent(conversationId)}/pins/${encodeURIComponent(messageId)}`,z.unknown(),undefined,'DELETE');
    else await this.requireApi().json(`/api/workspace/groups/${encodeURIComponent(conversationId)}/pins`,z.unknown(),{messageId});
    await this.open(conversationId);
  }
  async emotes(){return this.requireApi().json('/api/workspace/me/emotes',emoteListSchema);}
  async emoteLibrary(){return this.requireApi().json('/api/workspace/me/emote-library',emoteLibrarySchema);}
  async emoteShare(shareId:string){
    const result=await this.requireApi().json(`/api/workspace/emote-collection-shares/${encodeURIComponent(shareId)}`,z.object({share:emoteShareSchema}));
    return result.share;
  }
  async importEmoteShare(shareId:string,subscribeToSourceChanges=false){
    const result=await this.requireApi().json(`/api/workspace/emote-collection-shares/${encodeURIComponent(shareId)}/import`,z.object({
      collection:emoteCollectionSchema.nullish(),items:z.array(emoteSchema).default([]),
    }),{asCollection:true,subscribeToSourceChanges});
    if(result.collection)rememberEmotes(result.collection.items);
    return result;
  }
  async favoriteMessageEmote(messageId:string,attachmentId:string){
    const result=await this.requireApi().json('/api/workspace/me/emotes/favorite',z.object({emote:emoteSchema}),{messageId,attachmentId});
    rememberEmotes([result.emote]);
    return result.emote;
  }
  async resolveCard(cardId:string){const result=await this.requireApi().json(`/api/workspace/cards/${encodeURIComponent(cardId)}`,z.object({card:cardResolutionSchema}));return result.card;}
  async cardAction(cardId:string,actionId:string,allowed:string[]=[],revision?:number,input:Record<string,unknown>={}){
    assertAllowedCardAction(actionId,allowed);
    return this.requireApi().json(`/api/workspace/cards/${encodeURIComponent(cardId)}/actions`,z.object({action:z.unknown()}).passthrough(),{actionId,clientActionId:Crypto.randomUUID(),expectedRevision:revision,input});
  }
  async remark(userId:string,value:string){await this.requireApi().json(`/api/workspace/members/${encodeURIComponent(userId)}/remark`,z.unknown(),{remark:value},'PUT');await this.bootstrap();}
  async clearRemark(userId:string){await this.requireApi().json(`/api/workspace/members/${encodeURIComponent(userId)}/remark`,z.unknown(),undefined,'DELETE');await this.bootstrap();}
  async direct(userId:string){const epoch=this.epoch;const r=await this.requireApi().json('/api/workspace/conversations',z.object({conversation:conversationSchema}),{type:'direct',memberIds:[userId]});if(!this.current(epoch))throw new Error('Stale session');useWorkspace.setState(s=>({conversations:{...s.conversations,[r.conversation.id]:r.conversation}}));return r.conversation.id;}
  private messageBucketById(id:string){
    const entries=Object.entries(useWorkspace.getState().messages);
    for(const [bucket,list] of entries){if(list.some(item=>item.id===id))return bucket;}
    return undefined;
  }
  private refreshConversation(id:string){
    if(this.refreshingConversations.has(id))return;
    this.refreshingConversations.add(id);
    const epoch=this.epoch;
    void this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}`,z.object({conversation:conversationSchema}))
      .then(result=>{if(this.current(epoch))useWorkspace.setState(s=>({conversations:{...s.conversations,[id]:result.conversation}}));})
      .catch(()=>undefined)
      .finally(()=>this.refreshingConversations.delete(id));
  }
  private async applyEvent(event:WorkspaceEvent,replay:boolean){const s=useWorkspace.getState();if(!s.bootstrap||event.spaceId!==s.bootstrap.space.id)return;
    if(event.type==='topic.message.created'){
      const ref=topicCreatedRef(event.payload);
      const parsed=parseMessage(event.payload.message);
      if(parsed&&(parsed.topicId||ref.topicId)){
        s.upsertMessage(parsed,`topic:${parsed.topicId??ref.topicId}`);
        await this.listTopics().catch(()=>undefined);
        await this.notifyIfNeeded(parsed,replay,true);
        return;
      }
      if(ref.topicId){
        const epoch=this.epoch;
        await Promise.all([this.listTopics().catch(()=>undefined),this.topicMessages(ref.topicId).catch(()=>undefined)]);
        if(!this.current(epoch))return;
        const created=useWorkspace.getState().messages[`topic:${ref.topicId}`]?.find(item=>item.id===ref.topicMessageId);
        if(created)await this.notifyIfNeeded(created,replay,true);
        return;
      }
    }
    const message=parseMessage(event.payload.message);
    if(message){
      s.upsertMessage(message);
      if(!message.topicId){
        const current=s.conversations[message.conversationId];
        const raw=event.payload.conversation;
        const projection=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
        const merged=projection&&projection.id===message.conversationId?conversationSchema.safeParse({
          ...current,...projection,
          capabilities:projection.capabilities??current?.capabilities,
          members:projection.members??current?.members,
          lastMessagePlainText:projection.lastMessagePlainText??message.plainText,
        }):null;
        if(merged?.success)useWorkspace.setState(v=>({conversations:{...v.conversations,[message.conversationId]:merged.data}}));
        else if(current)useWorkspace.setState(v=>({conversations:{...v.conversations,[message.conversationId]:{...current,lastMessagePlainText:message.plainText,lastActivityAt:message.createdAt}}}));
        if(projection&&!projection.capabilities)this.refreshConversation(message.conversationId);
      }
      await this.notifyIfNeeded(message,replay,event.type==='message.created');
      return;
    }
    if(event.type.startsWith('topic.'))await this.listTopics().catch(()=>undefined);
    else await this.bootstrap(true);
  }
  private async notifyIfNeeded(message:Message,replay:boolean,created:boolean){
    const s=useWorkspace.getState();
    if(!created||!s.bootstrap)return;
    const conversation=s.conversations[message.conversationId];
    const topic=message.topicId?s.topics[message.topicId]:undefined;
    if(!shouldNotify({background:!this.foreground,replay,message,userId:s.bootstrap.auth.currentUser.id,conversation,topic})||this.notified.has(message.id))return;
    this.notified.add(message.id);if(this.notified.size>2000)this.notified.delete(this.notified.values().next().value??'');
    await showMessageNotification({origin:this.requireApi().origin,userId:s.bootstrap.auth.currentUser.id,conversationId:message.conversationId,messageId:message.id,topicId:message.topicId});
  }
  connect(){if(!this.active||this.forced()||!this.api?.session||!useWorkspace.getState().ready)return;this.disconnect();const api=this.api,epoch=this.epoch;
    const tracker=new ReplayTracker(useWorkspace.getState().cursor);
    const socket=new NativeWebSocket(api.origin.replace(/^https:/,'wss:')+'/ws/workspace',undefined,{headers:{Authorization:`Bearer ${api.session!.accessToken}`}});this.socket=socket;
    const hello=()=>socket.readyState===WebSocket.OPEN&&socket.send(JSON.stringify({type:'hello',version:1,lastSeq:tracker.cursor}));
    socket.onopen=()=>{hello();};
    socket.onmessage=e=>{this.queue=this.queue.then(async()=>{if(!this.current(epoch)||this.socket!==socket)return;let raw:unknown;try{raw=JSON.parse(String(e.data));}catch{this.scheduleSync();return;}
      const result=tracker.accept(raw);if(result.sync){this.scheduleSync();return;}if(result.event)await this.applyEvent(result.event,!!result.replay);if(!this.current(epoch)||this.socket!==socket)return;
      this.attempts=0;this.stopHttpSync();useWorkspace.setState({cursor:tracker.cursor,connection:'已连接'});if(result.hello)hello();
    }).catch(()=>{if(!this.current(epoch)||this.socket!==socket)return;useWorkspace.setState({connection:'同步未完成'});this.scheduleSync();});};
    socket.onerror=()=>socket.close();socket.onclose=()=>{if(this.socket!==socket||!this.current(epoch))return;this.disconnect();useWorkspace.setState({connection:'正在重新连接'});this.startHttpSync();this.scheduleRetry();};
    this.refreshTimer=setTimeout(()=>void this.resume(),Math.max(1000,Date.parse(api.session!.accessTokenExpiresAt)-Date.now()-15000));
  }
  private scheduleRetry(){if(!this.active||!this.api?.session||this.forced()||this.retry)return;this.retry=setTimeout(()=>{this.retry=null;void this.resume();},Math.min(30000,1000*2**Math.min(this.attempts++,5)));}
  private scheduleSync(){if(this.syncing)return;this.disconnect();this.syncing=this.resume().finally(()=>{this.syncing=null;});}
  resume(){if(this.resuming)return this.resuming;const task=this.reconnect();this.resuming=task;void task.finally(()=>{if(this.resuming===task)this.resuming=null;});return task;}
  private async reconnect(){const epoch=this.epoch,api=this.api;if(!this.current(epoch)||!api)return;this.disconnect();try{await this.checkPolicy();if(!this.current(epoch)||this.forced())return;if(api.session){await this.bootstrap(true);this.connect();}}catch(error){if(!this.current(epoch))return;if(error instanceof ApiError&&([401,403].includes(error.status)||error.code==='workspace.disabled')){await this.logout(false);useWorkspace.setState({error:errorText(error)});return;}useWorkspace.setState({connection:'连接暂时不可用',error:errorText(error)});this.scheduleRetry();}}
  disconnect(){if(this.retry)clearTimeout(this.retry);if(this.heartbeat)clearInterval(this.heartbeat);if(this.refreshTimer)clearTimeout(this.refreshTimer);this.retry=null;this.heartbeat=null;this.refreshTimer=null;const socket=this.socket;this.socket=null;if(socket)socket.close();}
  private startHttpSync(){if(this.poll||!this.active)return;void this.httpSync();this.poll=setInterval(()=>{void this.httpSync();},8000);}
  private stopHttpSync(){if(this.poll)clearInterval(this.poll);this.poll=null;}
  private async httpSync(){if(!this.active||!this.api?.session||useWorkspace.getState().connection==='已连接')return;try{await this.bootstrap(true);if(this.active&&useWorkspace.getState().connection!=='已连接')useWorkspace.setState({connection:'实时未接通，已用 HTTP 同步'});}catch{/* WebSocket retry continues */}}
  async logout(remote=true){const api=this.api,session=api?.session;this.epoch++;api?.invalidate();this.stopHttpSync();this.disconnect();this.api=null;this.notified.clear();this.inFlight.clear();this.resuming=null;this.starting=null;const key=useWorkspace.getState().accountKey;useWorkspace.getState().reset();if(key){clearAccountFiles(key);clearAccountPreviewCache(key);cache.clearAccount(key);}setMediaAccount('');setMediaClient(null);await credentials.clear();await clearNotifications();
    if(remote&&api&&session){try{await api.raw('/api/auth/mobile/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:session.refreshToken})},false);}catch{/* Local logout must still complete offline. */}}api?.invalidate();
  }
  dispose(){this.active=false;this.stopHttpSync();this.disconnect();this.stopAppState?.();this.stopAppState=null;}
}
