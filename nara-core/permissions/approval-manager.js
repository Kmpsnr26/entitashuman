import {randomUUID} from 'node:crypto';
import {
  APPROVAL_MANAGER_VERSION,
  APPROVAL_STATUS,
  DEFAULT_APPROVAL_LIMITS
} from './constants.js';

const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const ALLOWED_REQUEST_KEYS=new Set([
  'id','capability','scope','requestedBy','ttlMs','singleUse','timestamp'
]);
const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

function normalizeLimits(overrides={}){
  const merged={...DEFAULT_APPROVAL_LIMITS,...overrides};
  for(const key of Object.keys(DEFAULT_APPROVAL_LIMITS)){
    if(!Number.isInteger(merged[key])||merged[key]<1)throw new TypeError(key+' must be a positive integer');
  }
  if(merged.defaultTtlMs>merged.maxTtlMs)throw new TypeError('defaultTtlMs cannot exceed maxTtlMs');
  return Object.freeze(merged);
}

function publicRequest(record){
  return Object.freeze({
    id:record.id,
    capability:record.capability,
    scope:record.scope,
    requestedBy:record.requestedBy,
    singleUse:record.singleUse,
    status:record.status,
    createdAt:record.createdAt,
    expiresAt:record.expiresAt,
    decidedAt:record.decidedAt,
    decidedBy:record.decidedBy,
    consumedAt:record.consumedAt,
    revokedAt:record.revokedAt
  });
}

export class NaraApprovalManager{
  constructor({bus=null,now=()=>Date.now(),idFactory=()=>randomUUID(),limits={}}={}){
    this.bus=bus;
    this.now=now;
    this.idFactory=idFactory;
    this.limits=normalizeLimits(limits);
    this.requests=new Map();
    this.history=[];
    this.counters={
      created:0,
      approved:0,
      denied:0,
      revoked:0,
      expired:0,
      consumed:0
    };
  }

  emit(event,payload={}){
    if(this.bus&&typeof this.bus.emit==='function'){
      this.bus.emit(event,payload,{source:'approval-manager'});
    }
  }

  normalizeRequest(raw){
    if(raw===null||typeof raw!=='object'||Array.isArray(raw)){
      throw new TypeError('Approval request must be an object.');
    }
    for(const key of Object.keys(raw)){
      if(!ALLOWED_REQUEST_KEYS.has(key))throw new TypeError('Unsupported approval request field: '+key);
    }

    const id=safeText(raw.id||this.idFactory(),120);
    const capability=safeText(raw.capability,120);
    const scope=safeText(raw.scope,120);
    const requestedBy=safeText(raw.requestedBy||'system',80);
    if(!SAFE_ID.test(id))throw new TypeError('Invalid approval request id.');
    if(!SAFE_ID.test(capability))throw new TypeError('Invalid approval capability.');
    if(!SAFE_ID.test(scope))throw new TypeError('Invalid approval scope.');
    if(!SAFE_ID.test(requestedBy))throw new TypeError('Invalid approval requester.');

    const ttlMs=raw.ttlMs===undefined?this.limits.defaultTtlMs:Number(raw.ttlMs);
    if(!Number.isInteger(ttlMs)||ttlMs<1||ttlMs>this.limits.maxTtlMs){
      throw new TypeError('Approval ttlMs is outside the allowed range.');
    }

    const timestamp=raw.timestamp===undefined?this.now():Number(raw.timestamp);
    if(!Number.isInteger(timestamp)||timestamp<0)throw new TypeError('Approval timestamp must be a non-negative integer.');

    return Object.freeze({
      id,capability,scope,requestedBy,ttlMs,
      singleUse:raw.singleUse!==false,
      timestamp
    });
  }

  addHistory(event){
    this.history.push(Object.freeze({...event}));
    while(this.history.length>this.limits.historyLimit)this.history.shift();
  }

  expireRecord(record,at){
    if(record.status!==APPROVAL_STATUS.PENDING&&record.status!==APPROVAL_STATUS.APPROVED)return false;
    if(at<record.expiresAt)return false;
    record.status=APPROVAL_STATUS.EXPIRED;
    this.counters.expired++;
    this.addHistory({id:record.id,event:'expired',timestamp:at});
    this.emit('approval.expired',{id:record.id,capability:record.capability,scope:record.scope});
    return true;
  }

  sweep({timestamp=null}={}){
    const at=timestamp===null||timestamp===undefined?this.now():Number(timestamp);
    if(!Number.isInteger(at)||at<0)throw new TypeError('Approval timestamp must be a non-negative integer.');
    const expired=[];
    for(const record of this.requests.values()){
      if(this.expireRecord(record,at))expired.push(record.id);
    }
    return Object.freeze(expired);
  }

