import { AppState } from 'react-native';
import { fetch } from 'expo/fetch';
import { Runtime } from '../src/data/runtime';
import { ApiClient } from '../src/data/client';
import { useWorkspace } from '../src/domain/store';
import { parseMessage, type WorkspaceEvent } from '../src/domain/contracts';
import { cache, credentials } from '../src/platform/storage';

jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('expo-web-browser',()=>({openAuthSessionAsync:jest.fn()}));
jest.mock('expo-crypto',()=>({randomUUID:()=> 'synthetic-id',digestStringAsync:async()=> 'synthetic-digest',CryptoDigestAlgorithm:{SHA256:'SHA256'},CryptoEncoding:{BASE64:'base64'}}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.1.0',versionCode:1},config:{apiOrigin:''},redirectUri:'com.timestarry.duallane://oauth',validateOrigin:(s:string)=>s}));
jest.mock('../src/platform/storage',()=>({cache:{get:jest.fn(),set:jest.fn(),remove:jest.fn(),clearAccount:jest.fn()},credentials:{read:jest.fn(),save:jest.fn(async()=>undefined),clear:jest.fn(async()=>undefined)}}));
jest.mock('../src/platform/notifications',()=>({clearNotifications:jest.fn(async()=>undefined),showMessageNotification:jest.fn(async()=>undefined)}));
jest.mock('../src/data/transfers',()=>({clearAccountFiles:jest.fn()}));
const fetchMock=jest.mocked(fetch);
const session={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2099-01-01T00:00:00.000Z',refreshTokenExpiresAt:'2099-02-01T00:00:00.000Z'};
const policy={schemaVersion:1,platform:'android',channel:'internal',latest:{appVersion:'0.1.0',versionCode:1,releaseId:'r1',releaseNotes:[]},minimum:{appVersion:'0.1.0',versionCode:1},recommendation:'none',apkUrl:null,protocol:{eventMajor:1,contentFormats:['duallane.message+json;v=1']}};
const conversation={id:'c1',displayTitle:'Test',type:'group',lastActivityAt:'2026-01-01T00:00:00Z',notificationLevel:'all',capabilities:{canSendMessage:true,canUploadFile:true}};
const bootstrap={auth:{currentUser:{id:'u1',displayName:'Test'}},space:{id:'s1',name:'Test'},eventCursor:4,policy:{dailyQuotaBytes:100,remainingQuotaBytes:100,messageRetentionCount:50},permissions:{canReadConversations:true,canDownload:true},members:[],conversations:[conversation],files:[]};
const topic={id:'t1',conversationId:'c1',title:'Topic',status:'open',joined:true,canJoin:false,allowSyncToGroup:true,participantCount:2,unreadCount:0,notificationLevel:'all' as const,revision:1};
const attachment={id:'a1',fileName:'synthetic.png',mimeType:'image/png',byteSize:3,status:'available',capabilities:{canDownload:true}};
const message={id:'m1',conversationId:'c1',authorId:'u2',authorName:'Peer',kind:'user',createdAt:'2026-01-01T00:00:00Z',plainText:'canonical text',attachments:[attachment],content:{format:'duallane.message+json;v=1',blocks:[{type:'text',text:'canonical text'},{type:'attachment',attachmentId:'a1'}]}};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function response(body:unknown,status=200){return {ok:status<400,status,json:async()=>body} as Awaited<ReturnType<typeof fetch>>;}
function fallback(url:string){return response(url.endsWith('/release-policy')?policy:url.endsWith('/refresh')?session:url.endsWith('/topics/mine')?{topics:[topic]}:bootstrap);}
function windowRows(count:number,isTopic=false){return Array.from({length:count},(_,index)=>({...message,id:`window-${String(index).padStart(3,'0')}`,createdAt:new Date(Date.UTC(2026,0,1,0,index)).toISOString(),...(isTopic?{topicId:'t1'}:{})}));}
function windowPage(url:string,rows:ReturnType<typeof windowRows>){
  const query=new URL(url).searchParams,around=query.get('around'),before=query.get('before');
  if(around)return rows.filter(row=>row.id===around);
  const index=before?rows.findIndex(row=>row.id===before):rows.length;
  return rows.slice(0,Math.max(0,index)).slice(-50);
}
let runtime:Runtime;
beforeEach(async()=>{
  jest.spyOn(console,'warn').mockImplementation(()=>undefined);
  jest.spyOn(AppState,'addEventListener').mockReturnValue({remove:jest.fn()});
  useWorkspace.getState().reset();jest.mocked(cache.get).mockReturnValue(null);jest.mocked(cache.set).mockReset();
  jest.mocked(credentials.read).mockResolvedValue({origin:'https://workspace.example',refreshToken:'synthetic-refresh',userId:'u1'});
  fetchMock.mockImplementation(async url=>fallback(String(url)));
  runtime=new Runtime();jest.spyOn(runtime,'connect').mockImplementation(()=>undefined);await runtime.start();
  useWorkspace.getState().upsertTopic({...topic,notificationLevel:'all'});
});
afterEach(()=>{runtime.dispose();jest.restoreAllMocks();});

test.each([false,true])('same-target notification open preserves the 75-row authorized history until its fresh window completes (topic=%s)',async isTopic=>{
  const bucket=isTopic?'topic:t1':'c1',loaded=windowRows(75,isTopic);
  const fresh=windowRows(76,isTopic).filter(row=>row.id!=='window-010').map(row=>row.id==='window-011'?{...row,recalledAt:'2026-01-02T00:00:00Z',plainText:'synthetic recall notice'}:row);
  useWorkspace.getState().setMessages(bucket,loaded.map(row=>parseMessage(row)!));
  const previous=useWorkspace.getState().messages[bucket],pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(path.endsWith('/conversations/c1'))return response({conversation});
    if(path.endsWith('/topics/t1'))return response({topic});
    if(!path.includes('/messages?'))return fallback(path);
    if(new URL(path).searchParams.has('before')){started.resolve();return pending.promise;}
    return response({messages:windowPage(path,fresh)});
  });
  const opening=isTopic?runtime.openTopic('t1',{preserveLoadedWindow:true}):runtime.open('c1',{preserveLoadedWindow:true});
  await Promise.race([started.promise,opening]);
  expect(useWorkspace.getState().messages[bucket]).toBe(previous);
  expect(useWorkspace.getState().messageReads[bucket]).toBeUndefined();
  pending.resolve(response({messages:windowPage('https://workspace.example/messages?before=window-026',fresh)}));
  await opening;
  const rows=useWorkspace.getState().messages[bucket]!;
  expect(rows.map(row=>row.id)).toEqual(fresh.map(row=>row.id));
  expect(rows.some(row=>row.id==='window-001')).toBe(true);
  expect(rows.some(row=>row.id==='window-010')).toBe(false);
  expect(rows.find(row=>row.id==='window-011')).toMatchObject({recalledAt:'2026-01-02T00:00:00Z',attachments:[],blocks:[]});
  expect(rows.at(-1)?.id).toBe('window-075');
  expect(useWorkspace.getState().messageReads[bucket]).toEqual({revision:1,source:runtime.api,before:undefined});
});

test.each([false,true])('ordinary open retains latest-page behavior for a different notification target (topic=%s)',async isTopic=>{
  const bucket=isTopic?'topic:t1':'c1',loaded=windowRows(75,isTopic),fresh=windowRows(76,isTopic);
  useWorkspace.getState().setMessages(bucket,loaded.map(row=>parseMessage(row)!));
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(path.endsWith('/conversations/c1'))return response({conversation});
    if(path.endsWith('/topics/t1'))return response({topic});
    return path.includes('/messages?')?response({messages:windowPage(path,fresh)}):fallback(path);
  });
  await (isTopic?runtime.openTopic('t1'):runtime.open('c1'));
  expect(useWorkspace.getState().messages[bucket]?.map(row=>row.id)).toEqual(fresh.slice(-50).map(row=>row.id));
  expect(fetchMock.mock.calls.filter(([url])=>String(url).includes('/messages?'))).toHaveLength(1);
});

