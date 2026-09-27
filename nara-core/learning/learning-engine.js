import {randomUUID} from 'node:crypto';
import {
  LEARNING_ENGINE_VERSION,
  LEARNING_SIGNAL_KINDS,
  LEARNING_OUTCOMES,
  LEARNING_FEEDBACK,
  LEARNING_AUTHORITIES,
  LEARNING_PROPOSAL_TYPES,
  DEFAULT_LEARNING_LIMITS
} from './constants.js';

const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const SAFE_TAG=/^[a-z0-9][a-z0-9._:-]{0,47}$/i;
const ALLOWED_SIGNAL_KEYS=new Set([
  'id','kind','skillId','outcome','latencyMs','feedback',
  'authority','timestamp','weight','tags'
]);

const safeText=(value,max=160)=>String(value??'')
  .replace(/[\r\n\t]+/g,' ')
  .trim()
  .slice(0,max);

const round4=value=>Math.round((Number(value)||0)*10000)/10000;

function normalizeLimits(overrides={}){
  const merged={...DEFAULT_LEARNING_LIMITS,...overrides};
  const integerKeys=[
    'maxSkills','maxSignalsPerSkill','maxGlobalSignals','maxLatencyMs',
    'maxTags','maxTagLength','minSamplesForProposal','proposalHistoryLimit'
  ];
  for(const key of integerKeys){
    if(!Number.isInteger(merged[key])||merged[key]<1){
      throw new TypeError(key+' must be a positive integer');
    }
  }
  const rateKeys=[
    'failureRateThreshold','timeoutRateThreshold','negativeFeedbackThreshold'
  ];
  for(const key of rateKeys){
    if(typeof merged[key]!=='number'||!Number.isFinite(merged[key])||merged[key]<0||merged[key]>1){
      throw new TypeError(key+' must be between 0 and 1');
    }
  }
  return Object.freeze(merged);
}

function normalizeTags(tags,limits){
  if(tags===undefined||tags===null)return [];
  if(!Array.isArray(tags))throw new TypeError('Learning tags must be an array.');
  if(tags.length>limits.maxTags)throw new TypeError('Learning tag limit exceeded.');
  const result=[];
  for(const raw of tags){
    const tag=safeText(raw,limits.maxTagLength);
    if(!SAFE_TAG.test(tag))throw new TypeError('Invalid learning tag: '+tag);
    if(!result.includes(tag))result.push(tag);
  }
  return result;
}

function percentile(values,p){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const index=Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1));
  return sorted[index];
}

function emptyCounters(){
  return {
    success:0,
    failure:0,
    timeout:0,
    blocked:0,
    deferred:0,
    neutral:0,
    positiveFeedback:0,
    negativeFeedback:0,
    neutralFeedback:0
  };
}

function cloneSignal(signal){
  return Object.freeze({
    id:signal.id,
    kind:signal.kind,
    skillId:signal.skillId,
    outcome:signal.outcome,
    latencyMs:signal.latencyMs,
    feedback:signal.feedback,
    authority:signal.authority,
    timestamp:signal.timestamp,
    weight:signal.weight,
    tags:Object.freeze([...signal.tags])
  });
}

