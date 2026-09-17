import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { z } from 'zod';
import { useWorkspace } from '../../domain/store';
import { attachmentSchema } from '../../domain/contracts';
import { Runtime } from '../../data/runtime';
import { errorText } from '../../data/client';
import { Transfers } from '../../data/transfers';
import { AppHeader, Button, FileRow, InlineFeedback, Input, PageState, TransferItem, styles } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function FilesScreen({ runtime, transfers }: { runtime: Runtime; transfers: Transfers }) {
  const t = useTheme();
  const files = useWorkspace(s => s.files);
  const key = useWorkspace(s => s.accountKey);
  const permission = useWorkspace(s => s.bootstrap?.permissions.canUpload);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [revision, setRevision] = useState(0);
  const visible = files.filter(file => file.fileName.includes(query));
  const refresh = async () => {
    if (!runtime.api) return;
    const r = await runtime.api.json(`/api/workspace/files?q=${encodeURIComponent(query)}`, z.object({ files: z.array(attachmentSchema) }));
    useWorkspace.setState({ files: r.files });
  };
  const run = async (task: ReturnType<Transfers['tasks']>[number]) => {
    if (!runtime.api) return;
    setProgress('上传中');
    try {
      await transfers.run(runtime.api, key, task, n => setProgress(`上传 ${Math.round(n * 100)}%`));
      await refresh();
    } catch (e) { setError(errorText(e)); }
    finally { setProgress(''); setRevision(v => v + 1); }
  };
  const tasks = transfers.tasks(key).filter(task => !task.complete);
  return (
    <View style={[styles.page, { backgroundColor: t.bg }]}>
      <AppHeader title="文件" subtitle="文件库上传不会自动发到某个会话" includeTopInset />
      <ScrollView contentContainerStyle={styles.content}>
        <Input accessibilityLabel="查找已加载的文件" placeholder="查找已加载的文件" value={query} onChangeText={setQuery} />
        <View style={styles.actions}>
          <Button title="搜索" secondary onPress={() => void refresh().catch(e => setError(errorText(e)))} />
          <Button title="上传文件" disabled={!permission || !!progress} onPress={() => void transfers.choose(key).then(task => task && run(task)).catch(e => setError(errorText(e)))} />
        </View>
        <InlineFeedback text={error || progress} tone={error ? 'danger' : 'info'} />
        <PageState status={visible.length ? 'ready' : 'empty'} emptyTitle="还没有文件" emptyDetail="这里是空间文件库，不是当前会话的待发送附件。">
          {visible.map(file => (
            <FileRow key={file.id} file={file} download={() => { if (runtime.api) void transfers.download(runtime.api, key, file).catch(e => setError(errorText(e))); }} />
          ))}
        </PageState>
        <Text style={{ color: t.muted, fontSize: t.type.meta }}>上传任务</Text>
        <View key={revision}>
          {tasks.map(task => (
            <TransferItem
              key={task.id}
              task={task}
              progress={progress}
              busy={!!progress}
              onResume={() => void run(task)}
              onPause={() => transfers.pause(task.id)}
              onCancel={() => { if (runtime.api) void transfers.cancel(runtime.api, key, task).then(() => setRevision(v => v + 1)).catch(e => setError(errorText(e))); }}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
