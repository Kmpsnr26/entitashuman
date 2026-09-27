import {randomUUID} from 'node:crypto';
import {
  INTEGRATION_DIRECTIONS,
  createIntegrationMessage,
  validateIntegrationMessage
} from './protocol.js';
import {createHumanALEHealthTracker,isHumanALEHealthState} from './health-state.js';

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

export function createNaraHumanALEBridge({
  transport=null,
  now=()=>Date.now(),
  idFactory=()=>randomUUID(),
  maxQueue=100,
  maxRetries=2,
  historyLimit=100
}={}){
  if(!Number.isInteger(maxQueue)||maxQueue<1)throw new TypeError('maxQueue must be a positive integer');
  if(!Number.isInteger(maxRetries)||maxRetries<0)throw new TypeError('maxRetries must be a non-negative integer');
  if(!Number.isInteger(historyLimit)||historyLimit<1)throw new TypeError('historyLimit must be a positive integer');

  let currentTransport=transport;
  const queue=[];
  const deadLetters=[];
  const outboundIds=new Set();
  const inboundIds=new Set();
  const inboundHistory=[];
  const acknowledgements=[];
  const health=createHumanALEHealthTracker({initialState:'OFFLINE',now,historyLimit});
  const counters={
    queued:0,
    delivered:0,
    retried:0,
    failed:0,
    inboundAccepted:0,
    inboundDuplicates:0,
    inboundRejected:0
  };

  function trim(list){
    while(list.length>historyLimit)list.shift();
  }

  function setTransport(nextTransport){
    if(nextTransport!==null&&typeof nextTransport?.send!=='function'){
      throw new TypeError('transport must expose async send(message) or be null');
    }
    currentTransport=nextTransport;
  }

  function enqueue(type,payload={},options={}){
    if(queue.length>=maxQueue)throw new Error('Integration outbound queue is full');
    const id=options.id||idFactory();
    if(outboundIds.has(id))throw new Error('Duplicate outbound integration id: '+id);
    const message=createIntegrationMessage({
      direction:INTEGRATION_DIRECTIONS.NARA_TO_HUMANALE,
      type,
      payload,
      id,
      timestamp:options.timestamp??now(),
      correlationId:options.correlationId,
      metadata:options.metadata
    });
    outboundIds.add(id);
    queue.push({message,attempts:0,lastError:null});
    counters.queued++;
    return message;
  }

  async function flush({limit}={}){
    const cycleLimit=limit===undefined?queue.length:Math.min(queue.length,Math.max(0,limit));
    const result={attempted:0,delivered:0,retried:0,failed:0,pending:queue.length};
    if(!currentTransport||typeof currentTransport.send!=='function')return result;

    for(let index=0;index<cycleLimit;index++){
      const item=queue.shift();
      if(!item)break;
      result.attempted++;
      item.attempts++;

      let response;
      try{
        response=await currentTransport.send(item.message);
      }catch(error){
        response={ok:false,retryable:true,error:error instanceof Error?error.message:String(error)};
      }

      const ackMatches=response?.ok===true&&response?.ackId===item.message.id;
      if(ackMatches){
        counters.delivered++;
        result.delivered++;
        acknowledgements.push({
          id:item.message.id,
          at:now(),
          attempts:item.attempts,
          status:response.status||'ACK'
        });
        trim(acknowledgements);
        continue;
      }

      const error=response?.error||(
        response?.ok===true?'ack id mismatch':'transport rejected message'
      );
      item.lastError=String(error).slice(0,300);
      const retryable=response?.retryable!==false;

      if(retryable&&item.attempts<=maxRetries){
        queue.push(item);
        counters.retried++;
        result.retried++;
      }else{
        deadLetters.push({
          message:item.message,
          attempts:item.attempts,
          error:item.lastError,
          at:now()
        });
        trim(deadLetters);
        counters.failed++;
        result.failed++;
      }
    }

    result.pending=queue.length;
    return result;
  }

  function receive(message){
    const validation=validateIntegrationMessage(message,{
      direction:INTEGRATION_DIRECTIONS.HUMANALE_TO_NARA
    });
    if(!validation.ok){
      counters.inboundRejected++;
      return {ok:false,error:'invalid_message',details:validation.errors};
    }

    if(inboundIds.has(message.id)){
      counters.inboundDuplicates++;
      return {ok:true,duplicate:true,ackId:message.id};
    }

    inboundIds.add(message.id);
    inboundHistory.push(clone(message));
    trim(inboundHistory);
    counters.inboundAccepted++;

    if(message.type==='runtime.health'&&isHumanALEHealthState(message.payload.state)){
      const next=message.payload.state;
      try{
        health.transition(next,{reason:message.payload.reason||'runtime.health'});
      }catch{
        health.transition(next,{reason:'bridge sync',force:true});
      }
    }else if(message.type==='avatar.ready'&&health.state!=='READY'){
      try{
        health.transition('READY',{reason:'avatar.ready'});
      }catch{
        health.transition('READY',{reason:'avatar.ready sync',force:true});
      }
    }

    return {ok:true,ackId:message.id};
  }

  function snapshot(){
    return Object.freeze({
      protocol:'nara-humanale-v1',
      connected:Boolean(currentTransport),
      health:health.snapshot(),
      queue:Object.freeze(queue.map(item=>Object.freeze({
        message:clone(item.message),
        attempts:item.attempts,
        lastError:item.lastError
      }))),
      deadLetters:Object.freeze(deadLetters.map(clone)),
      acknowledgements:Object.freeze(acknowledgements.map(clone)),
      inboundHistory:Object.freeze(inboundHistory.map(clone)),
      counters:Object.freeze({...counters}),
      limits:Object.freeze({maxQueue,maxRetries,historyLimit})
    });
  }

  return Object.freeze({
    enqueue,
    flush,
    receive,
    snapshot,
    setTransport,
    get health(){return health;}
  });
}
