import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import type { NavigationAction } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useWorkspace } from '../../domain/store';
import type { ChatSettings, ChatSettingsPatch } from '../../domain/contracts';
import { Runtime } from '../../data/runtime';
import { errorText } from '../../data/client';
import { cache } from '../../platform/storage';
import { enableNotifications } from '../../platform/notifications';
import { installed } from '../../platform/config';
import {
  AppHeader,
  Avatar,
  Button,
  Dialog,
  EmptyState,
  InlineFeedback,
  Input,
  Label,
  PageState,
  SegmentedControl,
  SettingGroup,
  SettingRow,
  SwitchRow,
  styles,
} from '../../ui/components';
import { useTheme, type AppearanceMode } from '../../ui/theme';
import { WorkbenchScreen } from '../workbench/WorkbenchScreen';

export type AccountParams = {
  Home: undefined;
  Profile: undefined;
  Appearance: undefined;
  ChatPreferences: undefined;
  Notifications: undefined;
  Space: undefined;
  About: undefined;
  Workbench: undefined;
};

const Stack = createNativeStackNavigator<AccountParams>();
type HomeProps = NativeStackScreenProps<AccountParams, 'Home'>;

export function AccountNavigator({
  runtime,
  mode,
  setMode,
}: {
  runtime: Runtime;
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
}) {
  const t = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    >
      <Stack.Screen name="Home" options={{ headerShown: false }}>
        {({ navigation }: HomeProps) => <AccountHomeScreen runtime={runtime} open={name => navigation.navigate(name)} />}
      </Stack.Screen>
      <Stack.Screen name="Profile" options={{ title: '个人资料' }}>{() => <ProfileScreen runtime={runtime} />}</Stack.Screen>
      <Stack.Screen name="Appearance" options={{ title: '外观与阅读' }}>
        {() => <AppearanceScreen mode={mode} setMode={setMode} />}
      </Stack.Screen>
      <Stack.Screen name="ChatPreferences" options={{ title: '聊天偏好' }}>{() => <ChatPreferencesScreen runtime={runtime} />}</Stack.Screen>
      <Stack.Screen name="Notifications" options={{ title: '通知' }}>{() => <NotificationsScreen />}</Stack.Screen>
      <Stack.Screen name="Space" options={{ title: '空间信息' }}>{() => <SpaceInfoScreen />}</Stack.Screen>
      <Stack.Screen name="About" options={{ title: '关于与更新' }}>{() => <AboutScreen runtime={runtime} />}</Stack.Screen>
      {__DEV__ ? <Stack.Screen name="Workbench" options={{ headerShown: false }}>{() => <WorkbenchScreen />}</Stack.Screen> : null}
    </Stack.Navigator>
  );
}

function AccountHomeScreen({ runtime, open }: { runtime: Runtime; open: (name: Exclude<keyof AccountParams, 'Home'>) => void }) {
  const t = useTheme();
  const bootstrap = useWorkspace(s => s.bootstrap);
  const [confirm, setConfirm] = useState(false);
  return (
    <View style={[styles.page, { backgroundColor: t.bg }]}>
      <AppHeader title="我的" subtitle={bootstrap?.auth.currentUser.displayName} includeTopInset />
      <ScrollView contentContainerStyle={{ paddingBottom: 32, paddingTop: 12, gap: 20 }}>
        <SettingGroup title="账号">
          <SettingRow title="个人资料" detail="显示名与查找可见性" onPress={() => open('Profile')} />
        </SettingGroup>
        <SettingGroup title="偏好">
          <SettingRow title="外观与阅读" detail="浅色、深色或跟随系统，仅本机" onPress={() => open('Appearance')} />
          <SettingRow title="聊天偏好" detail="自动折叠、发送方式和表情点击发送" onPress={() => open('ChatPreferences')} />
          <SettingRow title="通知" detail="系统权限与本地通知说明" onPress={() => open('Notifications')} />
        </SettingGroup>
        <SettingGroup title="空间">
          <SettingRow title="空间信息" detail={bootstrap?.space.name} onPress={() => open('Space')} />
          <SettingRow title="关于与更新" detail={`版本 ${installed.appVersion}`} onPress={() => open('About')} />
          <SettingRow title="重新连接" detail="不修复实时通道，只重新拉取会话" onPress={() => void runtime.resume()} />
          {__DEV__ ? <SettingRow title="组件工作台" detail="仅开发构建" onPress={() => open('Workbench')} /> : null}
        </SettingGroup>
        <SettingGroup title="危险" danger>
          <SettingRow title="退出登录" danger onPress={() => setConfirm(true)} />
        </SettingGroup>
      </ScrollView>
      <Dialog
        visible={confirm}
        title="退出登录"
        onRequestClose={() => setConfirm(false)}
        actions={[
          { title: '退出', variant: 'danger', onPress: () => { setConfirm(false); void runtime.logout(); } },
          { title: '取消', variant: 'secondary', onPress: () => setConfirm(false) },
        ]}
      >
        <Label>本机缓存和未发送草稿将清除。这不会退出其他设备上的会话。</Label>
      </Dialog>
    </View>
  );
}

