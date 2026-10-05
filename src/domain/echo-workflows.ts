import { z } from 'zod';
import type { Conversation } from './contracts';

export const echoUserId = 'usr_system_echo';
const identifier = z.string().min(1).max(256);
export const echoDraftSchema = z.object({
  type: z.enum(['requirement', 'suggestion', 'problem']).optional(),
  title: z.string().max(120).optional(),
  detail: z.string().max(10000).optional(),
  scenario: z.string().max(4000).optional(),
  expectedResult: z.string().max(4000).optional(),
  relatedLink: z.string().max(2000).optional(),
});
export type EchoDraft = z.infer<typeof echoDraftSchema>;
export const echoStoredDraftSchema = z.object({ revision: z.number().int().positive(), fields: echoDraftSchema });
export const echoStepSchema = z.enum(['type', 'title', 'detail', 'scenario', 'expectedResult', 'confirm', 'complete']);
export const echoWorkflowSchema = z.object({
  id: identifier, conversationId: identifier, botUserId: z.literal(echoUserId),
  type: z.literal('echo.requirement'), version: z.literal(1),
  status: z.enum(['active', 'completed', 'cancelled', 'expired', 'conflicted']),
  revision: z.number().int().positive(), expiresAt: z.string(),
  state: z.object({ step: echoStepSchema, fields: echoDraftSchema }),
});
export type EchoWorkflow = z.infer<typeof echoWorkflowSchema>;
export const echoWorkflowResponseSchema = z.object({
  workflow: echoWorkflowSchema,
  result: z.object({ type: z.string(), publicId: z.string().optional() }).nullish(),
});
export const echoCommandResponseSchema = z.object({ command: z.object({
  ok: z.literal(true),
  result: z.object({ type: z.literal('workflow.start'), workflowType: z.literal('echo.requirement'), version: z.literal(1), input: echoDraftSchema }),
}) });
export const echoSlotSchema = z.object({
  workflowId: identifier.optional(),
  request: z.object({ source: z.string().max(10000), clientInvocationId: identifier }).optional(),
});

export function isOfficialEchoConversation(conversation?: Conversation) {
  return conversation?.type === 'direct' && conversation.members.some(member => member.id === echoUserId && member.kind === 'bot');
}

export function recognizeEchoCommand(conversation: Conversation | undefined, text: string) {
  if (!isOfficialEchoConversation(conversation)) return null;
  const source = text.trim();
  return /^\/(need|feedback)(?:\s+[\s\S]*)?$/i.test(source) ? source : null;
}

export const echoFieldLabels = {
  type: '反馈类型', title: '简短标题', detail: '详细描述', scenario: '使用场景', expectedResult: '期望结果', relatedLink: '相关链接（可选）',
} as const;
export const echoFieldLimits = { title: 120, detail: 10000, scenario: 4000, expectedResult: 4000, relatedLink: 2000 };

export function restoredEchoDraft(workflow: EchoWorkflow, local: EchoDraft): EchoDraft {
  // GET projects sensitive values to first-character + ellipsis. Only local drafts contain originals.
  const { type, title, relatedLink } = workflow.state.fields;
  return echoDraftSchema.parse({ type, title, relatedLink, ...local });
}

export function echoStepInput(workflow: EchoWorkflow, draft: EchoDraft, confirm = false): Record<string, string | boolean> {
  const step = workflow.state.step;
  if (workflow.status !== 'active' || step === 'complete') throw new Error('这个流程已经结束。');
  if (step === 'confirm') {
    if (!confirm) throw new Error('请点击确认提交。');
    return { confirm: true, idempotencyKey: `workflow-${workflow.id}-${workflow.revision}` };
  }
  if (confirm) throw new Error('请先完成当前步骤。');
  const value = draft[step]?.trim();
  if (!value) throw new Error('请填写当前步骤后继续。');
  const input: Record<string, string | boolean> = { [step]: value };
  if (step === 'title' && draft.type) input.type = draft.type;
  if (step === 'expectedResult' && draft.relatedLink?.trim()) {
    let url: URL;
    try { url = new URL(draft.relatedLink.trim()); } catch { throw new Error('请输入有效的相关链接。'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('请输入有效的相关链接。');
    input.relatedLink = draft.relatedLink.trim();
  }
  return input;
}

export function echoErrorText(error: unknown) {
  const messages: Record<string, string> = {
    'interaction.unavailable': 'Echo 交互暂时不可用，请稍后重试。',
    'command.arguments_invalid': '命令参数不完整，请检查后重试。',
    'command.in_progress': '命令仍在处理中，请稍后重试。',
    'command.rate_limited': '操作过于频繁，请稍后重试。',
    'interaction.rate_limited': '操作过于频繁，请稍后重试。',
    'workflow.active_conflict': '已有未完成的流程，请继续或取消。',
    'workflow.expired': '这个流程已过期，请重新发起。',
    'workflow.not_active': '这个流程已经结束。',
    'workflow.stale_revision': '流程已在别处更新，请重新载入。',
    'workflow.race_conflict': '流程已在别处更新，请重新载入。',
    'workflow.invalid_input': '请检查填写的内容后重试。',
  };
  return typeof error === 'string' ? messages[error] : undefined;
}
