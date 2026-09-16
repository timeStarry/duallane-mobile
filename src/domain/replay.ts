import { z } from 'zod';
import { eventSchema, readySchema, type WorkspaceEvent } from './contracts';
// Workspace sequences are permission-filtered, so nonconsecutive seq values are valid.
export class ReplayTracker {
  cursor: number;
  private remaining = 0;
  private highWater = 0;
  private more = false;
  private ready = false;
  private seen = new Set<string>();
  constructor(cursor: number) { this.cursor = cursor; }
  accept(raw: unknown): { event?: WorkspaceEvent; replay?: boolean; sync?: boolean; hello?: boolean } {
    const frame = z.object({type:z.string(),event:z.unknown().optional(),currentSeq:z.number().optional()}).safeParse(raw);
    if (!frame.success) return {sync:true};
    if(frame.data.type==='sync.required') { this.ready=false; return {sync:true}; }
    if(frame.data.type==='ready') {
      const r=readySchema.safeParse(raw); if(!r.success) return {sync:true};
      this.ready=true; this.remaining=r.data.replayCount; this.highWater=r.data.currentSeq; this.more=r.data.hasMore;
      if(this.remaining===0) { this.cursor=this.highWater; return {hello:this.more}; } return {};
    }
    if(frame.data.type!=='event') return {};
    if(!this.ready) return {sync:true};
    const result=eventSchema.safeParse(frame.data.event); if(!result.success) return {sync:true};
    const event=result.data, replay=this.remaining>0;
    if(replay) this.remaining--;
    const duplicate=this.seen.has(event.id) || event.seq<=this.cursor;
    if(!duplicate) { this.seen.add(event.id); this.cursor=event.seq; }
    if(this.seen.size>2000) this.seen.delete(this.seen.values().next().value ?? '');
    const hello=replay && this.remaining===0 && this.more;
    if(replay && this.remaining===0 && !this.more) this.cursor=Math.max(this.cursor,this.highWater);
    return { event:duplicate?undefined:event,replay,hello };
  }
}
