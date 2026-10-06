import React from 'react';
import { Modal, View } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../src/ui/theme';
import { ProfileScreen } from '../src/features/account/screens';
import { Runtime } from '../src/data/runtime';
import { ApiClient } from '../src/data/client';
import { chooseAvatar } from '../src/data/avatar';
import { Button } from '../src/ui/primitives';
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
function loadPreview(view:ReturnType<typeof render>){
  fireEvent(view.getByLabelText('所选头像中心裁剪预览'),'load',{nativeEvent:{source:{width:256,height:256,url:'file:///cache/synthetic.png'}}});
}
function avatarDialog(view:ReturnType<typeof render>){return within(view.getByRole('summary',{name:'确认更换头像？'}));}
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
  runtime=new Runtime();runtime.avatarScope=jest.fn(()=>{
    const api=runtime.api,account=useWorkspace.getState().accountKey,userId=useWorkspace.getState().bootstrap?.auth.currentUser.id;
    return ()=>runtime.api===api&&useWorkspace.getState().accountKey===account&&useWorkspace.getState().bootstrap?.auth.currentUser.id===userId;
  });
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
  loadPreview(view);
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
  loadPreview(view);
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
  loadPreview(view);
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

test('preview confirmation stays disabled until the selected image loads successfully',async()=>{
  const {view}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  expect(view.getByText('正在加载预览…')).toBeTruthy();
  expect(avatarDialog(view).getByRole('button',{name:'确认上传',disabled:true})).toBeTruthy();
  fireEvent(view.getByLabelText('所选头像中心裁剪预览'),'loadEnd');
  expect(avatarDialog(view).getByRole('button',{name:'确认上传',disabled:true})).toBeTruthy();
  fireEvent.press(avatarDialog(view).getByRole('button',{name:'确认上传'}));
  expect(runtime.updateAvatar).not.toHaveBeenCalled();
  loadPreview(view);
  expect(avatarDialog(view).getByRole('button',{name:'确认上传',disabled:false})).toBeTruthy();
  fireEvent.press(avatarDialog(view).getByRole('button',{name:'确认上传'}));
  await waitFor(()=>expect(runtime.updateAvatar).toHaveBeenCalledTimes(1));
});

test('the upload handler independently rejects an image that has not decoded',async()=>{
  const {view}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  const confirm=view.UNSAFE_getAllByType(Button).find(button=>button.props.title==='确认上传');
  expect(confirm).toBeTruthy();
  await act(async()=>confirm?.props.onPress());
  expect(runtime.updateAvatar).not.toHaveBeenCalled();
  expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy();
});

test('a malformed nonempty PNG reports the decode failure, cleans its copy and preserves independent profile fields',async()=>{
  const malformed={...picked,byteSize:29,dispose:jest.fn()};
  jest.mocked(chooseAvatar).mockResolvedValueOnce(malformed);
  const {view}=screen();fireEvent.changeText(view.getByLabelText('显示名'),'Unsaved');
  fireEvent.press(view.getByRole('switch',{name:'允许被成员查找'}));
  fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  fireEvent(view.getByLabelText('所选头像中心裁剪预览'),'error',{nativeEvent:{error:'synthetic decode failure'}});
  expect(view.queryByLabelText('所选头像中心裁剪预览')).toBeNull();
  expect(view.getByText('这张图片无法读取，请选择其他图片')).toBeTruthy();
  expect(malformed.dispose).toHaveBeenCalledTimes(1);
  expect(runtime.updateAvatar).not.toHaveBeenCalled();expect(runtime.updateProfile).not.toHaveBeenCalled();
  expect(useWorkspace.getState().bootstrap?.auth.currentUser.avatarUrl).toBeNull();
  expect(view.getByLabelText('显示名').props.value).toBe('Unsaved');
  expect(view.getByRole('switch',{name:'允许被成员查找',checked:false})).toBeTruthy();
});

