(function exposeHumanALEContextBridge(global){
  const STORAGE_KEY='humanale.nara.context-mode.v1';
  const MODES=new Set(['off','ask','auto-safe']);
  const TARGETS=new Set(['reasoner','planner','agent']);
  const SECRET_PATTERNS=[
    /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{12,}\b/i,
    /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/i,
    /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
    /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*[^\s,;]{6,}/i
  ];
  const safeText=(value,max=1600)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').trim().slice(0,max);
  const safeId=value=>safeText(value,80).replace(/[^a-z0-9._:-]/gi,'');
  const storageOrNull=storage=>{try{return storage||global.localStorage||null;}catch{return null;}};
  const hasSecret=text=>SECRET_PATTERNS.some(pattern=>pattern.test(String(text||'')));

  class HumanALEContextBridge{
    constructor({runtime,memory,storage=null,onState=null,now=null,maxEntries=6,maxChars=1600}={}){
      if(!runtime?.dispatch)throw new Error('Runtime NARA diperlukan untuk Context Bridge.');
      if(!memory?.context)throw new Error('NARA Memory diperlukan untuk Context Bridge.');
      this.runtime=runtime;
      this.memory=memory;
      this.storage=storageOrNull(storage);
      this.onState=typeof onState==='function'?onState:()=>{};
      this.now=typeof now==='function'?now:()=>Date.now();
      this.maxEntries=Math.max(1,Math.min(6,Number(maxEntries)||6));
      this.maxChars=Math.max(300,Math.min(1600,Number(maxChars)||1600));
      this.sequence=0;
      this.pending=null;
      this.lastUsed=null;
      this.mode='ask';
      this.loadMode();
    }

    loadMode(){
      try{
        const saved=this.storage?.getItem?.(STORAGE_KEY);
        if(MODES.has(saved))this.mode=saved;
      }catch{}
      return this.mode;
    }
    setMode(mode){
      const next=MODES.has(mode)?mode:'ask';
      this.mode=next;
      try{this.storage?.setItem?.(STORAGE_KEY,next);}catch{}
      if(next==='off')this.pending=null;
      return this.publish();
    }
    snapshot(){
      return Object.freeze({
        version:1,
        mode:this.mode,
        pending:this.pending?Object.freeze({
          id:this.pending.id,target:this.pending.target,count:this.pending.count,chars:this.pending.chars,
          entryIds:Object.freeze([...this.pending.entryIds]),
          approved:Boolean(this.pending.approved),
          requiresApproval:Boolean(this.pending.requiresApproval),
          blocked:Boolean(this.pending.blocked),
          generatedAt:this.pending.generatedAt
        }):null,
        lastUsed:this.lastUsed?Object.freeze({...this.lastUsed}):null
      });
    }
    publish(){const state=this.snapshot();this.onState(state);return state;}

    prepare(task='',options={}){
      const target=TARGETS.has(options.target)?options.target:'reasoner';
      if(this.mode==='off'){
        this.pending=null;
        this.runtime.dispatch('context.blocked',{target,reason:'mode-off',source:'context-bridge'});
        this.publish();
        return Object.freeze({blocked:true,reason:'mode-off',target});
      }
      const recallQuery=safeText(task,160).replace(/[_-]+/g,' ');
      const memoryContext=this.memory.context(recallQuery,{
        limit:Math.min(this.maxEntries,Number(options.limit)||this.maxEntries),
        maxChars:Math.min(this.maxChars,Number(options.maxChars)||this.maxChars)
      });
      const text=safeText(memoryContext.text,this.maxChars);
      if(hasSecret(text))throw new Error('Context Bridge menolak context yang masih mengandung pola credential.');
      const entryIds=(memoryContext.entries||[]).map(entry=>safeId(entry.id)).filter(Boolean).slice(0,this.maxEntries);
      const id='ctx-'+this.now()+'-'+(++this.sequence);
      const count=Math.min(entryIds.length,Number(memoryContext.count)||0);
      const requiresApproval=this.mode==='ask'&&count>0;
      const approved=this.mode==='auto-safe'&&count>0;
      this.pending={
        id,target,count,chars:text.length,entryIds,text,
        mode:this.mode,approved,requiresApproval,blocked:count===0,generatedAt:this.now()
      };
      this.runtime.dispatch('context.prepare',{target,count,chars:text.length,source:'context-bridge'});
      if(count===0)this.runtime.dispatch('context.blocked',{target,reason:'no-memory',source:'context-bridge'});
      else if(approved)this.runtime.dispatch('context.approved',{target,count,chars:text.length,source:'context-bridge'});
      this.publish();
      return this.preview();
    }

    preview(){
      if(!this.pending)return null;
      const p=this.pending;
      return Object.freeze({
        id:p.id,target:p.target,count:p.count,chars:p.chars,entryIds:Object.freeze([...p.entryIds]),
        text:p.text,mode:p.mode,approved:p.approved,requiresApproval:p.requiresApproval,
        blocked:p.blocked,generatedAt:p.generatedAt
      });
    }

    approve(id=''){
      if(!this.pending||safeId(id)!==this.pending.id)return false;
      if(this.pending.blocked||!this.pending.count)return false;
      this.pending.approved=true;this.pending.requiresApproval=false;
      this.runtime.dispatch('context.approved',{
        target:this.pending.target,count:this.pending.count,chars:this.pending.chars,source:'context-bridge'
      });
      this.publish();
      return true;
    }

    reject(id=''){
      if(!this.pending||safeId(id)!==this.pending.id)return false;
      const target=this.pending.target;
      this.pending=null;
      this.runtime.dispatch('context.blocked',{target,reason:'user-rejected',source:'context-bridge'});
      this.publish();
      return true;
    }

    transport(id=''){
      if(!this.pending||safeId(id)!==this.pending.id)throw new Error('Context packet tidak ditemukan.');
      if(this.pending.blocked||!this.pending.approved)throw new Error('Context belum disetujui.');
      if(hasSecret(this.pending.text))throw new Error('Context ditolak karena pola credential.');
      const packet=Object.freeze({
        version:1,
        target:this.pending.target,
        mode:this.pending.mode,
        approved:true,
        count:this.pending.count,
        chars:this.pending.chars,
        entryIds:Object.freeze([...this.pending.entryIds]),
        text:this.pending.text
      });
      this.lastUsed={target:packet.target,count:packet.count,chars:packet.chars,usedAt:this.now()};
      this.runtime.dispatch('context.used',{
        target:packet.target,count:packet.count,chars:packet.chars,source:'context-bridge'
      });
      this.publish();
      return packet;
    }

    clearPending(){this.pending=null;return this.publish();}
  }

  global.HumanALEContextBridge=Object.freeze({
    key:STORAGE_KEY,
    modes:Object.freeze([...MODES]),
    targets:Object.freeze([...TARGETS]),
    create:options=>new HumanALEContextBridge(options),
    HumanALEContextBridge
  });
})(typeof window==='undefined'?globalThis:window);
