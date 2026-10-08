import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { z } from 'zod';
import { ApiClient, ApiError, errorDiagnostic, errorText } from './client';
import { hideResultSchema, reactionResultSchema, topicCreatedRef } from '../domain/command-results';
import { setMediaAccount, setMediaClient, clearAccountPreviewCache, rememberEmotes } from './media';
import { topicReadResultSchema } from './inbox-read';
import { topicProjectionLimit, topicProjectionResultSchema, topicProjectionsSchema } from '../domain/topic-projections';
import { bootstrapSchema, cardResolutionSchema, chatSettingsResponseSchema, conversationSchema, draftSchema, emoteCollectionSchema, emoteLibrarySchema, emoteListSchema, emoteSchema, parseMessage, profileResponseSchema, sessionSchema, topicSchema, type Attachment, type ChatSettingsPatch, type Draft, type MentionSpan, type Message, type WorkspaceEvent } from '../domain/contracts';
import { composeBlocks } from '../domain/compose';
import { assertAllowedCardAction } from '../domain/actions';
import { clearAccountFiles } from './transfers';
import { clearAvatarSelections, cleanupAvatarCopies, readAvatarBytes, type AvatarSelection } from './avatar';
import { mergeMessages, useWorkspace } from '../domain/store';
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
  // A denied resource invalidates permission snapshots that began before the denial.
  private authorizationRevision=0;
  private avatarRevision=0;
  private avatarRequest=0;
  private pendingTopicDrafts:{account:string;drafts:Record<string,Draft>}|null=null;
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
  start(){this.attach();if(this.starting)return this.starting;try{cleanupAvatarCopies();}catch{/* Disposable cache cleanup cannot prevent restoring credentials. */}const task=this.restore();this.starting=task;void task.finally(()=>{if(this.starting===task)this.starting=null;});return task;}
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
  private persistDrafts(account:string){
    const state=useWorkspace.getState();if(state.accountKey!==account)return;
    const pending=this.pendingTopicDrafts?.account===account?this.pendingTopicDrafts.drafts:{};
    cache.set(`${account}:drafts`,{...pending,...state.drafts});
  }
  private restoreLocal(key:string,restoreMessages=false,deniedTopics:ReadonlySet<string>=new Set()){
    const visible=useWorkspace.getState().conversations;
    const raw=cache.get(`${key}:drafts`);
    const asDrafts=z.record(draftSchema).safeParse(raw);
    const asStrings=z.record(z.string()).safeParse(raw);
    const parsed=asDrafts.success?asDrafts.data:asStrings.success?Object.fromEntries(Object.entries(asStrings.data).map(([id,text])=>[id,{text,mentionIds:[] as string[]}])):null;
    this.pendingTopicDrafts={account:key,drafts:{}};
    if(parsed){
      const allowed:Record<string,Draft>={};
      for(const [id,draft] of Object.entries(parsed)){
        if(!id.startsWith('topic:')){if(visible[id])allowed[id]=draft;continue;}
        const state=useWorkspace.getState(),topic=state.topics[id.slice(6)];
        if(deniedTopics.has(id)||!state.bootstrap?.permissions.canReadConversations||(topic&&!this.canReadBucket(id)))cache.remove(`${key}:messages:${id}`);
        else if(topic)allowed[id]=draft;
        // Cold-start topic membership is unknown until a successful inventory request.
        // Keep that draft private and durable without projecting it into the chat store.
        else this.pendingTopicDrafts.drafts[id]=draft;
      }
      useWorkspace.setState({drafts:allowed});this.persistDrafts(key);
    }
    if(restoreMessages)for(const id of Object.keys(visible)){
      const rows=z.array(z.record(z.unknown())).safeParse(cache.get(`${key}:messages:${id}`));
      if(!rows.success)continue;
      const messages=rows.data.map(row=>parseMessage(row.content?row:{...row,content:{format:'duallane.message+json;v=1',blocks:row.blocks}})).filter((message):message is Message=>!!message&&message.conversationId===id);
      useWorkspace.getState().setMessages(id,messages);
    }
  }
  async bootstrap(refreshMessages=false){const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,avatarRevision=this.avatarRevision;let authorizationRevision=this.authorizationRevision;if(this.forced())return;
    const loaded=Object.keys(useWorkspace.getState().messages);
    let b=await api.json('/api/workspace/bootstrap',bootstrapSchema);if(!this.current(epoch)||this.api!==api||useWorkspace.getState().accountKey!==account||this.authorizationRevision!==authorizationRevision)return;
    const key=`${api.origin}:${b.auth.currentUser.id}`;
    // A pre-mutation snapshot still applies authorization; only its old self-avatar is superseded.
    const currentUser=useWorkspace.getState().bootstrap?.auth.currentUser;
    if(avatarRevision!==this.avatarRevision&&account===key&&currentUser?.id===b.auth.currentUser.id){
      b={...b,auth:{...b.auth,currentUser:{...b.auth.currentUser,avatarUrl:currentUser.avatarUrl}},members:b.members.map(member=>member.id===currentUser.id?{...member,avatarUrl:currentUser.avatarUrl}:member)};
    }
    const state=useWorkspace.getState(),visibleIds=new Set(b.permissions.canReadConversations?b.conversations.map(conversation=>conversation.id):[]);
    const deniedTopics=new Set(Object.values(state.topics).filter(topic=>!visibleIds.has(topic.conversationId)).map(topic=>`topic:${topic.id}`));
    if((state.bootstrap?.permissions.canReadConversations&&!b.permissions.canReadConversations)||Object.keys(state.conversations).some(id=>!visibleIds.has(id)))authorizationRevision=++this.authorizationRevision;
    const previous=bootstrapSchema.safeParse(cache.get(`${key}:bootstrap`));
    if(previous.success)for(const conversation of previous.data.conversations)if(!b.permissions.canReadConversations||!b.conversations.some(item=>item.id===conversation.id))cache.remove(`${key}:messages:${conversation.id}`);
    useWorkspace.getState().applyBootstrap(b,key);setMediaAccount(key);cache.set(`${key}:bootstrap`,b);this.restoreLocal(key,false,deniedTopics);
    for(const bucket of new Set([...loaded,...deniedTopics]))if(!this.canReadBucket(bucket))cache.remove(`${key}:messages:${bucket}`);
    if(api.session)await credentials.save({origin:api.origin,refreshToken:api.session.refreshToken,userId:b.auth.currentUser.id});
    if(!this.current(epoch)||this.api!==api||useWorkspace.getState().accountKey!==key||this.authorizationRevision!==authorizationRevision)return;
    void this.chatSettings().then(result=>{if(this.current(epoch))useWorkspace.getState().setChatSettings(result.settings);}).catch(()=>undefined);
    void this.listTopics().catch(()=>undefined);
    if(refreshMessages)await Promise.all(loaded.filter(id=>!!useWorkspace.getState().conversations[id]||id.startsWith('topic:')).map(id=>this.refreshMessageWindow(id)));
  }
  draft(id:string,text:string){this.patchDraft(id,{text});}
  patchDraft(id:string,patch:Partial<Draft>){useWorkspace.getState().setDraft(id,patch);this.persistDrafts(useWorkspace.getState().accountKey);}
  private canReadBucket(bucket:string){
    const s=useWorkspace.getState();
    if(!s.bootstrap?.permissions.canReadConversations)return false;
    if(!bucket.startsWith('topic:'))return !!s.conversations[bucket];
    const topic=s.topics[bucket.slice(6)];
    return !!topic?.joined&&!!s.conversations[topic.conversationId];
  }
  private messagePath(bucket:string){return bucket.startsWith('topic:')?`/api/workspace/topics/${encodeURIComponent(bucket.slice(6))}/messages`:`/api/workspace/conversations/${encodeURIComponent(bucket)}/messages`;}
  private belongsToBucket(message:Message,bucket:string){return bucket.startsWith('topic:')?message.topicId===bucket.slice(6)&&message.conversationId===useWorkspace.getState().topics[bucket.slice(6)]?.conversationId:message.conversationId===bucket&&!message.topicId;}
  private async loadMessages(bucket:string,before?:string){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,authorizationRevision=this.authorizationRevision;
    const topicId=bucket.startsWith('topic:')?bucket.slice(6):undefined;
    const parent=topicId?useWorkspace.getState().topics[topicId]?.conversationId:bucket;
    const current=()=>this.current(epoch)&&this.api===api&&useWorkspace.getState().accountKey===account&&this.authorizationRevision===authorizationRevision
      &&(!topicId||useWorkspace.getState().topics[topicId]?.conversationId===parent);
    for(let attempt=0;attempt<3;attempt++){
      if(!current()||!this.canReadBucket(bucket))return 0;
      const previous=useWorkspace.getState().messages[bucket];
      const result=await api.json(`${this.messagePath(bucket)}?limit=50${before?`&before=${encodeURIComponent(before)}`:''}`,z.object({messages:z.array(z.unknown())}));
      if(!current()||!this.canReadBucket(bucket))return 0;
      // A page cannot overwrite a canonical event or command that arrived while it was loading.
      // Refetch instead of retaining arbitrary old rows: a fresh stable page still applies retention.
      if(useWorkspace.getState().messages[bucket]!==previous)continue;
      const messages=result.messages.map(parseMessage).filter((m):m is Message=>!!m&&this.belongsToBucket(m,bucket));
      useWorkspace.getState().acceptMessageRead(bucket,messages,api,before);
      cache.set(`${account}:messages:${bucket}`,useWorkspace.getState().messages[bucket]);
      return messages.length;
    }
    throw new Error('消息正在同步，请重试');
  }
  private clearDeniedMessageWindow(bucket:string,current:()=>boolean){
    if(!current())return;
    const topicId=bucket.startsWith('topic:')?bucket.slice(6):undefined;
    const state=useWorkspace.getState(),account=state.accountKey;
    this.authorizationRevision++;
    const removed=new Set([bucket,...Object.keys(state.messages).filter(id=>!topicId&&id.startsWith('topic:')&&state.topics[id.slice(6)]?.conversationId===bucket),...(!topicId?Object.values(state.topics).filter(topic=>topic.conversationId===bucket).map(topic=>`topic:${topic.id}`):[])]);
    if(topicId){
      const topic=state.topics[topicId];
      if(topic)state.upsertTopic({...topic,joined:false});
      else useWorkspace.setState(s=>({
        messages:Object.fromEntries(Object.entries(s.messages).filter(([id])=>id!==bucket)),
        drafts:Object.fromEntries(Object.entries(s.drafts).filter(([id])=>id!==bucket)),
        messageReads:Object.fromEntries(Object.entries(s.messageReads).filter(([id])=>id!==bucket)),
      }));
    }
    else if(state.bootstrap)state.applyBootstrap({...state.bootstrap,conversations:Object.values(state.conversations).filter(conversation=>conversation.id!==bucket)},account);
    for(const id of removed){cache.remove(`${account}:messages:${id}`);if(this.pendingTopicDrafts?.account===account)delete this.pendingTopicDrafts.drafts[id];}
    const next=useWorkspace.getState();this.persistDrafts(account);if(next.bootstrap)cache.set(`${account}:bootstrap`,next.bootstrap);
  }
  private async refreshMessageWindow(bucket:string){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,authorizationRevision=this.authorizationRevision;
    const topicId=bucket.startsWith('topic:')?bucket.slice(6):undefined;
    const parent=topicId?useWorkspace.getState().topics[topicId]?.conversationId:bucket;
    const current=()=>this.current(epoch)&&this.api===api&&useWorkspace.getState().accountKey===account&&this.authorizationRevision===authorizationRevision
      &&(!topicId||useWorkspace.getState().topics[topicId]?.conversationId===parent);
    const readable=()=>current()&&this.canReadBucket(bucket);
    const clearDenied=()=>this.clearDeniedMessageWindow(bucket,current);
    const compare=(left:Message,right:Message)=>left.createdAt.localeCompare(right.createdAt)||left.id.localeCompare(right.id);
    for(let attempt=0;attempt<3;attempt++){
      if(!readable()){if(current()&&!this.canReadBucket(bucket))clearDenied();return 0;}
      const previous=useWorkspace.getState().messages[bucket];
      const oldest=previous?.find(message=>!message.status);
      let fresh:Message[]=[],before:Message|undefined,changed=false;
      try{
        for(;;){
          const result=await api.json(`${this.messagePath(bucket)}?limit=50${before?`&before=${encodeURIComponent(before.id)}`:''}`,z.object({messages:z.array(z.unknown())}));
          if(!readable()){if(current()&&!this.canReadBucket(bucket))clearDenied();return 0;}
          if(useWorkspace.getState().messages[bucket]!==previous){changed=true;break;}
          const page=mergeMessages([],result.messages.map(parseMessage).filter((message):message is Message=>!!message&&this.belongsToBucket(message,bucket)));
          const cursor=before;
          if(result.messages.length!==page.length||(cursor&&page.some(message=>compare(message,cursor)>=0)))throw new ApiError('response.invalid',0);
          // An empty before-page can mean its cursor was deleted during pagination.
          // Verify that cursor instead of treating a stale cursor as the end of history.
          if(cursor&&!page.length){
            const anchor=await api.json(`${this.messagePath(bucket)}?around=${encodeURIComponent(cursor.id)}&limit=1`,z.object({messages:z.array(z.unknown())}));
            if(!readable()){if(current()&&!this.canReadBucket(bucket))clearDenied();return 0;}
            if(useWorkspace.getState().messages[bucket]!==previous){changed=true;break;}
            if(!anchor.messages.map(parseMessage).some(message=>!!message&&message.id===cursor.id&&this.belongsToBucket(message,bucket))){changed=true;break;}
          }
          fresh=mergeMessages(fresh,page);
          const first=page[0];
          if(!oldest||result.messages.length<50||(first&&compare(first,oldest)<=0))break;
          if(!first)throw new ApiError('response.invalid',0);
          before=first;
        }
      }catch(error){
        if(error instanceof ApiError&&[403,404].includes(error.status))clearDenied();
        throw error;
      }
      if(changed)continue;
      if(!readable()){if(current()&&!this.canReadBucket(bucket))clearDenied();return 0;}
      // Replace once with freshly authorized rows. Absence inside this rebuilt
      // window applies deletion/retention; absence from only the latest page does not.
      useWorkspace.getState().acceptMessageRead(bucket,oldest?fresh.filter(message=>compare(message,oldest)>=0):fresh,api);
      cache.set(`${account}:messages:${bucket}`,useWorkspace.getState().messages[bucket]);
      return fresh.length;
    }
    throw new Error('消息正在同步，请重试');
  }
  async messages(id:string,before?:string){return this.loadMessages(id,before);}
  async topicMessages(id:string,before?:string){return this.loadMessages(`topic:${id}`,before);}
  async open(id:string,options?:{preserveLoadedWindow?:boolean}){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,authorizationRevision=this.authorizationRevision;
    const preserve=!!options?.preserveLoadedWindow&&useWorkspace.getState().messages[id]!==undefined;
    const current=()=>this.current(epoch)&&this.api===api&&useWorkspace.getState().accountKey===account&&this.authorizationRevision===authorizationRevision;
    try{
      const result=await api.json(`/api/workspace/conversations/${encodeURIComponent(id)}`,z.object({conversation:conversationSchema}));
      if(!current()||!useWorkspace.getState().bootstrap?.permissions.canReadConversations||(preserve&&!this.canReadBucket(id)))return;
      if(result.conversation.id!==id)throw new ApiError('response.invalid',0,'body.schema');
      useWorkspace.setState(s=>({conversations:{...s.conversations,[id]:result.conversation}}));
      // A same-route notification revalidates its loaded history; a latest page
      // alone cannot establish that older authorized rows were deleted.
      return preserve?this.refreshMessageWindow(id):this.messages(id);
    }catch(error){
      if(error instanceof ApiError&&[403,404].includes(error.status))this.clearDeniedMessageWindow(id,current);
      throw error;
    }
  }
  async openTopic(id:string,options?:{preserveLoadedWindow?:boolean}){
    const bucket=`topic:${id}`,api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,authorizationRevision=this.authorizationRevision;
    const preserve=!!options?.preserveLoadedWindow&&useWorkspace.getState().messages[bucket]!==undefined;
    const parent=useWorkspace.getState().topics[id]?.conversationId;
    const current=()=>this.current(epoch)&&this.api===api&&useWorkspace.getState().accountKey===account&&this.authorizationRevision===authorizationRevision
      &&useWorkspace.getState().topics[id]?.conversationId===parent;
    try{
      const result=await api.json(`/api/workspace/topics/${encodeURIComponent(id)}`,z.object({topic:topicSchema}));
      if(!current()||!useWorkspace.getState().bootstrap?.permissions.canReadConversations||(preserve&&!this.canReadBucket(bucket)))return;
      if(result.topic.id!==id||(preserve&&result.topic.conversationId!==parent))throw new ApiError('response.invalid',0,'body.schema');
      useWorkspace.getState().upsertTopic(result.topic);
      if(preserve&&!result.topic.joined)this.clearDeniedMessageWindow(bucket,current);
      if(result.topic.joined)return preserve?this.refreshMessageWindow(bucket):this.topicMessages(id);
      return 0;
    }catch(error){
      if(error instanceof ApiError&&[403,404].includes(error.status))this.clearDeniedMessageWindow(bucket,current);
      throw error;
    }
  }
  async send(id:string,text:string,existing?:Message,attachmentId?:string,options?:{topicId?:string;replyToMessageId?:string|null;mentionIds?:string[];mentionSpans?:MentionSpan[];upload?:()=>Promise<Attachment|null>;uploadTaskId?:string;syncToGroup?:boolean;preserveDraft?:boolean;shouldSend?:()=>boolean;}){
    const s=useWorkspace.getState();const topicId=options?.topicId??existing?.topicId;const conversationId=existing?.conversationId??id;
    const bucket=topicId?`topic:${topicId}`:conversationId;
    const topic=topicId?s.topics[topicId]:undefined;
    const canSend=topicId?!!topic&&topic.conversationId===conversationId&&topic.joined&&topic.status==='open':!!s.conversations[conversationId]?.capabilities.canSendMessage;
    if(!s.bootstrap||!this.canReadBucket(bucket)||!canSend||this.forced()||options?.shouldSend?.()===false)throw new Error('Cannot send');
    const api=this.requireApi(),epoch=this.epoch,account=s.accountKey;
    // Membership can be revoked without changing the login epoch while an upload or command is pending.
    const readable=()=>this.current(epoch)&&this.api===api&&useWorkspace.getState().accountKey===account&&this.canReadBucket(bucket)&&(!topicId||useWorkspace.getState().topics[topicId]?.conversationId===conversationId);
    const canStillSend=()=>{
      const state=useWorkspace.getState(),currentTopic=topicId?state.topics[topicId]:undefined;
      return readable()&&!this.forced()&&options?.shouldSend?.()!==false&&(topicId?currentTopic?.status==='open':!!state.conversations[conversationId]?.capabilities.canSendMessage);
    };
    const clientMessageId=existing?.clientMessageId??Crypto.randomUUID();if(this.inFlight.has(clientMessageId))return;
    const members=s.conversations[conversationId]?.members??s.bootstrap.members;
    const replyTo=options?.replyToMessageId===undefined?existing?.replyToMessageId??null:options.replyToMessageId;
    const mentionIds=options?.mentionIds??[];
    let fileId=attachmentId??existing?.attachments[0]?.id;
    const uploadTaskId=options?.uploadTaskId??existing?.pendingUploadTaskId;
    const syncToGroup=existing?.pendingSyncToGroup??options?.syncToGroup??false;
    let blocks=existing?.blocks.length?existing.blocks:composeBlocks(text,members,mentionIds,fileId,options?.mentionSpans);
    if(!blocks.length&&!options?.upload&&!uploadTaskId)return;
    let pending:Message=existing??{id:clientMessageId,conversationId,topicId,authorId:s.bootstrap.auth.currentUser.id,authorName:s.bootstrap.auth.currentUser.displayName,kind:'user',clientMessageId,createdAt:new Date().toISOString(),plainText:text,replyToMessageId:replyTo,hiddenByCurrentUser:false,attachments:[],reactions:[],blocks,fallback:false};
    pending={...pending,pendingUploadTaskId:uploadTaskId,pendingSyncToGroup:topicId?syncToGroup:undefined};
    this.inFlight.add(clientMessageId);s.upsertMessage({...pending,status:'sending'},bucket);if(!existing&&!options?.preserveDraft)this.patchDraft(bucket,{text:'',mentionIds:[],mentionSpans:[],replyToMessageId:undefined,pendingAttachment:undefined});
    try{
      if(uploadTaskId&&!fileId&&!options?.upload)throw new Error('Upload unavailable');
      if(options?.upload&&!fileId){
        const file=await options.upload();
        if(!readable())return;
        if(!file)throw new Error('Upload paused');
        fileId=file.id;
        blocks=existing?.blocks.length?[...existing.blocks.filter(block=>block.type!=='attachment'),{type:'attachment',attachmentId:file.id}]:composeBlocks(text,members,mentionIds,file.id,options?.mentionSpans);
        pending={...pending,attachments:[file],blocks,plainText:text||file.fileName};
        useWorkspace.getState().upsertMessage({...pending,status:'sending'},bucket);
        if(!canStillSend())throw new Error('Cannot send');
      }
      if(!readable())return;
      if(!canStillSend())throw new Error('Cannot send');
      if(!blocks.length)throw new Error('Cannot send');
      const body={clientMessageId,content:{format:'duallane.message+json;v=1',blocks},replyToMessageId:replyTo,...(topicId?{syncToGroup}:{conversationId})};
      const path=topicId?`/api/workspace/topics/${encodeURIComponent(topicId)}/messages`:'/api/workspace/messages';
      const r=await api.json(path,z.object({message:z.unknown()}).passthrough(),body);
      if(!readable())return;
      const parsed=parseMessage('message' in r?r.message:r);if(!parsed||!this.belongsToBucket(parsed,bucket))throw new Error('Invalid message');useWorkspace.getState().upsertMessage(parsed,bucket);}
    catch(error){if(readable())useWorkspace.getState().upsertMessage({...pending,status:'failed',error:errorText(error)},bucket);throw error;}finally{this.inFlight.delete(clientMessageId);}
  }
  isForced(){ return this.forced(); }
  async markRead(id:string,messageId:string,topic=false){
    if(!this.foreground)return;const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,key=topic?`topic:${id}`:id;
    if(!this.canReadBucket(key))return;
    if(topic){
      const result=await api.json(`/api/workspace/topics/${encodeURIComponent(id)}/read`,topicReadResultSchema,{messageId},'POST');
      if(!this.current(epoch)||this.api!==api||account!==useWorkspace.getState().accountKey||!this.canReadBucket(key))return;
      if(result.read.topicId!==id)throw new ApiError('response.invalid',0,'body.schema');
      useWorkspace.setState(s=>{const current=s.topics[id];return current?{topics:{...s.topics,[id]:{...current,lastReadMessageId:result.read.lastReadMessageId,unreadCount:result.read.unreadCount??0}}}:s;});
      return;
    }
    const result=await api.json(`/api/workspace/conversations/${encodeURIComponent(id)}/read`,z.object({conversation:conversationSchema}),{messageId});
    if(!this.current(epoch)||this.api!==api||account!==useWorkspace.getState().accountKey||!this.canReadBucket(key))return;
    if(result.conversation.id!==id)throw new ApiError('response.invalid',0,'body.schema');
    useWorkspace.setState(s=>({conversations:{...s.conversations,[id]:result.conversation}}));
  }
  async notification(id:string,level:'all'|'mentions'|'muted'){await this.requireApi().json(`/api/workspace/conversations/${encodeURIComponent(id)}/notification`,z.unknown(),{level},'PATCH');await this.bootstrap();}
  async updateProfile(patch:{nickname?:string|null;searchDiscoverable?:boolean;recallReason?:string}){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,avatarRevision=this.avatarRevision;
    const result=await api.json('/api/workspace/me/profile',profileResponseSchema,patch,'PATCH');
    if(!this.current(epoch)||this.api!==api||useWorkspace.getState().accountKey!==account)throw new Error('Stale session');
    useWorkspace.setState(s=>{
      if(!s.bootstrap||s.bootstrap.auth.currentUser.id!==result.user.id)return s;
      const user=avatarRevision===this.avatarRevision?result.user:{...result.user,avatarUrl:s.bootstrap.auth.currentUser.avatarUrl};
      const bootstrap={...s.bootstrap,auth:{...s.bootstrap.auth,currentUser:{...s.bootstrap.auth.currentUser,...user}},members:s.bootstrap.members.map(member=>member.id===result.user.id?{...member,...user}:member)};
      cache.set(`${s.accountKey}:bootstrap`,bootstrap);
      return {bootstrap};
    });
    return result.user;
  }
  avatarScope(){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,userId=useWorkspace.getState().bootstrap?.auth.currentUser.id;
    return ()=>!!account&&!!userId&&this.current(epoch)&&this.api===api&&!this.forced()&&useWorkspace.getState().accountKey===account&&useWorkspace.getState().bootstrap?.auth.currentUser.id===userId;
  }
  async updateAvatar(selection:AvatarSelection,current:()=>boolean=()=>true){
    try{
      const scoped=this.avatarScope();
      if(!scoped()||!current())throw new Error('Stale session');
      const bytes=readAvatarBytes(selection);
      if(!scoped()||!current())throw new Error('Stale session');
      return await this.mutateAvatar({method:'PUT',headers:{'Content-Type':selection.mimeType},body:bytes},()=>scoped()&&current());
    }finally{selection.dispose();}
  }
  async clearAvatar(current:()=>boolean=()=>true){return this.mutateAvatar({method:'DELETE'},current);}
  private async mutateAvatar(init:RequestInit,current:()=>boolean){
    const scoped=this.avatarScope(),api=this.requireApi(),request=++this.avatarRequest,userId=useWorkspace.getState().bootstrap?.auth.currentUser.id;
    const valid=()=>scoped()&&current()&&request===this.avatarRequest;
    if(!valid())throw new Error('Stale session');
    const response=await api.raw('/api/workspace/me/avatar',init);
    if(!valid())throw new Error('Stale session');
    let payload:unknown;
    try{payload=await response.json();}catch{throw new ApiError('response.invalid',response.status,'body.non_json');}
    if(!valid())throw new Error('Stale session');
    const result=profileResponseSchema.safeParse(payload);
    if(!result.success||result.data.user.id!==userId||result.data.user.avatarUrl===undefined)throw new ApiError('response.invalid',response.status,'body.schema');
    const avatarUrl=result.data.user.avatarUrl;
    this.avatarRevision++;
    useWorkspace.setState(s=>{
      if(!s.bootstrap)return s;
      const bootstrap={...s.bootstrap,auth:{...s.bootstrap.auth,currentUser:{...s.bootstrap.auth.currentUser,avatarUrl}},members:s.bootstrap.members.map(member=>member.id===userId?{...member,avatarUrl}:member)};
      cache.set(`${s.accountKey}:bootstrap`,bootstrap);return {bootstrap};
    });
    return result.data.user;
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
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,authorizationRevision=this.authorizationRevision;
    const path=conversationId?`/api/workspace/conversations/${encodeURIComponent(conversationId)}/topics`:'/api/workspace/topics/mine';
    const result=await api.json(path,z.object({topics:z.array(topicSchema)}));
    if(this.current(epoch)&&this.api===api&&useWorkspace.getState().accountKey===account&&this.authorizationRevision===authorizationRevision){
      const previous=useWorkspace.getState().topics;
      if(Object.values(previous).some(topic=>topic.joined&&(!conversationId||topic.conversationId===conversationId)&&!result.topics.some(next=>next.id===topic.id&&next.joined&&next.conversationId===topic.conversationId)))this.authorizationRevision++;
      if(conversationId)for(const topic of result.topics)useWorkspace.getState().upsertTopic(topic);
      else {
        useWorkspace.getState().setTopics(result.topics);
        useWorkspace.getState().pruneTopics(new Set(result.topics.map(topic=>topic.id)));
      }
      const current=useWorkspace.getState();
      for(const topic of Object.values(previous))if((!conversationId||topic.conversationId===conversationId)&&!this.canReadBucket(`topic:${topic.id}`))cache.remove(`${account}:messages:topic:${topic.id}`);
      if(this.pendingTopicDrafts?.account===account){
        const drafts={...current.drafts};
        for(const [bucket,draft] of Object.entries(this.pendingTopicDrafts.drafts)){
          if(conversationId&&!result.topics.some(topic=>`topic:${topic.id}`===bucket))continue;
          if(this.canReadBucket(bucket)){if(!drafts[bucket])drafts[bucket]=draft;}
          else cache.remove(`${account}:messages:${bucket}`);
          delete this.pendingTopicDrafts.drafts[bucket];
        }
        useWorkspace.setState({drafts});
      }
      this.persistDrafts(account);
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
  async leaveTopic(id:string){const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey;const result=await api.json(`/api/workspace/topics/${encodeURIComponent(id)}/leave`,z.object({topic:topicSchema}),{});if(!this.current(epoch)||this.api!==api||useWorkspace.getState().accountKey!==account)throw new Error('Stale session');this.authorizationRevision++;useWorkspace.getState().upsertTopic(result.topic);cache.remove(`${account}:messages:topic:${id}`);if(this.pendingTopicDrafts?.account===account)delete this.pendingTopicDrafts.drafts[`topic:${id}`];this.persistDrafts(account);return result.topic;}
  async topicNotification(id:string,level:'all'|'mentions'|'muted'){const result=await this.requireApi().json(`/api/workspace/topics/${encodeURIComponent(id)}/notification`,z.object({topic:topicSchema}),{level},'PATCH');useWorkspace.getState().upsertTopic(result.topic);}
  async topicProjections(id:string){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey;
    const result=await api.json(`/api/workspace/topics/${encodeURIComponent(id)}/projections?limit=${topicProjectionLimit}`,topicProjectionsSchema);
    if(!this.current(epoch)||this.api!==api||account!==useWorkspace.getState().accountKey||!this.canReadBucket(`topic:${id}`))throw new Error('Stale session');
    return result.projections;
  }
  async setTopicProjection(id:string,messageId:string,enabled:boolean){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey;
    const result=await api.json(`/api/workspace/topics/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/sync`,topicProjectionResultSchema,enabled?{}:undefined,enabled?'POST':'DELETE');
    if(!this.current(epoch)||this.api!==api||account!==useWorkspace.getState().accountKey||!this.canReadBucket(`topic:${id}`))throw new Error('Stale session');
    if(result.projection&&result.projection.topicMessageId!==messageId)throw new Error('Invalid topic projection');
    return result.projection;
  }
  async recall(messageId:string){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,key=this.messageBucketById(messageId);
    const r=await api.json(`/api/workspace/messages/${encodeURIComponent(messageId)}/recall`,z.object({message:z.unknown()}),{},'POST');
    if(!key||!this.current(epoch)||this.api!==api||account!==useWorkspace.getState().accountKey||!this.canReadBucket(key))return;
    const parsed=parseMessage(r.message);
    if(!parsed||parsed.id!==messageId||!this.belongsToBucket(parsed,key))throw new ApiError('response.invalid',0,'body.schema');
    useWorkspace.getState().upsertMessage(parsed,key);
    cache.set(`${account}:messages:${key}`,useWorkspace.getState().messages[key]);
  }
  async hide(messageId:string,hidden:boolean,bucket?:string){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey;
    const key=bucket??this.messageBucketById(messageId);
    const r=await api.json(`/api/workspace/messages/${encodeURIComponent(messageId)}/hidden`,hideResultSchema,hidden?{}:undefined,hidden?'PUT':'DELETE');
    if(r.messageId!==messageId)throw new ApiError('response.invalid',0,'body.schema');
    if(!key||!this.current(epoch)||this.api!==api||useWorkspace.getState().accountKey!==account||!this.canReadBucket(key))return;
    if(r.hidden){
      useWorkspace.getState().patchMessage(key,messageId,{hiddenByCurrentUser:true,plainText:'消息已不可用',attachments:[],blocks:[]});
      cache.set(`${account}:messages:${key}`,useWorkspace.getState().messages[key]);
      return;
    }
    for(let attempt=0;attempt<3;attempt++){
      const previous=useWorkspace.getState().messages[key]?.find(message=>message.id===messageId);
      const result=await api.json(`${this.messagePath(key)}?around=${encodeURIComponent(messageId)}&limit=1`,z.object({messages:z.array(z.unknown())}));
      if(!this.current(epoch)||this.api!==api||useWorkspace.getState().accountKey!==account||!this.canReadBucket(key))return;
      if(useWorkspace.getState().messages[key]?.find(message=>message.id===messageId)!==previous)continue;
      const message=result.messages.map(parseMessage).find((item):item is Message=>!!item&&item.id===messageId&&this.belongsToBucket(item,key));
      if(!message)throw new ApiError('message.not_found',404);
      useWorkspace.getState().upsertMessage(message,key);
      cache.set(`${account}:messages:${key}`,useWorkspace.getState().messages[key]);
      return;
    }
    throw new Error('消息正在同步，请重试');
  }
  async react(messageId:string,emoteKey:string,remove=false,bucket?:string){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,key=bucket??this.messageBucketById(messageId);
    const path=`/api/workspace/messages/${encodeURIComponent(messageId)}/reactions${remove?`/${encodeURIComponent(emoteKey)}`:''}`;
    const r=await api.json(path,reactionResultSchema,remove?undefined:{emoteKey},remove?'DELETE':'POST');
    if(r.messageId!==messageId)throw new ApiError('response.invalid',0,'body.schema');
    if(!key||!this.current(epoch)||this.api!==api||account!==useWorkspace.getState().accountKey||!this.canReadBucket(key))return;
    useWorkspace.getState().patchMessage(key,messageId,{reactions:r.reactions});
    cache.set(`${account}:messages:${key}`,useWorkspace.getState().messages[key]);
  }
  async pin(conversationId:string,messageId:string,remove=false){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey,key=this.messageBucketById(messageId)??conversationId;
    if(remove)await api.json(`/api/workspace/groups/${encodeURIComponent(conversationId)}/pins/${encodeURIComponent(messageId)}`,z.unknown(),undefined,'DELETE');
    else await api.json(`/api/workspace/groups/${encodeURIComponent(conversationId)}/pins`,z.unknown(),{messageId});
    if(!this.current(epoch)||this.api!==api||account!==useWorkspace.getState().accountKey||!this.canReadBucket(key))return;
    if(key.startsWith('topic:')){
      // Refresh only the changed canonical row so pinning does not discard a historical reading window.
      for(let attempt=0;attempt<3;attempt++){
        const previous=useWorkspace.getState().messages[key]?.find(message=>message.id===messageId);
        const result=await api.json(`${this.messagePath(key)}?around=${encodeURIComponent(messageId)}&limit=1`,z.object({messages:z.array(z.unknown())}));
        if(!this.current(epoch)||this.api!==api||account!==useWorkspace.getState().accountKey||!this.canReadBucket(key))return;
        if(useWorkspace.getState().messages[key]?.find(message=>message.id===messageId)!==previous)continue;
        const message=result.messages.map(parseMessage).find((item):item is Message=>!!item&&item.id===messageId&&this.belongsToBucket(item,key));
        if(!message)throw new ApiError('message.not_found',404);
        useWorkspace.getState().upsertMessage(message,key);
        cache.set(`${account}:messages:${key}`,useWorkspace.getState().messages[key]);
        return;
      }
      throw new Error('消息正在同步，请重试');
    }
    const result=await api.json(`/api/workspace/conversations/${encodeURIComponent(conversationId)}`,z.object({conversation:conversationSchema}));
    if(!this.current(epoch)||this.api!==api||account!==useWorkspace.getState().accountKey||!this.canReadBucket(key))return;
    useWorkspace.setState(s=>({conversations:{...s.conversations,[conversationId]:result.conversation}}));
    await this.messages(conversationId);
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
  async resolveCard(cardId:string,context?:{conversationId:string;topicId?:string|null}){
    const api=this.requireApi(),epoch=this.epoch,account=useWorkspace.getState().accountKey;
    const readable=()=>!!useWorkspace.getState().bootstrap?.permissions.canReadConversations&&(!context||this.canReadBucket(context.topicId?`topic:${context.topicId}`:context.conversationId))
      &&(!context?.topicId||useWorkspace.getState().topics[context.topicId]?.conversationId===context.conversationId);
    if(!readable())throw new ApiError('permission.denied',403);
    const result=await api.json(`/api/workspace/cards/${encodeURIComponent(cardId)}`,z.object({card:cardResolutionSchema}));
    if(!this.current(epoch)||this.api!==api||account!==useWorkspace.getState().accountKey)throw new Error('Stale session');
    if(!readable())throw new ApiError('permission.denied',403);
    if(result.card.block.cardId&&result.card.block.cardId!==cardId)throw new ApiError('response.invalid',0,'body.schema');
    return result.card;
  }
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
    if(['card.created','card.updated','card.invalidated'].includes(event.type)){
      const reference=z.object({cardId:z.string().min(1).max(256),revision:z.number().int().nonnegative().default(0)}).safeParse({cardId:event.payload.cardId??event.targetId,revision:event.payload.revision});
      if(reference.success&&s.bootstrap.permissions.canReadConversations&&(!event.conversationId||this.canReadBucket(event.conversationId)))s.invalidateCard(reference.data.cardId,reference.data.revision,event.type==='card.invalidated');
      return;
    }
    if(event.type==='topic.message.created'){
      const ref=topicCreatedRef(event.payload);
      const parsed=parseMessage(event.payload.message);
      if(parsed&&(parsed.topicId||ref.topicId)){
        const bucket=`topic:${parsed.topicId??ref.topicId}`,epoch=this.epoch;
        await this.listTopics().catch(()=>undefined);
        if(!this.current(epoch)||!this.canReadBucket(bucket))return;
        useWorkspace.getState().upsertMessage(parsed,bucket);
        await this.notifyIfNeeded(parsed,replay,true);
        return;
      }
      if(ref.topicId){
        const epoch=this.epoch;
        await this.listTopics().catch(()=>undefined);
        if(!this.current(epoch)||!this.canReadBucket(`topic:${ref.topicId}`))return;
        await this.topicMessages(ref.topicId).catch(()=>undefined);
        if(!this.current(epoch))return;
        const created=useWorkspace.getState().messages[`topic:${ref.topicId}`]?.find(item=>item.id===ref.topicMessageId);
        if(created)await this.notifyIfNeeded(created,replay,true);
        return;
      }
    }
    const message=parseMessage(event.payload.message);
    if(message){
      if(!this.canReadBucket(message.topicId?`topic:${message.topicId}`:message.conversationId))return;
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
  private async reconnect(){const epoch=this.epoch,api=this.api,account=useWorkspace.getState().accountKey,snapshot=useWorkspace.getState().cardSyncVersion;if(!this.current(epoch)||!api)return;this.disconnect();try{await this.checkPolicy();if(!this.current(epoch)||this.forced())return;if(api.session){await this.bootstrap(true);if(!this.current(epoch)||this.api!==api||account!==useWorkspace.getState().accountKey)return;if(useWorkspace.getState().cardSyncVersion===snapshot)useWorkspace.getState().refreshCards();this.connect();}}catch(error){if(!this.current(epoch))return;if(error instanceof ApiError&&([401,403].includes(error.status)||error.code==='workspace.disabled')){await this.logout(false);useWorkspace.setState({error:errorText(error)});return;}useWorkspace.setState({connection:'连接暂时不可用',error:errorText(error)});this.scheduleRetry();}}
  disconnect(){if(this.retry)clearTimeout(this.retry);if(this.heartbeat)clearInterval(this.heartbeat);if(this.refreshTimer)clearTimeout(this.refreshTimer);this.retry=null;this.heartbeat=null;this.refreshTimer=null;const socket=this.socket;this.socket=null;if(socket)socket.close();}
  private startHttpSync(){if(this.poll||!this.active)return;void this.httpSync();this.poll=setInterval(()=>{void this.httpSync();},8000);}
  private stopHttpSync(){if(this.poll)clearInterval(this.poll);this.poll=null;}
  private async httpSync(){if(!this.active||!this.api?.session||useWorkspace.getState().connection==='已连接')return;try{await this.bootstrap(true);if(this.active&&useWorkspace.getState().connection!=='已连接')useWorkspace.setState({connection:'实时未接通，已用 HTTP 同步'});}catch{/* WebSocket retry continues */}}
  async logout(remote=true){const api=this.api,session=api?.session;this.epoch++;api?.invalidate();this.stopHttpSync();this.disconnect();this.api=null;this.pendingTopicDrafts=null;this.notified.clear();this.inFlight.clear();this.resuming=null;this.starting=null;const key=useWorkspace.getState().accountKey;useWorkspace.getState().reset();if(key){clearAccountFiles(key);clearAccountPreviewCache(key);cache.clearAccount(key);}const avatarCleanup=key?clearAvatarSelections(key).catch(()=>undefined):Promise.resolve();setMediaAccount('');setMediaClient(null);await credentials.clear();await clearNotifications();await avatarCleanup;
    if(remote&&api&&session){try{await api.raw('/api/auth/mobile/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:session.refreshToken})},false);}catch{/* Local logout must still complete offline. */}}api?.invalidate();
  }
  dispose(){this.active=false;this.stopHttpSync();this.disconnect();this.stopAppState?.();this.stopAppState=null;}
}
