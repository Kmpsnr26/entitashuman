import {randomUUID} from 'node:crypto';
import {
  MEMORY_MANAGER_VERSION,
  MEMORY_KINDS,
  MEMORY_SENSITIVITY,
  DEFAULT_MEMORY_LIMITS
} from './constants.js';

const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const SAFE_TAG=/^[a-z0-9][a-z0-9._:-]{0,47}$/i;

const safeText=(value,max=160)=>String(value??'')
  .replace(/[\r\n\t]+/g,' ')
  .trim()
  .slice(0,max);

const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));

function isPlainObject(value){
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return proto===Object.prototype||proto===null;
}

function isJsonCompatible(value,seen=new WeakSet(),depth=0){
  if(depth>16)return false;
  if(value===null)return true;
  if(typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value!=='object')return false;
  if(seen.has(value))return false;
  seen.add(value);
  if(Array.isArray(value))return value.every(item=>isJsonCompatible(item,seen,depth+1));
  if(!isPlainObject(value))return false;
  return Object.values(value).every(item=>isJsonCompatible(item,seen,depth+1));
}

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function bytesOf(value){
  return Buffer.byteLength(JSON.stringify(value),'utf8');
}

function normalizeTags(value,limits){
  if(value===undefined||value===null)return [];
  if(!Array.isArray(value))throw new TypeError('Memory tags must be an array.');
  if(value.length>limits.maxTags)throw new TypeError('Memory tag limit exceeded.');
  const tags=[];
  for(const item of value){
    const tag=safeText(item,limits.maxTagLength);
    if(!SAFE_TAG.test(tag))throw new TypeError('Invalid memory tag: '+tag);
    if(!tags.includes(tag))tags.push(tag);
  }
  return tags;
}

function normalizeLimits(overrides={}){
  const merged={...DEFAULT_MEMORY_LIMITS,...overrides};
  const integerKeys=[
    'maxEntries','maxValueBytes','maxTags','maxTagLength','maxTtlMs',
    'contextMaxEntries','contextMaxBytes','contextRecordLimit','contextRecordTtlMs'
  ];
  for(const key of integerKeys){
    if(!Number.isInteger(merged[key])||merged[key]<1){
      throw new TypeError(key+' must be a positive integer');
    }
  }
  return Object.freeze(merged);
}

function publicEntry(entry){
  return Object.freeze({
    id:entry.id,
    kind:entry.kind,
    source:entry.source,
    sensitivity:entry.sensitivity,
    priority:entry.priority,
    pinned:entry.pinned,
    tags:Object.freeze([...entry.tags]),
    createdAt:entry.createdAt,
    updatedAt:entry.updatedAt,
    expiresAt:entry.expiresAt,
    sizeBytes:entry.sizeBytes,
    value:clone(entry.value)
  });
}

export class NaraMemoryManager{
  constructor({
    bus=null,
    now=()=>Date.now(),
    idFactory=()=>randomUUID(),
    limits={}
  }={}){
    this.bus=bus;
    this.now=now;
    this.idFactory=idFactory;
    this.limits=normalizeLimits(limits);
    this.entries=new Map();
    this.contextRecords=new Map();
    this.counters={
      writes:0,
      reads:0,
      deletes:0,
      expired:0,
      evicted:0,
      contextPrepared:0,
      contextUsed:0,
      contextSensitiveBlocked:0
    };
  }

  emit(event,payload={}){
    if(this.bus&&typeof this.bus.emit==='function'){
      this.bus.emit(event,payload,{source:'memory-manager'});
    }
  }

  purgeExpired(){
    const now=this.now();
    let expired=0;
    for(const [id,entry] of this.entries){
      if(entry.expiresAt!==null&&entry.expiresAt<=now){
        this.entries.delete(id);
        expired++;
        this.counters.expired++;
        this.emit('memory.expired',{
          id,
          kind:entry.kind,
          sensitivity:entry.sensitivity,
          sizeBytes:entry.sizeBytes
        });
      }
    }
    for(const [id,record] of this.contextRecords){
      if(record.expiresAt<=now)this.contextRecords.delete(id);
    }
    return expired;
  }

