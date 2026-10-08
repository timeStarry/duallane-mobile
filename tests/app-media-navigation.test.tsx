import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Button as NativeButton, Image, Modal, StatusBar, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import App from '../App';
import { bootstrapSchema, parseMessage, type Attachment } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { releaseSchema } from '../src/domain/updates';
import { attachmentPreviewUri, emotePreviewUri } from '../src/data/media';
import { saveFileToDevice } from '../src/platform/save-file';

const mockDisk=new Map<string,Uint8Array>();
const mockDirs=new Set<string>();
const mockApi={
  origin:'https://workspace.example',
  json:jest.fn(async()=>({id:'synthetic-reservation'})),
  raw:jest.fn(async()=>{
    let read=false;
    return {body:{getReader:()=>({
      read:async()=>read ? {done:true} : (read=true,{done:false,value:new Uint8Array([1,2,3])}),
      cancel:async()=>undefined,
    })}};
  }),
};

jest.mock('../src/data/runtime',()=>({Runtime:jest.fn().mockImplementation(()=>({
  start:jest.fn().mockResolvedValue(undefined),dispose:jest.fn(),isForced:()=>false,api:mockApi,
}))}));
jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('expo-constants',()=>({__esModule:true,default:{
  expoConfig:{extra:{environment:'test',apiOrigin:'',channel:'internal'}},nativeAppVersion:'0.2.2',nativeBuildVersion:'18',
}}));
jest.mock('../src/platform/storage',()=>({cache:{get:jest.fn(),set:jest.fn(),remove:jest.fn()}}));
jest.mock('expo-notifications',()=>({
  setNotificationHandler:jest.fn(),addNotificationResponseReceivedListener:()=>({remove:jest.fn()}),
  getLastNotificationResponseAsync:jest.fn().mockResolvedValue(null),clearLastNotificationResponseAsync:jest.fn(),
}));
jest.mock('../src/features/account/screens',()=>({AccountNavigator:()=>null}));
jest.mock('../src/features/chat/SearchScreen',()=>({SearchScreen:()=>null}));
jest.mock('expo-document-picker',()=>({getDocumentAsync:jest.fn()}));
jest.mock('expo-image-picker',()=>({launchImageLibraryAsync:jest.fn()}));
jest.mock('expo-sharing',()=>({shareAsync:jest.fn().mockResolvedValue(undefined)}));
jest.mock('../src/platform/save-file',()=>({saveFileToDevice:jest.fn().mockResolvedValue(true)}));
jest.mock('expo-crypto',()=>({randomUUID:()=> 'synthetic-directory',CryptoDigestAlgorithm:{SHA256:'SHA256'}}));
jest.mock('expo-file-system',()=>({
  Paths:{cache:'file:///cache',document:'file:///document'},
  Directory:class{
    uri:string;
    constructor(base:string|{uri:string},...parts:string[]){this.uri=[typeof base==='string'?base:base.uri,...parts].join('/');}
    get exists(){return mockDirs.has(this.uri);}
    create(){mockDirs.add(this.uri);}
    delete(){mockDirs.delete(this.uri);for(const uri of mockDisk.keys())if(uri.startsWith(`${this.uri}/`))mockDisk.delete(uri);}
  },
  File:class{
    uri:string;
    constructor(base:string|{uri:string},...parts:string[]){this.uri=[typeof base==='string'?base:base.uri,...parts].join('/');}
    get exists(){return mockDisk.has(this.uri);}
    get size(){return mockDisk.get(this.uri)?.length??0;}
    create(){mockDisk.set(this.uri,new Uint8Array());}
    delete(){mockDisk.delete(this.uri);}
    open(){return {writeBytes:(bytes:Uint8Array)=>mockDisk.set(this.uri,bytes),close:()=>undefined};}
  },
}));
jest.mock('../src/data/media',()=>({
  ...jest.requireActual('../src/data/media'),attachmentPreviewUri:jest.fn(),emotePreviewUri:jest.fn(),
}));

