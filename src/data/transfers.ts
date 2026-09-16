import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { z } from 'zod';
import { attachmentSchema, type Attachment } from '../domain/contracts';
import { useWorkspace } from '../domain/store';
import { cache } from '../platform/storage';
import type { ApiClient } from './client';

const bytesSchema = z.number().int().nonnegative().safe();
const taskSchema = z.object({ id:z.string().uuid(), uri:z.string(), fileName:z.string(), mimeType:z.string(), byteSize:bytesSchema, uploadId:z.string().optional(), attachmentId:z.string().optional(), conversationId:z.string().optional(), complete:z.boolean().default(false) });
export type UploadTask = z.infer<typeof taskSchema>;
const partSizeSchema = z.number().int().positive().max(4194304);
const partCountSchema = z.number().int().nonnegative().max(10000);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const reservation = z.object({ id:z.string().min(1), attachment:attachmentSchema, upload:z.object({ partSize:partSizeSchema, partCount:partCountSchema }) });
// Go's deployed UploadPartRecord uses exported field names; accept both public spellings.
const partSchema = z.union([
  z.object({ partNumber:z.number().int().positive(), byteSize:bytesSchema, sha256:hashSchema }),
  z.object({ PartNumber:z.number().int().positive(), ByteSize:bytesSchema, SHA256:hashSchema }).transform(p => ({ partNumber:p.PartNumber, byteSize:p.ByteSize, sha256:p.SHA256 })),
]);
export const uploadStatusSchema = z.object({ uploadId:z.string().min(1), partSize:partSizeSchema, partCount:partCountSchema, parts:z.array(partSchema).max(10000) });
const completedSchema = z.object({ attachment:attachmentSchema });
const accountEpochs = new Map<string,number>();
const transientFiles = new Map<string,Set<File>>();
const downloadReaders = new Map<string,Set<ReadableStreamDefaultReader<Uint8Array>>>();
const activeTasks = new Set<string>();

function tasksFor(key:string):UploadTask[] {
  return z.array(taskSchema).catch([]).parse(cache.get(`${key}:uploads`) ?? []);
}
function managedFile(task:UploadTask):File {
  const file = new File(Paths.document, 'uploads', task.id);
  if (file.uri !== task.uri) throw new Error('Invalid upload file');
  return file;
}
function removeFile(file:File) { if (file.exists) file.delete(); }
async function readDownloadChunk(reader:ReadableStreamDefaultReader<Uint8Array>) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const inactivity = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Download timed out')), 30000);
  });
  try { return await Promise.race([reader.read(), inactivity]); }
  finally { clearTimeout(timer); }
}

export function clearAccountFiles(key:string):void {
  accountEpochs.set(key, (accountEpochs.get(key) ?? 0) + 1);
  for (const task of tasksFor(key)) {
    // An open native handle is closed and cleaned by run's finally block.
    if (!activeTasks.has(task.id)) removeFile(new File(Paths.document, 'uploads', task.id));
  }
  for (const file of transientFiles.get(key) ?? []) removeFile(file);
  transientFiles.delete(key);
  for (const reader of downloadReaders.get(key) ?? []) void reader.cancel().catch(() => undefined);
  downloadReaders.delete(key);
  cache.remove(`${key}:uploads`);
}