test.each([false,true])('preserve option on an unloaded notification target still performs its ordinary authorized first page (topic=%s)',async isTopic=>{
  const bucket=isTopic?'topic:t1':'c1',fresh=windowRows(76,isTopic);
  expect(useWorkspace.getState().messages[bucket]).toBeUndefined();
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(path.endsWith('/conversations/c1'))return response({conversation});
    if(path.endsWith('/topics/t1'))return response({topic});
    return path.includes('/messages?')?response({messages:windowPage(path,fresh)}):fallback(path);
  });
  await (isTopic?runtime.openTopic('t1',{preserveLoadedWindow:true}):runtime.open('c1',{preserveLoadedWindow:true}));
  expect(useWorkspace.getState().messages[bucket]?.map(row=>row.id)).toEqual(fresh.slice(-50).map(row=>row.id));
  expect(fetchMock.mock.calls.filter(([url])=>String(url).includes('/messages?'))).toHaveLength(1);
});

test('same-target notification applies canonical topic departure before any message request',async()=>{
  useWorkspace.getState().setMessages('topic:t1',windowRows(75,true).map(row=>parseMessage(row)!));
  useWorkspace.getState().setDraft('topic:t1','synthetic draft');
  fetchMock.mockImplementation(async url=>String(url).endsWith('/topics/t1')?response({topic:{...topic,joined:false}}):fallback(String(url)));
  await runtime.openTopic('t1',{preserveLoadedWindow:true});
  expect(useWorkspace.getState().topics.t1?.joined).toBe(false);
  expect(useWorkspace.getState().messages['topic:t1']).toBeUndefined();
  expect(useWorkspace.getState().drafts['topic:t1']).toBeUndefined();
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('/messages?'))).toBe(false);
  expect(jest.mocked(cache.remove)).toHaveBeenCalledWith(`${useWorkspace.getState().accountKey}:messages:topic:t1`);
});

test('ordinary notification topic open completes authorized unjoined metadata without requesting messages',async()=>{
  fetchMock.mockImplementation(async url=>String(url).endsWith('/topics/t1')?response({topic:{...topic,joined:false,canJoin:true}}):fallback(String(url)));
  await expect(runtime.openTopic('t1')).resolves.toBe(0);
  expect(useWorkspace.getState().topics.t1).toMatchObject({joined:false,canJoin:true});
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('/messages?'))).toBe(false);
});

test.each([false,true])('same-target notification does not publish a partial latest window when its older page fails (topic=%s)',async isTopic=>{
  const bucket=isTopic?'topic:t1':'c1',loaded=windowRows(75,isTopic),fresh=windowRows(76,isTopic);
  useWorkspace.getState().setMessages(bucket,loaded.map(row=>parseMessage(row)!));
  const previous=useWorkspace.getState().messages[bucket];
  jest.mocked(cache.set).mockClear();
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(path.endsWith('/conversations/c1'))return response({conversation});
    if(path.endsWith('/topics/t1'))return response({topic});
    if(!path.includes('/messages?'))return fallback(path);
    if(new URL(path).searchParams.has('before'))throw new Error('offline');
    return response({messages:windowPage(path,fresh)});
  });
  await expect(isTopic?runtime.openTopic('t1',{preserveLoadedWindow:true}):runtime.open('c1',{preserveLoadedWindow:true})).rejects.toThrow('request.network');
  expect(useWorkspace.getState().messages[bucket]).toBe(previous);
  expect(useWorkspace.getState().messageReads[bucket]).toBeUndefined();
  expect(jest.mocked(cache.set).mock.calls.some(([key])=>key.endsWith(`:messages:${bucket}`))).toBe(false);
});

test.each([false,true])('same-target notification clears denied metadata and its loaded history (topic=%s)',async isTopic=>{
  const bucket=isTopic?'topic:t1':'c1';
  useWorkspace.getState().setMessages(bucket,windowRows(75,isTopic).map(row=>parseMessage(row)!));
  useWorkspace.getState().setDraft(bucket,'synthetic draft');
  fetchMock.mockImplementation(async url=>String(url).endsWith(isTopic?'/topics/t1':'/conversations/c1')?response({error:{code:'permission.denied'}},403):fallback(String(url)));
  await expect(isTopic?runtime.openTopic('t1',{preserveLoadedWindow:true}):runtime.open('c1',{preserveLoadedWindow:true})).rejects.toThrow();
  expect(useWorkspace.getState().messages[bucket]).toBeUndefined();
  expect(useWorkspace.getState().drafts[bucket]).toBeUndefined();
});

test.each([[false,403],[false,404],[true,403],[true,404]] as const)('ordinary notification open clears rejected metadata and all stored reader state (topic=%s,status=%s)',async(isTopic,status)=>{
  const bucket=isTopic?'topic:t1':'c1',account=useWorkspace.getState().accountKey;
  useWorkspace.getState().acceptMessageRead(bucket,windowRows(75,isTopic).map(row=>parseMessage(row)!),runtime.api!);
  useWorkspace.getState().setDraft(bucket,'synthetic denied draft');
  if(!isTopic){
    useWorkspace.getState().upsertTopic({...topic,id:'no-loaded-message-child'});
    useWorkspace.getState().setDraft('topic:no-loaded-message-child','synthetic child draft');
  }
  jest.mocked(cache.remove).mockClear();jest.mocked(cache.set).mockClear();
  fetchMock.mockImplementation(async url=>String(url).endsWith(isTopic?'/topics/t1':'/conversations/c1')?response({error:{code:status===403?'permission.denied':'resource.not_found'}},status):fallback(String(url)));
  await expect(isTopic?runtime.openTopic('t1'):runtime.open('c1')).rejects.toThrow();
  const state=useWorkspace.getState();
  expect(state.messages[bucket]).toBeUndefined();expect(state.drafts[bucket]).toBeUndefined();expect(state.messageReads[bucket]).toBeUndefined();
  expect(cache.remove).toHaveBeenCalledWith(`${account}:messages:${bucket}`);
  const drafts=jest.mocked(cache.set).mock.calls.filter(([key])=>key===`${account}:drafts`).at(-1)?.[1];
  expect(drafts).toBeDefined();expect(drafts).not.toHaveProperty(bucket);
  if(isTopic)expect(state.topics.t1?.joined).toBe(false);
  else{
    expect(state.conversations.c1).toBeUndefined();expect(state.topics['no-loaded-message-child']).toBeUndefined();
    expect(state.drafts['topic:no-loaded-message-child']).toBeUndefined();
    expect(cache.remove).toHaveBeenCalledWith(`${account}:messages:topic:no-loaded-message-child`);
  }
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('/messages?'))).toBe(false);
});

