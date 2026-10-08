import React, { useEffect, useMemo, useState } from 'react';
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
import { MediaViewer } from './src/ui/MediaViewer';
import { StackHeader } from './src/ui/StackHeader';
import { Runtime } from './src/data/runtime';
import { Transfers } from './src/data/transfers';
import { useWorkspace } from './src/domain/store';
import { updateDecision } from './src/domain/updates';
import { ChatScreen, ConversationsScreen, DetailsScreen, FilesScreen, LoginScreen, MembersScreen, UpdatePrompt } from './src/features/screens';
import { AccountNavigator } from './src/features/account/screens';
import { installed } from './src/platform/config';
import { cache } from './src/platform/storage';
import { notificationTarget } from './src/platform/notifications';
import { ApiError, errorText } from './src/data/client';
import { canPreviewAttachment } from './src/data/media';

type RootParams = { Workspace: undefined; Chat: { id: string; focusMessageId?: string }; Topic: { id: string; conversationId: string }; Details: { id: string; kind?: 'conversation' | 'topic' }; Media: { id: string; fileName: string; mimeType: string; byteSize: number; status: string; canDownload: boolean; accountKey: string; conversationId?: string; topicId?: string; messageId?: string } };
type TabsParams = { 聊天: undefined; 文件: undefined; 成员: undefined; 我的: undefined };
const Stack = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator<TabsParams>();
const navigation = createNavigationContainerRef<RootParams>();

function previewSourceMessageId(bucket: string, fileId: string) {
  return useWorkspace.getState().messages[bucket]?.find(message => message.attachments.some(file => file.id === fileId))?.id;
}

