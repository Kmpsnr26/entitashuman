import {
  SUPERVISOR_VERSION,
  SUPERVISOR_STATUS,
  CIRCUIT_STATE,
  RECOVERY_RECOMMENDATION,
  DEFAULT_SUPERVISOR_LIMITS
} from './constants.js';

const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

function normalizeLimits(overrides={}){
  const merged={...DEFAULT_SUPERVISOR_LIMITS,...overrides};
  for(const key of Object.keys(DEFAULT_SUPERVISOR_LIMITS)){
    if(!Number.isInteger(merged[key])||merged[key]<1)throw new TypeError(key+' must be a positive integer');
  }
  return Object.freeze(merged);
}

function normalizePositiveInt(value,fallback,name){
  if(value===undefined||value===null)return fallback;
  const number=Number(value);
  if(!Number.isInteger(number)||number<1)throw new TypeError(name+' must be a positive integer');
  return number;
}

function publicComponent(component){
  return Object.freeze({
    id:component.id,
    critical:component.critical,
    allowDegraded:component.allowDegraded,
    status:component.status,
    circuit:component.circuit,
    lastSeenAt:component.lastSeenAt,
    lastStatusAt:component.lastStatusAt,
    lastLatencyMs:component.lastLatencyMs,
    lastErrorCode:component.lastErrorCode,
    openedAt:component.openedAt,
    cooldownUntil:component.cooldownUntil,
    heartbeatTimeoutMs:component.heartbeatTimeoutMs,
    errorWindowMs:component.errorWindowMs,
    errorThreshold:component.errorThreshold,
    cooldownMs:component.cooldownMs,
    incidents:component.incidents.length,
    probeStartedAt:component.probeStartedAt
  });
}

export class AleSupervisor{
  constructor({bus=null,now=()=>Date.now(),limits={}}={}){
    this.bus=bus;
    this.now=now;
    this.limits=normalizeLimits(limits);
    this.components=new Map();
    this.incidents=[];
    this.counters={
      reports:0,
      incidents:0,
      circuitsOpened:0,
      probesStarted:0,
      probesPassed:0,
      probesFailed:0,
      staleTransitions:0
    };
  }

  emit(event,payload={}){
    if(this.bus&&typeof this.bus.emit==='function'){
      this.bus.emit(event,payload,{source:'supervisor'});
    }
  }

  register({
    id,
    critical=false,
    allowDegraded=false,
    heartbeatTimeoutMs,
    errorWindowMs,
    errorThreshold,
    cooldownMs
  }={}){
    const componentId=safeText(id,120);
    if(!SAFE_ID.test(componentId))throw new TypeError('Invalid supervisor component id.');
    if(this.components.has(componentId))throw new Error('Component already registered: '+componentId);
    if(this.components.size>=this.limits.maxComponents)throw new Error('Supervisor component capacity reached.');

    const component={
      id:componentId,
      critical:Boolean(critical),
      allowDegraded:Boolean(allowDegraded),
      heartbeatTimeoutMs:normalizePositiveInt(heartbeatTimeoutMs,this.limits.defaultHeartbeatTimeoutMs,'heartbeatTimeoutMs'),
      errorWindowMs:normalizePositiveInt(errorWindowMs,this.limits.defaultErrorWindowMs,'errorWindowMs'),
      errorThreshold:normalizePositiveInt(errorThreshold,this.limits.defaultErrorThreshold,'errorThreshold'),
      cooldownMs:normalizePositiveInt(cooldownMs,this.limits.defaultCooldownMs,'cooldownMs'),
      status:'offline',
      circuit:CIRCUIT_STATE.CLOSED,
      lastSeenAt:null,
      lastStatusAt:null,
      lastLatencyMs:null,
      lastErrorCode:null,
      openedAt:null,
      cooldownUntil:null,
      probeStartedAt:null,
      incidents:[],
      reports:[]
    };
    this.components.set(componentId,component);
    return publicComponent(component);
  }

  get(id){
    const component=this.components.get(String(id||''));
    return component?publicComponent(component):null;
  }

  list(){
    return Object.freeze([...this.components.keys()].sort().map(id=>this.get(id)));
  }

  addIncident(component,{status,errorCode,timestamp}){
    const incident=Object.freeze({
      componentId:component.id,
      status,
      errorCode:errorCode||null,
      timestamp
    });
    component.incidents.push(incident);
    while(component.incidents.length>this.limits.componentHistoryLimit)component.incidents.shift();
    this.incidents.push(incident);
    while(this.incidents.length>this.limits.incidentHistoryLimit)this.incidents.shift();
    this.counters.incidents++;
    this.emit('supervisor.incident',{
      componentId:component.id,
      status,
      errorCode:errorCode||null,
      circuit:component.circuit
    });
  }