test.each([[false,'account'],[true,'account'],[false,'api'],[true,'api'],[false,'authorization'],[true,'authorization']] as const)('a late ordinary metadata denial cannot clear a changed reader scope (topic=%s,change=%s)',async(isTopic,changed)=>{
  const bucket=isTopic?'topic:t1':'c1';
  useWorkspace.getState().setMessages(bucket,windowRows(75,isTopic).map(row=>parseMessage(row)!));
  useWorkspace.getState().setDraft(bucket,'synthetic current draft');
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(path.endsWith(isTopic?'/topics/t1':'/conversations/c1')){started.resolve();return pending.promise;}
    if(path.endsWith('/topics/revision-topic/leave'))return response({topic:{...topic,id:'revision-topic',joined:false}});
    return fallback(path);
  });
  const opening=isTopic?runtime.openTopic('t1'):runtime.open('c1');await started.promise;
  if(changed==='account'){
    const snapshot=useWorkspace.getState().bootstrap!;
    useWorkspace.getState().applyBootstrap({...snapshot,auth:{currentUser:{...snapshot.auth.currentUser,id:'u3'}}},'synthetic-next-account');
    useWorkspace.getState().upsertTopic(topic);
    useWorkspace.getState().setMessages(bucket,[parseMessage({...message,id:'synthetic-next-account-row',...(isTopic?{topicId:'t1'}:{})})!]);
    useWorkspace.getState().setDraft(bucket,'synthetic next-account draft');
  }else if(changed==='api'){
    runtime.api=new ApiClient('https://next.example',async()=>undefined,()=>undefined);
  }else await runtime.leaveTopic('revision-topic');
  const state=useWorkspace.getState(),previous=state.messages[bucket],draft=state.drafts[bucket],metadata=isTopic?state.topics.t1:state.conversations.c1;
  jest.mocked(cache.remove).mockClear();jest.mocked(cache.set).mockClear();
  pending.resolve(response({error:{code:'permission.denied'}},403));
  await expect(opening).rejects.toThrow();
  expect(useWorkspace.getState().messages[bucket]).toBe(previous);expect(useWorkspace.getState().drafts[bucket]).toBe(draft);
  expect(isTopic?useWorkspace.getState().topics.t1:useWorkspace.getState().conversations.c1).toBe(metadata);
  expect(cache.remove).not.toHaveBeenCalled();expect(cache.set).not.toHaveBeenCalled();
});

test('a late ordinary topic metadata denial cannot clear a newer parent context',async()=>{
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();
  fetchMock.mockImplementation(async url=>{
    if(String(url).endsWith('/topics/t1')){started.resolve();return pending.promise;}
    return fallback(String(url));
  });
  const opening=runtime.openTopic('t1');await started.promise;
  const state=useWorkspace.getState();
  state.applyBootstrap({...state.bootstrap!,conversations:[...Object.values(state.conversations),{...state.conversations.c1!,id:'c2'}]},state.accountKey);
  useWorkspace.getState().upsertTopic({...topic,conversationId:'c2'});
  useWorkspace.getState().setMessages('topic:t1',[parseMessage({...message,conversationId:'c2',topicId:'t1'})!]);
  useWorkspace.getState().setDraft('topic:t1','synthetic new-parent draft');
  const previous=useWorkspace.getState().messages['topic:t1'],draft=useWorkspace.getState().drafts['topic:t1'];
  jest.mocked(cache.remove).mockClear();jest.mocked(cache.set).mockClear();
  pending.resolve(response({error:{code:'permission.denied'}},403));
  await expect(opening).rejects.toThrow();
  expect(useWorkspace.getState().messages['topic:t1']).toBe(previous);expect(useWorkspace.getState().drafts['topic:t1']).toBe(draft);
  expect(useWorkspace.getState().topics.t1).toMatchObject({conversationId:'c2',joined:true});
  expect(cache.remove).not.toHaveBeenCalled();expect(cache.set).not.toHaveBeenCalled();
});

test.each(['account','api','revocation'] as const)('same-target metadata cannot reopen an invalidated scope (%s)',async changed=>{
  useWorkspace.getState().setMessages('c1',windowRows(75).map(row=>parseMessage(row)!));
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();
  fetchMock.mockImplementation(async url=>{
    if(String(url).endsWith('/conversations/c1')){started.resolve();return pending.promise;}
    return fallback(String(url));
  });
  const opening=runtime.open('c1',{preserveLoadedWindow:true});await started.promise;
  if(changed==='account')useWorkspace.setState({accountKey:'synthetic-other-account',conversations:{},messages:{}});
  else if(changed==='api'){runtime.api=new ApiClient('https://other.example',async()=>undefined,()=>undefined);useWorkspace.setState({conversations:{},messages:{}});}
  else useWorkspace.getState().applyBootstrap({...useWorkspace.getState().bootstrap!,conversations:[]},useWorkspace.getState().accountKey);
  pending.resolve(response({conversation}));
  if(changed==='api')await expect(opening).rejects.toThrow('Session unavailable');
  else await opening;
  expect(useWorkspace.getState().conversations.c1).toBeUndefined();
  expect(useWorkspace.getState().messages.c1).toBeUndefined();
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('/messages?'))).toBe(false);
});

test.each([false,true])('resume atomically revalidates the loaded 75-row history window and adds a new tail (topic=%s)',async isTopic=>{
  const bucket=isTopic?'topic:t1':'c1',loaded=windowRows(75,isTopic),fresh=windowRows(76,isTopic);
  useWorkspace.getState().setMessages(bucket,loaded.map(row=>parseMessage(row)!));
  const previous=useWorkspace.getState().messages[bucket],pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(!path.includes('/messages?'))return fallback(path);
    if(new URL(path).searchParams.has('before')){started.resolve();return pending.promise;}
    return response({messages:windowPage(path,fresh)});
  });
  const refreshing=runtime.resume();
  // The latest page must not publish a truncated window while its older page is loading.
  await Promise.race([started.promise,refreshing]);
  expect(useWorkspace.getState().messages[bucket]===previous).toBe(true);
  expect(useWorkspace.getState().messageReads[bucket]).toBeUndefined();
  pending.resolve(response({messages:fresh.slice(0,26)}));await refreshing;
  expect(useWorkspace.getState().messages[bucket]?.map(row=>row.id)).toEqual(fresh.map(row=>row.id));
  expect(useWorkspace.getState().messages[bucket]?.some(row=>row.id==='window-010')).toBe(true);
  expect(useWorkspace.getState().messages[bucket]?.at(-1)?.id).toBe('window-075');
  expect(useWorkspace.getState().messageReads[bucket]).toEqual({ revision: 1, source: runtime.api, before: undefined });
});

test.each([false,true])('history refresh removes deleted rows and uses freshly redacted recalled and hidden rows (topic=%s)',async isTopic=>{
  const bucket=isTopic?'topic:t1':'c1',loaded=windowRows(75,isTopic);
  const fresh=windowRows(76,isTopic).filter(row=>row.id!=='window-010').map(row=>row.id==='window-011'?{...row,recalledAt:'2026-01-02T00:00:00Z',plainText:'synthetic recall notice'}:row.id==='window-012'?{...row,hiddenByCurrentUser:true}:row);
  useWorkspace.getState().setMessages(bucket,loaded.map(row=>parseMessage(row)!));
  fetchMock.mockImplementation(async url=>String(url).includes('/messages?')?response({messages:windowPage(String(url),fresh)}):fallback(String(url)));
  await runtime.bootstrap(true);
  const rows=useWorkspace.getState().messages[bucket]!;
  expect(rows.map(row=>row.id)).toEqual(fresh.map(row=>row.id));
  expect(rows.find(row=>row.id==='window-011')).toMatchObject({recalledAt:'2026-01-02T00:00:00Z',attachments:[],blocks:[]});
  expect(rows.find(row=>row.id==='window-012')).toMatchObject({hiddenByCurrentUser:true,plainText:'消息已不可用',attachments:[],blocks:[]});
});

test('history refresh keeps the previously loaded oldest boundary instead of loading the preceding page excess',async()=>{
  const all=windowRows(101),loaded=all.slice(25,100);
  useWorkspace.getState().setMessages('c1',loaded.map(row=>parseMessage(row)!));
  fetchMock.mockImplementation(async url=>String(url).includes('/messages?')?response({messages:windowPage(String(url),all)}):fallback(String(url)));
  await runtime.bootstrap(true);
  expect(useWorkspace.getState().messages.c1?.map(row=>row.id)).toEqual(all.slice(25).map(row=>row.id));
  expect(fetchMock.mock.calls.filter(([url])=>String(url).includes('/messages?'))).toHaveLength(2);
});

