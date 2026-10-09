import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Image, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MediaViewer } from '../src/ui/MediaViewer';
import { attachmentPreviewUri, emotePreviewUri } from '../src/data/media';
import { ApiError } from '../src/data/client';

jest.mock('../src/data/media',()=>({attachmentPreviewUri:jest.fn(),emotePreviewUri:jest.fn()}));
jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('../src/platform/config',()=>({installed:{appVersion:'0.2.2',versionCode:3}}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:jest.fn()}));
const file={id:'a1',fileName:'synthetic.png',mimeType:'image/png',byteSize:1500000,status:'available',capabilities:{canDownload:true}};
const context={accountKey:'account-a',conversationId:'c1',topicId:'t1'};
const saveTitle='保存到手机（1.5 MB）';

beforeEach(()=>{
  jest.mocked(attachmentPreviewUri).mockReset();
  jest.mocked(emotePreviewUri).mockReset();
  jest.mocked(useSafeAreaInsets).mockReturnValue({top:0,left:0,right:0,bottom:0});
});

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
  const save=view.getByRole('button',{name:saveTitle});
  act(()=>{fireEvent.press(save);fireEvent.press(save);});
  expect(view.getByRole('button',{name:'保存中…'})).toBeDisabled();
  expect(onDownload).toHaveBeenCalledTimes(1);
  await act(async()=>{reject(new ApiError('quota.insufficient',403));});
  expect(view.getByText('今日传输额度不足')).toBeTruthy();
  fireEvent.press(view.getByRole('button',{name:saveTitle}));
  await waitFor(()=>expect(onDownload).toHaveBeenCalledTimes(2));
  expect(view.queryByText('今日传输额度不足')).toBeNull();
});

test('the immersive viewer places transparent 48dp controls inside current top, bottom, and landscape safe areas',async()=>{
  jest.mocked(useSafeAreaInsets).mockReturnValue({top:32,left:10,right:14,bottom:24});
  jest.mocked(attachmentPreviewUri).mockResolvedValue('file:///cache/synthetic.png');
  const props={file,context,authorized:true,onClose:jest.fn(),onDownload:jest.fn()};
  const view=render(<MediaViewer {...props}/>);
  await waitFor(()=>expect(view.UNSAFE_queryByType(Image)).toBeTruthy());
  expect(StyleSheet.flatten(view.getByTestId('media-viewer-top-controls').props.style)).toMatchObject({paddingTop:40,paddingLeft:22,paddingRight:26});
  expect(StyleSheet.flatten(view.getByTestId('media-viewer-bottom-controls').props.style)).toMatchObject({paddingBottom:32,paddingLeft:26,paddingRight:30,backgroundColor:'transparent'});
  for(const name of ['关闭预览',saveTitle]){
    expect(StyleSheet.flatten(view.getByRole('button',{name}).props.style)).toMatchObject({minWidth:48,minHeight:48,backgroundColor:'transparent'});
  }
  expect(StyleSheet.flatten(view.UNSAFE_getByType(Image).props.style)).toMatchObject({position:'absolute',width:'100%',height:'100%'});
  expect(view.queryByText('下载并分享')).toBeNull();
  jest.mocked(useSafeAreaInsets).mockReturnValue({top:0,left:32,right:24,bottom:16});
  view.rerender(<MediaViewer {...props}/>);
  expect(StyleSheet.flatten(view.getByTestId('media-viewer-top-controls').props.style)).toMatchObject({paddingTop:8,paddingLeft:44,paddingRight:36});
  expect(StyleSheet.flatten(view.getByTestId('media-viewer-bottom-controls').props.style)).toMatchObject({paddingBottom:24,paddingLeft:48,paddingRight:40});
});

test('an image load failure remains retryable without replacing the save action with a solid footer',async()=>{
  jest.mocked(attachmentPreviewUri).mockRejectedValueOnce(new Error('synthetic failure')).mockResolvedValueOnce('file:///cache/retried.png');
  const view=render(<MediaViewer file={file} context={context} authorized onClose={jest.fn()} onDownload={jest.fn()}/>);
  await waitFor(()=>expect(view.getByText('图片无法加载')).toBeTruthy());
  expect(view.getByRole('button',{name:saveTitle})).toBeEnabled();
  fireEvent.press(view.getByRole('button',{name:'重试加载图片'}));
  await waitFor(()=>expect(view.UNSAFE_getByType(Image).props.source.uri).toBe('file:///cache/retried.png'));
  expect(view.queryByText('图片无法加载')).toBeNull();
});

