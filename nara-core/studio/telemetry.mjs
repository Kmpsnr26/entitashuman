const PHASES=Object.freeze({
  'reason.start':{stage:'reason',status:'running'},
  'reason.complete':{stage:'reason',status:'complete'},
  'plan.start':{stage:'plan',status:'running'},
  'plan.complete':{stage:'plan',status:'complete'},
  'agent.start':{stage:'agent',status:'running'},
  'agent.complete':{stage:'agent',status:'complete'},
  'agent.failed':{stage:'agent',status:'failed'},
  'program.start':{stage:'program',status:'running'},
  'program.complete':{stage:'program',status:'complete'},
  'verify.start':{stage:'verify',status:'running'},
  'verify.complete':{stage:'verify',status:'complete'}
});

const MEMORY_EVENTS=Object.freeze({
  'memory.read':'read',
  'memory.write':'write',
  'memory.complete':'complete',
  'context.prepare':'context_prepare',
  'context.approved':'context_approved',
  'context.used':'context_used',
  'context.blocked':'context_blocked'
});

const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

export class NaraStudioTelemetry{
  constructor({historyLimit=80,memoryLimit=60}={}){
    this.historyLimit=Math.max(20,Math.min(500,Number(historyLimit)||80));
    this.memoryLimit=Math.max(20,Math.min(300,Number(memoryLimit)||60));
    this.reset();
  }

  reset(){
    this.activePhases=new Map();
    this.decision={
      currentStage:null,
      currentLabel:'',
      status:'idle',
      startedAt:0,
      lastDurationMs:null,
      completedStages:0,
      failedStages:0,
      history:[]
    };
    this.memory={
      active:false,
      lastOperation:null,
      counters:{read:0,write:0,complete:0,context_prepare:0,context_approved:0,context_used:0,context_blocked:0},
      history:[]
    };
    this.lastEventId=0;
  }

  consume(envelope){
    if(!envelope?.event)return this.snapshot();
    this.lastEventId=Number(envelope.id)||this.lastEventId;
    this.consumeDecision(envelope);
    this.consumeMemory(envelope);
    return this.snapshot();
  }

  consumeDecision(envelope){
    const def=PHASES[envelope.event];
    if(!def)return;
    const timestamp=Number(envelope.timestamp)||Date.now();
    const label=safeText(envelope.payload?.label||envelope.payload?.message||def.stage);
    if(def.status==='running'){
      const item={stage:def.stage,status:'running',label,startedAt:timestamp,endedAt:null,durationMs:null,eventId:envelope.id};
      this.activePhases.set(def.stage,item);
      this.decision.currentStage=def.stage;
      this.decision.currentLabel=label;
      this.decision.status='running';
      this.decision.startedAt=timestamp;
      this.pushDecision(item);
      return;
    }

    const started=this.activePhases.get(def.stage);
    const durationMs=started?Math.max(0,timestamp-started.startedAt):null;
    const item={
      stage:def.stage,
      status:def.status,
      label:started?.label||label,
      startedAt:started?.startedAt||timestamp,
      endedAt:timestamp,
      durationMs,
      eventId:envelope.id
    };
    this.activePhases.delete(def.stage);
    this.decision.lastDurationMs=durationMs;
    if(def.status==='failed')this.decision.failedStages+=1;
    else this.decision.completedStages+=1;
    this.decision.currentStage=this.activePhases.size?[...this.activePhases.keys()].at(-1):null;
    this.decision.currentLabel=this.decision.currentStage?this.activePhases.get(this.decision.currentStage)?.label||'':'';
    this.decision.status=def.status==='failed'?'failed':this.activePhases.size?'running':'idle';
    this.decision.startedAt=this.decision.currentStage?this.activePhases.get(this.decision.currentStage)?.startedAt||0:0;
    this.pushDecision(item);
  }

  pushDecision(item){
    this.decision.history.push({...item});
    if(this.decision.history.length>this.historyLimit)this.decision.history.splice(0,this.decision.history.length-this.historyLimit);
  }

  consumeMemory(envelope){
    const operation=MEMORY_EVENTS[envelope.event];
    if(!operation)return;
    const timestamp=Number(envelope.timestamp)||Date.now();
    this.memory.counters[operation]=(this.memory.counters[operation]||0)+1;
    this.memory.active=!['complete','context_approved','context_blocked'].includes(operation);
    const item={
      operation,
      event:envelope.event,
      label:safeText(envelope.payload?.label||envelope.payload?.message||envelope.payload?.target||operation),
      target:safeText(envelope.payload?.target||'',80),
      timestamp,
      eventId:envelope.id
    };
    this.memory.lastOperation=item;
    this.memory.history.push(item);
    if(this.memory.history.length>this.memoryLimit)this.memory.history.splice(0,this.memory.history.length-this.memoryLimit);
  }

  snapshot(){
    const active={};
    for(const [stage,value] of this.activePhases)active[stage]={...value};
    return {
      version:1,
      lastEventId:this.lastEventId,
      decision:{
        ...this.decision,
        active,
        history:this.decision.history.map(item=>({...item}))
      },
      memory:{
        ...this.memory,
        counters:{...this.memory.counters},
        lastOperation:this.memory.lastOperation?{...this.memory.lastOperation}:null,
        history:this.memory.history.map(item=>({...item}))
      }
    };
  }
}

export function createStudioTelemetry(options){return new NaraStudioTelemetry(options);}