test('history refresh applies retention when the server no longer has the old boundary',async()=>{
  const loaded=windowRows(75),fresh=windowRows(76).slice(56);
  useWorkspace.getState().setMessages('c1',loaded.map(row=>parseMessage(row)!));
  fetchMock.mockImplementation(async url=>String(url).includes('/messages?')?response({messages:windowPage(String(url),fresh)}):fallback(String(url)));
  await runtime.bootstrap(true);
  expect(useWorkspace.getState().messages.c1?.map(row=>row.id)).toEqual(fresh.map(row=>row.id));
});

test('an unavailable older page never publishes or caches a partially refreshed window',async()=>{
  const loaded=windowRows(75),fresh=windowRows(76);
  useWorkspace.getState().setMessages('c1',loaded.map(row=>parseMessage(row)!));
  const previous=useWorkspace.getState().messages.c1;
  jest.mocked(cache.set).mockClear();
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(!path.includes('/messages?'))return fallback(path);
    if(new URL(path).searchParams.has('before'))throw new Error('offline');
    return response({messages:windowPage(path,fresh)});
  });
  await expect(runtime.bootstrap(true)).rejects.toThrow('request.network');
  expect(useWorkspace.getState().messages.c1===previous).toBe(true);
  expect(jest.mocked(cache.set).mock.calls.some(([key])=>key.endsWith(':messages:c1'))).toBe(false);
  expect(useWorkspace.getState().messageReads.c1).toBeUndefined();
});

test.each([undefined, 'm1'])('successful empty HTTP pages publish the exact read range (%s)', async before => {
  fetchMock.mockImplementation(async url => String(url).includes('/messages?') ? response({ messages: [] }) : fallback(String(url)));
  await runtime.messages('c1', before);
  expect(useWorkspace.getState().messageReads.c1).toEqual({ revision: 1, source: runtime.api, before });
  expect(jest.mocked(cache.set).mock.calls.some(([, value]) => value === useWorkspace.getState().messageReads)).toBe(false);
});

test('cache, optimistic rows and a canonical WebSocket event do not publish HTTP read receipts', async () => {
  useWorkspace.getState().setMessages('c1', [parseMessage(message)!]);
  useWorkspace.getState().upsertMessage({ ...parseMessage(message)!, id: 'pending', status: 'sending' });
  await (runtime as unknown as { applyEvent: (event: WorkspaceEvent, replay: boolean) => Promise<void> }).applyEvent({
    id: 'read-receipt-event', spaceId: 's1', seq: 5, type: 'message.created', conversationId: 'c1', payload: { message: { ...message, id: 'canonical-next' } },
  }, false);
  expect(useWorkspace.getState().messages.c1?.some(row => row.id === 'canonical-next')).toBe(true);
  expect(useWorkspace.getState().messageReads).toEqual({});
});

test('a successfully revalidated empty loaded window publishes a window receipt', async () => {
  useWorkspace.getState().setMessages('c1', []);
  fetchMock.mockImplementation(async url => String(url).includes('/messages?') ? response({ messages: [] }) : fallback(String(url)));
  await runtime.bootstrap(true);
  expect(useWorkspace.getState().messageReads.c1).toEqual({ revision: 1, source: runtime.api, before: undefined });
});

test.each(['account', 'api', 'permission', 'topic-parent', 'leave-rejoin'] as const)('a late single HTTP page cannot publish a read receipt after %s changes', async change => {
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  const isTopic = change === 'topic-parent' || change === 'leave-rejoin';
  fetchMock.mockImplementation(async url => String(url).includes('/messages?') ? pending.promise
    : String(url).endsWith('/leave') ? response({ topic: { ...topic, joined: false } }) : fallback(String(url)));
  const loading = isTopic ? runtime.topicMessages('t1') : runtime.messages('c1');
  if (change === 'account') useWorkspace.getState().applyBootstrap(useWorkspace.getState().bootstrap!, 'next-account');
  else if (change === 'api') runtime.api = new ApiClient('https://next.example', async () => undefined, () => undefined);
  else if (change === 'permission') useWorkspace.getState().applyBootstrap({ ...useWorkspace.getState().bootstrap!, permissions: { ...useWorkspace.getState().bootstrap!.permissions, canReadConversations: false } }, useWorkspace.getState().accountKey);
  else if (change === 'topic-parent') useWorkspace.getState().upsertTopic({ ...topic, conversationId: 'other' });
  else { await runtime.leaveTopic('t1'); useWorkspace.getState().upsertTopic(topic); }
  pending.resolve(response({ messages: [] }));
  if (change === 'api') await expect(loading).rejects.toThrow('Session unavailable');
  else await loading;
  expect(useWorkspace.getState().messageReads).toEqual({});
});

test.each([403,404])('authoritative history page denial clears the group and child-topic cache and cannot be revived by queued events (%s)',async status=>{
  const loaded=windowRows(75),topicRows=windowRows(2,true);
  useWorkspace.getState().setMessages('c1',loaded.map(row=>parseMessage(row)!));
  useWorkspace.getState().setMessages('topic:t1',topicRows.map(row=>parseMessage(row)!));
  useWorkspace.getState().setDraft('c1','synthetic draft');useWorkspace.getState().setDraft('topic:t1','synthetic topic draft');
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(!path.includes('/messages?'))return fallback(path);
    if(path.includes('/topics/'))return response({messages:topicRows});
    return new URL(path).searchParams.has('before')?response({error:{code:'conversation.not_found'}},status):response({messages:windowPage(path,windowRows(76))});
  });
  await expect(runtime.bootstrap(true)).rejects.toThrow('conversation.not_found');
  expect(useWorkspace.getState().messages).toEqual({});
  expect(useWorkspace.getState().drafts).toEqual({});
  expect(useWorkspace.getState().conversations.c1).toBeUndefined();
  expect(useWorkspace.getState().topics.t1).toBeUndefined();
  expect(cache.remove).toHaveBeenCalledWith('https://workspace.example:u1:messages:c1');
  expect(cache.remove).toHaveBeenCalledWith('https://workspace.example:u1:messages:topic:t1');
  await (runtime as unknown as {applyEvent:(event:WorkspaceEvent,replay:boolean)=>Promise<void>}).applyEvent({id:'late-event',spaceId:'s1',seq:5,type:'message.created',conversationId:'c1',payload:{message:loaded[0]}},false);
  expect(useWorkspace.getState().messages).toEqual({});
});

test('authoritative topic history denial clears only the revoked topic and draft',async()=>{
  const loaded=windowRows(75,true);
  useWorkspace.getState().setMessages('topic:t1',loaded.map(row=>parseMessage(row)!));
  useWorkspace.getState().setDraft('topic:t1','synthetic draft');
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(!path.includes('/messages?'))return fallback(path);
    return new URL(path).searchParams.has('before')?response({error:{code:'permission.denied'}},403):response({messages:windowPage(path,windowRows(76,true))});
  });
  await expect(runtime.bootstrap(true)).rejects.toThrow('permission.denied');
  expect(useWorkspace.getState().messages['topic:t1']).toBeUndefined();
  expect(useWorkspace.getState().drafts['topic:t1']).toBeUndefined();
  expect(useWorkspace.getState().topics.t1?.joined).toBe(false);
  expect(useWorkspace.getState().conversations.c1).toBeDefined();
  expect(cache.remove).toHaveBeenCalledWith('https://workspace.example:u1:messages:topic:t1');
});

test('a topics snapshot started before authoritative history denial cannot restore revoked read eligibility',async()=>{
  useWorkspace.getState().setMessages('topic:t1',windowRows(75,true).map(row=>parseMessage(row)!));
  const pendingTopics=deferred<Awaited<ReturnType<typeof fetch>>>();
  const topicRequests=jest.spyOn(runtime,'listTopics');
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(path.endsWith('/topics/mine'))return pendingTopics.promise;
    if(!path.includes('/messages?'))return fallback(path);
    return new URL(path).searchParams.has('before')?response({error:{code:'permission.denied'}},403):response({messages:windowPage(path,windowRows(76,true))});
  });
  await expect(runtime.bootstrap(true)).rejects.toThrow('permission.denied');
  pendingTopics.resolve(response({topics:[topic]}));await topicRequests.mock.results[0]!.value;
  expect(useWorkspace.getState().topics.t1?.joined).toBe(false);
  await (runtime as unknown as {applyEvent:(event:WorkspaceEvent,replay:boolean)=>Promise<void>}).applyEvent({id:'denied-topic-event',spaceId:'s1',seq:5,type:'message.reaction.updated',conversationId:'c1',payload:{message:windowRows(1,true)[0]}},false);
  expect(useWorkspace.getState().messages['topic:t1']).toBeUndefined();
});