export function ProfileScreen({ runtime }: { runtime: Runtime }) {
  const t = useTheme();
  const navigation = useNavigation();
  const user = useWorkspace(s => s.bootstrap?.auth.currentUser);
  const savedNickname = user?.nickname ?? '';
  const savedDiscoverable = user?.searchDiscoverable ?? true;
  const [nickname, setNickname] = useState(savedNickname);
  const [discoverable, setDiscoverable] = useState(savedDiscoverable);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [leave, setLeave] = useState(false);
  const pendingLeave = useRef<NavigationAction | null>(null);
  const dirty = nickname !== savedNickname || discoverable !== savedDiscoverable;
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError('');
    try {
      await runtime.updateProfile({
        nickname: nickname.trim() ? nickname.trim().slice(0, 32) : null,
        searchDiscoverable: discoverable,
      });
    } catch (e) {
      setError(errorText(e));
      throw e;
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', event => {
      if (saving) {
        event.preventDefault();
        return;
      }
      if (!dirty) return;
      event.preventDefault();
      pendingLeave.current = event.data.action;
      setLeave(true);
    });
    return sub;
  }, [dirty, saving, navigation]);
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <AvatarBlock name={user?.displayName ?? '当前账号'} id={user?.id ?? 'self'} uri={user?.avatarUrl} />
      <Label muted>GitHub 身份 {user?.githubLogin || '只读，由登录提供'}</Label>
      <Label>显示名</Label>
      <Input accessibilityLabel="显示名" value={nickname} onChangeText={text => setNickname(text.slice(0, 32))} placeholder={user?.displayName || '显示名'} />
      <SwitchRow
        title="允许被成员查找"
        detail="这是个人可见性，不能改成对方的公共名字。"
        value={discoverable}
        onValueChange={setDiscoverable}
      />
      <View style={styles.actions}>
        <Button title={saving ? '保存中…' : '保存'} disabled={!dirty || saving} onPress={() => void save().catch(() => undefined)} />
        <Button title="取消" secondary disabled={saving || !dirty} onPress={() => { setNickname(savedNickname); setDiscoverable(savedDiscoverable); setError(''); }} />
      </View>
      <InlineFeedback text={error} tone="danger" />
      <EmptyState title="更换头像稍后接入" detail="自定义头像会按授权地址加载。上传仍走独立接口，本页不会假装已经保存头像。" />
      <Dialog
        visible={leave}
        title="保存对资料的修改？"
        onRequestClose={() => { setLeave(false); pendingLeave.current = null; }}
        actions={[
          {
            title: '保存并离开',
            onPress: () => {
              void save().then(() => {
                const action = pendingLeave.current;
                pendingLeave.current = null;
                setLeave(false);
                if (action) navigation.dispatch(action);
              }).catch(() => setLeave(false));
            },
          },
          {
            title: '放弃更改',
            variant: 'danger',
            onPress: () => {
              const action = pendingLeave.current;
              pendingLeave.current = null;
              setNickname(savedNickname);
              setDiscoverable(savedDiscoverable);
              setLeave(false);
              if (action) navigation.dispatch(action);
            },
          },
          { title: '继续编辑', variant: 'secondary', onPress: () => { setLeave(false); pendingLeave.current = null; } },
        ]}
      >
        <Label>只有未提交的修改才会询问。保存失败会留在本页并保留输入。</Label>
      </Dialog>
    </ScrollView>
  );
}

