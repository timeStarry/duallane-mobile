import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AboutScreen } from '../src/features/account/screens';
import { UpdatePrompt } from '../src/features/updates/UpdatePrompt';
import { ThemeProvider } from '../src/ui/theme';
import { useWorkspace } from '../src/domain/store';
import { updateDecision, updateTarget, releaseSchema } from '../src/domain/updates';
import type { GitHubRelease } from '../src/domain/github-releases';
import type { Runtime } from '../src/data/runtime';
import { cache } from '../src/platform/storage';

jest.mock('../src/data/runtime', () => ({ Runtime: jest.fn() }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../src/data/transfers', () => ({ Transfers: jest.fn() }));
jest.mock('../src/platform/config', () => ({ installed:{appVersion:'0.2.2',versionCode:30},config:{environment:'test',apiOrigin:'',channel:'internal'} }));
jest.mock('../src/platform/storage', () => ({ cache:{get:jest.fn(),set:jest.fn()} }));
jest.mock('../src/platform/notifications', () => ({ enableNotifications:jest.fn() }));
jest.mock('expo-updates', () => ({ isEnabled:false,checkForUpdateAsync:jest.fn(),fetchUpdateAsync:jest.fn(),reloadAsync:jest.fn() }));

const metrics={frame:{x:0,y:0,width:390,height:844},insets:{top:24,left:0,right:0,bottom:0}};
const wrap=(children:React.ReactNode)=><SafeAreaProvider initialMetrics={metrics}><ThemeProvider mode="light">{children}</ThemeProvider></SafeAreaProvider>;
const release:GitHubRelease={appVersion:'0.2.3',versionCode:36,runtimeVersion:'android-5',releaseId:'github-123',releaseNotes:['Synthetic release notes'],apkUrl:'https://github.com/timeStarry/duallane-mobile/releases/download/v0.2.3/app-release.apk',apkBytes:1234,apkSha256:'a'.repeat(64)};
const policy=releaseSchema.parse({schemaVersion:1,platform:'android',channel:'internal',latest:{appVersion:'0.1.0',versionCode:1,releaseId:'old',releaseNotes:['Old notes']},minimum:{appVersion:'0.1.0',versionCode:1},recommendation:'none',apkUrl:'https://workspace.example/old.apk',protocol:{eventMajor:1,contentFormats:['duallane.message+json;v=1']}});
const installed={appVersion:'0.2.2',versionCode:30};
let runtime:Runtime;
beforeEach(()=>{
  useWorkspace.getState().reset();jest.mocked(cache.get).mockReturnValue(null);
  runtime={checkUpdates:jest.fn(async()=>undefined)} as unknown as Runtime;
  useWorkspace.setState({policy,release,releaseCheck:{status:'checked',checkedAt:1,error:''}});
});

test('About checks GitHub and displays its formal version instead of the stale server latest',()=>{
  const view=render(wrap(<AboutScreen runtime={runtime}/>));
  expect(view.getByText('发现新版本 0.2.3')).toBeTruthy();expect(view.getByText('GitHub 最新正式版 0.2.3 (36)')).toBeTruthy();
  expect(view.queryByText('Old notes')).toBeNull();fireEvent.press(view.getByRole('button',{name:'检查更新'}));expect(runtime.checkUpdates).toHaveBeenCalledTimes(1);
  const open=jest.spyOn(Linking,'openURL').mockResolvedValue(true);fireEvent.press(view.getByRole('button',{name:'下载 Android 安装包'}));expect(open).toHaveBeenCalledWith(release.apkUrl);open.mockRestore();
});

test('checking has an explicit disabled control and failure never says up-to-date',()=>{
  useWorkspace.setState({releaseCheck:{status:'checking',checkedAt:null,error:''}});
  const view=render(wrap(<AboutScreen runtime={runtime}/>));expect(view.getByRole('button',{name:'正在检查更新',disabled:true})).toBeTruthy();
  act(()=>useWorkspace.setState({releaseCheck:{status:'failed',checkedAt:1,error:'暂时无法获取 GitHub 最新版本，请稍后重试（http.403）'}}));
  view.rerender(wrap(<AboutScreen runtime={runtime}/>));expect(view.getByText(/暂时无法获取 GitHub 最新版本/)).toBeTruthy();expect(view.queryByText('当前版本无需更新')).toBeNull();
});

test('no published release and a newer installed candidate are distinct successful states',()=>{
  useWorkspace.setState({release:null});const view=render(wrap(<AboutScreen runtime={runtime}/>));expect(view.getByText('暂未发布正式版本')).toBeTruthy();
  act(()=>useWorkspace.setState({release:{...release,appVersion:'0.2.1',versionCode:29}}));view.rerender(wrap(<AboutScreen runtime={runtime}/>));expect(view.getByText('当前版本无需更新')).toBeTruthy();expect(view.queryByRole('button',{name:'下载 Android 安装包'})).toBeNull();
});

test('a stale soft/strong server latest cannot advertise an installer',()=>{
  const stale={...policy,latest:{...policy.latest,appVersion:'9.0.0',versionCode:999},recommendation:'strong' as const};
  expect(updateDecision(stale,installed)).toBe('none');expect(updateTarget(stale,null,installed)).toBeNull();
  useWorkspace.setState({policy:stale,release:null});expect(render(wrap(<UpdatePrompt runtime={runtime}/>)).queryByText('下载更新')).toBeNull();
});

test('GitHub can recommend an update while policy is temporarily unavailable',()=>{
  useWorkspace.setState({policy:null});const view=render(wrap(<UpdatePrompt runtime={runtime}/>));expect(view.getByText('发现新版本')).toBeTruthy();expect(view.getByText('可用版本 0.2.3')).toBeTruthy();
});

test('a forced server gate cannot be deferred and rejects a GitHub package below its minimum',()=>{
  const forced={...policy,latest:{...policy.latest,appVersion:'9.0.0',versionCode:999},minimum:{appVersion:'9.0.0',versionCode:999},apkUrl:'https://workspace.example/required.apk'};
  useWorkspace.setState({policy:forced});const view=render(wrap(<UpdatePrompt runtime={runtime}/>));expect(view.getByText('请更新后继续使用')).toBeTruthy();expect(view.queryByText('稍后提醒')).toBeNull();
  const open=jest.spyOn(Linking,'openURL').mockResolvedValue(true);fireEvent.press(view.getByRole('button',{name:'下载更新'}));expect(open).toHaveBeenCalledWith(forced.apkUrl);open.mockRestore();
});

test('a GitHub package meeting the server minimum replaces its stale download URL',()=>{
  const forced={...policy,latest:{...policy.latest,appVersion:'0.2.3',versionCode:36},minimum:{appVersion:'0.2.3',versionCode:36}};
  expect(updateDecision(forced,installed,release)).toBe('forced');expect(updateTarget(forced,release,installed)?.apkUrl).toBe(release.apkUrl);
});

test('unknown protocol stays forced even if latest-version discovery fails',()=>{
  const incompatible={...policy,protocol:{eventMajor:2,contentFormats:[]}};
  expect(updateDecision(incompatible,installed,null)).toBe('forced');
  expect(updateTarget(incompatible,release,installed)?.apkUrl).toBe(policy.apkUrl);
});

test('deferring one GitHub release does not hide a later release',()=>{
  const view=render(wrap(<UpdatePrompt runtime={runtime}/>));fireEvent.press(view.getByRole('button',{name:'稍后提醒'}));expect(cache.set).toHaveBeenCalledWith('defer:github-123',expect.any(Number));expect(view.queryByText('发现新版本')).toBeNull();
  act(()=>useWorkspace.setState({release:{...release,releaseId:'github-124'}}));view.rerender(wrap(<UpdatePrompt runtime={runtime}/>));expect(view.getByText('发现新版本')).toBeTruthy();
});
