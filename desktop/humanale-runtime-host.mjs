import {
  NARA_UNIFIED_RUNTIME_CONTRACT,
  normalizeHumanALEInput,
  projectRuntimeAuthority
} from '../nara-core/runtime/unified-contract.js';

const DEFAULT_RENDERER_EVENTS=NARA_UNIFIED_RUNTIME_CONTRACT.rendererEvents;

const safeNumber=(value,min=0,max=1)=>{
  const number=Number(value);
  if(!Number.isFinite(number))return min;
  return Math.max(min,Math.min(max,number));
};

function deriveBodyState(core={}){
  const sensory=core.engine?.sensory||{};
  const brain=core.regions||{};
  const speech=Boolean(sensory.speech?.active);
  const hearing=Boolean(sensory.hearing?.active);
  const vision=Boolean(sensory.vision?.active);
  const reasoning=brain.REASONER?.status==='active'||brain.REASONER?.status==='processing';
  const working=['processing','active'].includes(brain.PROGRAM?.status)||
    ['processing','active'].includes(brain.AGENT_MANAGER?.status);
  const warning=brain.ERROR_MONITOR?.status==='error'||brain.SAFETY?.status==='paused';

  return Object.freeze({
    state:warning?'warning':speech?'speaking':reasoning?'thinking':working?'working':hearing?'listening':'idle',
    hearing:Object.freeze({
      active:hearing,
      energy:safeNumber(sensory.hearing?.energy),
      low:safeNumber(sensory.hearing?.low),
      mid:safeNumber(sensory.hearing?.mid),
      high:safeNumber(sensory.hearing?.high)
    }),
    vision:Object.freeze({
      active:vision,
      activity:safeNumber(sensory.vision?.activity)
    }),
    speech:Object.freeze({
      active:speech,
      energy:safeNumber(sensory.speech?.energy)
    }),
    cognition:Object.freeze({
      reasoning,
      working,
      warning,
      selectedRegion:String(core.selectedRegion||'NARA_CORE')
    })
  });
}

export class HumanALERuntimeHost{
  constructor({
    nara,
    voiceFeedback=null,
    dataFlowMeter=null,
    getTargets=()=>[],
    isTrustedEvent=()=>false,
    rendererEvents=DEFAULT_RENDERER_EVENTS,
    onExperienceDirty=()=>{}
  }={}){
    if(!nara?.snapshot||!nara?.dispatch||!nara?.bus)throw new Error('HumanALE Runtime Host membutuhkan NARA Orchestrator.');
    this.nara=nara;
    this.voiceFeedback=voiceFeedback;
    this.dataFlowMeter=dataFlowMeter;
    this.getTargets=typeof getTargets==='function'?getTargets:()=>[];
    this.isTrustedEvent=typeof isTrustedEvent==='function'?isTrustedEvent:()=>false;
    this.rendererEvents=new Set(rendererEvents);
    this.onExperienceDirty=typeof onExperienceDirty==='function'?onExperienceDirty:()=>{};
    this.started=false;
    this.unsubState=null;
    this.unsubBus=null;
    this.lastRuntime=null;
  }

  targets(){
    return (Array.isArray(this.getTargets())?this.getTargets():[])
      .filter(target=>target&&!target.isDestroyed?.()&&!target.webContents?.isLoading?.());
  }

  send(channel,payload,{avatarOnly=false}={}){
    this.dataFlowMeter?.recordOut?.(payload);
    const targets=this.targets();
    const selected=avatarOnly?targets.slice(0,1):targets;
    for(const target of selected)target.webContents.send(channel,payload);
  }

  buildRuntimeSnapshot(core=this.nara.snapshot()){
    const runtime=Object.freeze({
      version:3,
      contract:NARA_UNIFIED_RUNTIME_CONTRACT,
      authority:projectRuntimeAuthority(core),
      timestamp:Date.now(),
      core,
      humanale:Object.freeze({
        role:'nara-body',
        body:deriveBodyState(core),
        channels:Object.freeze({
          state:'dudidam:runtime-state',
          coreState:'dudidam:nara-state',
          voice:'dudidam:nara-voice'
        })
      })
    });
    this.lastRuntime=runtime;
    return runtime;
  }

  publishState(core){
    this.send('dudidam:nara-state',core);
    this.send('dudidam:runtime-state',this.buildRuntimeSnapshot(core));
  }

  publishVoice(cue){
    if(!cue)return null;
    this.send('dudidam:nara-voice',cue,{avatarOnly:true});
    return cue;
  }

  consumeEnvelope(envelope){
    const cue=this.voiceFeedback?.consume?.(envelope);
    if(cue)this.publishVoice(cue);
    if(['autopilot.task.complete','autopilot.task.failed'].includes(envelope?.event)){
      this.onExperienceDirty(envelope);
    }
    return cue||null;
  }

  announce(event,payload={}){
    return this.consumeEnvelope({
      event:String(event||''),
      payload:payload&&typeof payload==='object'?payload:{},
      timestamp:Date.now()
    });
  }

  start(){
    if(this.started)return this.buildRuntimeSnapshot();
    this.unsubState=null;
    this.unsubBus=this.nara.bus.onAny(envelope=>{
      this.consumeEnvelope(envelope);
      this.publishState(this.nara.snapshot());
    });
    this.started=true;
    const core=this.nara.snapshot();
    this.publishState(core);
    return this.buildRuntimeSnapshot(core);
  }

  stop(){
    this.unsubState?.();
    this.unsubBus?.();
    this.unsubState=null;
    this.unsubBus=null;
    this.started=false;
  }

  snapshot(){
    return this.buildRuntimeSnapshot(this.nara.snapshot());
  }

  snapshotRequest(event){
    if(!this.isTrustedEvent(event))return {error:'Akses ditolak.'};
    const core=this.nara.snapshot();
    const result={ok:true,state:core,runtime:this.buildRuntimeSnapshot(core)};
    this.dataFlowMeter?.recordOut?.(result);
    return result;
  }

  runtimeSnapshotRequest(event){
    if(!this.isTrustedEvent(event))return {error:'Akses ditolak.'};
    const result={ok:true,runtime:this.snapshot()};
    this.dataFlowMeter?.recordOut?.(result);
    return result;
  }

  dispatchRenderer(event,value){
    if(!this.isTrustedEvent(event))return {error:'Akses ditolak.'};
    this.dataFlowMeter?.recordIn?.(value);
    const name=String(value?.event||'');
    if(!this.rendererEvents.has(name))return {error:'Event NARA tidak diizinkan dari renderer.'};
    const payload=normalizeHumanALEInput(name,value?.payload);
    if(payload===null)return {error:'Payload event HumanALE tidak valid.'};
    try{
      const result={ok:true,...this.nara.dispatch(name,payload,{source:'humanale-renderer'})};
      return result;
    }catch(error){
      return {error:error?.message||'NARA dispatch gagal.'};
    }
  }

  bindIpc(ipcMain){
    if(!ipcMain?.handle)throw new TypeError('Electron ipcMain wajib tersedia.');
    ipcMain.handle('dudidam:nara-snapshot',event=>this.snapshotRequest(event));
    ipcMain.handle('dudidam:runtime-snapshot',event=>this.runtimeSnapshotRequest(event));
    ipcMain.handle('dudidam:nara-dispatch',(event,value)=>this.dispatchRenderer(event,value));
  }
}

export function createHumanALERuntimeHost(options){return new HumanALERuntimeHost(options);}
export {DEFAULT_RENDERER_EVENTS};