export class NaraLearningEngine{
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
    this.skills=new Map();
    this.globalSignals=[];
    this.proposals=[];
    this.seenSignalIds=new Set();
    this.sequence=0;
    this.counters={
      signals:0,
      duplicates:0,
      rejected:0,
      proposals:0
    };
  }

  emit(event,payload={}){
    if(this.bus&&typeof this.bus.emit==='function'){
      this.bus.emit(event,payload,{source:'learning-engine'});
    }
  }

  normalizeSignal(raw){
    if(raw===null||typeof raw!=='object'||Array.isArray(raw)){
      throw new TypeError('Learning signal must be an object.');
    }
    for(const key of Object.keys(raw)){
      if(!ALLOWED_SIGNAL_KEYS.has(key)){
        throw new TypeError('Unsupported learning signal field: '+key);
      }
    }

    const id=safeText(raw.id||this.idFactory(),120);
    if(!SAFE_ID.test(id))throw new TypeError('Invalid learning signal id.');

    const kind=safeText(raw.kind,40).toLowerCase();
    if(!LEARNING_SIGNAL_KINDS.includes(kind)){
      throw new TypeError('Invalid learning signal kind: '+kind);
    }

    const skillId=safeText(raw.skillId,120);
    if(!SAFE_ID.test(skillId))throw new TypeError('Invalid learning skill id.');

    const outcome=safeText(raw.outcome||'neutral',32).toLowerCase();
    if(!LEARNING_OUTCOMES.includes(outcome)){
      throw new TypeError('Invalid learning outcome: '+outcome);
    }

    const authority=safeText(raw.authority||'observed',32).toLowerCase();
    if(!LEARNING_AUTHORITIES.includes(authority)){
      throw new TypeError('Invalid learning authority: '+authority);
    }

    let feedback=null;
    if(raw.feedback!==undefined&&raw.feedback!==null){
      feedback=safeText(raw.feedback,32).toLowerCase();
      if(!LEARNING_FEEDBACK.includes(feedback)){
        throw new TypeError('Invalid learning feedback: '+feedback);
      }
    }
    if(kind==='feedback'&&feedback===null){
      throw new TypeError('Feedback signal requires feedback.');
    }

    let latencyMs=null;
    if(raw.latencyMs!==undefined&&raw.latencyMs!==null){
      latencyMs=Number(raw.latencyMs);
      if(!Number.isFinite(latencyMs)||latencyMs<0||latencyMs>this.limits.maxLatencyMs){
        throw new TypeError('Learning latencyMs is outside the allowed range.');
      }
      latencyMs=Math.round(latencyMs);
    }

    let weight=raw.weight===undefined?1:Number(raw.weight);
    if(!Number.isFinite(weight)||weight<=0||weight>1){
      throw new TypeError('Learning weight must be > 0 and <= 1.');
    }

    const timestamp=raw.timestamp===undefined?this.now():Number(raw.timestamp);
    if(!Number.isInteger(timestamp)||timestamp<0){
      throw new TypeError('Learning timestamp must be a non-negative integer.');
    }

    return Object.freeze({
      id,
      kind,
      skillId,
      outcome,
      latencyMs,
      feedback,
      authority,
      timestamp,
      weight,
      tags:Object.freeze(normalizeTags(raw.tags,this.limits))
    });
  }

  ensureSkill(skillId){
    let state=this.skills.get(skillId);
    if(state)return state;
    if(this.skills.size>=this.limits.maxSkills){
      throw new Error('Learning skill capacity reached.');
    }
    state={
      skillId,
      signals:[],
      counters:emptyCounters(),
      weighted:{success:0,failure:0,timeout:0},
      latency:{sum:0,count:0,max:0},
      firstSeenAt:null,
      lastSeenAt:null,
      version:0
    };
    this.skills.set(skillId,state);
    return state;
  }

  ingest(rawSignal){
    let signal;
    try{
      signal=this.normalizeSignal(rawSignal);
    }catch(error){
      this.counters.rejected++;
      throw error;
    }

    if(this.seenSignalIds.has(signal.id)){
      this.counters.duplicates++;
      return Object.freeze({accepted:false,duplicate:true,id:signal.id});
    }

    const state=this.ensureSkill(signal.skillId);
    this.seenSignalIds.add(signal.id);
    this.counters.signals++;
    this.sequence++;

    state.signals.push(signal);
    while(state.signals.length>this.limits.maxSignalsPerSkill){
      state.signals.shift();
    }
    state.firstSeenAt=state.firstSeenAt??signal.timestamp;
    state.lastSeenAt=signal.timestamp;
    state.version++;

    state.counters[signal.outcome]++;
    if(signal.outcome==='success')state.weighted.success+=signal.weight;
    if(signal.outcome==='failure')state.weighted.failure+=signal.weight;
    if(signal.outcome==='timeout')state.weighted.timeout+=signal.weight;

    if(signal.feedback==='positive')state.counters.positiveFeedback++;
    else if(signal.feedback==='negative')state.counters.negativeFeedback++;
    else if(signal.feedback==='neutral')state.counters.neutralFeedback++;

    if(signal.latencyMs!==null){
      state.latency.sum+=signal.latencyMs;
      state.latency.count++;
      state.latency.max=Math.max(state.latency.max,signal.latencyMs);
    }

    this.globalSignals.push(signal);
    while(this.globalSignals.length>this.limits.maxGlobalSignals){
      const removed=this.globalSignals.shift();
      if(!removed)break;
      const stillPresent=this.globalSignals.some(item=>item.id===removed.id)||
        [...this.skills.values()].some(skill=>skill.signals.some(item=>item.id===removed.id));
      if(!stillPresent)this.seenSignalIds.delete(removed.id);
    }

    this.emit('learning.signal.recorded',{
      id:signal.id,
      kind:signal.kind,
      skillId:signal.skillId,
      outcome:signal.outcome,
      feedback:signal.feedback,
      authority:signal.authority,
      latencyMs:signal.latencyMs,
      weight:signal.weight,
      tagCount:signal.tags.length
    });

    return Object.freeze({
      accepted:true,
      duplicate:false,
      id:signal.id,
      skill:this.skillSnapshot(signal.skillId)
    });
  }

  observeExecution(record,{authority='system',weight=1,tags=[]}={}){
    const status=safeText(record?.status,32).toUpperCase();
    const mapping={
      COMPLETED:'success',
      FAILED:'failure',
      TIMEOUT:'timeout',
      BLOCKED:'blocked',
      DEFERRED:'deferred'
    };
    const outcome=mapping[status];
    if(!outcome)throw new TypeError('Unsupported execution status for learning.');
    return this.ingest({
      id:record.learningSignalId,
      kind:'execution',
      skillId:record.skillId,
      outcome,
      latencyMs:record.durationMs,
      authority,
      timestamp:record.endedAt??record.timestamp,
      weight,
      tags
    });
  }

  observeVerification({id,skillId,ok,latencyMs=null,timestamp,weight=1,tags=[]}={}){
    return this.ingest({
      id,
      kind:'verification',
      skillId,
      outcome:ok===true?'success':'failure',
      latencyMs,
      authority:'verifier',
      timestamp,
      weight,
      tags
    });
  }

  recordFeedback({id,skillId,feedback,timestamp,weight=1,tags=[]}={}){
    return this.ingest({
      id,
      kind:'feedback',
      skillId,
      outcome:'neutral',
      feedback,
      authority:'owner',
      timestamp,
      weight,
      tags
    });
  }

  skillSnapshot(skillId){
    const state=this.skills.get(String(skillId||''));
    if(!state)return null;
    const terminalWeight=state.weighted.success+state.weighted.failure+state.weighted.timeout;
    const reliability=terminalWeight
      ?state.weighted.success/terminalWeight
      :null;
    const failureRate=terminalWeight
      ?state.weighted.failure/terminalWeight
      :null;
    const timeoutRate=terminalWeight
      ?state.weighted.timeout/terminalWeight
      :null;
    const feedbackCount=
      state.counters.positiveFeedback+
      state.counters.negativeFeedback+
      state.counters.neutralFeedback;
    const negativeFeedbackRate=feedbackCount
      ?state.counters.negativeFeedback/feedbackCount
      :null;
    const latencyValues=state.signals
      .map(item=>item.latencyMs)
      .filter(value=>value!==null);

    return Object.freeze({
      skillId:state.skillId,
      sampleCount:state.signals.length,
      lifetimeSignalCount:Object.values(state.counters).slice(0,6).reduce((sum,value)=>sum+value,0),
      counters:Object.freeze({...state.counters}),
      metrics:Object.freeze({
        reliability:reliability===null?null:round4(reliability),
        failureRate:failureRate===null?null:round4(failureRate),
        timeoutRate:timeoutRate===null?null:round4(timeoutRate),
        negativeFeedbackRate:negativeFeedbackRate===null?null:round4(negativeFeedbackRate),
        meanLatencyMs:state.latency.count?Math.round(state.latency.sum/state.latency.count):null,
        p95LatencyMs:percentile(latencyValues,.95),
        maxLatencyMs:state.latency.count?state.latency.max:null
      }),
      firstSeenAt:state.firstSeenAt,
      lastSeenAt:state.lastSeenAt,
      version:state.version
    });
  }

  proposalCandidates(skillId){
    const snapshot=this.skillSnapshot(skillId);
    if(!snapshot)return [];
    const proposals=[];
    const terminalCount=
      snapshot.counters.success+
      snapshot.counters.failure+
      snapshot.counters.timeout;

    if(
      terminalCount>=this.limits.minSamplesForProposal&&
      snapshot.metrics.failureRate!==null&&
      snapshot.metrics.failureRate>=this.limits.failureRateThreshold
    ){
      proposals.push({
        type:LEARNING_PROPOSAL_TYPES.REVIEW_RELIABILITY,
        evidence:Object.freeze({
          terminalCount,
          failureRate:snapshot.metrics.failureRate,
          threshold:this.limits.failureRateThreshold
        })
      });
    }

    if(
      terminalCount>=this.limits.minSamplesForProposal&&
      snapshot.metrics.timeoutRate!==null&&
      snapshot.metrics.timeoutRate>=this.limits.timeoutRateThreshold
    ){
      proposals.push({
        type:LEARNING_PROPOSAL_TYPES.REVIEW_TIMEOUT,
        evidence:Object.freeze({
          terminalCount,
          timeoutRate:snapshot.metrics.timeoutRate,
          threshold:this.limits.timeoutRateThreshold,
          p95LatencyMs:snapshot.metrics.p95LatencyMs
        })
      });
    }

    const feedbackCount=
      snapshot.counters.positiveFeedback+
      snapshot.counters.negativeFeedback+
      snapshot.counters.neutralFeedback;
    if(
      feedbackCount>=this.limits.minSamplesForProposal&&
      snapshot.metrics.negativeFeedbackRate!==null&&
      snapshot.metrics.negativeFeedbackRate>=this.limits.negativeFeedbackThreshold
    ){
      proposals.push({
        type:LEARNING_PROPOSAL_TYPES.REVIEW_FEEDBACK,
        evidence:Object.freeze({
          feedbackCount,
          negativeFeedbackRate:snapshot.metrics.negativeFeedbackRate,
          threshold:this.limits.negativeFeedbackThreshold
        })
      });
    }

    return proposals;
  }

  propose(skillId){
    const snapshot=this.skillSnapshot(skillId);
    if(!snapshot)return Object.freeze([]);
    const candidates=this.proposalCandidates(skillId);
    const created=[];
    for(const candidate of candidates){
      const fingerprint=[
        candidate.type,
        snapshot.skillId,
        snapshot.version
      ].join(':');
      if(this.proposals.some(item=>item.fingerprint===fingerprint))continue;
      const proposal=Object.freeze({
        id:'proposal-'+(++this.sequence),
        fingerprint,
        type:candidate.type,
        skillId:snapshot.skillId,
        createdAt:this.now(),
        skillVersion:snapshot.version,
        status:'review_required',
        requiresApproval:true,
        autoApply:false,
        evidence:candidate.evidence
      });
      this.proposals.push(proposal);
      while(this.proposals.length>this.limits.proposalHistoryLimit)this.proposals.shift();
      this.counters.proposals++;
      created.push(proposal);
      this.emit('learning.proposal.created',{
        id:proposal.id,
        type:proposal.type,
        skillId:proposal.skillId,
        skillVersion:proposal.skillVersion,
        status:proposal.status,
        requiresApproval:true,
        autoApply:false
      });
    }
    return Object.freeze(created.map(item=>Object.freeze({...item})));
  }

  recentSignals({limit=25,skillId=null}={}){
    const max=Math.max(1,Math.min(this.limits.maxGlobalSignals,Number(limit)||25));
    const source=skillId
      ?this.globalSignals.filter(item=>item.skillId===skillId)
      :this.globalSignals;
    return Object.freeze(source.slice(-max).map(cloneSignal));
  }

  recentProposals({limit=25,skillId=null}={}){
    const max=Math.max(1,Math.min(this.limits.proposalHistoryLimit,Number(limit)||25));
    const source=skillId
      ?this.proposals.filter(item=>item.skillId===skillId)
      :this.proposals;
    return Object.freeze(source.slice(-max).map(item=>Object.freeze({
      ...item,
      evidence:Object.freeze({...item.evidence})
    })));
  }

  snapshot(){
    return Object.freeze({
      version:LEARNING_ENGINE_VERSION,
      trackedSkills:this.skills.size,
      counters:Object.freeze({...this.counters}),
      limits:this.limits,
      skills:Object.freeze([...this.skills.keys()].sort().map(id=>this.skillSnapshot(id))),
      recentProposals:this.recentProposals({limit:10})
    });
  }
}

export function createLearningEngine(options){
  return new NaraLearningEngine(options);
}
