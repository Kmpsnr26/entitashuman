import {HUMANALE_HEALTH_STATES} from './protocol.js';

const ALLOWED_TRANSITIONS=Object.freeze({
  OFFLINE:new Set(['STARTING']),
  STARTING:new Set(['READY','DEGRADED','ERROR','OFFLINE']),
  READY:new Set(['BUSY','DEGRADED','ERROR','OFFLINE']),
  BUSY:new Set(['READY','DEGRADED','ERROR','OFFLINE']),
  DEGRADED:new Set(['RECOVERING','READY','ERROR','OFFLINE']),
  ERROR:new Set(['RECOVERING','OFFLINE']),
  RECOVERING:new Set(['READY','DEGRADED','ERROR','OFFLINE'])
});

export function isHumanALEHealthState(value){
  return HUMANALE_HEALTH_STATES.includes(value);
}

export function canTransitionHumanALEHealth(from,to){
  if(!isHumanALEHealthState(from)||!isHumanALEHealthState(to))return false;
  if(from===to)return true;
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function createHumanALEHealthTracker({
  initialState='OFFLINE',
  now=()=>Date.now(),
  historyLimit=50
}={}){
  if(!isHumanALEHealthState(initialState))throw new TypeError('Invalid initial HumanALE health state');
  if(!Number.isInteger(historyLimit)||historyLimit<1)throw new TypeError('historyLimit must be a positive integer');

  let state=initialState;
  let changedAt=now();
  const history=[Object.freeze({from:null,to:state,at:changedAt,reason:'initial'})];

  function transition(nextState,{reason='unspecified',force=false}={}){
    if(!isHumanALEHealthState(nextState))throw new TypeError('Invalid HumanALE health state: '+nextState);
    if(!force&&!canTransitionHumanALEHealth(state,nextState)){
      throw new Error('Invalid HumanALE health transition: '+state+' -> '+nextState);
    }
    const previous=state;
    state=nextState;
    changedAt=now();
    history.push(Object.freeze({from:previous,to:state,at:changedAt,reason:String(reason).slice(0,200)}));
    while(history.length>historyLimit)history.shift();
    return snapshot();
  }

  function snapshot(){
    return Object.freeze({
      state,
      changedAt,
      history:Object.freeze(history.map(entry=>Object.freeze({...entry})))
    });
  }

  return Object.freeze({
    transition,
    snapshot,
    get state(){return state;}
  });
}
