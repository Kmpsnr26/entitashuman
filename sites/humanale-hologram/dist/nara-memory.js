(function exposeHumanALEMemory(global){
  const STORAGE_KEY='humanale.nara.memory.v1';
  const VERSION=1;
  const ALLOWED_TYPES=new Set(['task','result','note','project','debug']);
  const REDACTION_PATTERNS=[
    /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{12,}\b/g,
    /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{12,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
    /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*[^\s,;]{6,}/gi
  ];
  const safeText=(value,max=600)=>{
    let text=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
    for(const pattern of REDACTION_PATTERNS)text=text.replace(pattern,'[REDACTED]');
    return text.slice(0,max);
  };
  const safeTag=value=>safeText(value,32).toLowerCase().replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'');
  const clone=value=>JSON.parse(JSON.stringify(value));
  const nowMs=()=>Date.now();

  class HumanALEMemory{
    constructor({runtime,storage=null,key=STORAGE_KEY,maxEntries=80,onState=null,onError=null,now=null}={}){
      if(!runtime?.dispatch||!runtime?.bus?.onAny)throw new Error('Runtime NARA diperlukan untuk Memory.');
      this.runtime=runtime;
      this.storage=storage||global.localStorage||null;
      this.key=String(key||STORAGE_KEY);
      this.maxEntries=Math.max(10,Math.min(200,Number(maxEntries)||80));
      this.onState=typeof onState==='function'?onState:()=>{};
      this.onError=typeof onError==='function'?onError:()=>{};
      this.now=typeof now==='function'?now:nowMs;
      this.entries=[];
      this.sequence=0;
      this.pendingTask=null;
      this.started=false;
      this.offBus=null;
      this.persistent=Boolean(this.storage?.getItem&&this.storage?.setItem);
      this.load();
    }

    normalizeEntry(value={}){
      if(!value||typeof value!=='object')return null;
      const type=ALLOWED_TYPES.has(String(value.type))?String(value.type):'note';
      const title=safeText(value.title,120);
      const summary=safeText(value.summary,600);
      if(!title&&!summary)return null;
      const tags=[...new Set((Array.isArray(value.tags)?value.tags:[]).map(safeTag).filter(Boolean))].slice(0,6);
      const createdAt=Number(value.createdAt)||this.now();
      const updatedAt=Number(value.updatedAt)||createdAt;
      const id=safeText(value.id,64)||('mem-'+createdAt+'-'+(++this.sequence));
      const source=safeText(value.source,48)||'site';
      return {id,type,title:title||summary.slice(0,80)||'Memori NARA',summary,tags,source,createdAt,updatedAt};
    }

    load(){
      if(!this.persistent)return this.snapshot();
      try{
        const raw=this.storage.getItem(this.key);
        if(!raw)return this.snapshot();
        const data=JSON.parse(raw);
        if(Number(data?.version)!==VERSION||!Array.isArray(data?.entries))return this.snapshot();
        this.entries=data.entries.map(item=>this.normalizeEntry(item)).filter(Boolean).slice(-this.maxEntries);
        this.sequence=this.entries.reduce((max,item)=>{
          const match=String(item.id).match(/-(\d+)$/);return Math.max(max,Number(match?.[1])||0);
        },this.sequence);
      }catch(error){
        this.onError({type:'load',message:String(error?.message||'Memori lokal gagal dibaca.')});
      }
      return this.snapshot();
    }

    persist(){
      if(!this.persistent)return false;
      try{
        this.storage.setItem(this.key,JSON.stringify({version:VERSION,entries:this.entries,updatedAt:this.now()}));
        return true;
      }catch(error){
        this.onError({type:'persist',message:String(error?.message||'Memori lokal gagal disimpan.')});
        return false;
      }
    }

    snapshot(){
      return Object.freeze({
        version:VERSION,
        persistent:this.persistent,
        count:this.entries.length,
        maxEntries:this.maxEntries,
        entries:Object.freeze(this.entries.map(item=>Object.freeze({...item,tags:[...item.tags]}))),
        updatedAt:this.entries.at(-1)?.updatedAt||0
      });
    }

    publish(){const state=this.snapshot();this.onState(state);return state;}

    remember(value={},options={}){
      const entry=this.normalizeEntry({
        ...value,
        id:value.id||('mem-'+this.now()+'-'+(++this.sequence)),
        createdAt:value.createdAt||this.now(),
        updatedAt:this.now()
      });
      if(!entry)return null;
      const existing=this.entries.findIndex(item=>item.id===entry.id);
      if(existing>=0)this.entries.splice(existing,1,entry);else this.entries.push(entry);
      if(this.entries.length>this.maxEntries)this.entries.splice(0,this.entries.length-this.maxEntries);
      this.persist();
      if(options.emit!==false){
        this.runtime.dispatch('memory.write',{label:'Menyimpan '+entry.type+' ke memori proyek',source:'site-memory'});
        this.runtime.dispatch('memory.complete',{source:'site-memory'});
      }
      this.publish();
      return Object.freeze({...entry,tags:[...entry.tags]});
    }

    recall(query='',options={}){
      const q=safeText(query,160).toLowerCase();
      const terms=[...new Set(q.split(/[^a-z0-9._-]+/i).filter(term=>term.length>1))].slice(0,12);
      const limit=Math.max(1,Math.min(20,Number(options.limit)||8));
      this.runtime.dispatch('memory.read',{label:q?'Mencari memori proyek':'Membaca memori proyek',source:'site-memory'});
      const scored=this.entries.map((entry,index)=>{
        const haystack=(entry.title+' '+entry.summary+' '+entry.tags.join(' ')).toLowerCase();
        let score=terms.length?0:1;
        for(const term of terms){
          if(entry.title.toLowerCase().includes(term))score+=4;
          if(entry.tags.some(tag=>tag.includes(term)))score+=3;
          if(entry.summary.toLowerCase().includes(term))score+=2;
        }
        return{entry,index,score};
      }).filter(item=>item.score>0)
        .sort((a,b)=>b.score-a.score||b.entry.updatedAt-a.entry.updatedAt||b.index-a.index)
        .slice(0,limit)
        .map(item=>Object.freeze({...item.entry,tags:[...item.entry.tags]}));
      this.runtime.dispatch('memory.complete',{source:'site-memory'});
      return Object.freeze(scored);
    }

    forget(id=''){
      const safeId=safeText(id,64);
      const index=this.entries.findIndex(item=>item.id===safeId);
      if(index<0)return false;
      this.runtime.dispatch('memory.write',{label:'Menghapus satu memori proyek',source:'site-memory'});
      this.entries.splice(index,1);
      this.persist();
      this.runtime.dispatch('memory.complete',{source:'site-memory'});
      this.publish();
      return true;
    }

    clear(){
      if(!this.entries.length)return this.snapshot();
      this.runtime.dispatch('memory.write',{label:'Menghapus seluruh memori lokal',source:'site-memory'});
      this.entries=[];
      try{this.storage?.removeItem?.(this.key);}catch(error){this.onError({type:'clear',message:String(error?.message||'Memori lokal gagal dihapus.')});}
      this.runtime.dispatch('memory.complete',{source:'site-memory'});
      return this.publish();
    }

    consume(envelope={}){
      const event=String(envelope.event||''),payload=envelope.payload&&typeof envelope.payload==='object'?envelope.payload:{};
      if(event==='work.start'){
        this.pendingTask={
          id:safeText(payload.id,64),
          label:safeText(payload.label,120)||'Pekerjaan NARA',
          startedAt:Number(envelope.timestamp)||this.now()
        };
      }else if(event==='work.complete'&&this.pendingTask){
        const task=this.pendingTask;this.pendingTask=null;
        this.remember({
          type:'task',
          title:task.label,
          summary:'Pekerjaan selesai dan terverifikasi sebagai aktivitas NARA.',
          tags:['task','complete'],
          source:'auto-task'
        });
      }else if(event==='work.failed'&&this.pendingTask){
        const task=this.pendingTask;this.pendingTask=null;
        this.remember({
          type:'result',
          title:task.label,
          summary:'Pekerjaan berakhir dengan status gagal dan memerlukan tindak lanjut.',
          tags:['task','failed'],
          source:'auto-task'
        });
      }else if(event==='bug.fixed'){
        this.remember({
          type:'debug',
          title:'Perbaikan bug selesai',
          summary:'Bug ditandai selesai dan siap diverifikasi.',
          tags:['bug','fixed'],
          source:'auto-debug'
        });
      }
    }

    start(){
      if(this.started)return this.snapshot();
      this.started=true;
      this.offBus=this.runtime.bus.onAny(envelope=>this.consume(envelope));
      return this.publish();
    }

    stop(){
      this.offBus?.();this.offBus=null;this.started=false;this.pendingTask=null;
      return this.publish();
    }
  }

  global.HumanALEMemory=Object.freeze({
    key:STORAGE_KEY,
    version:VERSION,
    create:options=>new HumanALEMemory(options),
    HumanALEMemory
  });
})(typeof window==='undefined'?globalThis:window);
