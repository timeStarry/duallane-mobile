import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { z } from 'zod';
import { attachmentSchema, type Attachment } from '../domain/contracts';
import { useWorkspace } from '../domain/store';
import { cache } from '../platform/storage';
import type { ApiClient } from './client';
const taskSchema=z.object({id:z.string(),uri:z.string(),fileName:z.string(),mimeType:z.string(),byteSize:z.number(),uploadId:z.string().optional(),attachmentId:z.string().optional(),conversationId:z.string().optional(),complete:z.boolean().default(false)});
export type UploadTask=z.infer<typeof taskSchema>;
const reservation=z.object({id:z.string(),attachment:attachmentSchema,upload:z.object({partSize:z.number().positive().max(4194304),partCount:z.number().int().nonnegative()})});
export class Transfers {
  private paused=new Set<string>();
  private active=new Set<string>();
  tasks(key:string):UploadTask[]{return z.array(taskSchema).catch([]).parse(cache.get(`${key}:uploads`)??[]);}
  private save(key:string,t:UploadTask){const tasks=this.tasks(key).filter(v=>v.id!==t.id);cache.set(`${key}:uploads`,[...tasks,t]);}
  private assertAccount(key:string){if(useWorkspace.getState().accountKey!==key)throw new Error('Account changed');}
  async choose(key:string,conversationId?:string){const result=await DocumentPicker.getDocumentAsync({copyToCacheDirectory:true,multiple:false});if(result.canceled)return null;this.assertAccount(key);const asset=result.assets[0];if(!asset)return null;
    const id=Crypto.randomUUID(),dir=new Directory(Paths.document,'uploads');dir.create({intermediates:true,idempotent:true});const file=new File(dir,id);new File(asset.uri).copy(file);
    const task=taskSchema.parse({id,uri:file.uri,fileName:asset.name,mimeType:asset.mimeType??'application/octet-stream',byteSize:file.size,conversationId});this.save(key,task);return task;
  }
  pause(id:string){this.paused.add(id);}
  async run(api:ApiClient,key:string,task:UploadTask,progress:(n:number)=>void):Promise<Attachment|null>{
    if(this.active.has(task.id))return null;this.active.add(task.id);this.paused.delete(task.id);
    try{this.assertAccount(key);if(task.complete)return null;
      const file=new File(task.uri);if(!file.exists||file.size!==task.byteSize)throw new Error('File unavailable');
      if(!task.uploadId){const r=await api.json('/api/workspace/files/uploads/reserve',reservation,{fileName:task.fileName,mimeType:task.mimeType,byteSize:task.byteSize,visibility:task.conversationId?'conversation':'space',conversationId:task.conversationId});this.assertAccount(key);task={...task,uploadId:r.id,attachmentId:r.attachment.id};this.save(key,task);}
      const prefix=`/api/workspace/files/uploads/${encodeURIComponent(task.uploadId!)}`;
      const status=await api.json(prefix,z.object({partSize:z.number().positive().max(4194304),partCount:z.number().int().nonnegative(),parts:z.array(z.object({partNumber:z.number().int(),sha256:z.string()}))}));
      const handle=file.open();
      try{for(let number=1;number<=status.partCount;number++){
        this.assertAccount(key);if(this.paused.has(task.id))return null;
        handle.offset=(number-1)*status.partSize;const bytes=handle.readBytes(Math.min(status.partSize,task.byteSize-handle.offset));
        const digest=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,bytes);const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
        const received=status.parts.find(p=>p.partNumber===number);if(received&&received.sha256!==hash)throw new Error('Part conflict');
        if(!received)await api.raw(`${prefix}/parts/${number}`,{method:'PUT',headers:{'Content-Type':'application/octet-stream','X-DualLane-Part-SHA256':hash},body:bytes});
        progress(number/Math.max(1,status.partCount));
      }}finally{handle.close();}
      this.assertAccount(key);const completed=await api.json(`${prefix}/complete`,z.object({attachment:attachmentSchema}),{mode:'chunked'});this.assertAccount(key);task={...task,complete:true};this.save(key,task);file.delete();return completed.attachment;
    }finally{this.active.delete(task.id);}
  }
  async cancel(api:ApiClient,key:string,task:UploadTask){this.pause(task.id);if(this.active.has(task.id))throw new Error('Pause first');if(task.uploadId&&!task.complete)await api.json(`/api/workspace/files/uploads/${encodeURIComponent(task.uploadId)}/fail`,z.unknown(),{reason:'cancelled'});this.assertAccount(key);cache.set(`${key}:uploads`,this.tasks(key).filter(v=>v.id!==task.id));const file=new File(task.uri);if(file.exists)file.delete();}
  async download(api:ApiClient,key:string,attachment:Attachment){
    const res=await api.json(`/api/workspace/files/${encodeURIComponent(attachment.id)}/downloads/reserve`,z.object({id:z.string()}),{});this.assertAccount(key);
    const response=await api.raw(`/api/workspace/files/${encodeURIComponent(attachment.id)}/download?downloadId=${encodeURIComponent(res.id)}`);
    // Small bounded chunks are uploaded; downloads use streamed native fetch response where supported.
    const bytes=new Uint8Array(await response.arrayBuffer());this.assertAccount(key);
    const file=new File(Paths.cache,`${Crypto.randomUUID()}-${attachment.fileName.replace(/[^\p{L}\p{N}._-]/gu,'_').slice(-100)}`);file.write(bytes);
    try{await Sharing.shareAsync(file.uri,{mimeType:attachment.mimeType,dialogTitle:'保存文件'});}finally{if(file.exists)file.delete();}
  }
}
