import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { syntheticConversations, syntheticFiles, syntheticMessages, syntheticTopics } from '../../fixtures/synthetic';
import {
  AppHeader,
  Avatar,
  Button,
  ConversationRow,
  EmptyState,
  InlineFeedback,
  Input,
  Label,
  ObjectActionSheet,
  SegmentedControl,
  SettingRow,
  TopicRow,
  styles,
} from '../../ui/components';
import { MessageRow } from '../screens';
import { useTheme } from '../../ui/theme';

export function WorkbenchScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<'conversations' | 'topics'>('conversations');
  const [sheet, setSheet] = useState(false);
  return (
    <ScrollView style={[styles.page, { backgroundColor: t.bg }]} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      <AppHeader title="组件工作台" subtitle="导入正式组件，合成数据" />
      <View style={styles.content}>
        <Label muted>仅开发构建可见。工作台通过不等于真实流程通过。</Label>
        <Text style={[styles.section, { color: t.text }]}>按钮与输入</Text>
        <View style={styles.actions}>
          <Button title="主按钮" onPress={() => undefined} />
          <Button title="次要" secondary onPress={() => undefined} />
          <Button title="危险" variant="danger" onPress={() => undefined} />
          <Button title="禁用" disabled onPress={() => undefined} />
        </View>
        <Input accessibilityLabel="合成输入" placeholder="长 URL https://example.test/very/long/path?q=中文" />
        <InlineFeedback text="保存失败，保留输入并可重试" tone="danger" />
        <InlineFeedback text="已保存到本机，不会同步到其他设备" tone="success" />
        <Text style={[styles.section, { color: t.text }]}>头像</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Avatar name="成员甲" id="user-a" shape="person" />
          <Avatar name="工程协作 G1" id="c-group" shape="group" />
          <Avatar name="Echo" id="bot-echo" shape="bot" />
        </View>
        <Text style={[styles.section, { color: t.text }]}>分段与设置行</Text>
        <SegmentedControl
          accessibilityLabel="会话与话题"
          value={segment}
          options={[
            { value: 'conversations', label: '会话' },
            { value: 'topics', label: '话题' },
          ]}
          onChange={setSegment}
        />
        <SettingRow title="外观与阅读" detail="跟随系统 · 仅本机" onPress={() => undefined} />
        <SettingRow title="退出登录" danger onPress={() => undefined} />
        <Button title="打开消息动作" secondary onPress={() => setSheet(true)} />
      </View>
      <Text style={[styles.section, { color: t.text, paddingHorizontal: 16 }]}>会话行</Text>
      {syntheticConversations.map(conversation => (
        <ConversationRow key={conversation.id} conversation={conversation} selfId="user-a" onPress={() => undefined} />
      ))}
      <Text style={[styles.section, { color: t.text, paddingHorizontal: 16, paddingTop: 16 }]}>话题行</Text>
      {syntheticTopics.map(topic => (
        <TopicRow key={topic.id} {...topic} onPress={() => undefined} />
      ))}
      <Text style={[styles.section, { color: t.text, paddingHorizontal: 16, paddingTop: 16 }]}>消息</Text>
      {syntheticMessages.map(message => (
        <MessageRow key={message.id} message={message} retry={() => undefined} download={() => undefined} />
      ))}
      <EmptyState title="还没有话题" detail="未加入或已关闭的话题会显示准确状态，不会伪装成空消息列表。" />
      <View style={styles.content}>
        <Label muted>文件：{syntheticFiles.map(file => file.fileName).join('、')}</Label>
      </View>
      <ObjectActionSheet
        visible={sheet}
        title="成员乙的消息"
        detail="合成对象 · 动作与权限由服务端执行"
        onRequestClose={() => setSheet(false)}
        actions={[
          { id: 'reply', title: '回复', onPress: () => undefined },
          { id: 'copy', title: '复制', onPress: () => undefined },
          { id: 'hide', title: '仅自己隐藏', onPress: () => undefined },
          { id: 'recall', title: '撤回', danger: true, onPress: () => undefined },
        ]}
      />
    </ScrollView>
  );
}
