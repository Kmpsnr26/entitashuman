const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

export class AleWatchdog{
  constructor({defaultTimeoutMs=120000,limit=200}={}){
    this.defaultTimeoutMs=Math.max(1000,Math.min(60*60*1000,Number(defaultTimeoutMs)||120000));
    this.limit=Math.max(10,Math.min(2000,Number(limit)||200));
    this.entries=new Map();
  }

  track(id,{timeoutMs=this.defaultTimeoutMs,label=''}={}){
    const taskId=safeText(id,80);
    if(!taskId)throw new Error('Watchdog task ID wajib diisi.');
    if(!this.entries.has(taskId)&&this.entries.size>=this.limit){
      for(const [id,entry] of this.entries){
        if(entry.status!=='watching')this.entries.delete(id);
        if(this.entries.size<this.limit)break;
      }
      if(this.entries.size>=this.limit)throw new Error('Watchdog AleCore AI penuh: seluruh slot masih memantau task aktif.');
    }
    const now=Date.now();
    const item={
      id:taskId,
      label:safeText(label,160),
      timeoutMs:Math.max(1000,Math.min(60*60*1000,Number(timeoutMs)||this.defaultTimeoutMs)),
      startedAt:now,
      heartbeatAt:now,
      status:'watching'
    };
    this.entries.set(taskId,item);
    return {...item};
  }

  heartbeat(id){
    const item=this.entries.get(String(id||''));
    if(!item)return null;
    item.heartbeatAt=Date.now();
    item.status='watching';
    return {...item};
  }

  complete(id){
    const item=this.entries.get(String(id||''));
    if(!item)return null;
    item.status='complete';
    item.heartbeatAt=Date.now();
    return {...item};
  }

  remove(id){return this.entries.delete(String(id||''));}

  inspect(now=Date.now()){
    const stale=[];
    for(const item of this.entries.values()){
      if(item.status!=='watching')continue;
      if(now-item.heartbeatAt>item.timeoutMs){
        item.status='stalled';
        stale.push({...item});
      }
    }
    return stale;
  }

  snapshot(){
    const entries=[...this.entries.values()].map(item=>({...item}));
    return {
      version:1,
      watching:entries.filter(item=>item.status==='watching').length,
      stalled:entries.filter(item=>item.status==='stalled').length,
      entries
    };
  }
}

export function createWatchdog(options){return new AleWatchdog(options);}
