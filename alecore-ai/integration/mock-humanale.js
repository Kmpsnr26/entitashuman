import {
  INTEGRATION_DIRECTIONS,
  createIntegrationMessage,
  validateIntegrationMessage
} from './protocol.js';
import {isHumanALEHealthState} from './health-state.js';

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

export function createMockHumanALE({
  online=true,
  health='READY',
  failuresBeforeAck=0,
  now=()=>Date.now()
}={}){
  if(!isHumanALEHealthState(health))throw new TypeError('Invalid mock HumanALE health state');
  if(!Number.isInteger(failuresBeforeAck)||failuresBeforeAck<0){
    throw new TypeError('failuresBeforeAck must be a non-negative integer');
  }

  let isOnline=Boolean(online);
  let healthState=health;
  let remainingFailures=failuresBeforeAck;
  let inboundSequence=0;
  const received=[];
  const receivedIds=new Set();

  async function send(message){
    const validation=validateIntegrationMessage(message,{
      direction:INTEGRATION_DIRECTIONS.ALECORE_AI_TO_HUMANALE
    });
    if(!validation.ok)return {ok:false,retryable:false,error:validation.errors.join('; ')};
    if(!isOnline)return {ok:false,retryable:true,error:'mock HumanALE offline'};
    if(remainingFailures>0){
      remainingFailures--;
      return {ok:false,retryable:true,error:'simulated transient transport failure'};
    }

    if(!receivedIds.has(message.id)){
      receivedIds.add(message.id);
      received.push(clone(message));
    }

    return {
      ok:true,
      ackId:message.id,
      status:'ACK',
      health:healthState
    };
  }

  function emit(type,payload={},options={}){
    inboundSequence++;
    return createIntegrationMessage({
      direction:INTEGRATION_DIRECTIONS.HUMANALE_TO_NARA,
      type,
      payload,
      id:options.id||'mock-humanale-'+inboundSequence,
      timestamp:options.timestamp??now(),
      correlationId:options.correlationId,
      metadata:options.metadata
    });
  }

  function setOnline(value){isOnline=Boolean(value);}
  function setHealth(value){
    if(!isHumanALEHealthState(value))throw new TypeError('Invalid mock HumanALE health state');
    healthState=value;
  }

  function snapshot(){
    return Object.freeze({
      online:isOnline,
      health:healthState,
      remainingFailures,
      received:Object.freeze(received.map(clone))
    });
  }

  return Object.freeze({
    send,
    emit,
    setOnline,
    setHealth,
    snapshot
  });
}
