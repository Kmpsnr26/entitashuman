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

  queueAutopilotTask(task={}){
    return this.autopilot.enqueue(task);
  }

  async runAutopilotOnce(){
    return await this.autopilot.runNext();
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
    return {
      ...this.state.snapshot(),
      engine:{
        identity:NARA_IDENTITY,
        sensory:this.sensory.snapshot(),
        capabilities:this.capabilities.snapshot(),
        device:this.devicePlan,
        autopilot:this.autopilot.snapshot(),
        instinct:this.instinct.evaluate({
          sensory:this.sensory.snapshot(),
          diagnostics:{
            failures:this.autopilot.snapshot().scheduler.failed,
            errors:this.state.regions.ERROR_MONITOR?.status==='error'?1:0
          },
          task:this.autopilot.snapshot().scheduler.tasks.find(item=>item.status==='running'||item.status==='failed')||{}
        })
      }
    };
  }
}

export function createOrchestrator(options){return new NaraOrchestrator(options);}
