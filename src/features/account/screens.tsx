import React, { useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useWorkspace } from '../../domain/store';
import { Runtime } from '../../data/runtime';
import { cache } from '../../platform/storage';
import { enableNotifications } from '../../platform/notifications';
import { installed } from '../../platform/config';
import { AppHeader, Button, Dialog, EmptyState, InlineFeedback, Label, SegmentedControl, SettingRow, styles } from '../../ui/components';
import { useTheme, type AppearanceMode } from '../../ui/theme';
import { WorkbenchScreen } from '../workbench/WorkbenchScreen';

export type AccountParams = {
  Home: undefined;
  Profile: undefined;
  Appearance: undefined;
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
      <Stack.Screen name="Profile" options={{ title: '个人资料' }}>{() => <ProfileScreen />}</Stack.Screen>
      <Stack.Screen name="Appearance" options={{ title: '外观与阅读' }}>
        {() => <AppearanceScreen mode={mode} setMode={setMode} />}
      </Stack.Screen>
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
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <SettingRow title="个人资料" detail="显示名与只读身份" onPress={() => open('Profile')} />
        <SettingRow title="外观与阅读" detail="浅色、深色或跟随系统，仅本机" onPress={() => open('Appearance')} />
        <SettingRow title="通知" detail="系统权限与本地通知说明" onPress={() => open('Notifications')} />
        <SettingRow title="空间信息" detail={bootstrap?.space.name} onPress={() => open('Space')} />
        <SettingRow title="关于与更新" detail={`版本 ${installed.appVersion}`} onPress={() => open('About')} />
        {__DEV__ ? <SettingRow title="组件工作台" detail="仅开发构建" onPress={() => open('Workbench')} /> : null}
        <View style={{ padding: 16, gap: 8 }}>
          <Button title="重新连接" secondary onPress={() => void runtime.resume()} />
          <Button title="退出登录" variant="danger" onPress={() => setConfirm(true)} />
        </View>
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

function ProfileScreen() {
  const t = useTheme();
  const user = useWorkspace(s => s.bootstrap?.auth.currentUser);
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Label>{user?.displayName ?? '当前账号'}</Label>
      <Label muted>{user?.kind === 'bot' ? 'Bot' : '共享空间成员'}</Label>
      <EmptyState title="资料编辑稍后接入" detail="服务端已有个人资料接口。本页先展示当前身份，不会假装已经保存成功。" />
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
