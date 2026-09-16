import { parseMessage } from '../src/domain/contracts';
import { updateDecision, compareVersion, releaseSchema } from '../src/domain/updates';
import { ReplayTracker } from '../src/domain/replay';
import { shouldNotify } from '../src/domain/notifications';
const valid={id:'m1',conversationId:'c1',authorId:'u2',authorName:'A',kind:'user',createdAt:'2026-01-01T00:00:00.000Z',plainText:'hi',content:{format:'duallane.message+json;v=1',blocks:[{type:'text',text:'hi'}]},attachments:[]};
test('unknown block falls back safely',()=>{const message=parseMessage({...valid,content:{format:'duallane.message+json;v=1',blocks:[{type:'future_card',payload:{script:'bad'}}]}});expect(message?.fallback).toBe(true);expect(message?.plainText).toBe('hi');expect(JSON.stringify(message)).not.toContain('script');});
test('invalid envelope is ignored',()=>expect(parseMessage({id:'m'})).toBeNull());
test('semantic versions and forced update',()=>{expect(compareVersion('0.1.0','0.2.0')).toBe(-1);const p=releaseSchema.parse({schemaVersion:1,platform:'android',channel:'internal',latest:{appVersion:'0.2.0',versionCode:2,releaseId:'r',releaseNotes:[]},minimum:{appVersion:'0.1.0',versionCode:1},recommendation:'soft',apkUrl:null,protocol:{eventMajor:1,contentFormats:['duallane.message+json;v=1']}});expect(updateDecision(p,{appVersion:'0.0.1',versionCode:1})).toBe('forced');expect(updateDecision(p,{appVersion:'0.1.0',versionCode:1})).toBe('soft');});
test('replay is idempotent and does not require consecutive visible seq',()=>{const t=new ReplayTracker(1);expect(t.accept({type:'ready',version:1,currentSeq:4,replayCount:2,hasMore:false})).toEqual({});const e={version:1,id:'e1',spaceId:'s',seq:2,type:'message.created',conversationId:'c',payload:{message:valid}};expect(t.accept({type:'event',event:e}).event?.id).toBe('e1');expect(t.accept({type:'event',event:e}).event).toBeUndefined();expect(t.cursor).toBe(4);});
test('local notification obeys background and mention preference',()=>{const message=parseMessage(valid)!;const conversation={id:'c1',displayTitle:'x',type:'direct' as const,lastMessagePlainText:'',lastActivityAt:'',unreadCount:0,notificationLevel:'mentions' as const,retentionText:'',members:[],capabilities:{canSendMessage:true,canUploadFile:false}};expect(shouldNotify({background:true,replay:false,message,userId:'u1',conversation})).toBe(false);const mention=parseMessage({...valid,content:{format:'duallane.message+json;v=1',blocks:[{type:'mention',userId:'u1',label:'me'}]}})!;expect(shouldNotify({background:true,replay:false,message:mention,userId:'u1',conversation})).toBe(true);});

test('local notification suppresses self, replay, muted and system messages',()=>{
  const message=parseMessage(valid)!;
  const base={background:true,replay:false,message,userId:'u1',conversation:{id:'c1',displayTitle:'x',type:'direct' as const,lastMessagePlainText:'',lastActivityAt:'',unreadCount:0,notificationLevel:'all' as const,retentionText:'',members:[],capabilities:{canSendMessage:true,canUploadFile:false}}};
  expect(shouldNotify({...base,message:parseMessage({...valid,authorId:'u1'})!})).toBe(false);
  expect(shouldNotify({...base,replay:true})).toBe(false);
  expect(shouldNotify({...base,conversation:{...base.conversation,notificationLevel:'muted'}})).toBe(false);
  expect(shouldNotify({...base,message:parseMessage({...valid,kind:'system'})!})).toBe(false);
});
