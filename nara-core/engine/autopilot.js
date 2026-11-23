const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,79}$/i;
export class NaraAutopilot{
  constructor({scheduler,watchdog,recovery,capabilities,experience,onEvent=()=>{}}={}){
    if(!scheduler||!watchdog||!recovery||!capabilities||!experience)throw new Error('Autopilot NARA membutuhkan scheduler, watchdog, recovery, capability broker, dan experience model.');
    this.scheduler=scheduler;this.watchdog=watchdog;this.recovery=recovery;this.capabilities=capabilities;
    this.experience=experience;this.onEvent=typeof onEvent==='function'?onEvent:()=>{};
    this.handlers=new Map();this.running=false;this.pumpPromise=null;this.activeController=null;this.activeTaskId=null;this.outcomes=new Map();
  }
  registerHandler(id,handler,{capability='',timeoutMs=120000,idempotent=false}={}){
    const key=String(id||'');
    if(!SAFE_ID.test(key))throw new Error('Autopilot handler ID tidak valid.');
    if(typeof handler!=='function')throw new TypeError('Autopilot handler harus fungsi.');
    this.handlers.set(key,{handler,capability:String(capability||''),idempotent:Boolean(idempotent),
      timeoutMs:Math.max(1000,Math.min(3600000,Number(timeoutMs)||120000))});
    return key;
  }
  enqueue(task){const item=this.scheduler.enqueue(task);this.onEvent('autopilot.task.queued',{id:item.id,label:item.label});return item;}
  requiredCapability(task,registered){return task.capability||registered.capability;}
  canRun(task){
    const registered=this.handlers.get(task.handler);
    if(!registered)return true;
    const required=this.requiredCapability(task,registered);
    return !required||this.capabilities.authorize(required).ok;
  }
  async runNext(){
    const next=this.scheduler.next({isRunnable:task=>this.canRun(task)});
    if(!next){
      const blocked=this.scheduler.next();
      if(blocked){
        const registered=this.handlers.get(blocked.handler),required=registered&&this.requiredCapability(blocked,registered);
        const auth=required?this.capabilities.authorize(required):{ok:false,reason:'no-runnable-task'};
        this.onEvent('autopilot.task.blocked',{id:blocked.id,capability:required||'',reason:auth.reason});
        this.pump();
        return {ok:false,reason:auth.reason,task:blocked};
      }
      return {ok:false,reason:'queue-empty'};
    }
    return this.runTask(next.id);
  }
  async runTask(taskId){
    const id=String(taskId||'');
    while(true){
      const prior=this.outcomes.get(id);
      if(prior)return prior;
      const current=this.scheduler.get(id);
      if(!current)return {ok:false,reason:'task-not-found'};
      if(current.status==='complete')return {ok:true,task:current,result:current.result};
      if(['failed','cancelled'].includes(current.status))return {ok:false,reason:current.lastError||current.status,task:current};
      const registered=this.handlers.get(current.handler);
      if(!registered){const task=this.scheduler.fail(id,'handler-not-registered');return {ok:false,reason:'handler-not-registered',task};}
      const required=this.requiredCapability(current,registered);
      if(required&&!this.capabilities.authorize(required).ok){
        this.pump();
        return {ok:false,reason:this.capabilities.authorize(required).reason,task:current};
      }
      if(!this.pumpPromise)this.pump();
      if(this.pumpPromise)await this.pumpPromise;
      const result=this.outcomes.get(id);
      if(result)return result;
      const after=this.scheduler.get(id);
      if(after?.status==='queued')return {ok:false,reason:'task-not-runnable',task:after};
    }
  }
  pump(){
    if(this.pumpPromise)return this.pumpPromise;
    this.pumpPromise=this.drain().finally(()=>{this.pumpPromise=null;this.running=false;});
    return this.pumpPromise;
  }
  async drain(){
    this.running=true;
    while(true){
      const next=this.scheduler.next({isRunnable:task=>this.canRun(task)});
      if(!next)break;
      const outcome=await this.execute(next);
      this.outcomes.set(next.id,outcome);
      while(this.outcomes.size>(this.scheduler.limit||200))this.outcomes.delete(this.outcomes.keys().next().value);
      if(!outcome.ok&&outcome.decision?.action==='retry'){
        this.scheduler.requeue(next.id);
        this.outcomes.delete(next.id);
      }
    }
  }
  async execute(next){
    const registered=this.handlers.get(next.handler);
    if(!registered){
      const task=this.scheduler.fail(next.id,'handler-not-registered');
      this.onEvent('autopilot.task.failed',{id:next.id,reason:'handler-not-registered'});
      return {ok:false,reason:'handler-not-registered',task};
    }
    const required=this.requiredCapability(next,registered);
    if(required){
      const auth=this.capabilities.authorize(required);
      if(!auth.ok){this.onEvent('autopilot.task.blocked',{id:next.id,capability:required,reason:auth.reason});return {ok:false,reason:auth.reason,task:next};}
    }
    let started=null,watching=false,controller=null,startedAt=Date.now();
    try{
      started=this.scheduler.start(next.id);
      this.watchdog.track(started.id,{timeoutMs:registered.timeoutMs,label:started.label});watching=true;
      controller=new AbortController();this.activeController=controller;this.activeTaskId=started.id;
      this.onEvent('autopilot.task.start',{id:started.id,label:started.label});
      let timeoutHandle;
      const timeout=new Promise((_,reject)=>{
        timeoutHandle=setTimeout(()=>{const error=new Error('Autopilot task timeout.');error.code='AUTOPILOT_TIMEOUT';error.category='timeout';controller.abort(error);reject(error);},registered.timeoutMs);
      });
      const aborted=new Promise((_,reject)=>{
        if(controller.signal.aborted){reject(controller.signal.reason||new Error('Task dibatalkan.'));return;}
        controller.signal.addEventListener('abort',()=>reject(controller.signal.reason||new Error('Task dibatalkan.')),{once:true});
      });
      const work=Promise.resolve().then(()=>registered.handler({
        task:{...started,dependencies:[...started.dependencies]},heartbeat:()=>this.watchdog.heartbeat(started.id),signal:controller.signal
      }));
      let result;
      try{result=await Promise.race([work,timeout,aborted]);}
      finally{clearTimeout(timeoutHandle);}
      if(controller.signal.aborted)throw controller.signal.reason||new Error('Task dibatalkan.');
      const task=this.scheduler.complete(started.id);
      this.experience.record(started.handler,{ok:true,durationMs:Date.now()-startedAt});
      this.onEvent('autopilot.task.complete',{id:started.id,label:started.label});
      return {ok:true,task,result};
    }catch(error){
      if(started){
        const task=this.scheduler.fail(started.id,error?.message||'handler-failed');
        this.experience.record(started.handler,{ok:false,durationMs:Date.now()-startedAt});
        const decision=this.recovery.decide({attempt:task.attempts,errorCategory:error?.category||'runtime',
          capabilityRequired:Boolean(required),capabilityApproved:required?this.capabilities.authorize(required).ok:true,
          fallbackAvailable:false,idempotent:registered.idempotent===true,compensationConfirmed:false});
        this.onEvent('autopilot.task.failed',{id:started.id,label:started.label,action:decision.action,reason:decision.reason});
        return {ok:false,error:error?.message||'handler-failed',decision,task};
      }
      return {ok:false,error:error?.message||'setup-failed',task:this.scheduler.get(next.id)};
    }finally{
      if(controller&&!controller.signal.aborted)controller.abort();
      if(this.activeController===controller){this.activeController=null;this.activeTaskId=null;}
      if(watching)this.watchdog.complete(next.id);
      this.running=false;
    }
  }
  cancel(taskId,reason='Task dibatalkan oleh pemanggil.'){
    const task=this.scheduler.get(taskId);if(!task)return null;
    if(task.status==='running'&&this.activeTaskId===String(taskId)&&this.activeController)this.activeController.abort(new Error(String(reason)));
    return this.scheduler.cancel(taskId);
  }
  snapshot(){return {version:1,running:this.running,handlers:[...this.handlers.keys()],scheduler:this.scheduler.snapshot(),
    watchdog:this.watchdog.snapshot(),experience:this.experience.snapshot()};}
}
export function createAutopilot(options){return new NaraAutopilot(options);}