export class Transfers {
  private paused = new Set<string>();
  tasks(key:string):UploadTask[] { return tasksFor(key); }
  clearAccountFiles(key:string) { clearAccountFiles(key); }
  private save(key:string, task:UploadTask) {
    cache.set(`${key}:uploads`, [...this.tasks(key).filter(v => v.id !== task.id), task]);
  }
  private guard(key:string) {
    const epoch = accountEpochs.get(key) ?? 0;
    return () => {
      if (useWorkspace.getState().accountKey !== key || (accountEpochs.get(key) ?? 0) !== epoch) throw new Error('Account changed');
    };
  }
  async choose(key:string, conversationId?:string) {
    const assertAccount = this.guard(key);
    assertAccount();
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory:true, multiple:false });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) return null;
    const source = new File(asset.uri);
    let file:File|undefined;
    try {
      assertAccount();
      const id = Crypto.randomUUID();
      const dir = new Directory(Paths.document, 'uploads');
      dir.create({ intermediates:true, idempotent:true });
      file = new File(dir, id);
      source.copy(file);
      const task = taskSchema.parse({ id, uri:file.uri, fileName:asset.name, mimeType:asset.mimeType ?? 'application/octet-stream', byteSize:file.size, conversationId });
      this.save(key, task);
      return task;
    } catch (error) {
      if (file) removeFile(file);
      throw error;
    } finally {
      // copyToCacheDirectory creates a disposable picker copy, not the user's original.
      if (source.uri.startsWith(`${Paths.cache.uri.replace(/\/$/, '')}/`)) removeFile(source);
    }
  }
  pause(id:string) { this.paused.add(id); }
  async run(api:ApiClient, key:string, input:UploadTask, progress:(n:number)=>void):Promise<Attachment|null> {
    const assertAccount = this.guard(key);
    assertAccount();
    if (activeTasks.has(input.id)) return null;
    // A screen can retain the pre-reservation object across a failed attempt.
    let task = this.tasks(key).find(t => t.id === input.id);
    if (!task) throw new Error('Upload unavailable');
    if (task.complete) return null;
    const file = managedFile(task);
    activeTasks.add(task.id);
    this.paused.delete(task.id);
    const cancelled = () => { assertAccount(); return this.paused.has(input.id); };
    try {
      if (!file.exists || file.size !== task.byteSize) throw new Error('File unavailable');
      if (!task.uploadId) {
        const r = await api.json('/api/workspace/files/uploads/reserve', reservation, { fileName:task.fileName, mimeType:task.mimeType, byteSize:task.byteSize, visibility:task.conversationId ? 'conversation' : 'space', conversationId:task.conversationId });
        assertAccount();
        task = { ...task, uploadId:r.id, attachmentId:r.attachment.id };
        this.save(key, task);
      }
      const prefix = `/api/workspace/files/uploads/${encodeURIComponent(task.uploadId!)}`;
      const status = await api.json(prefix, uploadStatusSchema);
      if (cancelled()) return null;
      if (status.uploadId !== task.uploadId || status.partCount !== Math.ceil(task.byteSize / status.partSize)) throw new Error('Invalid upload plan');
      const receivedParts = new Map(status.parts.map(part => [part.partNumber, part]));
      if (receivedParts.size !== status.parts.length || status.parts.some(part => part.partNumber > status.partCount)) throw new Error('Invalid upload parts');
      let attachment:Attachment;
      if (task.byteSize === 0) {
        // Zero bytes have no parts; the backend only accepts single completion for them.
        const response = await api.raw(`${prefix}/content`, { method:'PUT', headers:{ 'Content-Type':'application/octet-stream' }, body:new Uint8Array(0) });
        attachment = completedSchema.parse(await response.json()).attachment;
      } else {
        const handle = file.open();
        try {
          for (let number = 1; number <= status.partCount; number++) {
            if (cancelled()) return null;
            const offset = (number - 1) * status.partSize;
            const expectedBytes = Math.min(status.partSize, task.byteSize - offset);
            handle.offset = offset;
            const bytes = handle.readBytes(expectedBytes);
            if (bytes.length !== expectedBytes) throw new Error('File unavailable');
            const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
            if (cancelled()) return null;
            const hash = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
            const received = receivedParts.get(number);
            if (received && (received.sha256 !== hash || received.byteSize !== bytes.length)) throw new Error('Part conflict');
            if (!received) await api.raw(`${prefix}/parts/${number}`, { method:'PUT', headers:{ 'Content-Type':'application/octet-stream', 'X-DualLane-Part-SHA256':hash }, body:bytes });
            if (cancelled()) return null;
            progress(number / status.partCount);
          }
        } finally { handle.close(); }
        if (cancelled()) return null;
        attachment = (await api.json(`${prefix}/complete`, completedSchema, { mode:'chunked' })).attachment;
      }
      assertAccount();
      this.save(key, { ...task, complete:true });
      removeFile(file);
      return attachment;
    } finally {
      activeTasks.delete(input.id);
      this.paused.delete(input.id);
      if (!this.tasks(key).some(t => t.id === input.id)) removeFile(file);
    }
  }
  async cancel(api:ApiClient, key:string, input:UploadTask) {
    const assertAccount = this.guard(key);
    assertAccount();
    this.pause(input.id);
    if (activeTasks.has(input.id)) throw new Error('Pause first');
    const task = this.tasks(key).find(t => t.id === input.id);
    if (!task) return;
    if (task.uploadId && !task.complete) await api.json(`/api/workspace/files/uploads/${encodeURIComponent(task.uploadId)}/fail`, z.unknown(), { reason:'cancelled' });
    assertAccount();
    removeFile(managedFile(task));
    cache.set(`${key}:uploads`, this.tasks(key).filter(v => v.id !== task.id));
    this.paused.delete(task.id);
  }
  async download(api:ApiClient, key:string, attachment:Attachment) {
    const assertAccount = this.guard(key);
    assertAccount();
    const res = await api.json(`/api/workspace/files/${encodeURIComponent(attachment.id)}/downloads/reserve`, z.object({ id:z.string().min(1) }), {});
    assertAccount();
    const response = await api.raw(`/api/workspace/files/${encodeURIComponent(attachment.id)}/download?downloadId=${encodeURIComponent(res.id)}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Streaming unavailable');
    const readers = downloadReaders.get(key) ?? new Set<ReadableStreamDefaultReader<Uint8Array>>();
    readers.add(reader);
    downloadReaders.set(key, readers);
    const file = new File(Paths.cache, `${Crypto.randomUUID()}-${attachment.fileName.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-100)}`);
    const files = transientFiles.get(key) ?? new Set<File>();
    files.add(file);
    transientFiles.set(key, files);
    try {
      assertAccount();
      file.create();
      const handle = file.open();
      let size = 0;
      try {
        while (true) {
          const chunk = await readDownloadChunk(reader);
          assertAccount();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > attachment.byteSize) throw new Error('Invalid download size');
          handle.writeBytes(chunk.value);
        }
      } finally { handle.close(); }
      if (size !== attachment.byteSize) throw new Error('Incomplete download');
      assertAccount();
      await Sharing.shareAsync(file.uri, { mimeType:attachment.mimeType, dialogTitle:'保存文件' });
    } finally {
      await reader.cancel().catch(() => undefined);
      readers.delete(reader);
      if (!readers.size) downloadReaders.delete(key);
      files.delete(file);
      if (!files.size) transientFiles.delete(key);
      removeFile(file);
    }
  }
}
