import {
  READINESS_GATE_VERSION,
  READINESS_STATUS,
  READINESS_GATES,
  SIMULATION_REQUIRED_GATES,
  LIVE_REQUIRED_GATES,
  DEFAULT_READINESS_LIMITS
} from './constants.js';

const KNOWN_GATES=new Set(READINESS_GATES);

function normalizeLimits(overrides={}){
  const merged={...DEFAULT_READINESS_LIMITS,...overrides};
  if(!Number.isInteger(merged.historyLimit)||merged.historyLimit<1){
    throw new TypeError('historyLimit must be a positive integer');
  }
  return Object.freeze(merged);
}

function normalizeFacts(raw){
  if(raw===null||typeof raw!=='object'||Array.isArray(raw)){
    throw new TypeError('Readiness facts must be an object.');
  }
  for(const key of Object.keys(raw)){
    if(!KNOWN_GATES.has(key))throw new TypeError('Unknown readiness gate: '+key);
    if(typeof raw[key]!=='boolean')throw new TypeError('Readiness gate values must be boolean.');
  }
  return Object.freeze(Object.fromEntries(READINESS_GATES.map(gate=>[gate,raw[gate]===true])));
}

function missingFrom(facts,required){
  return required.filter(gate=>facts[gate]!==true);
}

export class NaraIntegrationReadinessGate{
  constructor({bus=null,now=()=>Date.now(),limits={}}={}){
    this.bus=bus;
    this.now=now;
    this.limits=normalizeLimits(limits);
    this.history=[];
    this.sequence=0;
  }

  emit(event,payload={}){
    if(this.bus&&typeof this.bus.emit==='function'){
      this.bus.emit(event,payload,{source:'integration-readiness'});
    }
  }

  evaluate(rawFacts){
    const facts=normalizeFacts(rawFacts);
    const simulationMissing=missingFrom(facts,SIMULATION_REQUIRED_GATES);
    const liveMissing=missingFrom(facts,LIVE_REQUIRED_GATES);
    const simulationReady=simulationMissing.length===0;
    const liveReady=liveMissing.length===0;
    const status=liveReady
      ?READINESS_STATUS.LIVE_READY
      :simulationReady
        ?READINESS_STATUS.SIMULATION_READY
        :READINESS_STATUS.NOT_READY;

    const record=Object.freeze({
      id:++this.sequence,
      version:READINESS_GATE_VERSION,
      evaluatedAt:this.now(),
      status,
      simulationReady,
      liveReady,
      simulationMissing:Object.freeze([...simulationMissing]),
      liveMissing:Object.freeze([...liveMissing]),
      facts
    });
    this.history.push(record);
    while(this.history.length>this.limits.historyLimit)this.history.shift();

    this.emit('readiness.evaluated',{
      id:record.id,
      status:record.status,
      simulationReady,
      liveReady,
      simulationMissingCount:simulationMissing.length,
      liveMissingCount:liveMissing.length,
      humanaleFinalReady:facts['humanale.final_ready'],
      creatorFinalApproval:facts['humanale.creator_final_approval']
    });
    return record;
  }

  canSimulate(rawFacts){
    return this.evaluate(rawFacts).simulationReady;
  }

  canActivateLive(rawFacts){
    return this.evaluate(rawFacts).liveReady;
  }

  recent({limit=10}={}){
    const max=Math.max(1,Math.min(this.limits.historyLimit,Number(limit)||10));
    return Object.freeze(this.history.slice(-max).map(item=>Object.freeze({
      ...item,
      simulationMissing:Object.freeze([...item.simulationMissing]),
      liveMissing:Object.freeze([...item.liveMissing]),
      facts:Object.freeze({...item.facts})
    })));
  }

  snapshot(){
    return Object.freeze({
      version:READINESS_GATE_VERSION,
      evaluations:this.history.length,
      limits:this.limits,
      last:this.history.length?this.recent({limit:1})[0]:null
    });
  }
}

export function createIntegrationReadinessGate(options){
  return new NaraIntegrationReadinessGate(options);
}