test('cancelled save returns to its retryable state and an obsolete source cannot report a late save failure',async()=>{
  jest.mocked(attachmentPreviewUri).mockResolvedValue('file:///cache/synthetic.png');
  let resolve!:()=>void,reject!:(error:Error)=>void;
  const onDownload=jest.fn().mockImplementationOnce(()=>new Promise<void>(r=>{resolve=r;})).mockImplementationOnce(()=>new Promise<void>((_resolve,r)=>{reject=r;}));
  const props={context,authorized:true,onClose:jest.fn(),onDownload};
  const view=render(<MediaViewer file={file} {...props}/>);
  fireEvent.press(view.getByRole('button',{name:saveTitle}));
  await act(async()=>{resolve();});
  expect(view.getByRole('button',{name:saveTitle})).toBeEnabled();
  fireEvent.press(view.getByRole('button',{name:saveTitle}));
  const nextFile={...file,id:'a2',byteSize:2000000};
  view.rerender(<MediaViewer file={nextFile} {...props}/>);
  await act(async()=>{reject(new ApiError('quota.insufficient',403));});
  expect(view.queryByText('今日传输额度不足')).toBeNull();
  expect(view.getByRole('button',{name:'保存到手机（2.0 MB）'})).toBeEnabled();
});

test('revocation during a save hides content and ignores the pending failure',async()=>{
  jest.mocked(attachmentPreviewUri).mockResolvedValue('file:///cache/synthetic.png');
  let reject!:(error:Error)=>void;
  const onDownload=jest.fn(()=>new Promise<void>((_resolve,r)=>{reject=r;}));
  const props={file,context,onClose:jest.fn(),onDownload};
  const view=render(<MediaViewer {...props} authorized/>);
  fireEvent.press(view.getByRole('button',{name:saveTitle}));
  view.rerender(<MediaViewer {...props} authorized={false}/>);
  await act(async()=>{reject(new ApiError('quota.insufficient',403));});
  expect(view.queryByTestId('media-viewer')).toBeNull();
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

test('emote preview uses its scoped resolver and a prior attachment result cannot replace it',async()=>{
  let resolve!:(value:string)=>void;
  jest.mocked(attachmentPreviewUri).mockImplementationOnce(()=>new Promise<string>(r=>{resolve=r;}));
  jest.mocked(emotePreviewUri).mockResolvedValue('file:///cache/synthetic-emote.png');
  const onClose=jest.fn();
  const view=render(<MediaViewer file={file} context={context} authorized onClose={onClose} onDownload={jest.fn()}/>);
  view.rerender(<MediaViewer emoteShortcode="[custom:synthetic]" context={context} authorized onClose={onClose}/>);
  await waitFor(()=>expect(view.UNSAFE_getByType(Image).props.source.uri).toBe('file:///cache/synthetic-emote.png'));
  expect(emotePreviewUri).toHaveBeenCalledWith('[custom:synthetic]',context);
  await act(async()=>{resolve('file:///cache/obsolete.png');});
  expect(view.UNSAFE_getByType(Image).props.source.uri).toBe('file:///cache/synthetic-emote.png');
  expect(view.queryByRole('button',{name:/保存/})).toBeNull();
  fireEvent.press(view.getByRole('button',{name:'关闭预览'}));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('an emote preview promise cannot reveal content after authorization is revoked',async()=>{
  let resolve!:(value:string)=>void;
  jest.mocked(emotePreviewUri).mockImplementationOnce(()=>new Promise<string>(r=>{resolve=r;}));
  const props={emoteShortcode:'[custom:synthetic]',context,onClose:jest.fn()};
  const view=render(<MediaViewer {...props} authorized/>);
  view.rerender(<MediaViewer {...props} authorized={false}/>);
  await act(async()=>{resolve('file:///cache/synthetic-emote.png');});
  expect(view.UNSAFE_queryByType(Image)).toBeNull();
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

test('an obsolete native image error cannot hide a new preview even when its cached URI is reused',async()=>{
  jest.mocked(attachmentPreviewUri).mockResolvedValue('file:///cache/synthetic.png');
  const props={context,authorized:true,onClose:jest.fn(),onDownload:jest.fn()};
  const view=render(<MediaViewer file={file} {...props}/>);
  await waitFor(()=>expect(view.UNSAFE_queryByType(Image)).toBeTruthy());
  const fail=view.UNSAFE_getByType(Image).props.onError as () => void;
  const nextFile={...file,id:'a2'};
  view.rerender(<MediaViewer file={nextFile} {...props}/>);
  await waitFor(()=>expect(attachmentPreviewUri).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(view.UNSAFE_queryByType(Image)).toBeTruthy());
  act(()=>{fail();});
  expect(view.UNSAFE_queryByType(Image)).toBeTruthy();
  expect(view.queryByText('图片无法加载')).toBeNull();
});
