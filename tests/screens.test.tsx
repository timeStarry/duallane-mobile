import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { LoginScreen, MessageRow } from '../src/features/screens';
import { parseMessage } from '../src/domain/contracts';
import { config } from '../src/platform/config';
import { Runtime } from '../src/data/runtime';

jest.mock('../src/data/runtime',()=>({Runtime:jest.fn()}));
jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('../src/data/transfers',()=>({Transfers:jest.fn()}));
jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{extra:{environment:'test',apiOrigin:'',channel:'internal'}},nativeAppVersion:'0.1.0',nativeBuildVersion:'1'}}));
jest.mock('../src/platform/storage',()=>({cache:{get:jest.fn()}}));
jest.mock('../src/platform/notifications',()=>({enableNotifications:jest.fn()}));
const file={id:'f1',fileName:'example.txt',mimeType:'text/plain',byteSize:3,status:'available',capabilities:{canDownload:true}};
const message={id:'m1',conversationId:'c1',authorName:'Test',kind:'user',createdAt:'2026-01-01T00:00:00Z',plainText:'example.txt',content:{format:'duallane.message+json;v=1',blocks:[{type:'attachment',attachmentId:'f1'}]},attachments:[file]};

beforeEach(()=>{config.apiOrigin='';});

test('chat attachments expose an authorized download action',()=>{
  const download=jest.fn();const view=render(<MessageRow message={parseMessage(message)!} retry={jest.fn()} download={download}/>);
  fireEvent.press(view.getByRole('button',{name:'下载并保存'}));expect(download).toHaveBeenCalledWith(file);
});
test('recalled messages never expose the old attachment action',()=>{
  const view=render(<MessageRow message={parseMessage({...message,recalledAt:'2026-01-02T00:00:00Z'})!} retry={jest.fn()} download={jest.fn()}/>);
  expect(view.queryByRole('button',{name:'下载并保存'})).toBeNull();expect(view.getByText('消息已不可用')).toBeTruthy();
});

test('a configured release offers direct GitHub login without a server address or required form field',async()=>{
  config.apiOrigin='https://duallane.tsio.top';
  const runtime=new Runtime();runtime.login=jest.fn().mockResolvedValue(undefined);
  const view=render(<LoginScreen runtime={runtime}/>);
  expect(view.queryByLabelText('服务地址或邀请链接')).toBeNull();
  expect(view.queryByPlaceholderText('HTTPS 服务地址或空间邀请链接')).toBeNull();
  expect(view.getByLabelText('空间邀请链接（可选）').props.value).toBe('');
  expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled();
  fireEvent.press(view.getByRole('button',{name:'使用 GitHub 登录'}));
  await waitFor(()=>expect(runtime.login).toHaveBeenCalledWith('https://duallane.tsio.top',undefined));
  await waitFor(()=>expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled());
});

test('the optional invitation field passes a same-service invitation into GitHub login',async()=>{
  config.apiOrigin='https://duallane.tsio.top';
  const runtime=new Runtime();runtime.login=jest.fn().mockResolvedValue(undefined);
  const view=render(<LoginScreen runtime={runtime}/>);
  fireEvent.changeText(view.getByLabelText('空间邀请链接（可选）'),'https://duallane.tsio.top/workspace?invite=test-code');
  fireEvent.press(view.getByRole('button',{name:'使用 GitHub 登录'}));
  await waitFor(()=>expect(runtime.login).toHaveBeenCalledWith('https://duallane.tsio.top','test-code'));
  await waitFor(()=>expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled());
});

test('a different-service invitation cannot initiate OAuth from the configured login screen',async()=>{
  config.apiOrigin='https://duallane.tsio.top';
  const runtime=new Runtime();runtime.login=jest.fn().mockResolvedValue(undefined);
  const view=render(<LoginScreen runtime={runtime}/>);
  fireEvent.changeText(view.getByLabelText('空间邀请链接（可选）'),'https://other.test/workspace?invite=test-code');
  fireEvent.press(view.getByRole('button',{name:'使用 GitHub 登录'}));
  await waitFor(()=>expect(view.getByText('请使用当前服务的有效空间邀请链接')).toBeTruthy());
  expect(runtime.login).not.toHaveBeenCalled();
  expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled();
});

test('an unconfigured development build still requests a service address before login',async()=>{
  const runtime=new Runtime();runtime.login=jest.fn().mockResolvedValue(undefined);
  const view=render(<LoginScreen runtime={runtime}/>);
  expect(view.queryByLabelText('空间邀请链接（可选）')).toBeNull();
  expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeDisabled();
  fireEvent.changeText(view.getByLabelText('服务地址或邀请链接'),'https://development.test');
  fireEvent.press(view.getByRole('button',{name:'使用 GitHub 登录'}));
  await waitFor(()=>expect(runtime.login).toHaveBeenCalledWith('https://development.test',undefined));
  await waitFor(()=>expect(view.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled());
});
