import {createEventBus} from './event-bus.js';
import {createBrainState} from './brain-state.js';
import {isRegionId} from './regions.js';

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
    if(!this.running&&event!=='nara.start')throw new Error('NARA Orchestrator belum dijalankan.');
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
    const events={GITHUB:'github.connected',COPILOT:'copilot.connected',DRIVE:'drive.connected',OWNER_EMAIL:'email.connected',WEB:'web.connected',TEAM:'team.connected'};
    if(!events[region])throw new Error('Koneksi NARA tidak dikenal: '+region);
    if(connected)return this.dispatch(events[region],{region});
    this.state.setRegion(region,{status:'disconnected',activity:0,message:'Terputus'},'connection.disconnected');
    return {event:null,state:this.snapshot()};
  }

  snapshot(){return this.state.snapshot();}
}

export function createOrchestrator(options){return new NaraOrchestrator(options);}
