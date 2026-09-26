import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { EllipsisVertical } from 'lucide-react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoginScreen, MessageRow } from '../src/features/screens';
import { Avatar } from '../src/ui/chrome';
import { parseMessage } from '../src/domain/contracts';
import { config } from '../src/platform/config';
import { Runtime } from '../src/data/runtime';
import { ApiError } from '../src/data/client';

jest.mock('../src/data/runtime',()=>({Runtime:jest.fn()}));
jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('../src/data/transfers',()=>({Transfers:jest.fn()}));
jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{extra:{environment:'test',apiOrigin:'',channel:'internal'}},nativeAppVersion:'0.1.0',nativeBuildVersion:'1'}}));
jest.mock('../src/platform/storage',()=>({cache:{get:jest.fn()}}));
jest.mock('../src/platform/notifications',()=>({enableNotifications:jest.fn()}));
jest.mock('../src/ui/RemoteImage',()=>({RemoteImage:({uri}:{uri:string})=>uri}));
const file={id:'f1',fileName:'example.txt',mimeType:'text/plain',byteSize:3,status:'available',capabilities:{canDownload:true}};
const message={id:'m1',conversationId:'c1',authorName:'Test',kind:'user',createdAt:'2026-01-01T00:00:00Z',plainText:'example.txt',content:{format:'duallane.message+json;v=1',blocks:[{type:'attachment',attachmentId:'f1'}]},attachments:[file]};
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, right: 0, bottom: 24, left: 0 } };
const renderMessage = (element: React.ReactElement) => render(<SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>);

beforeEach(()=>{config.apiOrigin='';});

test('chat attachments expose an authorized download action',()=>{
  const download=jest.fn();const view=renderMessage(<MessageRow message={parseMessage(message)!} retry={jest.fn()} download={download}/>);
  fireEvent.press(view.getByRole('button',{name:'保存到设备'}));expect(download).toHaveBeenCalledWith(file);
});
test('SVG avatars keep a single centered visual while image avatars retain their fallback',()=>{
  const svg=renderMessage(<Avatar name="回声" uri="/assets/echo-avatar.svg" id="echo" shape="bot"/>);
  expect(svg.queryByText('回')).toBeNull();
  const png=renderMessage(<Avatar name="信标" uri="/assets/beacon-avatar.png" id="beacon" shape="bot"/>);
  expect(png.getByText('信')).toBeTruthy();
});
test('message controls keep attachment taps separate and expose a complete TalkBack summary',()=>{
  const download=jest.fn();
  const view=renderMessage(<MessageRow message={parseMessage(message)!} retry={jest.fn()} download={download}/>);
  const menu=view.getByRole('button',{name:/消息操作，Test/});
  expect(menu.props.accessibilityHint).toBe('点按查看更多消息操作');
  expect(menu.findAllByType(EllipsisVertical)).toHaveLength(1);
  expect(menu.props.accessibilityLabel).toContain('1个附件');
  expect(menu.props.accessibilityLabel).toContain('2026');
  fireEvent.press(view.getByRole('button',{name:'保存到设备'}));
  expect(download).toHaveBeenCalledTimes(1);
  fireEvent.press(menu);
  expect(view.getByRole('button',{name:'更多'})).toBeTruthy();
});
test('quick reactions send a catalog key and surface a rejected request', async()=>{
  const react=jest.fn().mockRejectedValue(new Error('反应暂不可用'));
  const view=renderMessage(<MessageRow message={parseMessage(message)!} retry={jest.fn()} download={jest.fn()} runtime={{react} as unknown as Runtime}/>);
  fireEvent.press(view.getByRole('button',{name:/消息操作，Test/}));
  fireEvent.press(view.getByRole('button',{name:'反应'}));
  fireEvent.press(view.getByRole('button',{name:'反应 👍'}));
  expect(react).toHaveBeenCalledWith('m1','emoji:thumbs-up',false);
  await waitFor(()=>expect(view.getByText(/无法连接到服务器/)).toBeTruthy());
});
test('recalled messages never expose the old attachment action',()=>{
  const view=renderMessage(<MessageRow message={parseMessage({...message,recalledAt:'2026-01-02T00:00:00Z',recallReason:'内容有误',plainText:'Test因内容有误撤回了一条消息'})!} retry={jest.fn()} download={jest.fn()}/>);
  expect(view.queryByRole('button',{name:'下载并保存'})).toBeNull();
  expect(view.getByText('Test因内容有误撤回了一条消息')).toBeTruthy();
  expect(view.queryByText('消息已不可用')).toBeNull();
});

test('available message images can be saved to the personal emote library', async()=>{
  const favoriteMessageEmote=jest.fn().mockResolvedValue(undefined);
  const image={...file,fileName:'sticker.png',mimeType:'image/png'};
  const parsed=parseMessage({...message,attachments:[image]})!;
  const view=renderMessage(<MessageRow message={parsed} retry={jest.fn()} download={jest.fn()} runtime={{favoriteMessageEmote} as unknown as Runtime}/>);
  fireEvent.press(view.getByRole('button',{name:/消息操作，Test/}));
  fireEvent.press(view.getByRole('button',{name:'更多'}));
  fireEvent.press(view.getByRole('button',{name:'收藏为表情'}));
  await waitFor(()=>expect(favoriteMessageEmote).toHaveBeenCalledWith('m1','f1'));
});

