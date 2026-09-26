import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { credentials } from '../src/platform/storage';
import { clearNotifications, showMessageNotification } from '../src/platform/notifications';
import { installedVersion, loginTarget } from '../src/platform/config';

jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{extra:{environment:'test',apiOrigin:'',channel:'internal'}}}}));
jest.mock('expo-secure-store',()=>({getItemAsync:jest.fn(),setItemAsync:jest.fn(),deleteItemAsync:jest.fn()}));
jest.mock('expo-sqlite',()=>({openDatabaseSync:()=>({execSync:jest.fn(),getFirstSync:jest.fn(),runSync:jest.fn()})}));
jest.mock('expo-notifications',()=>({setNotificationHandler:jest.fn(),getPermissionsAsync:jest.fn(),scheduleNotificationAsync:jest.fn(),cancelAllScheduledNotificationsAsync:jest.fn(),dismissAllNotificationsAsync:jest.fn(),clearLastNotificationResponseAsync:jest.fn()}));
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}

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