test('a bootstrap snapshot started before authoritative history denial cannot restore revoked group read eligibility',async()=>{
  useWorkspace.getState().setMessages('c1',windowRows(75).map(row=>parseMessage(row)!));
  const pendingOlder=deferred<Awaited<ReturnType<typeof fetch>>>(),olderStarted=deferred<void>(),pendingBootstrap=deferred<Awaited<ReturnType<typeof fetch>>>();let bootstraps=0;
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(path.endsWith('/bootstrap')&&++bootstraps===2)return pendingBootstrap.promise;
    if(!path.includes('/messages?'))return fallback(path);
    if(new URL(path).searchParams.has('before')){olderStarted.resolve();return pendingOlder.promise;}
    return response({messages:windowPage(path,windowRows(76))});
  });
  const refreshing=runtime.bootstrap(true);await olderStarted.promise;
  const staleBootstrap=runtime.bootstrap();
  pendingOlder.resolve(response({error:{code:'permission.denied'}},403));
  await expect(refreshing).rejects.toThrow('permission.denied');
  pendingBootstrap.resolve(response(bootstrap));await staleBootstrap;
  expect(useWorkspace.getState().conversations.c1).toBeUndefined();
  expect(useWorkspace.getState().messages.c1).toBeUndefined();
});

test('bootstrap revocation clears loaded group and orphan-topic caches even without a cached bootstrap',async()=>{
  useWorkspace.getState().setMessages('c1',windowRows(75).map(row=>parseMessage(row)!));
  useWorkspace.getState().setMessages('topic:t1',windowRows(75,true).map(row=>parseMessage(row)!));
  jest.mocked(cache.get).mockImplementation(key=>key.endsWith(':drafts')?{c1:{text:'synthetic draft',mentionIds:[]},'topic:t1':{text:'synthetic topic draft',mentionIds:[]}}:null);
  fetchMock.mockImplementation(async url=>String(url).endsWith('/bootstrap')?response({...bootstrap,conversations:[]}):String(url).endsWith('/topics/mine')?response({topics:[]}):fallback(String(url)));
  await runtime.bootstrap(true);
  expect(useWorkspace.getState().messages).toEqual({});
  expect(useWorkspace.getState().drafts).toEqual({});
  expect(cache.remove).toHaveBeenCalledWith('https://workspace.example:u1:messages:c1');
  expect(cache.remove).toHaveBeenCalledWith('https://workspace.example:u1:messages:topic:t1');
  expect(cache.set).toHaveBeenCalledWith('https://workspace.example:u1:drafts',{});
});

test('group history denial clears a known child-topic cache and draft even without its messages key',async()=>{
  useWorkspace.getState().setMessages('c1',windowRows(75).map(row=>parseMessage(row)!));
  useWorkspace.getState().setDraft('topic:t1','synthetic child draft');
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(!path.includes('/messages?'))return fallback(path);
    return new URL(path).searchParams.has('before')?response({error:{code:'permission.denied'}},403):response({messages:windowPage(path,windowRows(76))});
  });
  await expect(runtime.bootstrap(true)).rejects.toThrow('permission.denied');
  expect(useWorkspace.getState().drafts['topic:t1']).toBeUndefined();
  expect(cache.remove).toHaveBeenCalledWith('https://workspace.example:u1:messages:topic:t1');
});

test.each(['left','orphan'] as const)('cached %s topic drafts without loaded messages stay inaccessible when topic metadata fails',async state=>{
  useWorkspace.getState().upsertTopic(state==='left'?{...topic,joined:false}:{...topic,conversationId:'removed-group'});
  jest.mocked(cache.get).mockImplementation(key=>key.endsWith(':drafts')?{'topic:t1':{text:'synthetic cached topic draft',mentionIds:[]}}:null);
  const topicRequests=jest.spyOn(runtime,'listTopics');
  fetchMock.mockImplementation(async url=>{if(String(url).endsWith('/topics/mine'))throw new Error('offline');return fallback(String(url));});
  await runtime.bootstrap(true);await expect(topicRequests.mock.results[0]!.value).rejects.toThrow('request.network');
  expect(useWorkspace.getState().drafts['topic:t1']).toBeUndefined();
  expect(cache.remove).toHaveBeenCalledWith('https://workspace.example:u1:messages:topic:t1');
  expect(cache.set).toHaveBeenCalledWith('https://workspace.example:u1:drafts',{});
});

test('a legitimate cold-start topic draft is kept off screen until metadata succeeds and survives unrelated draft writes',async()=>{
  useWorkspace.setState({topics:{}});
  const saved={'topic:t1':{text:'synthetic pending topic draft',mentionIds:[]}};let persisted:unknown=saved;
  jest.mocked(cache.get).mockImplementation(key=>key.endsWith(':drafts')?persisted:null);
  jest.mocked(cache.set).mockImplementation((key,value)=>{if(key.endsWith(':drafts'))persisted=value;return {changes:1,lastInsertRowId:0};});
  const pendingTopics=deferred<Awaited<ReturnType<typeof fetch>>>(),topicRequests=jest.spyOn(runtime,'listTopics');
  fetchMock.mockImplementation(async url=>String(url).endsWith('/topics/mine')?pendingTopics.promise:fallback(String(url)));
  await runtime.bootstrap(true);
  expect(useWorkspace.getState().drafts['topic:t1']).toBeUndefined();
  runtime.draft('c1','synthetic group edit');
  const currentDraft=useWorkspace.getState().drafts.c1;
  expect(currentDraft).toMatchObject({text:'synthetic group edit',mentionIds:[]});
  expect(persisted).toEqual({...saved,c1:currentDraft});
  pendingTopics.resolve(response({topics:[topic]}));await topicRequests.mock.results[0]!.value;
  expect(useWorkspace.getState().drafts['topic:t1']).toEqual(saved['topic:t1']);
  expect(useWorkspace.getState().drafts.c1).toBe(currentDraft);
});

test('failed cold-start topic validation retains private draft storage and restores it after later authorization',async()=>{
  useWorkspace.setState({topics:{}});
  const saved={'topic:t1':{text:'synthetic pending topic draft',mentionIds:[]}};let persisted:unknown=saved;
  jest.mocked(cache.get).mockImplementation(key=>key.endsWith(':drafts')?persisted:null);
  jest.mocked(cache.set).mockImplementation((key,value)=>{if(key.endsWith(':drafts'))persisted=value;return {changes:1,lastInsertRowId:0};});
  const topicRequests=jest.spyOn(runtime,'listTopics');
  fetchMock.mockImplementation(async url=>{if(String(url).endsWith('/topics/mine'))throw new Error('offline');return fallback(String(url));});
  await runtime.bootstrap(true);await expect(topicRequests.mock.results[0]!.value).rejects.toThrow('request.network');
  expect(useWorkspace.getState().drafts['topic:t1']).toBeUndefined();
  expect(persisted).toEqual(saved);
  runtime.draft('c1','synthetic group edit');
  fetchMock.mockImplementation(async url=>fallback(String(url)));await runtime.listTopics();
  expect(useWorkspace.getState().drafts['topic:t1']).toEqual(saved['topic:t1']);
  expect(useWorkspace.getState().drafts.c1?.text).toBe('synthetic group edit');
});