function AvatarBlock({ name, id, uri }: { name: string; id: string; uri?: string | null }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
      <Avatar name={name} id={id} uri={uri} />
      <Text style={{ fontSize: t.type.section, fontWeight: '600', color: t.text, flex: 1 }}>{name}</Text>
    </View>
  );
}

export function ChatPreferencesScreen({ runtime }: { runtime: Runtime }) {
  const accountKey = useWorkspace(s => s.accountKey);
  const seq = useRef(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState<ChatSettings | null>(null);
  const [feedback, setFeedback] = useState('');
  const [tone, setTone] = useState<'success' | 'danger' | 'info'>('info');
  const load = useCallback(() => {
    const request = ++seq.current;
    setStatus('loading');
    setDraft(null);
    void runtime.chatSettings().then(result => {
      if (request !== seq.current) return;
      setDraft(result.settings);
      setStatus('ready');
      setFeedback('');
    }).catch(error => {
      if (request !== seq.current) return;
      setStatus('error');
      setFeedback(errorText(error));
    });
  }, [runtime]);
  useEffect(() => {
    load();
    return () => { seq.current += 1; };
  }, [load, accountKey]);
  const save = (patch: ChatSettingsPatch, next: ChatSettings) => {
    const request = ++seq.current;
    setDraft(next);
    setFeedback('保存中…');
    setTone('info');
    void runtime.saveChatSettings(patch).then(saved => {
      if (request !== seq.current) return;
      setDraft(saved);
      setFeedback('已保存到当前账号');
      setTone('success');
    }).catch(error => {
      if (request !== seq.current) return;
      setFeedback(errorText(error));
      setTone('danger');
    });
  };
  const toggleType = (type: 'image' | 'emote' | 'long') => {
    if (!draft) return;
    const types = draft.autoHideMessageTypes.includes(type)
      ? draft.autoHideMessageTypes.filter(item => item !== type)
      : [...draft.autoHideMessageTypes, type];
    save({ autoHideMessageTypes: types }, { ...draft, autoHideMessageTypes: types });
  };
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Label muted>这些是个人显示和发送偏好，不会撤回消息，也不会改变其他人看见的内容。</Label>
      <PageState status={status === 'ready' ? 'ready' : status === 'loading' ? 'loading' : 'error'} emptyTitle="" error={feedback} onRetry={load}>
        {draft ? (
          <>
            <SwitchRow
              title="点击图片表情直接发送"
              value={draft.clickImageEmoteToSend}
              onValueChange={value => save({ clickImageEmoteToSend: value }, { ...draft, clickImageEmoteToSend: value })}
            />
            <SwitchRow
              title="回复时自动提及原作者"
              value={draft.replyAutoMention}
              onValueChange={value => save({ replyAutoMention: value }, { ...draft, replyAutoMention: value })}
            />
            <SwitchRow
              title="自动折叠消息"
              detail="只影响自己的显示。不是服务器隐藏或撤回。"
              value={draft.autoHideMessages}
              onValueChange={value => save({ autoHideMessages: value }, { ...draft, autoHideMessages: value })}
            />
            {draft.autoHideMessages ? (
              <>
                <SwitchRow title="折叠图片" value={draft.autoHideMessageTypes.includes('image')} onValueChange={() => toggleType('image')} />
                <SwitchRow title="折叠表情" value={draft.autoHideMessageTypes.includes('emote')} onValueChange={() => toggleType('emote')} />
                <SwitchRow title="折叠长消息" value={draft.autoHideMessageTypes.includes('long')} onValueChange={() => toggleType('long')} />
              </>
            ) : null}
            <InlineFeedback text={feedback} tone={tone} />
            {tone === 'danger' ? (
              <Button
                title="重试保存"
                secondary
                onPress={() => save({
                  clickImageEmoteToSend: draft.clickImageEmoteToSend,
                  replyAutoMention: draft.replyAutoMention,
                  autoHideMessages: draft.autoHideMessages,
                  autoHideMessageTypes: draft.autoHideMessageTypes,
                }, draft)}
              />
            ) : null}
          </>
        ) : null}
      </PageState>
    </ScrollView>
  );
}