  create(raw){
    const request=this.normalizeRequest(raw);
    this.sweep({timestamp:request.timestamp});
    if(this.requests.has(request.id))throw new Error('Approval request already exists: '+request.id);
    if(this.requests.size>=this.limits.maxRequests){
      const removable=[...this.requests.values()]
        .filter(item=>![APPROVAL_STATUS.PENDING,APPROVAL_STATUS.APPROVED].includes(item.status))
        .sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))[0];
      if(!removable)throw new Error('Approval request capacity reached.');
      this.requests.delete(removable.id);
    }

    const record={
      id:request.id,
      capability:request.capability,
      scope:request.scope,
      requestedBy:request.requestedBy,
      singleUse:request.singleUse,
      status:APPROVAL_STATUS.PENDING,
      createdAt:request.timestamp,
      expiresAt:request.timestamp+request.ttlMs,
      decidedAt:null,
      decidedBy:null,
      consumedAt:null,
      revokedAt:null
    };
    this.requests.set(record.id,record);
    this.counters.created++;
    this.addHistory({id:record.id,event:'created',timestamp:record.createdAt});
    this.emit('approval.requested',{
      id:record.id,
      capability:record.capability,
      scope:record.scope,
      requestedBy:record.requestedBy,
      singleUse:record.singleUse,
      expiresAt:record.expiresAt
    });
    return publicRequest(record);
  }

  get(id,{timestamp=null}={}){
    const record=this.requests.get(String(id||''));
    if(!record)return null;
    const at=timestamp===null||timestamp===undefined?this.now():Number(timestamp);
    this.expireRecord(record,at);
    return publicRequest(record);
  }

  decide(id,{approved,authority,timestamp=null}={}){
    const record=this.requests.get(String(id||''));
    if(!record)throw new Error('Approval request not found: '+id);
    const at=timestamp===null||timestamp===undefined?this.now():Number(timestamp);
    this.expireRecord(record,at);
    if(record.status!==APPROVAL_STATUS.PENDING)throw new Error('Approval request is not pending.');
    if(authority!=='owner')throw new Error('Only owner authority can decide approval requests.');
    if(typeof approved!=='boolean')throw new TypeError('approved must be boolean.');

    record.status=approved?APPROVAL_STATUS.APPROVED:APPROVAL_STATUS.DENIED;
    record.decidedAt=at;
    record.decidedBy='owner';
    if(approved)this.counters.approved++;else this.counters.denied++;
    this.addHistory({id:record.id,event:approved?'approved':'denied',timestamp:at});
    this.emit(approved?'approval.approved':'approval.denied',{
      id:record.id,
      capability:record.capability,
      scope:record.scope,
      decidedBy:'owner'
    });
    return publicRequest(record);
  }

  revoke(id,{authority,timestamp=null}={}){
    const record=this.requests.get(String(id||''));
    if(!record)throw new Error('Approval request not found: '+id);
    const at=timestamp===null||timestamp===undefined?this.now():Number(timestamp);
    this.expireRecord(record,at);
    if(authority!=='owner')throw new Error('Only owner authority can revoke approvals.');
    if(record.status!==APPROVAL_STATUS.APPROVED)throw new Error('Only approved requests can be revoked.');
    record.status=APPROVAL_STATUS.REVOKED;
    record.revokedAt=at;
    this.counters.revoked++;
    this.addHistory({id:record.id,event:'revoked',timestamp:at});
    this.emit('approval.revoked',{id:record.id,capability:record.capability,scope:record.scope});
    return publicRequest(record);
  }

  authorize({
    id,
    capability,
    scope,
    consume=true,
    timestamp=null
  }={}){
    const record=this.requests.get(String(id||''));
    const at=timestamp===null||timestamp===undefined?this.now():Number(timestamp);
    if(!record)return Object.freeze({allowed:false,reason:'approval_not_found'});
    this.expireRecord(record,at);
    if(record.status!==APPROVAL_STATUS.APPROVED){
      return Object.freeze({allowed:false,reason:'approval_'+record.status.toLowerCase()});
    }
    if(record.capability!==capability)return Object.freeze({allowed:false,reason:'capability_mismatch'});
    if(record.scope!==scope)return Object.freeze({allowed:false,reason:'scope_mismatch'});

    if(record.singleUse&&consume!==false){
      record.status=APPROVAL_STATUS.CONSUMED;
      record.consumedAt=at;
      this.counters.consumed++;
      this.addHistory({id:record.id,event:'consumed',timestamp:at});
      this.emit('approval.consumed',{id:record.id,capability:record.capability,scope:record.scope});
    }

    return Object.freeze({
      allowed:true,
      reason:'approved',
      id:record.id,
      capability:record.capability,
      scope:record.scope,
      singleUse:record.singleUse,
      consumed:record.status===APPROVAL_STATUS.CONSUMED,
      expiresAt:record.expiresAt
    });
  }

  recent({limit=25}={}){
    const max=Math.max(1,Math.min(this.limits.historyLimit,Number(limit)||25));
    return Object.freeze(this.history.slice(-max).map(item=>Object.freeze({...item})));
  }

  snapshot(){
    this.sweep();
    const counts={};
    for(const status of Object.values(APPROVAL_STATUS))counts[status]=0;
    for(const record of this.requests.values())counts[record.status]++;
    return Object.freeze({
      version:APPROVAL_MANAGER_VERSION,
      requests:this.requests.size,
      statusCounts:Object.freeze(counts),
      counters:Object.freeze({...this.counters}),
      limits:this.limits,
      recent:this.recent({limit:10})
    });
  }
}

export function createApprovalManager(options){
  return new NaraApprovalManager(options);
}