test('a successful topic inventory discards an unauthorized pending cold-start draft and its message cache',async()=>{
  useWorkspace.setState({topics:{}});
  const saved={'topic:t1':{text:'synthetic pending topic draft',mentionIds:[]}};let persisted:unknown=saved;
  jest.mocked(cache.get).mockImplementation(key=>key.endsWith(':drafts')?persisted:null);
  jest.mocked(cache.set).mockImplementation((key,value)=>{if(key.endsWith(':drafts'))persisted=value;return {changes:1,lastInsertRowId:0};});
  const topicRequests=jest.spyOn(runtime,'listTopics');
  fetchMock.mockImplementation(async url=>String(url).endsWith('/topics/mine')?response({topics:[]}):fallback(String(url)));
  await runtime.bootstrap(true);await topicRequests.mock.results[0]!.value;
  expect(useWorkspace.getState().drafts['topic:t1']).toBeUndefined();
  expect(persisted).toEqual({});
  expect(cache.remove).toHaveBeenCalledWith('https://workspace.example:u1:messages:topic:t1');
});

test('a late cold-start topic inventory cannot restore or persist the old account pending draft',async()=>{
  useWorkspace.setState({topics:{}});
  jest.mocked(cache.get).mockImplementation(key=>key==='https://workspace.example:u1:drafts'?{'topic:t1':{text:'synthetic pending topic draft',mentionIds:[]}}:null);
  const pendingTopics=deferred<Awaited<ReturnType<typeof fetch>>>(),topicRequests=jest.spyOn(runtime,'listTopics');
  fetchMock.mockImplementation(async url=>String(url).endsWith('/topics/mine')?pendingTopics.promise:fallback(String(url)));
  await runtime.bootstrap(true);
  const snapshot=useWorkspace.getState().bootstrap!;
  useWorkspace.getState().applyBootstrap({...snapshot,auth:{currentUser:{...snapshot.auth.currentUser,id:'u3'}}},'https://workspace.example:u3');
  runtime.draft('c1','synthetic next account draft');
  const currentDraft=useWorkspace.getState().drafts.c1;
  expect(currentDraft).toMatchObject({text:'synthetic next account draft',mentionIds:[]});
  pendingTopics.resolve(response({topics:[topic]}));await topicRequests.mock.results[0]!.value;
  expect(useWorkspace.getState().drafts['topic:t1']).toBeUndefined();
  expect(useWorkspace.getState().topics.t1).toBeUndefined();
  expect(useWorkspace.getState().drafts.c1).toBe(currentDraft);
  expect(cache.set).toHaveBeenCalledWith('https://workspace.example:u3:drafts',{c1:currentDraft});
});

test('an earlier bootstrap cannot undo a newer revocation snapshot',async()=>{
  useWorkspace.getState().setMessages('c1',windowRows(75).map(row=>parseMessage(row)!));
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>();let bootstrapRequests=0;
  fetchMock.mockImplementation(async url=>{
    if(String(url).endsWith('/bootstrap'))return ++bootstrapRequests===1?pending.promise:response({...bootstrap,conversations:[]});
    return fallback(String(url));
  });
  const staleBootstrap=runtime.bootstrap();await runtime.bootstrap();
  pending.resolve(response(bootstrap));await staleBootstrap;
  expect(useWorkspace.getState().conversations.c1).toBeUndefined();
});

test.each(['account','api','logout','dispose','group-revoke','global-revoke','topic-revoke','topic-parent'] as const)('a late older history page is isolated after %s changes',async change=>{
  const isTopic=change.startsWith('topic-'),bucket=isTopic?'topic:t1':'c1',loaded=windowRows(75,isTopic),fresh=windowRows(76,isTopic);
  useWorkspace.getState().setMessages(bucket,loaded.map(row=>parseMessage(row)!));
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(!path.includes('/messages?'))return fallback(path);
    if(new URL(path).searchParams.has('before')){started.resolve();return pending.promise;}
    return response({messages:windowPage(path,fresh)});
  });
  const refreshing=runtime.bootstrap(true);await started.promise;
  if(change==='account'){
    const snapshot=useWorkspace.getState().bootstrap!;
    useWorkspace.getState().applyBootstrap({...snapshot,auth:{currentUser:{...snapshot.auth.currentUser,id:'u3',displayName:'Next account'}}},'https://workspace.example:u3');
    useWorkspace.getState().setMessages('c1',[parseMessage({...message,id:'next-account'})!]);
  }else if(change==='api')runtime.api=new ApiClient('https://next.example',async()=>undefined,()=>undefined);
  else if(change==='logout')await runtime.logout(false);
  else if(change==='dispose')runtime.dispose();
  else if(change==='group-revoke')useWorkspace.getState().applyBootstrap({...useWorkspace.getState().bootstrap!,conversations:[]},useWorkspace.getState().accountKey);
  else if(change==='global-revoke')useWorkspace.getState().applyBootstrap({...useWorkspace.getState().bootstrap!,permissions:{...useWorkspace.getState().bootstrap!.permissions,canReadConversations:false}},useWorkspace.getState().accountKey);
  else if(change==='topic-revoke')useWorkspace.getState().upsertTopic({...topic,joined:false});
  else useWorkspace.getState().upsertTopic({...topic,conversationId:'c2'});
  const previous=useWorkspace.getState().messages[bucket];
  pending.resolve(response({messages:fresh.slice(0,26)}));
  if(change==='logout')await expect(refreshing).rejects.toThrow('Stale session');
  else if(change==='api')await expect(refreshing).rejects.toThrow('Session unavailable');
  else await refreshing;
  expect(useWorkspace.getState().messages[bucket]===previous).toBe(true);
  expect(useWorkspace.getState().messages[bucket]?.some(row=>row.id==='window-075')??false).toBe(false);
  expect(useWorkspace.getState().messageReads[bucket]).toBeUndefined();
});

test('a late denied older page cannot clear the next account cache or read eligibility',async()=>{
  useWorkspace.getState().setMessages('c1',windowRows(75).map(row=>parseMessage(row)!));
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(!path.includes('/messages?'))return fallback(path);
    if(new URL(path).searchParams.has('before')){started.resolve();return pending.promise;}
    return response({messages:windowPage(path,windowRows(76))});
  });
  const refreshing=runtime.bootstrap(true);await started.promise;
  const snapshot=useWorkspace.getState().bootstrap!;
  useWorkspace.getState().applyBootstrap({...snapshot,auth:{currentUser:{...snapshot.auth.currentUser,id:'u3',displayName:'Next account'}}},'https://workspace.example:u3');
  useWorkspace.getState().setMessages('c1',[parseMessage({...message,id:'next-account'})!]);
  const previous=useWorkspace.getState().messages.c1;
  jest.mocked(cache.remove).mockClear();
  pending.resolve(response({error:{code:'permission.denied'}},403));
  await expect(refreshing).rejects.toThrow('permission.denied');
  expect(useWorkspace.getState().messages.c1===previous).toBe(true);
  expect(useWorkspace.getState().conversations.c1).toBeDefined();
  expect(cache.remove).not.toHaveBeenCalled();
});

test.each(['account','api'] as const)('a stale bootstrap cannot start history refresh after an %s change',async change=>{
  useWorkspace.getState().setMessages('c1',windowRows(75).map(row=>parseMessage(row)!));
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();
  fetchMock.mockImplementation(async url=>{
    if(String(url).endsWith('/bootstrap')){started.resolve();return pending.promise;}
    return fallback(String(url));
  });
  const refreshing=runtime.bootstrap(true);await started.promise;
  if(change==='api')runtime.api=new ApiClient('https://next.example',async()=>undefined,()=>undefined);
  const snapshot=useWorkspace.getState().bootstrap!;
  useWorkspace.getState().applyBootstrap({...snapshot,auth:{currentUser:{...snapshot.auth.currentUser,id:'u3',displayName:'Next account'}}},'https://workspace.example:u3');
  useWorkspace.getState().setMessages('c1',[parseMessage({...message,id:'next-account'})!]);
  const previous=useWorkspace.getState().messages.c1;
  pending.resolve(response(bootstrap));
  if(change==='api')await expect(refreshing).rejects.toThrow('Session unavailable');else await refreshing;
  expect(useWorkspace.getState().accountKey).toBe('https://workspace.example:u3');
  expect(useWorkspace.getState().messages.c1===previous).toBe(true);
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('/messages?'))).toBe(false);
});

