import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../src/ui/theme';
import { ProfileScreen } from '../src/features/account/screens';
import { Runtime } from '../src/data/runtime';
import { chooseAvatar } from '../src/data/avatar';
import { bootstrapSchema } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';

jest.mock('../src/data/runtime',()=>({Runtime:jest.fn()}));
jest.mock('../src/data/avatar',()=>({chooseAvatar:jest.fn(),avatarErrorText:()=> '头像未保存，请重试'}));
jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.1.0',versionCode:1},config:{environment:'test'}}));
jest.mock('../src/platform/storage',()=>({cache:{get:jest.fn(),set:jest.fn()}}));
jest.mock('../src/platform/notifications',()=>({enableNotifications:jest.fn()}));
jest.mock('expo-updates',()=>({isEnabled:false}));
const metrics={frame:{x:0,y:0,width:390,height:844},insets:{top:24,left:0,right:0,bottom:0}};
const Stack=createNativeStackNavigator();
const snapshot=bootstrapSchema.parse({auth:{currentUser:{id:'u1',displayName:'Synthetic',nickname:'Original',avatarUrl:null,searchDiscoverable:true}},space:{id:'s1',name:'Synthetic'},eventCursor:0,policy:{dailyQuotaBytes:10,remainingQuotaBytes:10,messageRetentionCount:10},permissions:{canReadConversations:true},members:[],conversations:[],files:[]});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const picked={uri:'file:///cache/synthetic.png',mimeType:'image/png' as const,byteSize:3,dispose:jest.fn()};
let runtime:Runtime;
function screen(){
  const nav=createNavigationContainerRef<{Profile:undefined;Other:undefined}>();
  const view=render(<SafeAreaProvider initialMetrics={metrics}><ThemeProvider mode="light"><NavigationContainer ref={nav}><Stack.Navigator><Stack.Screen name="Profile">{()=> <ProfileScreen runtime={runtime}/>}</Stack.Screen><Stack.Screen name="Other">{()=> <View accessibilityLabel="Other page"/>}</Stack.Screen></Stack.Navigator></NavigationContainer></ThemeProvider></SafeAreaProvider>);
  return {view,nav};
}
beforeEach(()=>{
  useWorkspace.getState().reset();useWorkspace.getState().applyBootstrap(snapshot,'synthetic:u1');
  jest.mocked(chooseAvatar).mockReset().mockResolvedValue(picked);picked.dispose.mockClear();
  runtime=new Runtime();runtime.avatarScope=jest.fn(()=>()=>useWorkspace.getState().accountKey==='synthetic:u1');
  runtime.updateAvatar=jest.fn().mockImplementation(async()=>{
    useWorkspace.setState(s=>({bootstrap:s.bootstrap?{...s.bootstrap,auth:{currentUser:{...s.bootstrap.auth.currentUser,avatarUrl:'/api/workspace/avatars/u1/new'}}}:null}));
    return {...snapshot.auth.currentUser,avatarUrl:'/api/workspace/avatars/u1/new'};
  });
  runtime.clearAvatar=jest.fn().mockResolvedValue(snapshot.auth.currentUser);
  runtime.updateProfile=jest.fn();
});
afterEach(()=>useWorkspace.getState().reset());

test('selection previews without mutation; explicit upload preserves unsaved nickname and visibility',async()=>{
  const {view}=screen();
  expect(view.queryByText('更换头像稍后接入')).toBeNull();
  fireEvent.changeText(view.getByLabelText('显示名'),'Unsaved');
  fireEvent.press(view.getByRole('switch',{name:'允许被成员查找'}));
  fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  expect(runtime.updateAvatar).not.toHaveBeenCalled();
  fireEvent.press(within(view.getByRole('summary',{name:'确认更换头像？'})).getByRole('button',{name:'确认上传'}));
  await waitFor(()=>expect(view.getByText('头像已保存')).toBeTruthy());
  expect(runtime.updateAvatar).toHaveBeenCalledWith(picked,expect.any(Function));
  expect(runtime.updateProfile).not.toHaveBeenCalled();
  expect(view.getByLabelText('显示名').props.value).toBe('Unsaved');
  expect(view.getByRole('switch',{name:'允许被成员查找',checked:false})).toBeTruthy();
});

