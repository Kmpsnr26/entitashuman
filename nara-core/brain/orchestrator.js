import {createEventBus} from './event-bus.js';
import {createBrainState} from './brain-state.js';
import {isRegionId} from './regions.js';

const connectionEvents=Object.freeze({
  GITHUB:['github.connected','github.disconnected'],
  COPILOT:['copilot.connected','copilot.disconnected'],
  DRIVE:['drive.connected','drive.disconnected'],
  OWNER_EMAIL:['email.connected','email.disconnected'],
  WEB:['web.connected','web.disconnected'],
  TEAM:['team.connected','team.disconnected']
});

export class NaraOrchestrator{
  constructor({bus=createEventBus(),state=createBrainState()}={}){
    this.bus=bus;
    this.state=state;
    this.running=false;
    this.unsubscribe=null;
  }

  start(){
    if(this.running)return this.snapshot();
    this.unsubscribe=this.bus.onAny(envelope=>this.state.applyEvent(envelope));
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

  snapshot(){return this.state.snapshot();}
}

export function createOrchestrator(options){return new NaraOrchestrator(options);}