const file:Attachment={id:'f1',fileName:'synthetic.png',mimeType:'image/png',byteSize:3,status:'available',capabilities:{canDownload:true}};
const shortcode='[custom:11111111-1111-4111-8111-111111111111]';
const bootstrap=bootstrapSchema.parse({
  auth:{currentUser:{id:'u1',displayName:'Synthetic member'}},space:{id:'s1',name:'Synthetic workspace'},eventCursor:1,
  permissions:{canReadConversations:true,canDownload:true},policy:{dailyQuotaBytes:100,remainingQuotaBytes:100,messageRetentionCount:50},
  members:[],conversations:[{id:'c1',type:'group',displayTitle:'Synthetic group',lastActivityAt:'2026-01-01T00:00:00Z',notificationLevel:'all'}],files:[],
});
const topic={id:'t1',conversationId:'c1',title:'Synthetic topic',status:'open',joined:true,canJoin:false,allowSyncToGroup:false,participantCount:2,unreadCount:0,notificationLevel:'all' as const,revision:1};
const attachmentMessage=parseMessage({id:'m-file',conversationId:'c1',authorId:'u2',kind:'user',createdAt:'2026-01-01T00:00:00Z',plainText:'Synthetic attachment',attachments:[file],content:{format:'duallane.message+json;v=1',blocks:[{type:'attachment',attachmentId:file.id}]}})!;
const emoteMessage=parseMessage({id:'m-emote',conversationId:'c1',topicId:'t1',authorId:'u2',kind:'user',createdAt:'2026-01-01T00:00:00Z',plainText:shortcode,attachments:[],content:{format:'duallane.message+json;v=1',blocks:[{type:'emoji',shortcode}]}})!;

function MockConversationsScreen({open,openTopic}:{open:(id:string)=>void;openTopic:(topic:{id:string;conversationId:string})=>void}){
  return <View><NativeButton title="Open synthetic chat" onPress={()=>open('c1')}/><NativeButton title="Open synthetic topic" onPress={()=>openTopic(topic)}/></View>;
}
function MockChatScreen({onPreview,onPreviewEmote,target}:{onPreview:(file:Attachment)=>void;onPreviewEmote:(shortcode:string,messageId:string)=>void;target:{kind:string}}){
  return <View><NativeButton title="Preview synthetic image" onPress={()=>onPreview(file)}/><NativeButton title="Preview synthetic emote" onPress={()=>onPreviewEmote(shortcode,target.kind==='topic'?'m-emote':'m-file')}/></View>;
}
function MockDetailsScreen(){return <View accessibilityLabel="Synthetic details page"/>;}
jest.mock('../src/features/screens',()=>({
  ConversationsScreen:MockConversationsScreen,ChatScreen:MockChatScreen,DetailsScreen:MockDetailsScreen,
  FilesScreen:()=>null,MembersScreen:()=>null,LoginScreen:()=>null,UpdatePrompt:()=>null,
}));

const windowMetrics:Metrics={frame:{x:0,y:0,width:390,height:844},insets:{top:32,left:8,right:8,bottom:24}};
const navigationMetrics:Metrics={frame:{x:0,y:96,width:390,height:748},insets:{top:0,left:8,right:8,bottom:24}};
function nativeInsets(view:ReturnType<typeof render>,provider:number,metrics:Metrics){
  const native=view.UNSAFE_getAllByType(SafeAreaProvider)[provider]!.findAll((node:{props:{onInsetsChange?:unknown}})=>typeof node.props.onInsetsChange==='function')[0]!;
  act(()=>native.props.onInsetsChange({nativeEvent:metrics}));
}
function mediaModal(view:ReturnType<typeof render>){return view.UNSAFE_getAllByType(Modal).find(modal=>modal.props.statusBarTranslucent)!;}
function navigator(view:ReturnType<typeof render>){return view.UNSAFE_getByType(NavigationContainer).props.ref.current;}
function start(){
  const view=render(<App/>);
  nativeInsets(view,0,windowMetrics);
  nativeInsets(view,1,navigationMetrics);
  return view;
}

beforeEach(()=>{
  useWorkspace.getState().reset();mockDisk.clear();mockDirs.clear();
  useWorkspace.getState().applyBootstrap(bootstrap,'account-a');
  useWorkspace.getState().upsertTopic(topic);useWorkspace.getState().upsertMessage(attachmentMessage);useWorkspace.getState().upsertMessage(emoteMessage);
  useWorkspace.setState({ready:true,error:'Synthetic global feedback'});
  jest.mocked(attachmentPreviewUri).mockResolvedValue('file:///cache/synthetic-preview.png');
  jest.mocked(emotePreviewUri).mockResolvedValue('file:///cache/synthetic-emote.png');
});
afterEach(()=>{useWorkspace.getState().reset();mockDisk.clear();mockDirs.clear();});

