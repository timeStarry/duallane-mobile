import React, { useEffect, useState } from 'react';
import { AppState, BackHandler, Modal, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { z } from 'zod';
import * as Notifications from 'expo-notifications';
import { ThemeProvider, useTheme, type AppearanceMode } from './src/ui/theme';
import { DualLaneTabBar, Loading, Notice } from './src/ui/components';
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

type RootParams = { Workspace: undefined; Chat: { id: string }; Topic: { id: string; conversationId: string }; Details: { id: string; kind?: 'conversation' | 'topic' } };
type TabsParams = { 聊天: undefined; 文件: undefined; 成员: undefined; 我的: undefined };
const Stack = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator<TabsParams>();
const navigation = createNavigationContainerRef<RootParams>();

export default function App() {
  const [mode, setMode] = useState(z.enum(['system', 'light', 'dark']).catch('system').parse(cache.get('appearance')));
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider mode={mode}>
          <KeyboardProvider enabled={false} preserveEdgeToEdge statusBarTranslucent navigationBarTranslucent>
            <Application mode={mode} setMode={setMode} />
          </KeyboardProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
        if (target.data.topicId) {
          await runtime.openTopic(target.data.topicId);
          if (!cancelled && useWorkspace.getState().bootstrap?.auth.currentUser.id === target.data.userId) {
            const topic = useWorkspace.getState().topics[target.data.topicId];
            navigation.navigate('Topic', { id: target.data.topicId, conversationId: topic?.conversationId ?? target.data.conversationId });
          }
        } else {
          await runtime.open(target.data.conversationId);
          if (!cancelled && useWorkspace.getState().bootstrap?.auth.currentUser.id === target.data.userId) navigation.navigate('Chat', { id: target.data.conversationId });
        }
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
      tabBar={props => <DualLaneTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="聊天">{() => <ConversationsScreen runtime={runtime} open={id => nav.navigate('Chat', { id })} openTopic={topic => nav.navigate('Topic', { id: topic.id, conversationId: topic.conversationId })} />}</Tabs.Screen>
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
          <Stack.Screen name="Chat" options={{ headerShown: false }}>
            {({ route, navigation: nav }) => (
              <ChatScreen
                target={{ kind: 'conversation', id: route.params.id }}
                runtime={runtime}
                transfers={transfers}
                details={() => nav.navigate('Details', { id: route.params.id, kind: 'conversation' })}
                onOpenTopic={topicId => {
                  const topic = useWorkspace.getState().topics[topicId];
                  nav.navigate('Topic', { id: topicId, conversationId: topic?.conversationId ?? route.params.id });
                }}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Topic" options={{ headerShown: false }}>
            {({ route, navigation: nav }) => (
              <ChatScreen
                target={{ kind: 'topic', id: route.params.id, conversationId: route.params.conversationId }}
                runtime={runtime}
                transfers={transfers}
                details={() => nav.navigate('Details', { id: route.params.id, kind: 'topic' })}
                onOpenTopic={topicId => nav.navigate('Topic', { id: topicId, conversationId: route.params.conversationId })}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Details" options={{ title: '详情' }}>
            {({ route, navigation: nav }) => (
              <DetailsScreen
                id={route.params.id}
                kind={route.params.kind}
                runtime={runtime}
                onCreateTopic={topic => nav.navigate('Topic', { id: topic.id, conversationId: topic.conversationId })}
                onOpenTopic={topic => nav.navigate('Topic', { id: topic.id, conversationId: topic.conversationId })}
              />
            )}
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
