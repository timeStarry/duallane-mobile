import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { credentials } from '../src/platform/storage';
import { clearNotifications, enableNotifications, showMessageNotification } from '../src/platform/notifications';
import { installedVersion, loginTarget } from '../src/platform/config';

jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{extra:{environment:'test',apiOrigin:'',channel:'internal'}}}}));
jest.mock('expo-secure-store',()=>({getItemAsync:jest.fn(),setItemAsync:jest.fn(),deleteItemAsync:jest.fn()}));
jest.mock('expo-sqlite',()=>({openDatabaseSync:()=>({execSync:jest.fn(),getFirstSync:jest.fn(),runSync:jest.fn()})}));
jest.mock('expo-notifications',()=>({setNotificationHandler:jest.fn(),setNotificationChannelAsync:jest.fn(),requestPermissionsAsync:jest.fn(),getPermissionsAsync:jest.fn(),scheduleNotificationAsync:jest.fn(),cancelAllScheduledNotificationsAsync:jest.fn(),dismissAllNotificationsAsync:jest.fn(),clearLastNotificationResponseAsync:jest.fn(),AndroidImportance:{HIGH:4},AndroidNotificationVisibility:{PRIVATE:0}}));
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
beforeEach(()=>jest.clearAllMocks());

test('Keystore logout waits behind an in-flight native token write',async()=>{
  const started=deferred<void>(),write=deferred<void>(),operations:string[]=[];
  jest.mocked(SecureStore.setItemAsync).mockImplementation(()=>{started.resolve();return write.promise.then(()=>{operations.push('save');});});
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async()=>{operations.push('clear');});
  const saving=credentials.save({origin:'https://example.test',refreshToken:'test'});await started.promise;const clearing=credentials.clear();
  write.resolve();await Promise.all([saving,clearing]);expect(operations).toEqual(['save','clear']);
});

test('logout removes a notification even when Android scheduling was already in flight',async()=>{
  const started=deferred<void>(),schedule=deferred<string>(),operations:string[]=[];
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({granted:true} as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(()=>{started.resolve();return schedule.promise.then(id=>{operations.push('schedule');return id;});});
  jest.mocked(Notifications.dismissAllNotificationsAsync).mockImplementation(async()=>{operations.push('clear');});
  const showing=showMessageNotification({origin:'https://example.test',userId:'u1',conversationId:'c1',messageId:'m1'});await started.promise;
  const clearing=clearNotifications();schedule.resolve('n1');await Promise.all([showing,clearing]);expect(operations).toEqual(['schedule','clear']);
});

test('already-granted message notifications wait for their private channel and use its immediate trigger',async()=>{
  const started=deferred<void>(),channel=deferred<Notifications.NotificationChannel|null>(),operations:string[]=[];
  const target={origin:'https://example.test',userId:'u1',conversationId:'c1',messageId:'m2',topicId:'t1'};
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({granted:true} as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.setNotificationChannelAsync).mockImplementation(()=>{started.resolve();return channel.promise.then(value=>{operations.push('channel');return value;});});
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async()=>{operations.push('schedule');return 'n2';});
  const showing=showMessageNotification(target);
  // Observe either native operation so the old implementation fails immediately rather than timing out.
  await Promise.race([started.promise,showing]);
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('messages',{name:'聊天消息',importance:Notifications.AndroidImportance.HIGH,lockscreenVisibility:Notifications.AndroidNotificationVisibility.PRIVATE});
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  channel.resolve(null);await showing;
  expect(operations).toEqual(['channel','schedule']);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({identifier:'u1:m2',content:{title:'DualLane',body:'有新消息',data:target,sound:'default'},trigger:{channelId:'messages'}});
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('denied notification permission does not create or schedule a message channel',async()=>{
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({granted:false} as Notifications.NotificationPermissionsStatus);
  await showMessageNotification({origin:'https://example.test',userId:'u1',conversationId:'c1',messageId:'m3'});
  expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('channel creation failure does not silently schedule on the fallback channel or block logout cleanup',async()=>{
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({granted:true} as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.setNotificationChannelAsync).mockRejectedValue(new Error('synthetic channel failure'));
  await expect(showMessageNotification({origin:'https://example.test',userId:'u1',conversationId:'c1',messageId:'m4'})).rejects.toThrow('synthetic channel failure');
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  await clearNotifications();
  expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
});

test('enabling notifications creates the same private messages channel before asking permission',async()=>{
  const operations:string[]=[];
  jest.mocked(Notifications.setNotificationChannelAsync).mockImplementation(async()=>{operations.push('channel');return null;});
  jest.mocked(Notifications.requestPermissionsAsync).mockImplementation(async()=>{operations.push('permission');return {granted:true} as Notifications.NotificationPermissionsStatus;});
  expect(await enableNotifications()).toBe(true);
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('messages',{name:'聊天消息',importance:Notifications.AndroidImportance.HIGH,lockscreenVisibility:Notifications.AndroidNotificationVisibility.PRIVATE});
  expect(operations).toEqual(['channel','permission']);
});

test('login accepts a Workspace invitation only for its own HTTPS origin',()=>{
  expect(loginTarget('https://example.test/workspace?invite=test-code')).toEqual({origin:'https://example.test',inviteCode:'test-code'});
  expect(loginTarget('https://example.test')).toEqual({origin:'https://example.test'});
  for(const url of ['http://example.test/workspace?invite=test','https://secret@example.test/workspace?invite=test','https://example.test/workspace?invite=test#k=private','https://example.test/p2p?invite=test','https://example.test/workspace?invite=test&redirect=https://evil.test'])expect(()=>loginTarget(url)).toThrow();
});

test('installed version follows the Android package even if Expo reports its stale config version',()=>{
  expect(installedVersion({appVersion:'0.2.1',versionCode:3},'0.1.0','1')).toEqual({appVersion:'0.2.1',versionCode:3});
});

test.each(['', '  '])('a configured release uses its HTTPS origin when the optional invitation is empty',value=>{
  expect(loginTarget(value,'https://duallane.tsio.top')).toEqual({origin:'https://duallane.tsio.top'});
});

test('a configured release forwards an invitation only to its fixed service',()=>{
  expect(loginTarget('https://duallane.tsio.top/workspace?invite=test-code','https://duallane.tsio.top')).toEqual({origin:'https://duallane.tsio.top',inviteCode:'test-code'});
  expect(()=>loginTarget('https://other.test/workspace?invite=test-code','https://duallane.tsio.top')).toThrow('邀请链接不属于当前服务');
  expect(()=>loginTarget('https://other.test','https://duallane.tsio.top')).toThrow('邀请链接不属于当前服务');
});

test('fixed service configuration still requires a valid HTTPS origin',()=>{
  for(const origin of ['http://duallane.tsio.top','https://duallane.tsio.top/workspace','https://secret@duallane.tsio.top'])expect(()=>loginTarget('',origin)).toThrow();
});