test('image navigation uses full-window modal metrics and real transfer saving instead of sharing',async()=>{
  const view=start();
  fireEvent.press(view.getByText('Open synthetic chat'));
  await waitFor(()=>expect(view.getByText('Preview synthetic image')).toBeTruthy());
  fireEvent.press(view.getByText('Preview synthetic image'));
  await waitFor(()=>expect(view.UNSAFE_queryByType(Image)).toBeTruthy());
  const modal=mediaModal(view);
  expect(modal.props.visible).toBe(true);expect(modal.props.navigationBarTranslucent).toBe(true);
  expect(modal.findByType(SafeAreaProvider).props.initialMetrics).toEqual(windowMetrics);
  expect(modal.findByType(StatusBar).props.barStyle).toBe('light-content');
  expect(StyleSheet.flatten(view.getByTestId('media-viewer-top-controls').props.style).paddingTop).toBe(40);
  expect(attachmentPreviewUri).toHaveBeenCalledWith(file,{accountKey:'account-a',conversationId:'c1',messageId:'m-file',topicId:undefined});
  const save=view.getByRole('button',{name:'保存到手机（0.0 MB）'});
  act(()=>{fireEvent.press(save);fireEvent.press(save);});
  await waitFor(()=>expect(saveFileToDevice).toHaveBeenCalledWith('file:///cache/synthetic-directory/synthetic.png',file.fileName,file.mimeType));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(saveFileToDevice).toHaveBeenCalledTimes(1);
  expect(mockApi.json).toHaveBeenCalledTimes(1);
  await waitFor(()=>expect(view.getByRole('button',{name:'保存到手机（0.0 MB）'})).toBeEnabled());
  expect(mockDisk.size).toBe(0);expect(mockDirs.size).toBe(0);
  fireEvent(modal,'requestClose');
  await waitFor(()=>expect(navigator(view).getCurrentRoute().name).toBe('Chat'));
});

test('topic emote navigation retains message authorization and does not offer an unknown-size save action',async()=>{
  const view=start();
  fireEvent.press(view.getByText('Open synthetic topic'));
  await waitFor(()=>expect(view.getByText('Preview synthetic emote')).toBeTruthy());
  fireEvent.press(view.getByText('Preview synthetic emote'));
  await waitFor(()=>expect(view.UNSAFE_queryByType(Image)).toBeTruthy());
  expect(navigator(view).getCurrentRoute().name).toBe('EmoteMedia');
  expect(emotePreviewUri).toHaveBeenCalledWith(shortcode,{accountKey:'account-a',conversationId:'c1',topicId:'t1',messageId:'m-emote'});
  expect(view.queryByRole('button',{name:/保存到手机/})).toBeNull();
  act(()=>useWorkspace.getState().patchMessage('topic:t1','m-emote',{recalledAt:'2026-01-02T00:00:00Z'}));
  await waitFor(()=>expect(navigator(view).getCurrentRoute().name).toBe('Topic'));
  expect(view.UNSAFE_queryByType(Image)).toBeNull();
});

test('a mounted media route hides its native modal when another route takes focus and restores it on return',async()=>{
  const view=start();
  fireEvent.press(view.getByText('Open synthetic chat'));
  await waitFor(()=>expect(view.getByText('Preview synthetic image')).toBeTruthy());
  fireEvent.press(view.getByText('Preview synthetic image'));
  await waitFor(()=>expect(mediaModal(view).props.visible).toBe(true));
  act(()=>navigator(view).navigate('Details',{id:'c1'}));
  await waitFor(()=>expect(navigator(view).getCurrentRoute().name).toBe('Details'));
  expect(mediaModal(view).props.visible).toBe(false);
  act(()=>mediaModal(view).props.onRequestClose());
  expect(navigator(view).getCurrentRoute().name).toBe('Details');
  act(()=>navigator(view).goBack());
  await waitFor(()=>expect(mediaModal(view).props.visible).toBe(true));
  await waitFor(()=>expect(view.UNSAFE_queryByType(Image)).toBeTruthy());
});

test('a forced update takes the modal window and prevents the hidden preview from navigating back',async()=>{
  const view=start();
  fireEvent.press(view.getByText('Open synthetic chat'));
  await waitFor(()=>expect(view.getByText('Preview synthetic image')).toBeTruthy());
  fireEvent.press(view.getByText('Preview synthetic image'));
  await waitFor(()=>expect(view.UNSAFE_queryByType(Image)).toBeTruthy());
  const policy=releaseSchema.parse({schemaVersion:1,platform:'android',channel:'internal',
    latest:{appVersion:'9.0.0',versionCode:999,releaseId:'synthetic-release',releaseNotes:[]},
    minimum:{appVersion:'9.0.0',versionCode:999},recommendation:'none',apkUrl:null,
    protocol:{eventMajor:1,contentFormats:['duallane.message+json;v=1']},
  });
  act(()=>useWorkspace.setState({policy}));
  expect(mediaModal(view).props.visible).toBe(false);
  expect(view.UNSAFE_getAllByType(Modal).filter(modal=>modal.props.visible)).toHaveLength(1);
  act(()=>mediaModal(view).props.onRequestClose());
  expect(navigator(view).getCurrentRoute().name).toBe('Media');
  act(()=>useWorkspace.setState({policy:null}));
  await waitFor(()=>expect(view.UNSAFE_queryByType(Image)).toBeTruthy());
  expect(mediaModal(view).props.visible).toBe(true);
});