test('canceling a preview cleans the copy and leaves the saved avatar unchanged',async()=>{
  const {view}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByRole('summary',{name:'确认更换头像？'})).toBeTruthy());
  fireEvent.press(within(view.getByRole('summary',{name:'确认更换头像？'})).getByRole('button',{name:'取消上传'}));
  expect(picked.dispose).toHaveBeenCalled();expect(runtime.updateAvatar).not.toHaveBeenCalled();
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBeNull();
});

test('restore requires confirmation, while cancel does not call DELETE',async()=>{
  const {view}=screen();fireEvent.press(view.getByRole('button',{name:'恢复 GitHub 头像'}));
  expect(runtime.clearAvatar).not.toHaveBeenCalled();
  fireEvent.press(within(view.getByRole('summary',{name:'恢复 GitHub 头像？'})).getByRole('button',{name:'保留当前头像'}));
  expect(runtime.clearAvatar).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button',{name:'恢复 GitHub 头像'}));
  fireEvent.press(within(view.getByRole('summary',{name:'恢复 GitHub 头像？'})).getByRole('button',{name:'确认恢复'}));
  await waitFor(()=>expect(view.getByText('已恢复 GitHub 头像')).toBeTruthy());
  expect(runtime.clearAvatar).toHaveBeenCalledWith(expect.any(Function));
});

test('upload failure preserves the original avatar and profile inputs',async()=>{
  runtime.updateAvatar=jest.fn().mockRejectedValue(new Error('synthetic failure'));
  const {view}=screen();fireEvent.changeText(view.getByLabelText('显示名'),'Unsaved');
  fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByRole('summary',{name:'确认更换头像？'})).toBeTruthy());
  fireEvent.press(within(view.getByRole('summary',{name:'确认更换头像？'})).getByRole('button',{name:'确认上传'}));
  await waitFor(()=>expect(view.getByText('头像未保存，请重试')).toBeTruthy());
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBeNull();
  expect(view.getByLabelText('显示名').props.value).toBe('Unsaved');expect(picked.dispose).toHaveBeenCalled();
});

test('a picker result after route blur is disposed without preview or sending',async()=>{
  const pending=deferred<typeof picked|null>();jest.mocked(chooseAvatar).mockReturnValueOnce(pending.promise);
  const {view,nav}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  act(()=>nav.navigate('Other'));await act(async()=>pending.resolve(picked));
  expect(picked.dispose).toHaveBeenCalled();expect(runtime.updateAvatar).not.toHaveBeenCalled();
  act(()=>nav.goBack());expect(view.queryByLabelText('所选头像中心裁剪预览')).toBeNull();
});

test('account replacement disposes the preview and closes confirmation',async()=>{
  const {view}=screen();fireEvent.changeText(view.getByLabelText('显示名'),'Old account draft');fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  act(()=>useWorkspace.setState({accountKey:'synthetic:u2',bootstrap:{...snapshot,auth:{currentUser:{...snapshot.auth.currentUser,id:'u2',nickname:'Other account'}}}}));
  expect(picked.dispose).toHaveBeenCalled();expect(view.queryByLabelText('所选头像中心裁剪预览')).toBeNull();expect(runtime.updateAvatar).not.toHaveBeenCalled();
  expect(view.getByLabelText('显示名').props.value).toBe('Other account');
});

test('leaving during upload invalidates the runtime callback and ignores late success feedback',async()=>{
  const pending=deferred<typeof snapshot.auth.currentUser>();runtime.updateAvatar=jest.fn().mockReturnValueOnce(pending.promise);
  const {view,nav}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByRole('summary',{name:'确认更换头像？'})).toBeTruthy());
  fireEvent.press(within(view.getByRole('summary',{name:'确认更换头像？'})).getByRole('button',{name:'确认上传'}));
  const current=jest.mocked(runtime.updateAvatar).mock.calls[0]?.[1];expect(current?.()).toBe(true);
  act(()=>nav.navigate('Other'));expect(current?.()).toBe(false);
  await act(async()=>pending.resolve(snapshot.auth.currentUser));act(()=>nav.goBack());
  expect(view.queryByText('头像已保存')).toBeNull();expect(picked.dispose).toHaveBeenCalled();
});

