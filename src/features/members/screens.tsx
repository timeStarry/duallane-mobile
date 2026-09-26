import React, { useState } from 'react';
import { FlatList, View } from 'react-native';
import { z } from 'zod';
import { useWorkspace } from '../../domain/store';
import { memberSchema } from '../../domain/contracts';
import { Runtime } from '../../data/runtime';
import { errorText } from '../../data/client';
import { AppHeader, Button, Dialog, InlineFeedback, Input, Label, MemberRow, PageState, styles } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function MembersScreen({ runtime, open }: { runtime: Runtime; open: (id: string) => void }) {
  const members = useWorkspace(s => s.bootstrap?.members ?? []);
  const [items, setItems] = useState(members);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [remarkFor, setRemarkFor] = useState<(typeof members)[number] | null>(null);
  const [remark, setRemark] = useState('');
  const t = useTheme();
  return (
    <View style={[styles.page, { backgroundColor: t.bg }]}>
      <AppHeader title="成员" subtitle="可见联系人范围由服务端决定" includeTopInset />
      <View style={styles.content}>
        <Input accessibilityLabel="查找可见成员" placeholder="查找可见成员" value={query} onChangeText={setQuery} />
        <Button
          title="搜索"
          secondary
          onPress={() => {
            if (runtime.api) void runtime.api.json(`/api/workspace/members?q=${encodeURIComponent(query)}`, z.object({ members: z.array(memberSchema) })).then(r => setItems(r.members)).catch(e => setError(errorText(e)));
          }}
        />
        <InlineFeedback text={error} tone="danger" />
      </View>
      <PageState status={items.length ? 'ready' : 'empty'} emptyTitle="当前范围内没有匹配成员" emptyDetail="不会从全群成员推断通讯录。">
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={m => m.id}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              onPress={() => { setRemarkFor(item); setRemark(item.remark ?? ''); }}
              onDirect={item.capabilities.canStartDirectConversation ? () => void runtime.direct(item.id).then(open).catch(e => setError(errorText(e))) : undefined}
            />
          )}
        />
      </PageState>
      <Dialog
        visible={!!remarkFor}
        title={remarkFor ? `备注 ${remarkFor.displayName}` : '备注'}
        onRequestClose={() => setRemarkFor(null)}
        actions={[
          { title: '保存', onPress: () => { if (remarkFor) void runtime.remark(remarkFor.id, remark).then(() => setRemarkFor(null)).catch(e => setError(errorText(e))); } },
          { title: '清除备注', variant: 'danger', onPress: () => { if (remarkFor) void runtime.clearRemark(remarkFor.id).then(() => setRemarkFor(null)).catch(e => setError(errorText(e))); } },
          { title: '取消', variant: 'secondary', onPress: () => setRemarkFor(null) },
        ]}
      >
        <Label muted>备注只对你可见。</Label>
        <Input accessibilityLabel="成员备注" value={remark} onChangeText={setRemark} />
      </Dialog>
    </View>
  );
}
