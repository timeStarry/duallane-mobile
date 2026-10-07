import { sendSelectedPhotos } from '../src/features/chat/photo-send';
import type { ApiClient } from '../src/data/client';
import type { Runtime } from '../src/data/runtime';
import type { Transfers, UploadTask } from '../src/data/transfers';

const first:UploadTask={id:'11111111-1111-4111-8111-111111111111',uri:'file:///document/uploads/first',fileName:'one.jpg',mimeType:'image/jpeg',byteSize:2,complete:false};
const second:UploadTask={...first,id:'22222222-2222-4222-8222-222222222222',uri:'file:///document/uploads/second',fileName:'two.png',mimeType:'image/png'};
const api={} as ApiClient;

function fixture(tasks:UploadTask[]) {
  const send=jest.fn(async (..._args:Parameters<Runtime['send']>)=>undefined);
  const chooseImages=jest.fn(async()=>tasks);
  const run=jest.fn(async (..._args:Parameters<Transfers['run']>)=>null);
  const discardUnstarted=jest.fn();
  const progress=jest.fn();
  return { send, chooseImages, run, discardUnstarted, progress,
    input:{runtime:{send} as Pick<Runtime,'send'>,transfers:{chooseImages,run,discardUnstarted} as Pick<Transfers,'chooseImages'|'run'|'discardUnstarted'>,
      api,accountKey:'synthetic-account',target:{kind:'topic' as const,id:'topic-1',conversationId:'group-1'},syncToGroup:true,isCurrent:()=>true,onProgress:progress},
  };
}

test('selected photos send one by one with separate upload tasks and captured topic staging', async()=>{
  const f=fixture([first,second]);
  const order:string[]=[];
  f.send.mockImplementation(async (_conversation,_text,_existing,_attachment,options)=>{
    order.push(options?.uploadTaskId ?? '');
    await options?.upload?.();
  });
  const result=await sendSelectedPhotos(f.input);
  expect(result).toEqual({selected:2,sent:2,failed:0});
  expect(order).toEqual([first.id,second.id]);
  expect(f.chooseImages).toHaveBeenCalledWith('synthetic-account',undefined,'private_staging',expect.any(Function));
  expect(f.send.mock.calls[0]?.[0]).toBe('group-1');
  expect(f.send.mock.calls[0]?.[1]).toBe('');
  expect(f.send.mock.calls[0]?.[4]).toMatchObject({topicId:'topic-1',syncToGroup:true,uploadTaskId:first.id,preserveDraft:true});
  expect(f.run.mock.calls.map(call=>call[2].id)).toEqual([first.id,second.id]);
});

test('one failed photo remains retryable while later selected photos still send', async()=>{
  const f=fixture([first,second]);
  f.send.mockRejectedValueOnce(new Error('upload failed'));
  expect(await sendSelectedPhotos(f.input)).toEqual({selected:2,sent:1,failed:1});
  expect(f.send).toHaveBeenCalledTimes(2);
  expect(f.discardUnstarted).not.toHaveBeenCalled();
});

test('cancel sends nothing and a changed route discards remaining unstarted photos', async()=>{
  const cancelled=fixture([]);
  expect(await sendSelectedPhotos(cancelled.input)).toEqual({selected:0,sent:0,failed:0});
  expect(cancelled.send).not.toHaveBeenCalled();
  const f=fixture([first,second]);
  let current=true;
  f.input.isCurrent=()=>current;
  f.send.mockImplementationOnce(async()=>{current=false;});
  expect(await sendSelectedPhotos(f.input)).toEqual({selected:2,sent:0,failed:0});
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.discardUnstarted).toHaveBeenCalledWith('synthetic-account',[second]);
});
