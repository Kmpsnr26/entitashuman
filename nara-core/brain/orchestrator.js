import {createEventBus} from './event-bus.js';
import {createBrainState} from './brain-state.js';
import {isRegionId} from './regions.js';
import {
  createSensoryFusion,
  createCapabilityBroker,
  createTaskScheduler,
  createWatchdog,
  createRecoveryEngine,
  createInstinctEngine,
  createExperienceModel,
  createGoalManager,
  createMetacognitionEngine,
  createAutopilot,
  NARA_IDENTITY,
  integrationPlan
} from '../engine/index.js';

const connectionEvents=Object.freeze({
  GITHUB:['github.connected','github.disconnected'],
  COPILOT:['copilot.connected','copilot.disconnected'],
  DRIVE:['drive.connected','drive.disconnected'],
  OWNER_EMAIL:['email.connected','email.disconnected'],
  WEB:['web.connected','web.disconnected'],
  TEAM:['team.connected','team.disconnected']
});

export class NaraOrchestrator{
  constructor({
    bus=createEventBus(),
    state=createBrainState(),
    sensory=createSensoryFusion(),
    capabilities=createCapabilityBroker(),
    scheduler=createTaskScheduler(),
    watchdog=createWatchdog(),
    recovery=createRecoveryEngine(),
    instinct=createInstinctEngine(),
    experience=createExperienceModel(),
    goals=createGoalManager(),
    metacognition=createMetacognitionEngine(),
    autopilot=null,
    deviceProfile={}
  }={}){
    this.bus=bus;
    this.state=state;
    this.sensory=sensory;
    this.capabilities=capabilities;
    this.scheduler=scheduler;
    this.watchdog=watchdog;
    this.recovery=recovery;
    this.instinct=instinct;
    this.experience=experience;
    this.goals=goals;
    this.metacognition=metacognition;
    this.devicePlan=integrationPlan(deviceProfile);
    this.running=false;
    this.unsubscribe=null;
    this.autopilot=autopilot||createAutopilot({
      scheduler:this.scheduler,
      watchdog:this.watchdog,
      recovery:this.recovery,
      capabilities:this.capabilities,
      experience:this.experience,
      onEvent:(event,payload={})=>{
        if(this.running)this.bus.emit(event,payload,{source:'autopilot'});
      }
    });
  }

  start(){
    if(this.running)return this.snapshot();
    this.unsubscribe=this.bus.onAny(envelope=>{
      this.state.applyEvent(envelope);
      this.sensory.consume(envelope);
    });
    this.running=true;
    this.bus.emit('nara.start',{source:'orchestrator'});
    return this.snapshot();
  }

  stop(){
    if(!this.running)return this.snapshot();
    this.bus.emit('nara.shutdown',{source:'orchestrator'});
    this.unsubscribe?.();this.unsubscribe=null;this.running=false;
    return this.snapshot();
  }

  dispatch(event,payload={},meta={}){
    if(!this.running)throw new Error('NARA Orchestrator belum dijalankan.');
    const envelope=this.bus.emit(event,payload,meta);
    return {event:envelope,state:this.snapshot()};
  }

  selectRegion(region){
    if(!isRegionId(region))throw new Error('Region NARA tidak dikenal: '+region);
    return this.dispatch('brain.region.select',{region});
  }

  startWork({id='',label='Pekerjaan NARA'}={}){
    return this.dispatch('work.start',{id,label});
  }

  completeWork(payload={}){
    return this.dispatch('work.complete',payload);
  }

  connection(name,connected=true){
    const region=String(name||'').toUpperCase();
    const events=connectionEvents[region];
    if(!events)throw new Error('Koneksi NARA tidak dikenal: '+region);
    return this.dispatch(connected?events[0]:events[1],{region});
  }

  configureDevice(profile={}){
    this.devicePlan=integrationPlan(profile);
    if(this.running){
      this.dispatch('device.integration',{
        active:true,
        platform:this.devicePlan.device.platform,
        capabilities:this.devicePlan.plan.filter(item=>item.enabled).map(item=>item.id)
      },{source:'device-profile'});
    }
    return this.devicePlan;
  }

  requestCapability(capability,options={}){
    const request=this.capabilities.request(capability,options);
    if(this.running)this.bus.emit('capability.requested',{
      capability:request.capability,
      requestId:request.id,
      risk:request.risk
    },{source:'capability-broker'});
    return request;
  }

  approveCapability(requestId,options={}){
    const request=this.capabilities.approve(requestId,options);
    if(this.running)this.bus.emit('capability.approved',{
      capability:request.capability,
      requestId:request.id
    },{source:'capability-broker'});
    return request;
  }

