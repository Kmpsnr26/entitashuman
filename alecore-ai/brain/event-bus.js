const safeEvent=value=>{
  const event=String(value||'').trim();
  if(!event||event.length>120||!/^[a-z0-9_.:-]+$/i.test(event))throw new Error('Nama event AleCore AI tidak valid.');
  return event;
};

export class AleEventBus{
  constructor({historyLimit=250}={}){
    this.historyLimit=Math.max(10,Math.min(2000,Number(historyLimit)||250));
    this.listeners=new Map();
    this.anyListeners=new Set();
    this.history=[];
    this.sequence=0;
  }

  on(event,listener){
    const name=safeEvent(event);
    if(typeof listener!=='function')throw new TypeError('Listener AleCore AI harus berupa fungsi.');
    const bucket=this.listeners.get(name)||new Set();
    bucket.add(listener);this.listeners.set(name,bucket);
    return ()=>{bucket.delete(listener);if(!bucket.size)this.listeners.delete(name);};
  }

  onAny(listener){
    if(typeof listener!=='function')throw new TypeError('Listener AleCore AI harus berupa fungsi.');
    this.anyListeners.add(listener);
    return ()=>this.anyListeners.delete(listener);
  }

  once(event,listener){
    let off=()=>{};
    off=this.on(event,envelope=>{off();listener(envelope);});
    return off;
  }

  emit(event,payload={},meta={}){
    const name=safeEvent(event);
    const envelope=Object.freeze({
      id:++this.sequence,
      event:name,
      timestamp:Date.now(),
      payload:payload&&typeof payload==='object'?payload:{value:payload},
      meta:meta&&typeof meta==='object'?meta:{}
    });
    this.history.push(envelope);
    if(this.history.length>this.historyLimit)this.history.splice(0,this.history.length-this.historyLimit);
    for(const listener of [...(this.listeners.get(name)||[])])listener(envelope);
    for(const listener of [...this.anyListeners])listener(envelope);
    return envelope;
  }

  recent({event='',limit=25}={}){
    const max=Math.max(1,Math.min(250,Number(limit)||25));
    const items=event?this.history.filter(item=>item.event===event):this.history;
    return items.slice(-max);
  }

  clearHistory(){this.history.length=0;}
  clearListeners(){this.listeners.clear();this.anyListeners.clear();}
}

export function createEventBus(options){return new AleEventBus(options);}