test.each(['recalled','hidden','new-tail'] as const)('a realtime %s during older-page loading restarts the complete canonical history window',async change=>{
  const loaded=windowRows(75),fresh=windowRows(76);
  useWorkspace.getState().setMessages('c1',loaded.map(row=>parseMessage(row)!));
  const changed=change==='new-tail'?fresh[75]!:{...fresh[10]!,...(change==='recalled'?{recalledAt:'2026-01-02T00:00:00Z',plainText:'synthetic recall notice'}:{hiddenByCurrentUser:true})};
  const canonical=fresh.map(row=>row.id===changed.id?changed:row);
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();let pageRequests=0;
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(!path.includes('/messages?'))return fallback(path);
    pageRequests++;
    if(pageRequests===2){started.resolve();return pending.promise;}
    return response({messages:windowPage(path,pageRequests>2?canonical:loaded)});
  });
  const refreshing=runtime.bootstrap(true);await started.promise;
  await (runtime as unknown as {applyEvent:(event:WorkspaceEvent,replay:boolean)=>Promise<void>}).applyEvent({id:'mid-pagination-event',spaceId:'s1',seq:5,type:change==='new-tail'?'message.created':change==='recalled'?'message.recalled':'message.hidden',conversationId:'c1',payload:{message:changed}},false);
  pending.resolve(response({messages:loaded.slice(0,25)}));await refreshing;
  expect(pageRequests).toBe(4);
  expect(useWorkspace.getState().messages.c1?.map(row=>row.id)).toEqual(canonical.map(row=>row.id));
  expect(useWorkspace.getState().messages.c1?.find(row=>row.id===changed.id)).toEqual(parseMessage(changed));
});

test('an unavailable history retry preserves the realtime canonical change instead of applying stale pages',async()=>{
  const loaded=windowRows(75),changed={...loaded[10]!,recalledAt:'2026-01-02T00:00:00Z',plainText:'synthetic recall notice'};
  useWorkspace.getState().setMessages('c1',loaded.map(row=>parseMessage(row)!));
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();let pageRequests=0;
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(!path.includes('/messages?'))return fallback(path);
    if(++pageRequests===1)return response({messages:windowPage(path,loaded)});
    if(pageRequests===2){started.resolve();return pending.promise;}
    throw new Error('offline');
  });
  const refreshing=runtime.bootstrap(true);await started.promise;
  useWorkspace.getState().upsertMessage(parseMessage(changed)!);
  const previous=useWorkspace.getState().messages.c1;
  pending.resolve(response({messages:loaded.slice(0,25)}));
  await expect(refreshing).rejects.toThrow('request.network');
  expect(useWorkspace.getState().messages.c1===previous).toBe(true);
  expect(useWorkspace.getState().messages.c1?.find(row=>row.id===changed.id)).toEqual(parseMessage(changed));
});

test('repeated realtime changes bound history-window retries without publishing an obsolete snapshot',async()=>{
  const loaded=windowRows(75),changed={...loaded[10]!,hiddenByCurrentUser:true};
  useWorkspace.getState().setMessages('c1',loaded.map(row=>parseMessage(row)!));
  let pageRequests=0;
  jest.mocked(cache.set).mockClear();
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(!path.includes('/messages?'))return fallback(path);
    pageRequests++;useWorkspace.getState().upsertMessage(parseMessage(changed)!);
    return response({messages:windowPage(path,loaded)});
  });
  await expect(runtime.bootstrap(true)).rejects.toThrow('消息正在同步，请重试');
  expect(pageRequests).toBe(3);
  expect(useWorkspace.getState().messages.c1?.find(row=>row.id===changed.id)).toEqual(parseMessage(changed));
  expect(jest.mocked(cache.set).mock.calls.some(([key])=>key.endsWith(':messages:c1'))).toBe(false);
});

test('a cursor deleted during history pagination is revalidated and retries the fresh window',async()=>{
  const loaded=windowRows(75),first=windowRows(76),fresh=first.filter(row=>row.id!=='window-026');
  useWorkspace.getState().setMessages('c1',loaded.map(row=>parseMessage(row)!));
  let latestRequests=0;
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(!path.includes('/messages?'))return fallback(path);
    if(!new URL(path).searchParams.has('before')&&!new URL(path).searchParams.has('around'))latestRequests++;
    return response({messages:windowPage(path,latestRequests===1&&!new URL(path).searchParams.has('before')&&!new URL(path).searchParams.has('around')?first:fresh)});
  });
  await runtime.bootstrap(true);
  expect(latestRequests).toBe(2);
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('around=window-026'))).toBe(true);
  expect(useWorkspace.getState().messages.c1?.map(row=>row.id)).toEqual(fresh.map(row=>row.id));
});

test('an empty older page with an existing cursor applies the server retention boundary',async()=>{
  const loaded=windowRows(75),fresh=windowRows(76).slice(26);
  useWorkspace.getState().setMessages('c1',loaded.map(row=>parseMessage(row)!));
  fetchMock.mockImplementation(async url=>String(url).includes('/messages?')?response({messages:windowPage(String(url),fresh)}):fallback(String(url)));
  await runtime.bootstrap(true);
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('around=window-026'))).toBe(true);
  expect(useWorkspace.getState().messages.c1?.map(row=>row.id)).toEqual(fresh.map(row=>row.id));
});

test('a non-progressing older page is rejected without replacing cached history',async()=>{
  const loaded=windowRows(75);
  useWorkspace.getState().setMessages('c1',loaded.map(row=>parseMessage(row)!));
  const previous=useWorkspace.getState().messages.c1;
  fetchMock.mockImplementation(async url=>String(url).includes('/messages?')?response({messages:loaded.slice(25)}):fallback(String(url)));
  await expect(runtime.bootstrap(true)).rejects.toThrow('response.invalid');
  expect(useWorkspace.getState().messages.c1===previous).toBe(true);
});

test.each([false,true])('unhide refetches authorized canonical content in the correct bucket (topic=%s)',async isTopic=>{
  const canonical={...message,...(isTopic?{topicId:'t1'}:{})};
  const bucket=isTopic?'topic:t1':'c1';
  useWorkspace.getState().upsertMessage(parseMessage({...canonical,hiddenByCurrentUser:true})!);
  fetchMock.mockImplementation(async url=>String(url).endsWith('/hidden')?response({messageId:'m1',hidden:false}):String(url).includes('around=m1')?response({messages:[canonical]}):fallback(String(url)));
  await runtime.hide('m1',false,bucket);
  expect(useWorkspace.getState().messages[bucket]?.[0]).toMatchObject({hiddenByCurrentUser:false,plainText:'canonical text',attachments:[attachment]});
  expect(useWorkspace.getState().messages[bucket]?.[0]?.blocks).toHaveLength(2);
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes(`${isTopic?'/topics/t1':'/conversations/c1'}/messages?around=m1&limit=1`))).toBe(true);
  expect(useWorkspace.getState().messages[isTopic?'c1':'topic:t1']).toBeUndefined();
});

test('unhide keeps redacted content when the canonical resource is no longer available',async()=>{
  useWorkspace.getState().upsertMessage(parseMessage({...message,hiddenByCurrentUser:true})!);
  fetchMock.mockImplementation(async url=>String(url).endsWith('/hidden')?response({messageId:'m1',hidden:false}):response({messages:[]}));
  await expect(runtime.hide('m1',false,'c1')).rejects.toThrow('message.not_found');
  expect(useWorkspace.getState().messages.c1?.[0]).toMatchObject({hiddenByCurrentUser:true,attachments:[],blocks:[]});
});