  denyCapability(requestId,options={}){
    const request=this.capabilities.deny(requestId,options);
    if(request&&this.running)this.bus.emit('capability.denied',{
      capability:request.capability,
      requestId:request.id
    },{source:'capability-broker'});
    return request;
  }

  revokeCapability(capability,options={}){
    const removed=this.capabilities.revoke(capability,options);
    if(this.running)this.bus.emit('capability.revoked',{
      capability:String(capability||'').slice(0,80),
      removed
    },{source:'capability-broker'});
    return removed;
  }

  authorizeCapability(capability){
    return this.capabilities.authorize(capability);
  }

  registerAutopilotHandler(id,handler,options={}){
    return this.autopilot.registerHandler(id,handler,options);
  }

  createGoal(goal={}){
    const created=this.goals.create(goal);
    if(this.running)this.bus.emit('goal.created',{
      id:created.id,label:created.label,priority:created.priority
    },{source:'goal-manager'});
    return created;
  }

  activateGoal(id){
    const goal=this.goals.activate(id);
    if(this.running)this.bus.emit('goal.activated',{
      id:goal.id,label:goal.label
    },{source:'goal-manager'});
    return goal;
  }

  completeGoal(id){
    const goal=this.goals.complete(id);
    if(this.running)this.bus.emit('goal.complete',{
      id:goal.id,label:goal.label,progress:goal.progress
    },{source:'goal-manager'});
    return goal;
  }

  failGoal(id,error=''){
    const goal=this.goals.fail(id,error);
    if(this.running)this.bus.emit('goal.failed',{
      id:goal.id,label:goal.label,error:goal.lastError
    },{source:'goal-manager'});
    return goal;
  }

  queueAutopilotTask(task={}){
    const queued=this.autopilot.enqueue(task);
    if(queued.goalId){
      this.goals.attachTask(queued.goalId,queued.id);
      if(this.running)this.bus.emit('goal.task.linked',{
        id:queued.goalId,taskId:queued.id
      },{source:'goal-manager'});
    }
    return queued;
  }

  reconcileGoals(){
    const changes=this.goals.reconcileTasks(this.scheduler.snapshot().tasks);
    for(const goal of changes){
      if(!this.running)continue;
      const event=goal.status==='complete'?'goal.complete':
        goal.status==='blocked'?'goal.blocked':'goal.progress';
      this.bus.emit(event,{
        id:goal.id,label:goal.label,progress:goal.progress,status:goal.status
      },{source:'goal-manager'});
    }
    return changes;
  }

  reviewMetacognition(){
    const metrics=this.snapshot().engine.metacognition;
    if(this.running)this.bus.emit('metacognition.review',{
      confidence:metrics.confidence,
      uncertainty:metrics.uncertainty,
      workload:metrics.workload,
      recommendation:metrics.recommendation,
      flags:[...metrics.flags]
    },{source:'metacognition'});
    return metrics;
  }

  async runAutopilotOnce(){
    const result=await this.autopilot.runNext();
    this.reconcileGoals();
    this.reviewMetacognition();
    return result;
  }

  inspectWatchdog(now=Date.now()){
    const stalled=this.watchdog.inspect(now);
    for(const item of stalled){
      if(this.running)this.bus.emit('autopilot.task.stalled',{
        id:item.id,
        label:item.label
      },{source:'watchdog'});
    }
    return stalled;
  }

  snapshot(){
    const brain=this.state.snapshot();
    const sensory=this.sensory.snapshot();
    const autopilot=this.autopilot.snapshot();
    const goals=this.goals.snapshot();
    const capabilities=this.capabilities.snapshot();
    const experience=this.experience.snapshot();
    const activeTask=autopilot.scheduler.tasks.find(item=>
      item.status==='running'||item.status==='failed'
    )||{};
    const instinct=this.instinct.evaluate({
      sensory,
      diagnostics:{
        failures:autopilot.scheduler.failed,
        errors:brain.regions.ERROR_MONITOR?.status==='error'?1:0
      },
      task:activeTask
    });
    const metacognition=this.metacognition.evaluate({
      brain,
      sensory,
      goals,
      autopilot,
      capabilities,
      experience
    });
    return {
      ...brain,
      engine:{
        identity:NARA_IDENTITY,
        sensory,
        capabilities,
        device:this.devicePlan,
        goals,
        autopilot,
        experience,
        instinct,
        metacognition
      }
    };
  }
}

export function createOrchestrator(options){return new NaraOrchestrator(options);}
