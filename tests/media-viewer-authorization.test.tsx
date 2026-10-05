import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Image } from 'react-native';
import { MediaViewer } from '../src/ui/MediaViewer';
import { attachmentPreviewUri } from '../src/data/media';
import { ApiError } from '../src/data/client';

jest.mock('../src/data/media',()=>({attachmentPreviewUri:jest.fn()}));
jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.2.2',versionCode:3}}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,left:0,right:0,bottom:0})}));
const file={id:'a1',fileName:'synthetic.png',mimeType:'image/png',byteSize:3,status:'available',capabilities:{canDownload:true}};
const context={accountKey:'account-a',conversationId:'c1',topicId:'t1'};

test('an already visible image closes and stops rendering when its current authorization is revoked',async()=>{
  jest.mocked(attachmentPreviewUri).mockResolvedValueOnce('file:///cache/synthetic.png');const onClose=jest.fn();
  const view=render(<MediaViewer file={file} context={context} authorized onClose={onClose} onDownload={jest.fn()}/>);
  await waitFor(()=>expect(view.UNSAFE_queryByType(Image)).toBeTruthy());
  view.rerender(<MediaViewer file={file} context={context} authorized={false} onClose={onClose} onDownload={jest.fn()}/>);
  expect(view.UNSAFE_queryByType(Image)).toBeNull();expect(onClose).toHaveBeenCalledTimes(1);
});

test('a preview promise resolving after authorization loss cannot redisplay the image',async()=>{
  let resolve!:(value:string)=>void;jest.mocked(attachmentPreviewUri).mockImplementationOnce(()=>new Promise<string>(r=>{resolve=r;}));
  const onClose=jest.fn(),props={file,context,onClose,onDownload:jest.fn()};const view=render(<MediaViewer {...props} authorized/>);
  view.rerender(<MediaViewer {...props} authorized={false}/>);
  await act(async()=>{resolve('file:///cache/synthetic.png');});
  expect(view.UNSAFE_queryByType(Image)).toBeNull();expect(onClose).toHaveBeenCalledTimes(1);
});

test('failed download is visible and retryable without starting duplicate transfers',async()=>{
  jest.mocked(attachmentPreviewUri).mockResolvedValue('file:///cache/synthetic.png');
  let reject!:(error:Error)=>void;
  const onDownload=jest.fn().mockImplementationOnce(()=>new Promise<void>((_resolve,r)=>{reject=r;})).mockResolvedValueOnce(undefined);
  const view=render(<MediaViewer file={file} context={context} authorized onClose={jest.fn()} onDownload={onDownload}/>);
  await waitFor(()=>expect(view.UNSAFE_queryByType(Image)).toBeTruthy());
  fireEvent.press(view.getByText('下载并分享'));
  expect(view.getByText('正在下载…')).toBeTruthy();
  fireEvent.press(view.getByText('正在下载…'));
  expect(onDownload).toHaveBeenCalledTimes(1);
  await act(async()=>{reject(new ApiError('quota.insufficient',403));});
  expect(view.getByText('今日传输额度不足')).toBeTruthy();
  fireEvent.press(view.getByText('下载并分享'));
  await waitFor(()=>expect(onDownload).toHaveBeenCalledTimes(2));
  expect(view.queryByText('今日传输额度不足')).toBeNull();
});
