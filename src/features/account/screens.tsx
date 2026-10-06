import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, ScrollView, View, useWindowDimensions } from 'react-native';
import { Text } from '../../ui/Text';
import * as Updates from 'expo-updates';
import type { NavigationAction } from '@react-navigation/native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useWorkspace } from '../../domain/store';
import type { ChatSettings, ChatSettingsPatch } from '../../domain/contracts';
import { Runtime } from '../../data/runtime';
import { errorText } from '../../data/client';
import { avatarErrorText, chooseAvatar, type AvatarSelection } from '../../data/avatar';
import { cache } from '../../platform/storage';
import { enableNotifications } from '../../platform/notifications';
import { installed } from '../../platform/config';
import {
  AppHeader,
  Avatar,
  Button,
  Dialog,
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
import { Bell, Info, LogOut, MessageSquare, Palette, RefreshCw, Smile, UserRound } from 'lucide-react-native';
import { catalogPacks } from '../../domain/emote-catalog';
import { useTheme, type AppearanceMode } from '../../ui/theme';
import { StackHeader } from '../../ui/StackHeader';
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
        header: props => <StackHeader {...props} />,
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
          <SettingRow icon={<UserRound size={20} color={t.text} />} title="个人资料" detail="显示名与查找可见性" onPress={() => open('Profile')} />
        </SettingGroup>
        <SettingGroup title="偏好">
          <SettingRow icon={<Palette size={20} color={t.text} />} title="外观与阅读" detail="浅色、深色或跟随系统，仅本机" onPress={() => open('Appearance')} />
          <SettingRow icon={<Smile size={20} color={t.text} />} title="聊天偏好" detail="表情包、自动折叠和发送方式" onPress={() => open('ChatPreferences')} />
          <SettingRow icon={<Bell size={20} color={t.text} />} title="通知" detail="系统权限与本地通知说明" onPress={() => open('Notifications')} />
        </SettingGroup>
        <SettingGroup title="空间">
          <SettingRow icon={<MessageSquare size={20} color={t.text} />} title="空间信息" detail={bootstrap?.space.name} onPress={() => open('Space')} />
          <SettingRow icon={<Info size={20} color={t.text} />} title="关于与更新" detail={`版本 ${installed.appVersion}`} onPress={() => open('About')} />
          <SettingRow icon={<RefreshCw size={20} color={t.text} />} title="重新连接" detail="恢复连接并同步最新会话" onPress={() => void runtime.resume()} />
          {__DEV__ ? <SettingRow title="组件工作台" detail="仅开发构建" onPress={() => open('Workbench')} /> : null}
        </SettingGroup>
        <SettingGroup title="危险" danger>
          <SettingRow icon={<LogOut size={20} color={t.danger} />} title="退出登录" danger onPress={() => setConfirm(true)} />
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
  const { height } = useWindowDimensions();
  const navigation = useNavigation();
  const accountKey = useWorkspace(s => s.accountKey);
  const user = useWorkspace(s => s.bootstrap?.auth.currentUser);
  const savedNickname = user?.nickname ?? '';
  const savedDiscoverable = user?.searchDiscoverable ?? true;
  const [nickname, setNickname] = useState(savedNickname);
  const [discoverable, setDiscoverable] = useState(savedDiscoverable);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [leave, setLeave] = useState(false);
  const profileIdentity = useRef({ accountKey, userId: user?.id });
  const canonicalInputs = useRef({ nickname: savedNickname, discoverable: savedDiscoverable });
  const submittedProfile = useRef<{ nickname: string; discoverable: boolean; completed: boolean } | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarFeedback, setAvatarFeedback] = useState('');
  const [avatarTone, setAvatarTone] = useState<'success' | 'danger'>('success');
  const [avatarPreview, setAvatarPreview] = useState<AvatarSelection | null>(null);
  const [avatarPreviewReady, setAvatarPreviewReady] = useState(false);
  const [restoreAvatar, setRestoreAvatar] = useState(false);
  const avatarGeneration = useRef(0);
  const avatarWorking = useRef(false);
  const selectedAvatar = useRef<{ file: AvatarSelection; current: () => boolean; ready: boolean } | null>(null);
  const restoreScope = useRef<(() => boolean) | null>(null);
  const clearSelection = useCallback(() => {
    selectedAvatar.current?.file.dispose();
    selectedAvatar.current = null;
    setAvatarPreview(null);
    setAvatarPreviewReady(false);
  }, []);
  const invalidateAvatar = useCallback(() => {
    avatarGeneration.current += 1;
    setAvatarBusy(false); setAvatarFeedback(''); setRestoreAvatar(false);
    avatarWorking.current = false;
    restoreScope.current = null;
    clearSelection();
  }, [clearSelection]);
  useFocusEffect(useCallback(() => {
    invalidateAvatar();
    return invalidateAvatar;
  }, [invalidateAvatar]));
  useEffect(() => {
    invalidateAvatar();
    return invalidateAvatar;
  }, [runtime, runtime.api, accountKey, user?.id, invalidateAvatar]);
  const avatarCurrent = () => {
    try {
      const generation = avatarGeneration.current, session = runtime.avatarScope();
      return () => generation === avatarGeneration.current && navigation.isFocused() && session();
    } catch { return () => false; }
  };
  const selectAvatar = async () => {
    if (avatarWorking.current) return;
    const current = avatarCurrent();
    if (!current()) return;
    avatarWorking.current = true; setAvatarBusy(true); setAvatarFeedback(''); clearSelection();
    try {
      const file = await chooseAvatar(accountKey, current);
      if (!current()) { file?.dispose(); return; }
      if (file) { selectedAvatar.current = { file, current, ready: false }; setAvatarPreview(file); }
    } catch (error) {
      if (current()) { setAvatarFeedback(avatarErrorText(error)); setAvatarTone('danger'); }
    } finally { if (current()) { avatarWorking.current = false; setAvatarBusy(false); } }
  };
  const saveAvatar = async (selected: typeof selectedAvatar.current) => {
    if (!selected || selected !== selectedAvatar.current || avatarWorking.current) return;
    if (!selected.current()) { clearSelection(); return; }
    if (!selected.ready) return;
    avatarWorking.current = true; setAvatarBusy(true); setAvatarFeedback('');
    setAvatarPreview(null); setAvatarPreviewReady(false);
    try {
      await runtime.updateAvatar(selected.file, selected.current);
      if (selected.current()) { setAvatarFeedback('头像已保存'); setAvatarTone('success'); }
    } catch (error) {
      if (selected.current()) { setAvatarFeedback(avatarErrorText(error)); setAvatarTone('danger'); }
    } finally {
      selected.file.dispose();
      if (selected.current()) { selectedAvatar.current = null; avatarWorking.current = false; setAvatarBusy(false); }
    }
  };
  const restoreGithubAvatar = async () => {
    const current = restoreScope.current;
    setRestoreAvatar(false);
    if (!current?.() || avatarWorking.current) return;
    avatarWorking.current = true; setAvatarBusy(true); setAvatarFeedback('');
    try {
      await runtime.clearAvatar(current);
      if (current()) { setAvatarFeedback('已恢复 GitHub 头像'); setAvatarTone('success'); }
    } catch (error) {
      if (current()) { setAvatarFeedback(avatarErrorText(error)); setAvatarTone('danger'); }
    } finally { if (current()) { avatarWorking.current = false; setAvatarBusy(false); } }
  };
  const pendingLeave = useRef<NavigationAction | null>(null);
  useEffect(() => {
    const previous = canonicalInputs.current, submission = submittedProfile.current;
    canonicalInputs.current = { nickname: savedNickname, discoverable: savedDiscoverable };
    if (profileIdentity.current.accountKey !== accountKey || profileIdentity.current.userId !== user?.id) {
      profileIdentity.current = { accountKey, userId: user?.id };
      submittedProfile.current = null;
      setNickname(savedNickname); setDiscoverable(savedDiscoverable); setSaving(false); setError(''); setLeave(false);
      pendingLeave.current = null;
      return;
    }
    // A canonical update follows pristine fields independently. An in-flight save
    // must not mistake a newer edit back to the old canonical value for a pristine field.
    setNickname(value => submission && value !== submission.nickname ? value : value === previous.nickname ? savedNickname : value);
    setDiscoverable(value => submission && value !== submission.discoverable ? value : value === previous.discoverable ? savedDiscoverable : value);
    if (!saving && submission?.completed) submittedProfile.current = null;
  }, [accountKey, user?.id, savedNickname, savedDiscoverable, saving]);
  const dirty = nickname !== savedNickname || discoverable !== savedDiscoverable;
  const save = async () => {
    if (!dirty || saving) return;
    const submission = { nickname, discoverable, completed: false };
    const generation = avatarGeneration.current, api = runtime.api, userId = user?.id;
    const current = () => generation === avatarGeneration.current && navigation.isFocused() && runtime.api === api
      && useWorkspace.getState().accountKey === accountKey && useWorkspace.getState().bootstrap?.auth.currentUser.id === userId;
    submittedProfile.current = submission;
    setSaving(true);
    setError('');
    try {
      const canonical = await runtime.updateProfile({
        nickname: nickname.trim() ? nickname.trim().slice(0, 32) : null,
        searchDiscoverable: discoverable,
      });
      if (!current()) throw new Error('Stale session');
      setNickname(value => value === submission.nickname ? canonical.nickname ?? '' : value);
      setDiscoverable(value => value === submission.discoverable ? canonical.searchDiscoverable ?? true : value);
    } catch (e) {
      if (current()) setError(errorText(e));
      throw e;
    } finally {
      submission.completed = true;
      if (submittedProfile.current === submission) setSaving(false);
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
  const previewSelection = selectedAvatar.current;
  const closePreview = () => {
    if (previewSelection && selectedAvatar.current === previewSelection && !avatarWorking.current) clearSelection();
  };
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <AvatarBlock name={user?.displayName ?? '当前账号'} id={user?.id ?? 'self'} uri={user?.avatarUrl} />
      <Label muted>GitHub 身份 {user?.githubLogin || '只读，由登录提供'}</Label>
      <Label>显示名</Label>
      <Input accessibilityLabel="显示名" value={nickname} onChangeText={text => setNickname(text.slice(0, 32))} placeholder={user?.displayName || '显示名'} />
      <SwitchRow
        title="允许被成员查找"
        detail="开启后，空间成员可通过公开昵称或 GitHub 登录名找到你。关闭不影响已有会话和联系人。"
        value={discoverable}
        onValueChange={setDiscoverable}
      />
      <View style={styles.actions}>
        <Button title={saving ? '保存中…' : '保存'} disabled={!dirty || saving} onPress={() => void save().catch(() => undefined)} />
        <Button title="取消" secondary disabled={saving || !dirty} onPress={() => { setNickname(savedNickname); setDiscoverable(savedDiscoverable); setError(''); }} />
      </View>
      <InlineFeedback text={error} tone="danger" />
      <Label>头像</Label>
      <Label muted>选择 JPEG、PNG 或 WebP 图片，非空且不超过 5 MiB。确认后会校正图片方向并按中心裁剪成方形；头像与显示名独立保存。</Label>
      <View style={styles.actions}>
        <Button title={avatarBusy ? '头像处理中…' : '更换头像'} disabled={avatarBusy || !user} onPress={() => void selectAvatar()} />
        <Button title="恢复 GitHub 头像" secondary disabled={avatarBusy || !user} onPress={() => { const current = avatarCurrent(); if (current()) { restoreScope.current = current; setRestoreAvatar(true); } }} />
      </View>
      <InlineFeedback text={avatarFeedback} tone={avatarTone} />
      <Dialog
        visible={!!avatarPreview}
        title="确认更换头像？"
        onRequestClose={closePreview}
        actions={[
          { title: '取消上传', variant: 'secondary', onPress: closePreview },
        ]}
      >
        <ScrollView style={{ maxHeight: height * 0.4 }} contentContainerStyle={{ gap: t.space.md }} keyboardShouldPersistTaps="handled">
          {avatarPreview ? <Image
            key={avatarPreview.uri}
            accessibilityLabel="所选头像中心裁剪预览"
            source={{ uri: avatarPreview.uri }}
            resizeMode="cover"
            style={{ width: 160, height: 160, alignSelf: 'center', borderRadius: t.radius.control }}
            onLoad={() => {
              if (!previewSelection || selectedAvatar.current !== previewSelection || !previewSelection.current() || avatarWorking.current) return;
              previewSelection.ready = true; setAvatarPreviewReady(true);
            }}
            onError={() => {
              if (!previewSelection || selectedAvatar.current !== previewSelection || !previewSelection.current() || avatarWorking.current) return;
              clearSelection(); setAvatarFeedback('这张图片无法读取，请选择其他图片'); setAvatarTone('danger');
            }}
          /> : null}
          {!avatarPreviewReady ? <Label muted>正在加载预览…</Label> : null}
          <Label>预览按中心裁剪，保存后由服务器处理。不会保存尚未提交的显示名或查找可见性。</Label>
          <Button title="确认上传" disabled={!avatarPreviewReady || avatarBusy} onPress={() => void saveAvatar(previewSelection)} />
        </ScrollView>
      </Dialog>
      <Dialog
        visible={restoreAvatar}
        title="恢复 GitHub 头像？"
        onRequestClose={() => { setRestoreAvatar(false); restoreScope.current = null; }}
        actions={[
          { title: '确认恢复', variant: 'danger', onPress: () => void restoreGithubAvatar() },
          { title: '保留当前头像', variant: 'secondary', onPress: () => { setRestoreAvatar(false); restoreScope.current = null; } },
        ]}
      >
        <Label>将移除自定义头像并恢复 GitHub 头像，不改变显示名或查找可见性。</Label>
      </Dialog>
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
            <Label muted>聊天时显示的内置表情包，至少保留一个。自定义收藏和表情合集始终可用。</Label>
            {((draft.availablePacks?.length ? draft.availablePacks : catalogPacks().map(pack => ({ id: pack.id, label: pack.label, defaultEnabled: pack.defaultEnabled }))).map(pack => {
              const enabled = (draft.enabledPackIds ?? catalogPacks().filter(item => item.defaultEnabled !== false).map(item => item.id)).includes(pack.id);
              const only = enabled && (draft.enabledPackIds?.length ?? 1) <= (draft.minimumEnabled ?? 1);
              return (
                <SwitchRow
                  key={pack.id}
                  title={pack.label}
                  value={enabled}
                  onValueChange={() => {
                    const current = draft.enabledPackIds ?? catalogPacks().filter(item => item.defaultEnabled !== false).map(item => item.id);
                    const next = enabled ? current.filter(id => id !== pack.id) : [...current, pack.id];
                    if (next.length < (draft.minimumEnabled ?? 1) || only) return;
                    save({ enabledPackIds: next }, { ...draft, enabledPackIds: next });
                  }}
                />
              );
            }))}
            <RecallReasonField runtime={runtime} />
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
                  enabledPackIds: draft.enabledPackIds,
                }, draft)}
              />
            ) : null}
          </>
        ) : null}
      </PageState>
    </ScrollView>
  );
}

function RecallReasonField({ runtime }: { runtime: Runtime }) {
  const user = useWorkspace(s => s.bootstrap?.auth.currentUser);
  const [value, setValue] = useState(user?.recallReason ?? '内容有误');
  const [status, setStatus] = useState('');
  return (
    <View style={{ gap: 8 }}>
      <Label muted>撤回原因会出现在聊天里，例如“你因{value || '...'}撤回了一条消息”。</Label>
      <Input
        accessibilityLabel="自定义撤回原因"
        maxLength={16}
        value={value}
        onChangeText={setValue}
        onBlur={() => {
          const next = value.trim() || '内容有误';
          setValue(next);
          void runtime.updateProfile({ recallReason: next }).then(() => setStatus('已保存撤回原因')).catch(error => setStatus(errorText(error)));
        }}
      />
      {status ? <Label muted>{status}</Label> : null}
    </View>
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
