(function exposeHumanALEActivity(global){
  const MAX_TASKS=12,MAX_AGENTS=12,MAX_MEMORY=24,MAX_TIMELINE=48;
  const BLOCKED_KEYS=new Set(['prompt','output','content','token','secret','password','apikey','api_key','chainofthought','chain_of_thought','reasoning']);
  const redact=value=>String(value??'')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,'[email]')
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_-]{8,}\b/gi,'[secret]')
    .replace(/(?:bearer|token|password|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi,'[secret]')
    .replace(/[A-Za-z]:\\[^\n\r]+/g,'[path]')
    .replace(/\s+/g,' ').trim().slice(0,180);
  const safeId=value=>String(value||'').replace(/[^a-z0-9_.:-]/gi,'-').slice(0,72)||'unknown';
  const safeStatus=value=>['idle','queued','planning','thinking','running','complete','error','cancelled','stored','recalled'].includes(String(value))?String(value):'idle';
  const pushBounded=(list,item,max)=>{list.push(item);if(list.length>max)list.splice(0,list.length-max);};
  const cleanPayload=payload=>{
    const out={};
    if(!payload||typeof payload!=='object')return out;
    for(const [key,value] of Object.entries(payload)){
      if(BLOCKED_KEYS.has(String(key).toLowerCase()))continue;
      if(['taskId','agentId','mode','kind','outcome','count','source','status'].includes(key)){
        out[key]=typeof value==='number'?value:redact(value);
      }
    }
    return out;
  };

  class HumanALEActivity{
    constructor({runtime,onState=null}={}){
      if(!runtime?.bus?.onAny)throw new Error('Runtime NARA diperlukan untuk Activity Timeline.');
      this.runtime=runtime;
      this.onState=typeof onState==='function'?onState:()=>{};
      this.offBus=null;this.started=false;this.sequence=0;
      this.tasks=[];this.agents=[];this.memory=[];this.timeline=[];
      this.currentTask=null;this.activeAgent=null;
    }
    addTimeline(type,status,label,meta={}){
      const item=Object.freeze({
        id:++this.sequence,
        type:safeId(type),
        status:safeStatus(status),
        label:redact(label)||safeId(type),
        meta:Object.freeze(cleanPayload(meta)),
        timestamp:Date.now()
      });
      pushBounded(this.timeline,item,MAX_TIMELINE);
      return item;
    }
    upsertTask(id,patch={}){
      const taskId=safeId(id);
      let item=this.tasks.find(entry=>entry.id===taskId);
      if(!item){
        item={id:taskId,label:'Pekerjaan NARA',status:'idle',startedAt:0,completedAt:0,outcome:''};
        pushBounded(this.tasks,item,MAX_TASKS);
      }
      Object.assign(item,patch);
      return item;
    }
    upsertAgent(id,patch={}){
      const agentId=safeId(id);
      let item=this.agents.find(entry=>entry.id===agentId);
      if(!item){
        item={id:agentId,status:'idle',mode:'analyze',taskId:'',startedAt:0,completedAt:0,durationMs:0};
        pushBounded(this.agents,item,MAX_AGENTS);
      }
      Object.assign(item,patch);
      return item;
    }
    recordMemory(payload={},envelope={}){
      const item=Object.freeze({
        id:'memory-'+String(envelope.id||++this.sequence),
        kind:safeId(payload.kind||'episode'),
        summary:redact(payload.summary||payload.outcome||'Aktivitas NARA dicatat.'),
        outcome:redact(payload.outcome||''),
        source:safeId(payload.source||'runtime'),
        timestamp:Number(envelope.timestamp)||Date.now()
      });
      pushBounded(this.memory,item,MAX_MEMORY);
      return item;
    }
    consume(envelope={}){
      const event=String(envelope.event||''),payload=envelope.payload||{},timestamp=Number(envelope.timestamp)||Date.now();
      if(event==='work.start'){
        const id=safeId(payload.id||'task-'+String(envelope.id||this.sequence+1));
        const task=this.upsertTask(id,{label:redact(payload.label||'Pekerjaan NARA'),status:'planning',startedAt:timestamp,completedAt:0,outcome:''});
        this.currentTask=task.id;
        this.addTimeline('task','planning','Pekerjaan dimulai.',{taskId:task.id,source:payload.source});
      }else if(event==='work.complete'){
        const id=safeId(payload.taskId||this.currentTask||'task');
        const task=this.upsertTask(id,{status:'complete',completedAt:timestamp,outcome:'complete'});
        this.currentTask=null;
        this.addTimeline('task','complete','Pekerjaan selesai.',{taskId:task.id,source:payload.source});
      }else if(event==='planning.start'){
        this.addTimeline('planner','planning','Planner menyusun langkah kerja.',payload);
      }else if(event==='planning.complete'){
        this.addTimeline('planner','complete','Rencana kerja siap.',payload);
      }else if(event==='reasoner.start'){
        this.addTimeline('reasoner','thinking','Reasoner menganalisis tugas.',payload);
      }else if(event==='reasoner.complete'){
        this.addTimeline('reasoner','complete','Analisis tahap ini selesai.',payload);
      }else if(event==='agent.start'){
        const id=safeId(payload.agentId||'agent');
        const agent=this.upsertAgent(id,{status:'running',mode:safeId(payload.mode||'analyze'),taskId:safeId(payload.taskId||this.currentTask||''),startedAt:timestamp,completedAt:0,durationMs:0});
        this.activeAgent=agent.id;
        this.addTimeline('agent','running','Agent '+agent.id+' mulai bekerja.',{agentId:agent.id,mode:agent.mode,taskId:agent.taskId});
      }else if(event==='agent.progress'){
        const id=safeId(payload.agentId||this.activeAgent||'agent');
        this.upsertAgent(id,{status:'running'});
        this.addTimeline('agent','running','Agent '+id+' masih bekerja.',{agentId:id,mode:payload.mode,taskId:payload.taskId});
      }else if(event==='agent.complete'){
        const id=safeId(payload.agentId||this.activeAgent||'agent');
        const agent=this.upsertAgent(id,{status:'complete',completedAt:timestamp,durationMs:Math.max(0,Math.min(3600000,Number(payload.durationMs)||0))});
        if(this.activeAgent===id)this.activeAgent=null;
        this.addTimeline('agent','complete','Agent '+id+' selesai.',{agentId:id,mode:agent.mode,taskId:agent.taskId});
      }else if(event==='agent.error'){
        const id=safeId(payload.agentId||this.activeAgent||'agent');
        const agent=this.upsertAgent(id,{status:'error',completedAt:timestamp,durationMs:Math.max(0,Math.min(3600000,Number(payload.durationMs)||0))});
        if(this.activeAgent===id)this.activeAgent=null;
        this.addTimeline('agent','error','Agent '+id+' mengalami kesalahan.',{agentId:id,mode:agent.mode,taskId:agent.taskId});
      }else if(event==='memory.record'){
        const item=this.recordMemory(payload,envelope);
        this.addTimeline('memory','stored',item.summary,{kind:item.kind,source:item.source,outcome:item.outcome});
      }else if(event==='memory.recall'){
        const count=Math.max(0,Math.min(100,Number(payload.count)||0));
        this.addTimeline('memory','recalled',count?String(count)+' catatan relevan ditemukan.':'Memory diperiksa.',{count,source:payload.source});
      }else if(event==='bug.detected'){
        this.addTimeline('bug','error','Bug terdeteksi dan masuk antrean analisis.',{source:payload.source});
      }else if(event==='bug.fixed'){
        this.addTimeline('bug','complete','Perbaikan bug selesai diverifikasi.',{source:payload.source});
      }
      return this.publish();
    }
    snapshot(){
      return Object.freeze({
        version:1,currentTask:this.currentTask,activeAgent:this.activeAgent,
        tasks:Object.freeze(this.tasks.map(item=>Object.freeze({...item}))),
        agents:Object.freeze(this.agents.map(item=>Object.freeze({...item}))),
        memory:Object.freeze(this.memory.map(item=>Object.freeze({...item}))),
        timeline:Object.freeze(this.timeline.map(item=>item)),
        updatedAt:Date.now()
      });
    }
    publish(){const state=this.snapshot();this.onState(state);return state;}
    start(){
      if(this.started)return this.snapshot();
      this.started=true;this.offBus=this.runtime.bus.onAny(envelope=>this.consume(envelope));
      return this.publish();
    }
    stop(){this.offBus?.();this.offBus=null;this.started=false;return this.publish();}
  }

  global.HumanALEActivity=Object.freeze({
    create:options=>new HumanALEActivity(options),
    HumanALEActivity
  });
})(typeof window==='undefined'?globalThis:window);
