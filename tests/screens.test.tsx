import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MessageRow } from '../src/features/screens';
import { parseMessage } from '../src/domain/contracts';

jest.mock('../src/data/runtime',()=>({Runtime:jest.fn()}));
jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('../src/data/transfers',()=>({Transfers:jest.fn()}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.1.0',versionCode:1},config:{apiOrigin:''}}));
jest.mock('../src/platform/storage',()=>({cache:{get:jest.fn()}}));
jest.mock('../src/platform/notifications',()=>({enableNotifications:jest.fn()}));
const file={id:'f1',fileName:'example.txt',mimeType:'text/plain',byteSize:3,status:'available',capabilities:{canDownload:true}};
const message={id:'m1',conversationId:'c1',authorName:'Test',kind:'user',createdAt:'2026-01-01T00:00:00Z',plainText:'example.txt',content:{format:'duallane.message+json;v=1',blocks:[{type:'attachment',attachmentId:'f1'}]},attachments:[file]};

test('chat attachments expose an authorized download action',()=>{
  const download=jest.fn();const view=render(<MessageRow message={parseMessage(message)!} retry={jest.fn()} download={download}/>);
  fireEvent.press(view.getByRole('button',{name:'下载并保存'}));expect(download).toHaveBeenCalledWith(file);
});
test('recalled messages never expose the old attachment action',()=>{
  const view=render(<MessageRow message={parseMessage({...message,recalledAt:'2026-01-02T00:00:00Z'})!} retry={jest.fn()} download={jest.fn()}/>);
  expect(view.queryByRole('button',{name:'下载并保存'})).toBeNull();expect(view.getByText('消息已不可用')).toBeTruthy();
});