test('a configured release offers direct GitHub login without a server address or required form field',async()=>{
  config.apiOrigin='https://duallane.tsio.top';
  const runtime=new Runtime();runtime.login=jest.fn().mockResolvedValue(undefined);
  const view=render(<LoginScreen runtime={runtime}/>);
  expect(view.queryByLabelText('服务地址或邀请链接')).toBeNull();
  expect(view.queryByPlaceholderText('HTTPS 服务地址或空间邀请链接')).toBeNull();
  expect(view.queryByLabelText('空间邀请链接（可选）')).toBeNull();
  expect(view.getByLabelText('DualLane')).toBeTruthy();
  expect(view.getByRole('button',{name:'还没有账号？'})).toBeTruthy();
  expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled();
  fireEvent.press(view.getByRole('button',{name:'使用 GitHub 登录'}));
  await waitFor(()=>expect(runtime.login).toHaveBeenCalledWith('https://duallane.tsio.top',undefined));
  await waitFor(()=>expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled());
});

test('the optional invitation field stays behind a secondary account prompt',async()=>{
  config.apiOrigin='https://duallane.tsio.top';
  const runtime=new Runtime();runtime.login=jest.fn().mockResolvedValue(undefined);
  const view=render(<LoginScreen runtime={runtime}/>);
  fireEvent.press(view.getByRole('button',{name:'还没有账号？'}));
  fireEvent.changeText(view.getByLabelText('空间邀请链接（可选）'),'https://duallane.tsio.top/workspace?invite=test-code');
  fireEvent.press(view.getByRole('button',{name:'使用 GitHub 登录'}));
  await waitFor(()=>expect(runtime.login).toHaveBeenCalledWith('https://duallane.tsio.top','test-code'));
  await waitFor(()=>expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled());
});

test('a different-service invitation cannot initiate OAuth from the configured login screen',async()=>{
  config.apiOrigin='https://duallane.tsio.top';
  const runtime=new Runtime();runtime.login=jest.fn().mockResolvedValue(undefined);
  const view=render(<LoginScreen runtime={runtime}/>);
  fireEvent.press(view.getByRole('button',{name:'还没有账号？'}));
  fireEvent.changeText(view.getByLabelText('空间邀请链接（可选）'),'https://other.test/workspace?invite=test-code');
  fireEvent.press(view.getByRole('button',{name:'使用 GitHub 登录'}));
  await waitFor(()=>expect(view.getByText('请使用当前服务的有效空间邀请链接')).toBeTruthy());
  expect(runtime.login).not.toHaveBeenCalled();
  expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled();
});

test('GitHub login shows a classified network failure instead of a generic retry',async()=>{
  config.apiOrigin='https://duallane.tsio.top';
  const runtime=new Runtime();runtime.login=jest.fn().mockRejectedValue(new ApiError('request.network',0,'net.failed'));
  const view=render(<LoginScreen runtime={runtime}/>);
  fireEvent.press(view.getByRole('button',{name:'使用 GitHub 登录'}));
  await waitFor(()=>expect(view.getByText('无法连接到服务器，请检查网络后重试（net.failed）')).toBeTruthy());
  expect(view.queryByText('连接或数据暂时不可用，请重试')).toBeNull();
  expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled();
});

test('an unconfigured development build still requests a service address before login',async()=>{
  const runtime=new Runtime();runtime.login=jest.fn().mockResolvedValue(undefined);
  const view=render(<LoginScreen runtime={runtime}/>);
  expect(view.queryByLabelText('空间邀请链接（可选）')).toBeNull();
  expect(view.queryByRole('button',{name:'还没有账号？'})).toBeNull();
  expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeDisabled();
  fireEvent.changeText(view.getByLabelText('服务地址或邀请链接'),'https://development.test');
  fireEvent.press(view.getByRole('button',{name:'使用 GitHub 登录'}));
  await waitFor(()=>expect(runtime.login).toHaveBeenCalledWith('https://development.test',undefined));
  await waitFor(()=>expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled());
});

test('catalog emote tokens in ordinary markdown text render as catalog image sources',()=>{
  const parsed=parseMessage({
    id:'m2',conversationId:'c1',authorName:'Test',kind:'user',createdAt:'2026-01-01T00:00:00Z',
    plainText:'手机的[bili:melon]表情',
    content:{format:'duallane.message+json;v=1',blocks:[{type:'text',text:'手机的[bili:melon]表情'}]},
    attachments:[],
  })!;
  const view=renderMessage(<MessageRow message={parsed} retry={jest.fn()} download={jest.fn()}/>);
  expect(view.getByLabelText('[bili:melon]')).toBeTruthy();
  expect(view.getByText('手机的').props.selectable).toBe(true);
  expect(view.getByText('表情')).toBeTruthy();
  expect(view.queryByText('[bili:melon]')).toBeNull();
});