function AppearanceScreen({ mode, setMode }: { mode: AppearanceMode; setMode: (mode: AppearanceMode) => void }) {
  const t = useTheme();
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Label>显示模式只保存在这台设备，不会同步到 Web 或其他手机。</Label>
      <SegmentedControl
        accessibilityLabel="外观"
        value={mode}
        options={[
          { value: 'system', label: '跟随系统' },
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
        ]}
        onChange={value => {
          setMode(value);
          cache.set('appearance', value);
        }}
      />
      <Label muted>当前为{t.mode === 'dark' ? '深色' : '浅色'}界面。切换不重建草稿或未发送消息。</Label>
      <Label muted>减少动态跟随系统可访问设置。本页没有单独开关，也不会同步到其他设备。</Label>
    </ScrollView>
  );
}

function NotificationsScreen() {
  const t = useTheme();
  const [notice, setNotice] = useState('');
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Label>新消息通知由应用在前台 WebSocket 收到事件后发出本地通知。普通后台可能延迟，进程结束后不保证即时送达。</Label>
      <Button
        title="开启消息通知"
        onPress={() => void enableNotifications().then(granted => setNotice(granted ? '系统已允许通知' : '系统未允许通知，可在系统设置中修改'))}
      />
      <Button title="系统通知设置" secondary onPress={() => void Linking.openSettings()} />
      {notice ? <InlineFeedback text={notice} tone={notice.startsWith('系统已允许') ? 'success' : 'warning'} /> : null}
      <Label muted>每个会话的「所有消息 / 仅提到我 / 免打扰」在该会话详情中设置，不表示系统通知权限已打开。</Label>
    </ScrollView>
  );
}

function SpaceInfoScreen() {
  const t = useTheme();
  const bootstrap = useWorkspace(s => s.bootstrap);
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Text style={[styles.section, { color: t.text }]}>{bootstrap?.space.name}</Text>
      <Label muted>今日剩余传输 {Math.round((bootstrap?.policy.remainingQuotaBytes ?? 0) / 1048576)} MiB</Label>
      <Label muted>消息保留上限 {bootstrap?.policy.messageRetentionCount} 条</Label>
      <Label muted>空间邀请、角色、容量和保留策略在 Web 管理，移动端只读这些个人可见摘要。</Label>
    </ScrollView>
  );
}

function AboutScreen({ runtime }: { runtime: Runtime }) {
  const t = useTheme();
  const policy = useWorkspace(s => s.policy);
  const [notice, setNotice] = useState('');
  const [otaReady, setOtaReady] = useState(false);
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Label>版本 {installed.appVersion} ({installed.versionCode})</Label>
      <Button title="检查更新" secondary onPress={() => void runtime.checkPolicy()} />
      {policy ? <Label muted>{policy.latest.releaseNotes.join('\n') || '暂无更新说明'}</Label> : null}
      {policy?.apkUrl ? <Button title="下载 Android 安装包" onPress={() => void Linking.openURL(policy.apkUrl!)} /> : null}
      <Button
        title="检查兼容补丁"
        secondary
        disabled={!Updates.isEnabled}
        onPress={() => {
          void Updates.checkForUpdateAsync().then(async result => {
            if (result.isAvailable) {
              await Updates.fetchUpdateAsync();
              setOtaReady(true);
              setNotice('补丁已验证，下次启动生效');
            } else setNotice('当前补丁已是最新');
          }).catch(() => setNotice('补丁验证或下载失败，继续使用当前版本'));
        }}
      />
      {otaReady ? <Button title="保存草稿并重启" onPress={() => void Updates.reloadAsync()} /> : null}
      {notice ? <InlineFeedback text={notice} tone="info" /> : null}
    </ScrollView>
  );
}
