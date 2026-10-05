import { AppState } from 'react-native';
import { fetch } from 'expo/fetch';
import { Runtime } from '../src/data/runtime';
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
let runtime:Runtime;
beforeEach(async()=>{
  jest.spyOn(console,'warn').mockImplementation(()=>undefined);
  jest.spyOn(AppState,'addEventListener').mockReturnValue({remove:jest.fn()});
  useWorkspace.getState().reset();jest.mocked(cache.get).mockReturnValue(null);
  jest.mocked(credentials.read).mockResolvedValue({origin:'https://workspace.example',refreshToken:'synthetic-refresh',userId:'u1'});
  fetchMock.mockImplementation(async url=>fallback(String(url)));
  runtime=new Runtime();jest.spyOn(runtime,'connect').mockImplementation(()=>undefined);await runtime.start();
  useWorkspace.getState().upsertTopic({...topic,notificationLevel:'all'});
});
afterEach(()=>{runtime.dispose();jest.restoreAllMocks();});

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