  recentErrorCount(component,at){
    const cutoff=at-component.errorWindowMs;
    return component.incidents.filter(item=>
      item.timestamp>=cutoff&&['error','offline','stale'].includes(item.status)
    ).length;
  }

  openCircuit(component,{at,reason}){
    if(component.circuit!==CIRCUIT_STATE.OPEN)this.counters.circuitsOpened++;
    component.circuit=CIRCUIT_STATE.OPEN;
    component.openedAt=at;
    component.cooldownUntil=at+component.cooldownMs;
    component.probeStartedAt=null;
    this.emit('supervisor.circuit.open',{
      componentId:component.id,
      reason,
      cooldownUntil:component.cooldownUntil
    });
  }

  report({componentId,status,latencyMs=null,errorCode=null,timestamp=null}={}){
    const component=this.components.get(String(componentId||''));
    if(!component)throw new Error('Supervisor component not registered: '+componentId);

    const normalizedStatus=safeText(status,32).toLowerCase();
    if(!SUPERVISOR_STATUS.includes(normalizedStatus))throw new TypeError('Invalid supervisor status: '+normalizedStatus);

    let latency=null;
    if(latencyMs!==null&&latencyMs!==undefined){
      latency=Number(latencyMs);
      if(!Number.isFinite(latency)||latency<0||latency>this.limits.maxLatencyMs){
        throw new TypeError('Supervisor latencyMs is outside the allowed range.');
      }
      latency=Math.round(latency);
    }

    let code=null;
    if(errorCode!==null&&errorCode!==undefined){
      code=safeText(errorCode,120);
      if(!SAFE_ID.test(code))throw new TypeError('Invalid supervisor error code.');
    }

    const at=timestamp===null||timestamp===undefined?this.now():Number(timestamp);
    if(!Number.isInteger(at)||at<0)throw new TypeError('Supervisor timestamp must be a non-negative integer.');

    this.counters.reports++;
    component.status=normalizedStatus;
    component.lastSeenAt=at;
    component.lastStatusAt=at;
    component.lastLatencyMs=latency;
    component.lastErrorCode=code;
    component.reports.push(Object.freeze({status:normalizedStatus,latencyMs:latency,errorCode:code,timestamp:at}));
    while(component.reports.length>this.limits.componentHistoryLimit)component.reports.shift();

    if(['error','offline','stale'].includes(normalizedStatus)){
      this.addIncident(component,{status:normalizedStatus,errorCode:code,timestamp:at});
      if(this.recentErrorCount(component,at)>=component.errorThreshold){
        this.openCircuit(component,{at,reason:'error_threshold'});
      }
    }

    this.emit('supervisor.health',{
      componentId:component.id,
      status:component.status,
      latencyMs:component.lastLatencyMs,
      errorCode:component.lastErrorCode,
      circuit:component.circuit
    });
    return publicComponent(component);
  }

  sweep({timestamp=null}={}){
    const at=timestamp===null||timestamp===undefined?this.now():Number(timestamp);
    if(!Number.isInteger(at)||at<0)throw new TypeError('Supervisor timestamp must be a non-negative integer.');
    const changed=[];
    for(const component of this.components.values()){
      if(component.lastSeenAt===null)continue;
      if(at-component.lastSeenAt<=component.heartbeatTimeoutMs)continue;
      if(component.status==='stale')continue;
      component.status='stale';
      component.lastStatusAt=at;
      component.lastErrorCode='heartbeat_timeout';
      this.counters.staleTransitions++;
      this.addIncident(component,{status:'stale',errorCode:'heartbeat_timeout',timestamp:at});
      if(this.recentErrorCount(component,at)>=component.errorThreshold){
        this.openCircuit(component,{at,reason:'heartbeat_timeout'});
      }
      changed.push(component.id);
    }
    return Object.freeze(changed);
  }

  canRun(componentId,{timestamp=null}={}){
    const component=this.components.get(String(componentId||''));
    if(!component)return Object.freeze({allowed:false,reason:'component_not_registered'});
    const at=timestamp===null||timestamp===undefined?this.now():Number(timestamp);

    if(component.circuit===CIRCUIT_STATE.OPEN){
      return Object.freeze({
        allowed:false,
        reason:at>=component.cooldownUntil?'probe_required':'circuit_open',
        retryAt:component.cooldownUntil
      });
    }
    if(component.circuit===CIRCUIT_STATE.HALF_OPEN){
      return Object.freeze({allowed:false,reason:'probe_in_progress'});
    }
    if(component.status==='healthy'){
      return Object.freeze({allowed:true,reason:'healthy'});
    }
    if(component.status==='degraded'&&component.allowDegraded){
      return Object.freeze({allowed:true,reason:'degraded_allowed'});
    }
    return Object.freeze({allowed:false,reason:'status_'+component.status});
  }