test('picker cancellation leaves no confirmation or avatar mutation',async()=>{
  jest.mocked(chooseAvatar).mockResolvedValueOnce(null);const {view}=screen();
  fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByRole('button',{name:'更换头像'})).toBeTruthy());
  expect(view.queryByRole('summary',{name:'确认更换头像？'})).toBeNull();expect(runtime.updateAvatar).not.toHaveBeenCalled();
});

test('a failed restore leaves the avatar unchanged and does not save profile inputs',async()=>{
  runtime.clearAvatar=jest.fn().mockRejectedValueOnce(new Error('synthetic failure'));
  const {view}=screen();fireEvent.changeText(view.getByLabelText('显示名'),'Unsaved');
  fireEvent.press(view.getByRole('button',{name:'恢复 GitHub 头像'}));
  fireEvent.press(within(view.getByRole('summary',{name:'恢复 GitHub 头像？'})).getByRole('button',{name:'确认恢复'}));
  await waitFor(()=>expect(view.getByText('头像未保存，请重试')).toBeTruthy());
  expect(view.getByLabelText('显示名').props.value).toBe('Unsaved');expect(runtime.updateProfile).not.toHaveBeenCalled();
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBeNull();
});

function canonicalProfile(patch:Partial<typeof snapshot.auth.currentUser>){
  const user={...snapshot.auth.currentUser,...patch};
  useWorkspace.setState(s=>({bootstrap:s.bootstrap?{...s.bootstrap,auth:{currentUser:user}}:null}));
  return user;
}

test('profile save adopts canonical trimmed nickname and clears false dirty state',async()=>{
  runtime.updateProfile=jest.fn(async()=>canonicalProfile({nickname:'Saved'}));
  const {view}=screen();fireEvent.changeText(view.getByLabelText('显示名'),'Saved ');
  fireEvent.press(view.getByRole('button',{name:'保存'}));
  await waitFor(()=>expect(view.getByLabelText('显示名').props.value).toBe('Saved'));
  expect(runtime.updateProfile).toHaveBeenCalledWith({nickname:'Saved',searchDiscoverable:true});
  expect(view.getByRole('button',{name:'保存',disabled:true})).toBeTruthy();
});

test('pristine profile fields follow a canonical Web nickname and visibility update',()=>{
  const {view}=screen();act(()=>canonicalProfile({nickname:'Web nickname',searchDiscoverable:false}));
  expect(view.getByLabelText('显示名').props.value).toBe('Web nickname');
  expect(view.getByRole('switch',{name:'允许被成员查找',checked:false})).toBeTruthy();
  expect(view.getByRole('button',{name:'保存',disabled:true})).toBeTruthy();
});

test('a Web update follows each pristine field while preserving an independently edited field',()=>{
  const {view}=screen();fireEvent.changeText(view.getByLabelText('显示名'),'Local edit');
  act(()=>canonicalProfile({nickname:'Web nickname',searchDiscoverable:false}));
  expect(view.getByLabelText('显示名').props.value).toBe('Local edit');
  expect(view.getByRole('switch',{name:'允许被成员查找',checked:false})).toBeTruthy();
});

test.each(['Newer input','Original'])('a slow profile save preserves newer nickname %s and newer visibility input',async newer=>{
  const pending=deferred<typeof snapshot.auth.currentUser>();runtime.updateProfile=jest.fn().mockReturnValueOnce(pending.promise);
  const {view}=screen();fireEvent.changeText(view.getByLabelText('显示名'),'Submitted ');
  fireEvent.press(view.getByRole('button',{name:'保存'}));
  fireEvent.changeText(view.getByLabelText('显示名'),newer);fireEvent.press(view.getByRole('switch',{name:'允许被成员查找'}));
  await act(async()=>pending.resolve(canonicalProfile({nickname:'Submitted',searchDiscoverable:true})));
  expect(view.getByLabelText('显示名').props.value).toBe(newer);
  expect(view.getByRole('switch',{name:'允许被成员查找',checked:false})).toBeTruthy();
});