test('callbacks from a canceled image cannot ready or remove a newer preview',async()=>{
  const second={...picked,uri:'file:///cache/second.png',dispose:jest.fn()};
  jest.mocked(chooseAvatar).mockResolvedValueOnce(picked).mockResolvedValueOnce(second);
  const {view}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  const previous=view.getByLabelText('所选头像中心裁剪预览');
  const lateLoad=previous.props.onLoad,lateError=previous.props.onError;
  expect(typeof lateLoad).toBe('function');expect(typeof lateError).toBe('function');
  fireEvent.press(avatarDialog(view).getByRole('button',{name:'取消上传'}));
  fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览').props.source.uri).toBe(second.uri));
  act(()=>lateLoad({nativeEvent:{source:{width:256,height:256}}}));
  expect(avatarDialog(view).getByRole('button',{name:'确认上传',disabled:true})).toBeTruthy();
  loadPreview(view);
  act(()=>lateError({nativeEvent:{error:'synthetic late failure'}}));
  expect(avatarDialog(view).getByRole('button',{name:'确认上传',disabled:false})).toBeTruthy();
  expect(view.getByLabelText('所选头像中心裁剪预览').props.source.uri).toBe(second.uri);
  expect(second.dispose).not.toHaveBeenCalled();expect(picked.dispose).toHaveBeenCalledTimes(1);
  expect(view.queryByText('这张图片无法读取，请选择其他图片')).toBeNull();
  fireEvent.press(avatarDialog(view).getByRole('button',{name:'确认上传'}));
  await waitFor(()=>expect(runtime.updateAvatar).toHaveBeenCalledWith(second,expect.any(Function)));
});

test('callbacks after cancellation cannot restore a preview or report a stale image failure',async()=>{
  const {view}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  const preview=view.getByLabelText('所选头像中心裁剪预览');
  const lateLoad=preview.props.onLoad,lateError=preview.props.onError;
  expect(typeof lateLoad).toBe('function');expect(typeof lateError).toBe('function');
  fireEvent.press(avatarDialog(view).getByRole('button',{name:'取消上传'}));
  act(()=>{lateLoad({nativeEvent:{source:{width:256,height:256}}});lateError({nativeEvent:{error:'synthetic late failure'}});});
  expect(view.queryByLabelText('所选头像中心裁剪预览')).toBeNull();
  expect(view.queryByText('这张图片无法读取，请选择其他图片')).toBeNull();
  expect(picked.dispose).toHaveBeenCalledTimes(1);expect(runtime.updateAvatar).not.toHaveBeenCalled();
});

test('an old confirmation handler cannot upload a newer successfully loaded selection',async()=>{
  const second={...picked,uri:'file:///cache/reselected.png',dispose:jest.fn()};
  jest.mocked(chooseAvatar).mockResolvedValueOnce(picked).mockResolvedValueOnce(second);
  const {view}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  const previousConfirm=view.UNSAFE_getAllByType(Button).find(button=>button.props.title==='确认上传')?.props.onPress;
  expect(typeof previousConfirm).toBe('function');
  fireEvent.press(avatarDialog(view).getByRole('button',{name:'取消上传'}));
  fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览').props.source.uri).toBe(second.uri));
  loadPreview(view);
  await act(async()=>previousConfirm());
  expect(runtime.updateAvatar).not.toHaveBeenCalled();expect(second.dispose).not.toHaveBeenCalled();
  fireEvent.press(avatarDialog(view).getByRole('button',{name:'确认上传'}));
  await waitFor(()=>expect(runtime.updateAvatar).toHaveBeenCalledWith(second,expect.any(Function)));
});

test.each(['cancel button','system close'] as const)('a stale %s event cannot discard a newer preview',async action=>{
  const second={...picked,uri:'file:///cache/stale-close.png',dispose:jest.fn()};
  jest.mocked(chooseAvatar).mockResolvedValueOnce(picked).mockResolvedValueOnce(second);
  const {view}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  const previousClose=action==='cancel button'
    ?view.UNSAFE_getAllByType(Button).find(button=>button.props.title==='取消上传')?.props.onPress
    :view.UNSAFE_getAllByType(Modal).find(modal=>modal.props.visible)?.props.onRequestClose;
  expect(typeof previousClose).toBe('function');
  fireEvent.press(avatarDialog(view).getByRole('button',{name:'取消上传'}));
  fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览').props.source.uri).toBe(second.uri));
  loadPreview(view);act(()=>previousClose());
  expect(view.getByLabelText('所选头像中心裁剪预览').props.source.uri).toBe(second.uri);
  expect(avatarDialog(view).getByRole('button',{name:'确认上传',disabled:false})).toBeTruthy();
  expect(second.dispose).not.toHaveBeenCalled();expect(runtime.updateAvatar).not.toHaveBeenCalled();
});