  normalizeInput(input){
    if(input===null||typeof input!=='object'||Array.isArray(input)){
      throw new TypeError('Memory input must be an object.');
    }
    const id=safeText(input.id||this.idFactory(),120);
    if(!SAFE_ID.test(id))throw new TypeError('Invalid memory id.');

    const kind=safeText(input.kind||'working',32).toLowerCase();
    if(!MEMORY_KINDS.includes(kind))throw new TypeError('Invalid memory kind: '+kind);

    const sensitivity=safeText(input.sensitivity||'normal',32).toLowerCase();
    if(sensitivity==='secret'){
      throw new Error('Secret material is not accepted by NARA working memory.');
    }
    if(!MEMORY_SENSITIVITY.includes(sensitivity)){
      throw new TypeError('Invalid memory sensitivity: '+sensitivity);
    }

    if(!isJsonCompatible(input.value)){
      throw new TypeError('Memory value must be finite JSON-compatible data.');
    }
    const value=clone(input.value);
    const sizeBytes=bytesOf(value);
    if(sizeBytes>this.limits.maxValueBytes){
      throw new Error('Memory value exceeds maxValueBytes.');
    }

    let ttlMs=null;
    if(input.ttlMs!==undefined&&input.ttlMs!==null){
      ttlMs=Number(input.ttlMs);
      if(!Number.isInteger(ttlMs)||ttlMs<1||ttlMs>this.limits.maxTtlMs){
        throw new TypeError('Memory ttlMs is outside the allowed range.');
      }
    }

    return {
      id,
      kind,
      source:safeText(input.source||'nara',80),
      sensitivity,
      priority:clamp01(input.priority??.5),
      pinned:Boolean(input.pinned),
      tags:normalizeTags(input.tags,this.limits),
      ttlMs,
      value,
      sizeBytes
    };
  }

  chooseEvictionCandidate(){
    const candidates=[...this.entries.values()].filter(entry=>!entry.pinned);
    if(!candidates.length)return null;
    candidates.sort((a,b)=>
      a.priority-b.priority||
      a.updatedAt-b.updatedAt||
      a.createdAt-b.createdAt||
      a.id.localeCompare(b.id)
    );
    return candidates[0];
  }

  ensureCapacityFor(id){
    if(this.entries.has(id)||this.entries.size<this.limits.maxEntries)return;
    const candidate=this.chooseEvictionCandidate();
    if(!candidate)throw new Error('Memory capacity reached and all entries are pinned.');
    this.entries.delete(candidate.id);
    this.counters.evicted++;
    this.emit('memory.evicted',{
      id:candidate.id,
      kind:candidate.kind,
      sensitivity:candidate.sensitivity,
      sizeBytes:candidate.sizeBytes
    });
  }

  write(input){
    this.purgeExpired();
    const normalized=this.normalizeInput(input);
    this.ensureCapacityFor(normalized.id);
    const now=this.now();
    const previous=this.entries.get(normalized.id);
    const entry={
      id:normalized.id,
      kind:normalized.kind,
      source:normalized.source,
      sensitivity:normalized.sensitivity,
      priority:normalized.priority,
      pinned:normalized.pinned,
      tags:[...normalized.tags],
      createdAt:previous?.createdAt??now,
      updatedAt:now,
      expiresAt:normalized.ttlMs===null?null:now+normalized.ttlMs,
      sizeBytes:normalized.sizeBytes,
      value:normalized.value
    };
    this.entries.set(entry.id,entry);
    this.counters.writes++;
    this.emit('memory.write',{
      id:entry.id,
      kind:entry.kind,
      sensitivity:entry.sensitivity,
      priority:entry.priority,
      pinned:entry.pinned,
      tagCount:entry.tags.length,
      sizeBytes:entry.sizeBytes,
      operation:previous?'update':'create'
    });
    this.emit('memory.complete',{id:entry.id,operation:previous?'update':'create'});
    return publicEntry(entry);
  }

  read(id){
    this.purgeExpired();
    const key=safeText(id,120);
    const entry=this.entries.get(key);
    if(!entry)return null;
    this.counters.reads++;
    this.emit('memory.read',{
      id:entry.id,
      kind:entry.kind,
      sensitivity:entry.sensitivity,
      sizeBytes:entry.sizeBytes
    });
    return publicEntry(entry);
  }

  delete(id,{reason='explicit'}={}){
    this.purgeExpired();
    const key=safeText(id,120);
    const entry=this.entries.get(key);
    if(!entry)return false;
    this.entries.delete(key);
    this.counters.deletes++;
    this.emit('memory.deleted',{
      id:key,
      kind:entry.kind,
      sensitivity:entry.sensitivity,
      reason:safeText(reason,80)
    });
    return true;
  }

  clear({includePinned=false}={}){
    this.purgeExpired();
    let removed=0;
    for(const [id,entry] of [...this.entries]){
      if(entry.pinned&&!includePinned)continue;
      this.entries.delete(id);
      removed++;
      this.counters.deletes++;
    }
    this.emit('memory.cleared',{removed,includePinned:Boolean(includePinned)});
    return removed;
  }

