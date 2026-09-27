import {createEventBus} from './event-bus.js';
import {createBrainState} from './brain-state.js';
import {isRegionId} from './regions.js';
import {
  createSensoryFusion,
  createCapabilityBroker,
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
    deviceProfile={}
  }={}){
    this.bus=bus;
    this.state=state;
    this.sensory=sensory;
    this.capabilities=capabilities;
    this.devicePlan=integrationPlan(deviceProfile);
    this.running=false;
    this.unsubscribe=null;
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
    return this.capabilities.request(capability,options);
  }

  approveCapability(requestId,options={}){
    return this.capabilities.approve(requestId,options);
  }

  denyCapability(requestId,options={}){
    return this.capabilities.deny(requestId,options);
  }

  revokeCapability(capability,options={}){
    return this.capabilities.revoke(capability,options);
  }

  authorizeCapability(capability){
    return this.capabilities.authorize(capability);
  }

  snapshot(){
    return {
      ...this.state.snapshot(),
      engine:{
        identity:NARA_IDENTITY,
        sensory:this.sensory.snapshot(),
        capabilities:this.capabilities.snapshot(),
        device:this.devicePlan
      }
    };
  }
}

export function createOrchestrator(options){return new NaraOrchestrator(options);}
