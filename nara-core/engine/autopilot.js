const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,79}$/i;

export class NaraAutopilot{
  constructor({scheduler,watchdog,recovery,capabilities,experience,onEvent=()=>{}}={}){
    if(!scheduler||!watchdog||!recovery||!capabilities||!experience)throw new Error('Autopilot NARA membutuhkan scheduler, watchdog, recovery, capability broker, dan experience model.');
    this.scheduler=scheduler;
    this.watchdog=watchdog;
    this.recovery=recovery;
    this.capabilities=capabilities;
    this.experience=experience;
    this.onEvent=typeof onEvent==='function'?onEvent:()=>{};
    this.handlers=new Map();
    this.running=false;
  }

  registerHandler(id,handler,{capability='',timeoutMs=120000}={}){
    const key=String(id||'');
    if(!SAFE_ID.test(key))throw new Error('Autopilot handler ID tidak valid.');
    if(typeof handler!=='function')throw new TypeError('Autopilot handler harus fungsi.');
    this.handlers.set(key,{
      handler,
      capability:String(capability||''),
      timeoutMs:Math.max(1000,Math.min(60*60*1000,Number(timeoutMs)||120000))
    });
    return key;
  }

  enqueue(task){
    const item=this.scheduler.enqueue(task);
    this.onEvent('autopilot.task.queued',{id:item.id,label:item.label});
    return item;
  }

  async runNext(){
    if(this.running)return {ok:false,reason:'autopilot-busy'};
    const next=this.scheduler.next();
    if(!next)return {ok:false,reason:'queue-empty'};
    const registered=this.handlers.get(next.handler);
    if(!registered){
      this.scheduler.fail(next.id,'handler-not-registered');
      this.onEvent('autopilot.task.failed',{id:next.id,reason:'handler-not-registered'});
      return {ok:false,reason:'handler-not-registered',task:this.scheduler.get(next.id)};
    }

    const required=next.capability||registered.capability;
    if(required){
      const auth=this.capabilities.authorize(required);
      if(!auth.ok){
        this.onEvent('autopilot.task.blocked',{id:next.id,capability:required,reason:auth.reason});
        return {ok:false,reason:auth.reason,task:next};
      }
    }

    this.running=true;
    const started=this.scheduler.start(next.id);
    this.watchdog.track(started.id,{timeoutMs:registered.timeoutMs,label:started.label});
    this.onEvent('autopilot.task.start',{id:started.id,label:started.label});

    const startedAt=Date.now();
    try{
      const result=await registered.handler({
        task:{...started,dependencies:[...started.dependencies]},
        heartbeat:()=>this.watchdog.heartbeat(started.id)
      });
      this.scheduler.complete(started.id);
      this.watchdog.complete(started.id);
      this.experience.record(started.handler,{ok:true,durationMs:Date.now()-startedAt});
      this.onEvent('autopilot.task.complete',{id:started.id,label:started.label});
      return {ok:true,task:this.scheduler.get(started.id),result};
    }catch(error){
      const failed=this.scheduler.fail(started.id,error?.message||'handler-failed');
      this.watchdog.complete(started.id);
      this.experience.record(started.handler,{ok:false,durationMs:Date.now()-startedAt});
      const decision=this.recovery.decide({
        attempt:failed.attempts,
        errorCategory:error?.category||'runtime',
        capabilityRequired:Boolean(required),
        capabilityApproved:required?this.capabilities.authorize(required).ok:true,
        fallbackAvailable:false
      });
      if(decision.action==='retry')this.scheduler.requeue(started.id);
      this.onEvent('autopilot.task.failed',{
        id:started.id,
        label:started.label,
        action:decision.action,
        reason:decision.reason
      });
      return {ok:false,error:error?.message||'handler-failed',decision,task:this.scheduler.get(started.id)};
    }finally{
      this.running=false;
    }
  }

  snapshot(){
    return {
      version:1,
      running:this.running,
      handlers:[...this.handlers.keys()],
      scheduler:this.scheduler.snapshot(),
      watchdog:this.watchdog.snapshot(),
      experience:this.experience.snapshot()
    };
  }
}

export function createAutopilot(options){return new NaraAutopilot(options);}
