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

const DIAGNOSTIC_EVENTS=new Set(['error.detected','bug.detected','bug.fixed','work.failed','agent.failed','verify.start','verify.complete']);
const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

export class AleStudioTelemetry{
  constructor({historyLimit=80,memoryLimit=60,diagnosticLimit=60}={}){
    this.historyLimit=Math.max(20,Math.min(500,Number(historyLimit)||80));
    this.memoryLimit=Math.max(20,Math.min(300,Number(memoryLimit)||60));
    this.diagnosticLimit=Math.max(20,Math.min(300,Number(diagnosticLimit)||60));
    this.reset();
  }

  reset(){
    this.activePhases=new Map();
    this.startedAt=Date.now();
    this.eventTimes=[];
    this.decision={
      currentStage:null,currentLabel:'',status:'idle',startedAt:0,lastDurationMs:null,
      completedStages:0,failedStages:0,history:[]
    };
    this.memory={
      active:false,lastOperation:null,
      counters:{read:0,write:0,complete:0,context_prepare:0,context_approved:0,context_used:0,context_blocked:0},
      history:[]
    };
    this.diagnostics={
      active:false,status:'idle',current:null,lastRepairDurationMs:null,
      counters:{errors:0,bugs:0,fixed:0,workFailed:0,agentFailed:0,verified:0},
      history:[]
    };
    this.performance={totalEvents:0,lastEventAt:0,peakEvents10s:0};
    this.lastEventId=0;
  }

  consume(envelope){
    if(!envelope?.event)return this.snapshot();
    const timestamp=Number(envelope.timestamp)||Date.now();
    this.lastEventId=Number(envelope.id)||this.lastEventId;
    this.performance.totalEvents+=1;
    this.performance.lastEventAt=timestamp;
    this.eventTimes.push(timestamp);
    this.eventTimes=this.eventTimes.filter(value=>value>=timestamp-10000);
    this.performance.peakEvents10s=Math.max(this.performance.peakEvents10s,this.eventTimes.length);
    this.consumeDecision(envelope);
    this.consumeMemory(envelope);
    this.consumeDiagnostics(envelope);
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
      Object.assign(this.decision,{currentStage:def.stage,currentLabel:label,status:'running',startedAt:timestamp});
      this.pushDecision(item);return;
    }
    const started=this.activePhases.get(def.stage);
    const durationMs=started?Math.max(0,timestamp-started.startedAt):null;
    const item={stage:def.stage,status:def.status,label:started?.label||label,startedAt:started?.startedAt||timestamp,endedAt:timestamp,durationMs,eventId:envelope.id};
    this.activePhases.delete(def.stage);
    this.decision.lastDurationMs=durationMs;
    if(def.status==='failed')this.decision.failedStages+=1;else this.decision.completedStages+=1;
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
    const item={operation,event:envelope.event,label:safeText(envelope.payload?.label||envelope.payload?.message||envelope.payload?.target||operation),target:safeText(envelope.payload?.target||'',80),timestamp,eventId:envelope.id};
    this.memory.lastOperation=item;
    this.memory.history.push(item);
    if(this.memory.history.length>this.memoryLimit)this.memory.history.splice(0,this.memory.history.length-this.memoryLimit);
  }

  consumeDiagnostics(envelope){
    if(!DIAGNOSTIC_EVENTS.has(envelope.event))return;
    const timestamp=Number(envelope.timestamp)||Date.now();
    const message=safeText(envelope.payload?.message||envelope.payload?.label||envelope.event,240);
    const d=this.diagnostics;
    if(envelope.event==='error.detected'){
      d.counters.errors+=1;d.active=true;d.status='analyzing';
      d.current={message,detectedAt:timestamp,bugAt:0,fixedAt:0};
    }else if(envelope.event==='bug.detected'){
      d.counters.bugs+=1;d.active=true;d.status='bug';
      d.current={...(d.current||{}),message,detectedAt:d.current?.detectedAt||timestamp,bugAt:timestamp,fixedAt:0};
    }else if(envelope.event==='bug.fixed'){
      d.counters.fixed+=1;d.status='repaired';
      const start=d.current?.bugAt||d.current?.detectedAt||timestamp;
      d.lastRepairDurationMs=Math.max(0,timestamp-start);
      d.current={...(d.current||{}),message,detectedAt:d.current?.detectedAt||start,bugAt:d.current?.bugAt||start,fixedAt:timestamp};
    }else if(envelope.event==='work.failed'){
      d.counters.workFailed+=1;d.active=true;d.status='attention';
    }else if(envelope.event==='agent.failed'){
      d.counters.agentFailed+=1;d.active=true;d.status='attention';
    }else if(envelope.event==='verify.start'&&d.current){
      d.status='verifying';d.active=true;
    }else if(envelope.event==='verify.complete'&&d.current){
      d.counters.verified+=1;d.status='verified';d.active=false;
    }
    d.history.push({event:envelope.event,message,timestamp,eventId:envelope.id,status:d.status});
    if(d.history.length>this.diagnosticLimit)d.history.splice(0,d.history.length-this.diagnosticLimit);
  }

  snapshot(){
    const active={};
    for(const [stage,value] of this.activePhases)active[stage]={...value};
    const now=this.performance.lastEventAt||Date.now();
    const events10s=this.eventTimes.filter(value=>value>=now-10000).length;
    return {
      version:2,lastEventId:this.lastEventId,
      decision:{...this.decision,active,history:this.decision.history.map(item=>({...item}))},
      memory:{...this.memory,counters:{...this.memory.counters},lastOperation:this.memory.lastOperation?{...this.memory.lastOperation}:null,history:this.memory.history.map(item=>({...item}))},
      diagnostics:{...this.diagnostics,counters:{...this.diagnostics.counters},current:this.diagnostics.current?{...this.diagnostics.current}:null,history:this.diagnostics.history.map(item=>({...item}))},
      performance:{
        ...this.performance,
        startedAt:this.startedAt,
        uptimeMs:Math.max(0,Date.now()-this.startedAt),
        events10s,
        eventsPerSecond:Number((events10s/10).toFixed(2))
      }
    };
  }
}

export function createStudioTelemetry(options){return new AleStudioTelemetry(options);}