  listMetadata(){
    this.purgeExpired();
    return Object.freeze([...this.entries.values()]
      .sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id))
      .map(entry=>Object.freeze({
        id:entry.id,
        kind:entry.kind,
        source:entry.source,
        sensitivity:entry.sensitivity,
        priority:entry.priority,
        pinned:entry.pinned,
        tags:Object.freeze([...entry.tags]),
        createdAt:entry.createdAt,
        updatedAt:entry.updatedAt,
        expiresAt:entry.expiresAt,
        sizeBytes:entry.sizeBytes
      })));
  }

  prepareContext({
    tags=[],
    kinds=[],
    target='reasoner',
    includeSensitive=false,
    limit=this.limits.contextMaxEntries,
    maxBytes=this.limits.contextMaxBytes
  }={}){
    this.purgeExpired();
    const requestedTags=normalizeTags(tags,this.limits);
    const requestedKinds=kinds.length?[...new Set(kinds.map(kind=>safeText(kind,32).toLowerCase()))]:[];
    for(const kind of requestedKinds){
      if(!MEMORY_KINDS.includes(kind))throw new TypeError('Invalid context memory kind: '+kind);
    }
    const safeTarget=safeText(target,80)||'reasoner';
    const itemLimit=Math.max(1,Math.min(this.limits.contextMaxEntries,Number(limit)||this.limits.contextMaxEntries));
    const byteLimit=Math.max(1,Math.min(this.limits.contextMaxBytes,Number(maxBytes)||this.limits.contextMaxBytes));

    this.emit('context.prepare',{
      target:safeTarget,
      requestedTagCount:requestedTags.length,
      includeSensitive:Boolean(includeSensitive),
      itemLimit,
      byteLimit
    });

    let sensitiveBlocked=0;
    const candidates=[];
    for(const entry of this.entries.values()){
      if(requestedKinds.length&&!requestedKinds.includes(entry.kind))continue;
      const tagMatches=requestedTags.reduce((count,tag)=>count+(entry.tags.includes(tag)?1:0),0);
      if(requestedTags.length&&tagMatches===0)continue;
      if(entry.sensitivity==='sensitive'&&!includeSensitive){
        sensitiveBlocked++;
        continue;
      }
      candidates.push({entry,tagMatches});
    }

    candidates.sort((a,b)=>
      Number(b.entry.pinned)-Number(a.entry.pinned)||
      b.tagMatches-a.tagMatches||
      b.entry.priority-a.entry.priority||
      b.entry.updatedAt-a.entry.updatedAt||
      a.entry.id.localeCompare(b.entry.id)
    );

    const items=[];
    let totalBytes=0;
    for(const {entry} of candidates){
      if(items.length>=itemLimit)break;
      if(totalBytes+entry.sizeBytes>byteLimit)continue;
      items.push(publicEntry(entry));
      totalBytes+=entry.sizeBytes;
    }

    if(sensitiveBlocked){
      this.counters.contextSensitiveBlocked+=sensitiveBlocked;
      this.emit('context.blocked',{
        target:safeTarget,
        reason:'sensitive_memory_requires_explicit_permission',
        blockedCount:sensitiveBlocked
      });
    }

    const contextId='ctx-'+safeText(this.idFactory(),110);
    const createdAt=this.now();
    const record={
      id:contextId,
      target:safeTarget,
      itemIds:items.map(item=>item.id),
      itemCount:items.length,
      totalBytes,
      sensitiveBlocked,
      createdAt,
      expiresAt:createdAt+this.limits.contextRecordTtlMs,
      usedAt:null
    };
    this.contextRecords.set(contextId,record);
    while(this.contextRecords.size>this.limits.contextRecordLimit){
      const oldest=[...this.contextRecords.values()]
        .sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))[0];
      if(!oldest)break;
      this.contextRecords.delete(oldest.id);
    }

    this.counters.contextPrepared++;
    this.emit('context.approved',{
      contextId,
      target:safeTarget,
      itemCount:items.length,
      totalBytes,
      sensitiveBlocked
    });

    return Object.freeze({
      id:contextId,
      target:safeTarget,
      createdAt,
      totalBytes,
      sensitiveBlocked,
      items:Object.freeze(items)
    });
  }

  useContext(contextId){
    this.purgeExpired();
    const key=safeText(contextId,120);
    const record=this.contextRecords.get(key);
    if(!record)return null;
    record.usedAt=this.now();
    this.counters.contextUsed++;
    this.emit('context.used',{
      contextId:key,
      target:record.target,
      itemCount:record.itemCount,
      totalBytes:record.totalBytes
    });
    return Object.freeze({
      id:record.id,
      target:record.target,
      itemCount:record.itemCount,
      totalBytes:record.totalBytes,
      createdAt:record.createdAt,
      usedAt:record.usedAt
    });
  }

  snapshot(){
    this.purgeExpired();
    const entries=[...this.entries.values()];
    return Object.freeze({
      version:MEMORY_MANAGER_VERSION,
      count:entries.length,
      pinned:entries.filter(entry=>entry.pinned).length,
      sensitive:entries.filter(entry=>entry.sensitivity==='sensitive').length,
      bytes:entries.reduce((sum,entry)=>sum+entry.sizeBytes,0),
      activeContexts:this.contextRecords.size,
      counters:Object.freeze({...this.counters}),
      limits:this.limits
    });
  }
}

export function createMemoryManager(options){
  return new NaraMemoryManager(options);
}