test('logout during canonical unhide fetch cannot write content into the next account',async()=>{
  useWorkspace.getState().upsertMessage(parseMessage({...message,hiddenByCurrentUser:true})!);
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();
  fetchMock.mockImplementation(async url=>{if(String(url).endsWith('/hidden'))return response({messageId:'m1',hidden:false});started.resolve();return pending.promise;});
  const restoring=runtime.hide('m1',false,'c1');await started.promise;
  await runtime.logout(false);pending.resolve(response({messages:[message]}));
  await expect(restoring).rejects.toThrow('Stale session');
  expect(useWorkspace.getState().messages).toEqual({});
});

test.each([false,true])('a late latest page refetches after a canonical realtime message and preserves retention (topic=%s)',async isTopic=>{
  const bucket=isTopic?'topic:t1':'c1',old={...message,...(isTopic?{topicId:'t1'}:{})};
  const fresh={...old,id:'m2',createdAt:'2026-01-02T00:00:00Z',plainText:'new canonical'};
  useWorkspace.getState().upsertMessage(parseMessage(old)!);
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>();let pageRequests=0;
  fetchMock.mockImplementation(async url=>String(url).includes('/messages?')?(++pageRequests===1?pending.promise:response({messages:[fresh]})):fallback(String(url)));
  const loading=isTopic?runtime.topicMessages('t1'):runtime.messages('c1');
  await (runtime as unknown as {applyEvent:(event:WorkspaceEvent,replay:boolean)=>Promise<void>}).applyEvent({version:1,id:'e5',spaceId:'s1',seq:5,type:isTopic?'topic.message.created':'message.created',conversationId:'c1',payload:{message:fresh}},false);
  pending.resolve(response({messages:[old]}));await loading;
  expect(pageRequests).toBe(2);
  expect(useWorkspace.getState().messages[bucket]?.map(item=>item.id)).toEqual(['m2']);
});

test.each(['recalled','reaction'])('a late page cannot replace a newer realtime %s',async change=>{
  useWorkspace.getState().upsertMessage(parseMessage(message)!);
  const updated=change==='recalled'?{...message,recalledAt:'2026-01-02T00:00:00Z',plainText:'recalled'}:{...message,reactions:[{emoteKey:'emoji:grinning',count:1,reactedByCurrentUser:false}]};
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>();let pageRequests=0;
  fetchMock.mockImplementation(async url=>String(url).includes('/messages?')?(++pageRequests===1?pending.promise:response({messages:[updated]})):fallback(String(url)));
  const loading=runtime.messages('c1');
  await (runtime as unknown as {applyEvent:(event:WorkspaceEvent,replay:boolean)=>Promise<void>}).applyEvent({version:1,id:'e5',spaceId:'s1',seq:5,type:change==='recalled'?'message.recalled':'message.reaction.updated',conversationId:'c1',payload:{message:updated}},false);
  pending.resolve(response({messages:[message]}));await loading;
  expect(useWorkspace.getState().messages.c1?.[0]).toEqual(parseMessage(updated));
});

test('permission loss while a message page is loading prevents late content resurrection',async()=>{
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>();fetchMock.mockImplementation(()=>pending.promise);
  const loading=runtime.messages('c1');
  useWorkspace.getState().applyBootstrap({...useWorkspace.getState().bootstrap!,conversations:[]},useWorkspace.getState().accountKey);
  pending.resolve(response({messages:[message]}));await loading;
  expect(useWorkspace.getState().messages).toEqual({});
});

test('an unavailable retry never applies the stale page over a realtime canonical message',async()=>{
  useWorkspace.getState().upsertMessage(parseMessage(message)!);
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>();let requests=0;
  fetchMock.mockImplementation(()=>++requests===1?pending.promise:Promise.reject(new Error('offline')));
  const loading=runtime.messages('c1');
  useWorkspace.getState().upsertMessage(parseMessage({...message,recalledAt:'2026-01-02T00:00:00Z',plainText:'recalled'})!);
  pending.resolve(response({messages:[message]}));await expect(loading).rejects.toThrow();
  expect(useWorkspace.getState().messages.c1?.[0]?.recalledAt).toBe('2026-01-02T00:00:00Z');
});

test('topic access loss during canonical unhide loading cannot restore redacted content',async()=>{
  useWorkspace.getState().upsertMessage(parseMessage({...message,topicId:'t1',hiddenByCurrentUser:true})!);
  const pending=deferred<Awaited<ReturnType<typeof fetch>>>(),started=deferred<void>();
  fetchMock.mockImplementation(async url=>{if(String(url).endsWith('/hidden'))return response({messageId:'m1',hidden:false});started.resolve();return pending.promise;});
  const restoring=runtime.hide('m1',false,'topic:t1');await started.promise;
  useWorkspace.getState().upsertTopic({...topic,joined:false});pending.resolve(response({messages:[{...message,topicId:'t1'}]}));await restoring;
  expect(useWorkspace.getState().messages['topic:t1']).toBeUndefined();
});

test.each([false,true])('runtime send honors explicit selected mention spans and clears the draft spans (attachment=%s)',async upload=>{
  const member=(id:string)=>({id,displayName:'Peer',kind:'human',capabilities:{canStartDirectConversation:false}});
  useWorkspace.setState(s=>({conversations:{...s.conversations,c1:{...s.conversations.c1!,members:[member('u2'),member('u3')]}}}));
  const mentionSpans=[{userId:'u3',label:'Peer',start:6,end:11}];
  useWorkspace.getState().setDraft('c1',{text:'@Peer @Peer',mentionIds:['u3'],mentionSpans});
  fetchMock.mockImplementation(async()=>response({message:{...message,clientMessageId:'synthetic-id'}}));
  await runtime.send('c1','@Peer @Peer',undefined,undefined,{mentionIds:['u3'],mentionSpans,...(upload?{upload:async()=>attachment}:{})});
  const post=fetchMock.mock.calls.find(([url])=>String(url).endsWith('/api/workspace/messages'));
  const blocks=JSON.parse(String(post?.[1]?.body)).content.blocks;
  expect(blocks.filter((block:{type:string})=>block.type==='mention')).toEqual([{type:'mention',userId:'u3',label:'Peer'}]);
  expect(blocks[0]).toEqual({type:'text',text:'@Peer '});
  expect(useWorkspace.getState().drafts.c1?.mentionSpans).toEqual([]);
  if(upload)expect(blocks).toContainEqual({type:'attachment',attachmentId:'a1'});
});

test('leaving a topic immediately clears its loaded stream and draft',async()=>{
  useWorkspace.getState().upsertMessage(parseMessage({...message,topicId:'t1'})!);useWorkspace.getState().setDraft('topic:t1','draft');
  fetchMock.mockImplementation(async()=>response({topic:{...topic,joined:false}}));await runtime.leaveTopic('t1');
  expect(useWorkspace.getState().messages['topic:t1']).toBeUndefined();
  expect(useWorkspace.getState().drafts['topic:t1']).toBeUndefined();
  expect(cache.remove).toHaveBeenCalledWith('https://workspace.example:u1:messages:topic:t1');
  expect(cache.set).toHaveBeenCalledWith('https://workspace.example:u1:drafts',expect.not.objectContaining({'topic:t1':expect.anything()}));
});

test('a queued canonical event cannot reintroduce content after topic membership was revoked',async()=>{
  useWorkspace.getState().upsertTopic({...topic,joined:false});
  await (runtime as unknown as {applyEvent:(event:WorkspaceEvent,replay:boolean)=>Promise<void>}).applyEvent({version:1,id:'e5',spaceId:'s1',seq:5,type:'message.reaction.updated',conversationId:'c1',payload:{message:{...message,topicId:'t1'}}},false);
  expect(useWorkspace.getState().messages['topic:t1']).toBeUndefined();
});
