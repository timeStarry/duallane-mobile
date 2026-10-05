import React from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Button, Dialog, InlineFeedback, Input, Label, Loading, SegmentedControl } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { echoFieldLabels, echoFieldLimits, type EchoDraft } from '../../domain/echo-workflows';
import type { EchoWorkflowController } from './useEchoWorkflow';

const typeLabels = { requirement: '需求', suggestion: '建议', problem: '问题' };
const statusLabels = { completed: '已提交', cancelled: '已取消', expired: '已过期', conflicted: '流程发生冲突' };
const summaryFields: (keyof EchoDraft)[] = ['type', 'title', 'detail', 'scenario', 'expectedResult', 'relatedLink'];

export function EchoWorkflowDialog({ controller }: { controller: EchoWorkflowController }) {
  const t = useTheme();
  const { height } = useWindowDimensions();
  const { workflow, draft, busy } = controller;
  const step = workflow?.state.step;
  const field = step && step !== 'type' && step !== 'confirm' && step !== 'complete' ? step : undefined;
  const active = workflow?.status === 'active';
  return (
    <Dialog visible={controller.visible} title="Echo 需求与反馈" onRequestClose={controller.close} actions={[]}>
      <ScrollView style={{ maxHeight: height * 0.62 }} contentContainerStyle={{ gap: t.space.md }} keyboardShouldPersistTaps="handled">
        <InlineFeedback text={controller.feedback.text} tone={controller.feedback.tone} />
        {busy ? <Loading label="正在处理 Echo 流程" /> : null}
        {!workflow ? <Label muted>这里会引导你整理需求或问题。确认提交前不会创建需求。</Label> : null}
        {active && step !== 'confirm' ? (
          <>
            <Label>{step ? echoFieldLabels[step as keyof typeof echoFieldLabels] : ''}</Label>
            {step === 'type' || step === 'title' ? (
              <SegmentedControl
                accessibilityLabel="反馈类型"
                value={draft.type ?? 'requirement'}
                options={[{ value: 'requirement', label: '需求' }, { value: 'suggestion', label: '建议' }, { value: 'problem', label: '问题' }]}
                onChange={value => controller.edit('type', value)}
              />
            ) : null}
            {field ? <Input
              accessibilityLabel={echoFieldLabels[field]}
              placeholder={`填写${echoFieldLabels[field]}`}
              value={draft[field] ?? ''}
              editable={!busy}
              multiline={field !== 'title'}
              maxLength={echoFieldLimits[field]}
              textAlignVertical="top"
              style={field !== 'title' ? { minHeight: 120 } : undefined}
              onChangeText={value => controller.edit(field, value)}
            /> : null}
            {field && !draft[field] && workflow.state.fields[field] ? <Label muted>服务器已保存此项；恢复响应已脱敏。如需修改，请重新填写。</Label> : null}
            {step === 'expectedResult' ? <Input accessibilityLabel={echoFieldLabels.relatedLink} placeholder={echoFieldLabels.relatedLink} value={draft.relatedLink ?? ''} editable={!busy} autoCapitalize="none" keyboardType="url" maxLength={echoFieldLimits.relatedLink} onChangeText={value => controller.edit('relatedLink', value)} /> : null}
            <Button title="继续" disabled={busy} onPress={() => { void controller.advance(); }} />
          </>
        ) : null}
        {active && step === 'confirm' ? (
          <>
            <Label>确认提交以下内容</Label>
            {summaryFields.map(name => {
              const local = draft[name];
              const saved = workflow.state.fields[name];
              const value = name === 'type' ? typeLabels[draft.type ?? workflow.state.fields.type ?? 'requirement'] : local || (['detail', 'scenario', 'expectedResult'].includes(name) && saved ? '已在服务器保存；原文不在本机。' : saved);
              return value ? <View key={name} style={{ gap: t.space.xs }}><Label muted>{echoFieldLabels[name]}</Label><Label>{value}</Label></View> : null;
            })}
            <InlineFeedback text="提交后会通过 Echo 会话投递给你本人和空间所有者，不会向空间成员广播。" tone="info" />
            <Button title="确认提交" disabled={busy} onPress={() => { void controller.advance(true); }} />
          </>
        ) : null}
        {workflow && !active ? <InlineFeedback text={`${statusLabels[workflow.status as keyof typeof statusLabels] ?? '流程已结束'}${controller.publicId ? `：${controller.publicId}` : ''}`} tone={workflow.status === 'completed' ? 'success' : 'info'} /> : null}
        {!workflow && controller.canResume ? <Button title="重试流程" secondary disabled={busy} onPress={() => { void controller.resume(); }} /> : null}
        {active ? <Button title="取消流程" variant="danger" disabled={busy} onPress={() => { void controller.cancel(); }} /> : null}
        <Button title={active ? '稍后继续' : '关闭'} secondary onPress={controller.close} />
      </ScrollView>
    </Dialog>
  );
}