test('a late preview close after confirmation cannot dispose the active upload copy early',async()=>{
  const pending=deferred<typeof snapshot.auth.currentUser>();runtime.updateAvatar=jest.fn().mockReturnValueOnce(pending.promise);
  const {view}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  const previousClose=view.UNSAFE_getAllByType(Modal).find(modal=>modal.props.visible)?.props.onRequestClose;
  expect(typeof previousClose).toBe('function');loadPreview(view);
  fireEvent.press(avatarDialog(view).getByRole('button',{name:'确认上传'}));
  act(()=>previousClose());
  expect(picked.dispose).not.toHaveBeenCalled();expect(runtime.updateAvatar).toHaveBeenCalledTimes(1);
  await act(async()=>pending.resolve(snapshot.auth.currentUser));
  expect(view.getByText('头像已保存')).toBeTruthy();expect(picked.dispose).toHaveBeenCalledTimes(1);
});

test('late image events after route blur do not affect the next focused preview',async()=>{
  const second={...picked,uri:'file:///cache/focused.png',dispose:jest.fn()};
  jest.mocked(chooseAvatar).mockResolvedValueOnce(picked).mockResolvedValueOnce(second);
  const {view,nav}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  const preview=view.getByLabelText('所选头像中心裁剪预览');
  const lateLoad=preview.props.onLoad,lateError=preview.props.onError;
  expect(typeof lateLoad).toBe('function');expect(typeof lateError).toBe('function');
  act(()=>nav.navigate('Other'));act(()=>nav.goBack());
  fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览').props.source.uri).toBe(second.uri));
  act(()=>{lateLoad({nativeEvent:{source:{width:256,height:256}}});lateError({nativeEvent:{error:'synthetic late failure'}});});
  expect(avatarDialog(view).getByRole('button',{name:'确认上传',disabled:true})).toBeTruthy();
  expect(second.dispose).not.toHaveBeenCalled();expect(runtime.updateAvatar).not.toHaveBeenCalled();
  expect(view.queryByText('这张图片无法读取，请选择其他图片')).toBeNull();
});

test.each(['account','API'] as const)('late image events after %s replacement cannot modify the new session preview',async replacement=>{
  const second={...picked,uri:'file:///cache/session.png',dispose:jest.fn()};
  jest.mocked(chooseAvatar).mockResolvedValueOnce(picked).mockResolvedValueOnce(second);
  const {view}=screen();fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览')).toBeTruthy());
  const preview=view.getByLabelText('所选头像中心裁剪预览');
  const lateLoad=preview.props.onLoad,lateError=preview.props.onError;
  expect(typeof lateLoad).toBe('function');expect(typeof lateError).toBe('function');
  act(()=>{
    if(replacement==='account')useWorkspace.setState({accountKey:'synthetic:u2',bootstrap:{...snapshot,auth:{currentUser:{...snapshot.auth.currentUser,id:'u2',nickname:'Other account'}}}});
    else{runtime.api=new ApiClient('https://synthetic.invalid',async()=>undefined,()=>undefined);useWorkspace.setState({bootstrap:{...snapshot,auth:{currentUser:{...snapshot.auth.currentUser}}}});}
  });
  expect(picked.dispose).toHaveBeenCalledTimes(1);
  expect(view.queryByLabelText('所选头像中心裁剪预览')).toBeNull();
  fireEvent.press(view.getByRole('button',{name:'更换头像'}));
  await waitFor(()=>expect(view.getByLabelText('所选头像中心裁剪预览').props.source.uri).toBe(second.uri));
  act(()=>{lateLoad({nativeEvent:{source:{width:256,height:256}}});lateError({nativeEvent:{error:'synthetic late failure'}});});
  expect(avatarDialog(view).getByRole('button',{name:'确认上传',disabled:true})).toBeTruthy();
  expect(second.dispose).not.toHaveBeenCalled();expect(runtime.updateAvatar).not.toHaveBeenCalled();
  expect(view.queryByText('这张图片无法读取，请选择其他图片')).toBeNull();
  expect(view.getByLabelText('显示名').props.value).toBe(replacement==='account'?'Other account':'Original');
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