  beginProbe(componentId,{timestamp=null}={}){
    const component=this.components.get(String(componentId||''));
    if(!component)throw new Error('Supervisor component not registered: '+componentId);
    const at=timestamp===null||timestamp===undefined?this.now():Number(timestamp);
    if(component.circuit!==CIRCUIT_STATE.OPEN)throw new Error('Probe requires OPEN circuit.');
    if(at<component.cooldownUntil)throw new Error('Circuit cooldown has not elapsed.');
    component.circuit=CIRCUIT_STATE.HALF_OPEN;
    component.probeStartedAt=at;
    this.counters.probesStarted++;
    this.emit('supervisor.probe.start',{componentId:component.id});
    return publicComponent(component);
  }

  completeProbe(componentId,{ok,status='healthy',timestamp=null,errorCode=null}={}){
    const component=this.components.get(String(componentId||''));
    if(!component)throw new Error('Supervisor component not registered: '+componentId);
    if(component.circuit!==CIRCUIT_STATE.HALF_OPEN)throw new Error('No active supervisor probe.');

    const at=timestamp===null||timestamp===undefined?this.now():Number(timestamp);
    if(ok===true){
      component.circuit=CIRCUIT_STATE.CLOSED;
      component.status=SUPERVISOR_STATUS.includes(status)?status:'healthy';
      component.lastSeenAt=at;
      component.lastStatusAt=at;
      component.lastErrorCode=null;
      component.openedAt=null;
      component.cooldownUntil=null;
      component.probeStartedAt=null;
      this.counters.probesPassed++;
      this.emit('supervisor.probe.complete',{componentId:component.id,ok:true,status:component.status});
    }else{
      const code=errorCode===null?null:safeText(errorCode,120);
      if(code!==null&&!SAFE_ID.test(code))throw new TypeError('Invalid supervisor error code.');
      component.status='error';
      component.lastSeenAt=at;
      component.lastStatusAt=at;
      component.lastErrorCode=code||'probe_failed';
      this.counters.probesFailed++;
      this.addIncident(component,{status:'error',errorCode:component.lastErrorCode,timestamp:at});
      this.openCircuit(component,{at,reason:'probe_failed'});
      this.emit('supervisor.probe.complete',{componentId:component.id,ok:false,status:'error'});
    }
    return publicComponent(component);
  }

  recommend(componentId,{timestamp=null}={}){
    const component=this.components.get(String(componentId||''));
    if(!component)throw new Error('Supervisor component not registered: '+componentId);
    const at=timestamp===null||timestamp===undefined?this.now():Number(timestamp);

    let type=RECOVERY_RECOMMENDATION.NONE;
    if(component.circuit===CIRCUIT_STATE.OPEN){
      type=at>=component.cooldownUntil
        ?RECOVERY_RECOMMENDATION.RUN_HEALTH_PROBE
        :RECOVERY_RECOMMENDATION.WAIT_COOLDOWN;
    }else if(component.circuit===CIRCUIT_STATE.HALF_OPEN){
      type=RECOVERY_RECOMMENDATION.RUN_HEALTH_PROBE;
    }else if(component.status==='degraded'){
      type=RECOVERY_RECOMMENDATION.CHECK_DEPENDENCY;
    }else if(['error','offline','stale'].includes(component.status)){
      type=RECOVERY_RECOMMENDATION.REVIEW_COMPONENT;
    }

    return Object.freeze({
      componentId:component.id,
      type,
      status:'review_required',
      requiresApproval:true,
      autoExecute:false,
      circuit:component.circuit,
      healthStatus:component.status,
      retryAt:component.cooldownUntil
    });
  }

  recentIncidents({limit=25,componentId=null}={}){
    const max=Math.max(1,Math.min(this.limits.incidentHistoryLimit,Number(limit)||25));
    const source=componentId?this.incidents.filter(item=>item.componentId===componentId):this.incidents;
    return Object.freeze(source.slice(-max).map(item=>Object.freeze({...item})));
  }

  snapshot(){
    return Object.freeze({
      version:SUPERVISOR_VERSION,
      components:Object.freeze(this.list()),
      counters:Object.freeze({...this.counters}),
      limits:this.limits,
      recentIncidents:this.recentIncidents({limit:10})
    });
  }
}

export function createSupervisor(options){
  return new AleSupervisor(options);
}
