import type { ApiClient } from '../../data/client';
import type { Runtime } from '../../data/runtime';
import type { Transfers } from '../../data/transfers';
import type { ChatTarget } from '../../domain/contracts';

export type PhotoSendResult = { selected:number; sent:number; failed:number };

export async function sendSelectedPhotos(input:{
  runtime:Pick<Runtime,'send'>;
  transfers:Pick<Transfers,'chooseImages'|'run'|'discardUnstarted'>;
  api:ApiClient;
  accountKey:string;
  target:ChatTarget;
  syncToGroup:boolean;
  isCurrent:()=>boolean;
  onProgress:(text:string)=>void;
}):Promise<PhotoSendResult> {
  const { runtime, transfers, api, accountKey, target, syncToGroup, isCurrent, onProgress } = input;
  const conversationId = target.kind === 'topic' ? target.conversationId : target.id;
  const tasks = await transfers.chooseImages(accountKey, target.kind === 'topic' ? undefined : conversationId, target.kind === 'topic' ? 'private_staging' : 'conversation', isCurrent);
  let sent = 0;
  let failed = 0;
  for (let index = 0; index < tasks.length; index++) {
    if (!isCurrent()) {
      transfers.discardUnstarted(accountKey, tasks.slice(index));
      break;
    }
    const task = tasks[index];
    if (!task) break;
    onProgress(`正在发送图片 ${index + 1}/${tasks.length}`);
    try {
      await runtime.send(conversationId, '', undefined, undefined, {
        topicId:target.kind === 'topic' ? target.id : undefined,
        syncToGroup:target.kind === 'topic' && syncToGroup,
        uploadTaskId:task.id,
        upload:() => transfers.run(api, accountKey, task, progress => {
          if (isCurrent()) onProgress(`正在发送图片 ${index + 1}/${tasks.length} · ${Math.round(progress * 100)}%`);
        }, isCurrent),
        preserveDraft:true,
        shouldSend:isCurrent,
      });
      if (isCurrent()) sent++;
    } catch {
      if (!isCurrent()) {
        transfers.discardUnstarted(accountKey, tasks.slice(index));
        break;
      }
      failed++;
    }
  }
  if (isCurrent()) onProgress('');
  return { selected:tasks.length, sent, failed };
}
