export const INTEGRATION_PROTOCOL_VERSION='1.0.0';

export const INTEGRATION_DIRECTIONS=Object.freeze({
  NARA_TO_HUMANALE:'NARA_TO_HUMANALE',
  HUMANALE_TO_NARA:'HUMANALE_TO_NARA'
});

export const INTEGRATION_ENDPOINTS=Object.freeze({
  NARA_CORE:'NARA_CORE',
  HUMANALE:'HUMANALE'
});

export const NARA_TO_HUMANALE_TYPES=Object.freeze([
  'avatar.expression',
  'avatar.motion',
  'speech.start',
  'speech.stop',
  'system.state',
  'system.ping'
]);

export const HUMANALE_TO_NARA_TYPES=Object.freeze([
  'avatar.ready',
  'avatar.state',
  'user.interaction',
  'runtime.health',
  'runtime.error',
  'system.pong'
]);

export const HUMANALE_HEALTH_STATES=Object.freeze([
  'OFFLINE',
  'STARTING',
  'READY',
  'BUSY',
  'DEGRADED',
  'ERROR',
  'RECOVERING'
]);

const TYPE_SETS=Object.freeze({
  [INTEGRATION_DIRECTIONS.NARA_TO_HUMANALE]:new Set(NARA_TO_HUMANALE_TYPES),
  [INTEGRATION_DIRECTIONS.HUMANALE_TO_NARA]:new Set(HUMANALE_TO_NARA_TYPES)
});

const ENDPOINTS=Object.freeze({
  [INTEGRATION_DIRECTIONS.NARA_TO_HUMANALE]:{
    source:INTEGRATION_ENDPOINTS.NARA_CORE,
    target:INTEGRATION_ENDPOINTS.HUMANALE
  },
  [INTEGRATION_DIRECTIONS.HUMANALE_TO_NARA]:{
    source:INTEGRATION_ENDPOINTS.HUMANALE,
    target:INTEGRATION_ENDPOINTS.NARA_CORE
  }
});

function isPlainObject(value){
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return proto===Object.prototype||proto===null;
}

function isJsonCompatible(value,seen=new WeakSet(),depth=0){
  if(depth>12)return false;
  if(value===null)return true;
  if(typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value!=='object')return false;
  if(seen.has(value))return false;
  seen.add(value);
  if(Array.isArray(value))return value.every(item=>isJsonCompatible(item,seen,depth+1));
  if(!isPlainObject(value))return false;
  return Object.entries(value).every(([key,item])=>
    typeof key==='string'&&isJsonCompatible(item,seen,depth+1)
  );
}

function validateText(value,{name,max=128,required=true},errors){
  if(value===undefined||value===null){
    if(required)errors.push(name+' is required');
    return;
  }
  if(typeof value!=='string'||value.trim()===''||value.length>max){
    errors.push(name+' must be a non-empty string <= '+max+' characters');
  }
}

export function expectedEndpoints(direction){
  return ENDPOINTS[direction]||null;
}

export function allowedMessageTypes(direction){
  return TYPE_SETS[direction]?[...TYPE_SETS[direction]]:[];
}

export function validateIntegrationMessage(message,{direction}={}){
  const errors=[];
  if(!isPlainObject(message)){
    return {ok:false,errors:['message must be a plain object']};
  }

  if(message.version!==INTEGRATION_PROTOCOL_VERSION){
    errors.push('version must be '+INTEGRATION_PROTOCOL_VERSION);
  }
  validateText(message.id,{name:'id'},errors);
  if(!Number.isInteger(message.timestamp)||message.timestamp<0){
    errors.push('timestamp must be a non-negative integer');
  }

  const inferredDirection=direction||
    (message.source===INTEGRATION_ENDPOINTS.NARA_CORE&&message.target===INTEGRATION_ENDPOINTS.HUMANALE
      ?INTEGRATION_DIRECTIONS.NARA_TO_HUMANALE
      :message.source===INTEGRATION_ENDPOINTS.HUMANALE&&message.target===INTEGRATION_ENDPOINTS.NARA_CORE
        ?INTEGRATION_DIRECTIONS.HUMANALE_TO_NARA
        :null);

  if(!inferredDirection||!ENDPOINTS[inferredDirection]){
    errors.push('direction cannot be inferred or is unsupported');
  }else{
    const expected=ENDPOINTS[inferredDirection];
    if(message.source!==expected.source)errors.push('source must be '+expected.source);
    if(message.target!==expected.target)errors.push('target must be '+expected.target);
    if(!TYPE_SETS[inferredDirection].has(message.type)){
      errors.push('type is not allowlisted for '+inferredDirection);
    }
  }

  validateText(message.type,{name:'type'},errors);
  if(!isPlainObject(message.payload))errors.push('payload must be a plain object');
  else if(!isJsonCompatible(message.payload))errors.push('payload must be finite JSON-compatible data');

  if(message.correlationId!==undefined){
    validateText(message.correlationId,{name:'correlationId'},errors);
  }
  if(message.metadata!==undefined){
    if(!isPlainObject(message.metadata)||!isJsonCompatible(message.metadata)){
      errors.push('metadata must be a JSON-compatible plain object');
    }
  }

  return {ok:errors.length===0,errors,direction:inferredDirection};
}

export function createIntegrationMessage({
  direction,
  type,
  payload={},
  id,
  timestamp=Date.now(),
  correlationId,
  metadata
}){
  if(!ENDPOINTS[direction])throw new TypeError('Unsupported integration direction');
  const endpoints=ENDPOINTS[direction];
  const message={
    version:INTEGRATION_PROTOCOL_VERSION,
    id,
    timestamp,
    source:endpoints.source,
    target:endpoints.target,
    type,
    payload
  };
  if(correlationId!==undefined)message.correlationId=correlationId;
  if(metadata!==undefined)message.metadata=metadata;
  const validation=validateIntegrationMessage(message,{direction});
  if(!validation.ok)throw new TypeError('Invalid integration message: '+validation.errors.join('; '));
  return Object.freeze({...message});
}
