(function exposeHumanALECognition(global){
  const EVENT_META=Object.freeze({
    'observe.start':{stage:'OBSERVE',region:'NARA_CORE',state:'running'},
    'observe.complete':{stage:'OBSERVE',region:'NARA_CORE',state:'complete'},
    'reason.start':{stage:'REASON',region:'REASONER',state:'running'},
    'reason.complete':{stage:'REASON',region:'REASONER',state:'complete'},
    'plan.start':{stage:'PLAN',region:'PLANNER',state:'running'},
    'plan.complete':{stage:'PLAN',region:'PLANNER',state:'complete'},
    'agent.start':{stage:'AGENT',region:'AGENT_MANAGER',state:'running'},
    'agent.complete':{stage:'AGENT',region:'AGENT_MANAGER',state:'complete'},
    'agent.failed':{stage:'AGENT',region:'AGENT_MANAGER',state:'error'},
    'memory.read':{stage:'MEMORY',region:'MEMORY',state:'reading'},
    'memory.write':{stage:'MEMORY',region:'MEMORY',state:'writing'},
    'memory.complete':{stage:'MEMORY',region:'MEMORY',state:'complete'},
    'program.start':{stage:'ACT',region:'PROGRAM',state:'running'},
    'program.complete':{stage:'ACT',region:'PROGRAM',state:'complete'},
    'verify.start':{stage:'VERIFY',region:'FOLLOW_UP',state:'running'},
    'verify.complete':{stage:'VERIFY',region:'FOLLOW_UP',state:'complete'},
    'bug.detected':{stage:'DEBUG',region:'BUG_HUNTER',state:'error'},
    'bug.fixed':{stage:'DEBUG',region:'BUG_HUNTER',state:'complete'},
    'work.start':{stage:'TASK',region:'PROGRAM',state:'running'},
    'work.complete':{stage:'TASK',region:'PROGRAM',state:'complete'},
    'work.failed':{stage:'TASK',region:'PROGRAM',state:'error'}
  });
  const safeLabel=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,120);
  const defaultLabel=meta=>meta.stage+' · '+meta.state;

  class HumanALECognition{
    constructor({runtime,onState=null,maxEntries=40}={}){
      if(!runtime?.bus?.onAny||!runtime?.snapshot)throw new Error('Runtime NARA diperlukan untuk Cognitive Activity.');
      this.runtime=runtime;
      this.onState=typeof onState==='function'?onState:()=>{};
      this.maxEntries=Math.max(10,Math.min(120,Number(maxEntries)||40));
      this.entries=[];
      this.sequence=0;
      this.activeStage='IDLE';
      this.offBus=null;
      this.started=false;
    }

    consume(envelope={}){
      const meta=EVENT_META[String(envelope.event||'')];
      if(!meta)return null;
      const payload=envelope.payload&&typeof envelope.payload==='object'?envelope.payload:{};
      const label=safeLabel(payload.label)||safeLabel(payload.name)||defaultLabel(meta);
      const entry=Object.freeze({
        id:++this.sequence,
        event:String(envelope.event||'').slice(0,120),
        stage:meta.stage,
        region:meta.region,
        state:meta.state,
        label,
        timestamp:Number(envelope.timestamp)||Date.now()
      });
      this.entries.push(entry);
      if(this.entries.length>this.maxEntries)this.entries.splice(0,this.entries.length-this.maxEntries);
      this.activeStage=meta.state==='running'||meta.state==='reading'||meta.state==='writing'?meta.stage:
        this.entries.slice().reverse().find(item=>['running','reading','writing'].includes(item.state))?.stage||'IDLE';
      this.publish();
      return entry;
    }

    snapshot(){
      const brain=this.runtime.snapshot();
      return Object.freeze({
        version:1,
        activeStage:this.activeStage,
        currentTask:brain?.currentTask?{
          id:safeLabel(brain.currentTask.id),
          label:safeLabel(brain.currentTask.label),
          startedAt:Number(brain.currentTask.startedAt)||0
        }:null,
        entries:Object.freeze(this.entries.map(entry=>({...entry}))),
        updatedAt:Date.now()
      });
    }

    publish(){const state=this.snapshot();this.onState(state);return state;}
    start(){
      if(this.started)return this.snapshot();
      this.started=true;
      this.offBus=this.runtime.bus.onAny(envelope=>this.consume(envelope));
      return this.publish();
    }
    stop(){
      this.offBus?.();this.offBus=null;this.started=false;this.activeStage='IDLE';
      return this.publish();
    }
  }

  global.HumanALECognition=Object.freeze({
    events:EVENT_META,
    create:options=>new HumanALECognition(options),
    HumanALECognition
  });
})(typeof window==='undefined'?globalThis:window);
