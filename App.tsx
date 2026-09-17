import React, { useEffect, useState } from 'react';
import { AppState, BackHandler, Modal, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MessageCircle, Files, Users, UserRound } from 'lucide-react-native';
import { z } from 'zod';
import * as Notifications from 'expo-notifications';
import { ThemeProvider, useTheme, type AppearanceMode } from './src/ui/theme';
import { Loading, Notice } from './src/ui/components';
import { Runtime } from './src/data/runtime';
import { Transfers } from './src/data/transfers';
import { useWorkspace } from './src/domain/store';
import { updateDecision } from './src/domain/updates';
import { ChatScreen, ConversationsScreen, DetailsScreen, FilesScreen, LoginScreen, MembersScreen, UpdatePrompt } from './src/features/screens';
import { AccountNavigator } from './src/features/account/screens';
import { installed } from './src/platform/config';
import { cache } from './src/platform/storage';
import { notificationTarget } from './src/platform/notifications';
import { errorText } from './src/data/client';

type RootParams = { Workspace: undefined; Chat: { id: string }; Details: { id: string } };
type TabsParams = { 聊天: undefined; 文件: undefined; 成员: undefined; 我的: undefined };
const Stack = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator<TabsParams>();
const navigation = createNavigationContainerRef<RootParams>();

export default function App() {
  const [mode, setMode] = useState(z.enum(['system', 'light', 'dark']).catch('system').parse(cache.get('appearance')));
  return (
    <SafeAreaProvider>
      <ThemeProvider mode={mode}>
        <Application mode={mode} setMode={setMode} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Application({ mode, setMode }: { mode: AppearanceMode; setMode: (v: AppearanceMode) => void }) {
  const [runtime] = useState(() => new Runtime());
  const [transfers] = useState(() => new Transfers());
  const t = useTheme();
  const ready = useWorkspace(s => s.ready);
  const busy = useWorkspace(s => s.busy);
  const error = useWorkspace(s => s.error);
  const policy = useWorkspace(s => s.policy);
  const forced = policy ? updateDecision(policy, installed) === 'forced' : false;

  useEffect(() => {
    void runtime.start();
    return () => runtime.dispose();
  }, [runtime]);
  useEffect(() => {
    if (!forced) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [forced]);
  useEffect(() => {
    let cancelled = false;
    const open = async (response: Notifications.NotificationResponse) => {
      if (!navigation.isReady() || !ready || forced) return;
      const target = notificationTarget.safeParse(response.notification.request.content.data);
      const s = useWorkspace.getState();
      if (!target.success || target.data.userId !== s.bootstrap?.auth.currentUser.id || target.data.origin !== runtime.api?.origin) return;
      try {
        await runtime.open(target.data.conversationId);
        if (!cancelled && useWorkspace.getState().bootstrap?.auth.currentUser.id === target.data.userId) navigation.navigate('Chat', { id: target.data.conversationId });
      } catch (e) {
        if (!cancelled) {
          useWorkspace.setState({ error: errorText(e) });
          navigation.navigate('Workspace');
        }
      } finally {
        await Notifications.clearLastNotificationResponseAsync();
      }
    };
    const sub = Notifications.addNotificationResponseReceivedListener(r => void open(r));
    if (ready) void Notifications.getLastNotificationResponseAsync().then(r => { if (r) void open(r); });
    return () => { cancelled = true; sub.remove(); };
  }, [ready, forced, runtime]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state === 'active' && runtime.isForced()) void runtime.checkPolicy(); });
    return () => sub.remove();
  }, [runtime]);

  const tabs = ({ navigation: nav }: NativeStackScreenProps<RootParams, 'Workspace'>) => (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: t.shared,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
        tabBarIcon: ({ color, size }) => {
          const Icon = { 聊天: MessageCircle, 文件: Files, 成员: Users, 我的: UserRound }[route.name];
          return <Icon color={color} size={size} />;
        },
      })}
    >
      <Tabs.Screen name="聊天">{() => <ConversationsScreen open={id => nav.navigate('Chat', { id })} />}</Tabs.Screen>
      <Tabs.Screen name="文件">{() => <FilesScreen runtime={runtime} transfers={transfers} />}</Tabs.Screen>
      <Tabs.Screen name="成员">{() => <MembersScreen runtime={runtime} open={id => nav.navigate('Chat', { id })} />}</Tabs.Screen>
      <Tabs.Screen name="我的">{() => <AccountNavigator runtime={runtime} mode={mode} setMode={setMode} />}</Tabs.Screen>
    </Tabs.Navigator>
  );

  const shell = !ready ? (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'left', 'right']}>
      <Notice text={error} />
      {busy ? <Loading /> : <LoginScreen runtime={runtime} />}
    </SafeAreaView>
  ) : (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Notice text={error} />
      <NavigationContainer ref={navigation}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: t.surface },
            headerTintColor: t.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: t.bg },
          }}
        >
          <Stack.Screen name="Workspace" options={{ headerShown: false }}>{tabs}</Stack.Screen>
          <Stack.Screen name="Chat" options={{ title: '会话' }}>
            {({ route, navigation: nav }) => (
              <ChatScreen id={route.params.id} runtime={runtime} transfers={transfers} details={() => nav.navigate('Details', { id: route.params.id })} />
            )}
          </Stack.Screen>
          <Stack.Screen name="Details" options={{ title: '会话详情' }}>
            {({ route }) => <DetailsScreen id={route.params.id} runtime={runtime} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </View>
  );

  return (
    <>
      {shell}
      {!forced && <UpdatePrompt runtime={runtime} />}
      <Modal visible={forced} transparent={false} onRequestClose={() => undefined}>
        <SafeAreaView style={{ flex: 1, justifyContent: 'center', backgroundColor: t.bg }}>
          <View accessibilityViewIsModal>
            <UpdatePrompt runtime={runtime} />
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}