function AuthorizedMediaScreen({ route, navigation: nav, runtime, transfers }: NativeStackScreenProps<RootParams, 'Media'> & { runtime: Runtime; transfers: Transfers }) {
  useWorkspace();
  const params = route.params;
  const file = useMemo(() => ({ id: params.id, fileName: params.fileName, mimeType: params.mimeType, byteSize: params.byteSize, status: params.status, capabilities: { canDownload: params.canDownload } }), [params]);
  const context = useMemo(() => ({ accountKey: params.accountKey, conversationId: params.conversationId, topicId: params.topicId, messageId: params.messageId }), [params.accountKey, params.conversationId, params.topicId, params.messageId]);
  const authorized = canPreviewAttachment(file, context);
  return <MediaViewer file={file} context={context} authorized={authorized} onClose={() => nav.goBack()} onDownload={async () => {
    const api = runtime.api;
    if (!api || !canPreviewAttachment(file, context)) throw new ApiError('permission.denied', 403);
    await transfers.download(api, context.accountKey, file, 'share');
  }} />;
}

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
    let invocation = 0;
    const open = async (response: Notifications.NotificationResponse) => {
      if (!navigation.isReady() || !ready || forced) return;
      const target = notificationTarget.safeParse(response.notification.request.content.data);
      const s = useWorkspace.getState();
      if (!target.success || target.data.userId !== s.bootstrap?.auth.currentUser.id || target.data.origin !== runtime.api?.origin) return;
      const request = ++invocation;
      const api = runtime.api, accountKey = s.accountKey;
      const route = navigation.getCurrentRoute();
      const routeContext = z.object({ id: z.string(), conversationId: z.string().optional(), focusMessageId: z.string().optional() });
      const params = routeContext.safeParse(route?.params);
      const preserveLoadedWindow = params.success && (target.data.topicId
        ? route?.name === 'Topic' && params.data.id === target.data.topicId && params.data.conversationId === target.data.conversationId
        : route?.name === 'Chat' && params.data.id === target.data.conversationId);
      const current = () => {
        const nextRoute = navigation.getCurrentRoute(), nextParams = routeContext.safeParse(nextRoute?.params);
        const sameContext = params.success && nextParams.success
          ? params.data.id === nextParams.data.id && params.data.conversationId === nextParams.data.conversationId && params.data.focusMessageId === nextParams.data.focusMessageId
          : route?.params === nextRoute?.params;
        return !cancelled && invocation === request && runtime.api === api && api?.origin === target.data.origin && useWorkspace.getState().accountKey === accountKey
          && useWorkspace.getState().bootstrap?.auth.currentUser.id === target.data.userId && nextRoute?.key === route?.key && nextRoute?.name === route?.name && sameContext;
      };
      try {
        if (target.data.topicId) {
          const loaded = await (preserveLoadedWindow ? runtime.openTopic(target.data.topicId, { preserveLoadedWindow: true }) : runtime.openTopic(target.data.topicId));
          if (loaded !== undefined && current() && !preserveLoadedWindow) {
            const topic = useWorkspace.getState().topics[target.data.topicId];
            navigation.navigate('Topic', { id: target.data.topicId, conversationId: topic?.conversationId ?? target.data.conversationId });
          }
        } else {
          const loaded = await (preserveLoadedWindow ? runtime.open(target.data.conversationId, { preserveLoadedWindow: true }) : runtime.open(target.data.conversationId));
          if (loaded !== undefined && current() && !preserveLoadedWindow) navigation.navigate('Chat', { id: target.data.conversationId });
        }
      } catch (e) {
        if (current()) {
          useWorkspace.setState({ error: errorText(e) });
          const state = useWorkspace.getState();
          const topic = target.data.topicId ? state.topics[target.data.topicId] : undefined;
          const readable = !!state.bootstrap?.permissions.canReadConversations && !!state.conversations[target.data.conversationId]
            && (!target.data.topicId || (!!topic?.joined && topic.conversationId === target.data.conversationId));
          if (!preserveLoadedWindow || !readable) navigation.navigate('Workspace');
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
      {error ? <SafeAreaView edges={['top', 'left', 'right']}>
        <Notice text={error} />
      </SafeAreaView> : null}
      {/* Recompute navigation insets from the remaining frame without remounting routes. */}
      <SafeAreaProvider>
      <NavigationContainer ref={navigation}>
        <Stack.Navigator
          screenOptions={{
            header: props => <StackHeader {...props} />,
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
                focusMessageId={route.params.focusMessageId}
                runtime={runtime}
                transfers={transfers}
                details={() => nav.navigate('Details', { id: route.params.id, kind: 'conversation' })}
                onOpenTopic={topicId => {
                  const topic = useWorkspace.getState().topics[topicId];
                  nav.navigate('Topic', { id: topicId, conversationId: topic?.conversationId ?? route.params.id });
                }}
                onPreview={file => nav.navigate('Media', { id: file.id, fileName: file.fileName, mimeType: file.mimeType, byteSize: file.byteSize, status: file.status, canDownload: file.capabilities.canDownload, accountKey: useWorkspace.getState().accountKey, conversationId: route.params.id, messageId: previewSourceMessageId(route.params.id, file.id) })}
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
                onPreview={file => nav.navigate('Media', { id: file.id, fileName: file.fileName, mimeType: file.mimeType, byteSize: file.byteSize, status: file.status, canDownload: file.capabilities.canDownload, accountKey: useWorkspace.getState().accountKey, conversationId: route.params.conversationId, topicId: route.params.id, messageId: previewSourceMessageId(`topic:${route.params.id}`, file.id) })}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Media" options={{ headerShown: false }}>
            {props => <AuthorizedMediaScreen {...props} runtime={runtime} transfers={transfers} />}
          </Stack.Screen>
          <Stack.Screen name="Details" options={{ title: '详情' }}>
            {({ route, navigation: nav }) => (
              <DetailsScreen
                id={route.params.id}
                kind={route.params.kind}
                runtime={runtime}
                onCreateTopic={topic => nav.navigate('Topic', { id: topic.id, conversationId: topic.conversationId })}
                onOpenTopic={topic => nav.navigate('Topic', { id: topic.id, conversationId: topic.conversationId })}
                onOpenPinnedMessage={messageId => nav.popTo('Chat', { id: route.params.id, focusMessageId: messageId })}
                onOpenFile={file => nav.navigate('Media', { id: file.id, fileName: file.fileName, mimeType: file.mimeType, byteSize: file.byteSize, status: file.status, canDownload: file.capabilities.canDownload, accountKey: useWorkspace.getState().accountKey, ...(route.params.kind === 'topic' ? { topicId: route.params.id } : { conversationId: route.params.id }) })}
                onDownloadFile={file => {
                  const api = runtime.api;
                  if (api && file.capabilities.canDownload) void transfers.download(api, useWorkspace.getState().accountKey, file).catch(error => useWorkspace.setState({ error: errorText(error) }));
                }}
              />
            )}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
      </SafeAreaProvider>
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
