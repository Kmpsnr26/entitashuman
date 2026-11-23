import http from 'node:http';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createOrchestrator,NARA_REGIONS} from '../brain/index.js';
import {createStudioTelemetry} from './telemetry.mjs';
import {createSkillRegistry} from '../skills/index.js';
import {createCreatorAuth} from './creator-auth.mjs';
import {createOwnerStore} from '../security/owner-store.mjs';
import {resolveAleCoreCreatorCredentials} from './creator-env.mjs';

const HERE=fileURLToPath(new URL('.',import.meta.url));
const PUBLIC=join(HERE,'public');
const THREE_VENDOR=Object.freeze(new Map([
  ['/vendor/three/three.module.js',join(HERE,'../../node_modules/three/build/three.module.js')],
  ['/vendor/three/three.core.js',join(HERE,'../../node_modules/three/build/three.core.js')]
]));
const MAX_BODY=16*1024;

export const STUDIO_EVENT_ALLOWLIST=Object.freeze([
  'brain.region.select',
  'reason.start','reason.complete',
  'plan.start','plan.complete',
  'memory.read','memory.write','memory.complete',
  'context.prepare','context.approved','context.used','context.blocked',
  'agent.start','agent.complete','agent.failed',
  'program.start','program.complete',
  'verify.start','verify.complete',
  'work.start','work.complete','work.failed',
  'error.detected','bug.detected','bug.fixed',
  'sync.start','sync.complete',
  'terminal.open'
]);

const allow=new Set(STUDIO_EVENT_ALLOWLIST);
const MUTATION_METHODS=new Set(['POST','PUT','PATCH','DELETE']);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};

function studioOrigin(host,port){
  const boundHost=String(host).includes(':')&&!String(host).startsWith('[')?'['+host+']':host;
  return new URL('http://'+boundHost+':'+port).origin;
}

function json(res,status,data){
  const body=JSON.stringify(data);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store'});
  res.end(body);
}

async function bodyJson(req){
  let size=0;const chunks=[];
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_BODY)throw Object.assign(new Error('Payload terlalu besar.'),{statusCode:413});
    chunks.push(chunk);
  }
  if(!chunks.length)return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw Object.assign(new Error('JSON tidak valid.'),{statusCode:400});}
}

function safePayload(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).slice(0,20).map(([k,v])=>[
    String(k).slice(0,80),
    typeof v==='string'?v.slice(0,500):v
  ]));
}

function sendSse(res,type,data){
  res.write('event: '+type+'\n');
  res.write('data: '+JSON.stringify(data)+'\n\n');
}


function finiteNumber(value,fallback=0){
  const number=Number(value);
  return Number.isFinite(number)?number:fallback;
}

function safeEventName(value=''){
  const event=String(value||'').slice(0,80);
  return allow.has(event)?event:'';
}

const SAFE_STATUSES=new Set([
  'active','idle','ready','running','thinking','planning','executing','verifying',
  'complete','completed','error','bug','blocked','offline','disconnected',
  'listening','speaking','processing','waiting','learning','repairing','repaired',
  'attention','analyzing','failed','enabled'
]);
const SAFE_LIFECYCLES=new Set(['active','stopped','starting','stopping']);
const SAFE_STAGES=new Set(['reason','plan','agent','program','verify']);
const SAFE_MEMORY_OPERATIONS=new Set([
  'read','write','complete','context_prepare','context_approved','context_used','context_blocked'
]);
const SAFE_DIAGNOSTIC_EVENTS=new Set([
  'error.detected','bug.detected','bug.fixed','work.failed','agent.failed','verify.start','verify.complete'
]);

function safeEnum(value,allowed,fallback='idle'){
  const text=String(value||'');
  return allowed.has(text)?text:fallback;
}

function safeCount(value){
  const number=finiteNumber(value);
  return Math.max(0,Math.min(1_000_000_000,Math.floor(number)));
}

function safeMetric(value){
  return Math.max(0,Math.min(1_000_000_000,finiteNumber(value)));
}

function projectEmbeddedState(state={}){
  const regions={};
  for(const id of Object.keys(NARA_REGIONS)){
    const source=state.regions?.[id]||{};
    regions[id]={
      status:safeEnum(source.status,SAFE_STATUSES,NARA_REGIONS[id].defaultStatus||'idle'),
      lastEvent:safeEventName(source.lastEvent)
    };
  }
  const selectedRegion=String(state.selectedRegion||'');
  const sensory=state.sensory||{};
  const humanale=state.humanale||{};
  return {
    lifecycle:safeEnum(state.lifecycle,SAFE_LIFECYCLES,'unknown'),
    regions,
    selectedRegion:Object.hasOwn(NARA_REGIONS,selectedRegion)?selectedRegion:'NARA_CORE',
    currentTask:null,
    lastEvent:null,
    sensory:{
      hearing:{active:Boolean(sensory.hearing?.active),energy:safeMetric(sensory.hearing?.energy)},
      vision:{active:Boolean(sensory.vision?.active),activity:safeMetric(sensory.vision?.activity)},
      speech:{active:Boolean(sensory.speech?.active),energy:safeMetric(sensory.speech?.energy)}
    },
    humanale:{
      state:safeEnum(humanale.state,new Set(['idle','listening','thinking','speaking','processing','error']),'idle'),
      rendererMode:safeEnum(humanale.rendererMode,new Set(['eco','active']),'eco'),
      controlledBy:'NARA_CORE'
    }
  };
}

function projectEmbeddedTelemetry(data={}){
  const decision=data.decision||{};
  const active={};
  for(const [stage,item] of Object.entries(decision.active||{})){
    if(!SAFE_STAGES.has(stage))continue;
    active[stage]={
      stage,status:safeEnum(item.status,SAFE_STATUSES),label:'',
      startedAt:safeMetric(item.startedAt),endedAt:null,durationMs:item.durationMs==null?null:safeMetric(item.durationMs)
    };
  }
  const decisionHistory=(Array.isArray(decision.history)?decision.history:[]).slice(-80).map(item=>({
    stage:safeEnum(item.stage,SAFE_STAGES,'reason'),
    status:safeEnum(item.status,SAFE_STATUSES),
    label:'',
    startedAt:safeMetric(item.startedAt),
    endedAt:safeMetric(item.endedAt),
    durationMs:item.durationMs==null?null:safeMetric(item.durationMs)
  }));
  const memory=data.memory||{};
  const memoryHistory=(Array.isArray(memory.history)?memory.history:[]).slice(-60).map(item=>({
    operation:safeEnum(item.operation,SAFE_MEMORY_OPERATIONS),
    event:'',
    label:'',
    target:'',
    timestamp:safeMetric(item.timestamp)
  }));
  const diagnostics=data.diagnostics||{};
  const diagnosticHistory=(Array.isArray(diagnostics.history)?diagnostics.history:[]).slice(-60).map(item=>({
    event:SAFE_DIAGNOSTIC_EVENTS.has(item.event)?item.event:'',
    message:'',
    timestamp:safeMetric(item.timestamp),
    status:safeEnum(item.status,SAFE_STATUSES)
  }));
  const perf=data.performance||{};
  const counters=memory.counters||{};
  const diagnosticCounters=diagnostics.counters||{};
  return {
    version:2,
    decision:{
      currentStage:SAFE_STAGES.has(decision.currentStage)?decision.currentStage:null,
      currentLabel:'',
      status:safeEnum(decision.status,new Set(['idle','running','complete','failed']),'idle'),
      startedAt:safeMetric(decision.startedAt),
      lastDurationMs:decision.lastDurationMs==null?null:safeMetric(decision.lastDurationMs),
      completedStages:safeCount(decision.completedStages),
      failedStages:safeCount(decision.failedStages),
      active,history:decisionHistory
    },
    memory:{
      active:Boolean(memory.active),
      lastOperation:memory.lastOperation?{
        operation:safeEnum(memory.lastOperation.operation,SAFE_MEMORY_OPERATIONS),
        event:'',label:'',target:'',timestamp:safeMetric(memory.lastOperation.timestamp)
      }:null,
      counters:Object.fromEntries([...SAFE_MEMORY_OPERATIONS].map(key=>[key,safeCount(counters[key])])),
      history:memoryHistory
    },
    diagnostics:{
      active:Boolean(diagnostics.active),
      status:safeEnum(diagnostics.status,new Set(['idle','analyzing','bug','repaired','attention','verifying','verified']),'idle'),
      current:diagnostics.current?{
        message:'',
        detectedAt:safeMetric(diagnostics.current.detectedAt),
        bugAt:safeMetric(diagnostics.current.bugAt),
        fixedAt:safeMetric(diagnostics.current.fixedAt)
      }:null,
      lastRepairDurationMs:diagnostics.lastRepairDurationMs==null?null:safeMetric(diagnostics.lastRepairDurationMs),
      counters:Object.fromEntries(['errors','bugs','fixed','workFailed','agentFailed','verified'].map(key=>[key,safeCount(diagnosticCounters[key])])),
      history:diagnosticHistory
    },
    performance:{
      totalEvents:safeCount(perf.totalEvents),
      lastEventAt:safeMetric(perf.lastEventAt),
      peakEvents10s:safeCount(perf.peakEvents10s),
      startedAt:safeMetric(perf.startedAt),
      uptimeMs:safeMetric(perf.uptimeMs),
      events10s:safeCount(perf.events10s),
      eventsPerSecond:safeMetric(perf.eventsPerSecond)
    }
  };
}

function projectEmbeddedSkills(data={}){
  const skills=Array.isArray(data.skills)?data.skills:[];
  const rows=skills.slice(0,200).map(skill=>({
    id:String(skill.id||'').slice(0,80),
    label:String(skill.label||'').slice(0,120),
    region:Object.hasOwn(NARA_REGIONS,String(skill.region||''))?String(skill.region):'',
    status:safeEnum(skill.status,SAFE_STATUSES),
    enabled:Boolean(skill.enabled),
    runs:safeCount(skill.runs),
    successes:safeCount(skill.successes),
    failures:safeCount(skill.failures),
    lastEvent:safeEventName(skill.lastEvent),
    lastLabel:'',
    lastDurationMs:skill.lastDurationMs==null?null:safeMetric(skill.lastDurationMs)
  }));
  return {
    total:safeCount(data.total??rows.length),
    enabled:safeCount(data.enabled??rows.filter(item=>item.enabled).length),
    running:safeCount(data.running??rows.filter(item=>item.status==='running').length),
    failed:safeCount(data.failed??rows.filter(item=>item.status==='failed').length),
    skills:rows
  };
}

export function buildCreatorRegionMetadata({
  id,
  state={},
  telemetry={},
  skills={},
  host='127.0.0.1',
  port=4178
}={}){
  const region=NARA_REGIONS[String(id||'')];
  if(!region)return null;

  const live=state.regions?.[region.id]||{};
  const diagnostics=telemetry.diagnostics||{};
  const memory=telemetry.memory||{};
  const performance=telemetry.performance||{};
  const skillRows=Array.isArray(skills.skills)?skills.skills:[];
  const regionSkills=skillRows.filter(skill=>skill.region===region.id).slice(0,8).map(skill=>({
    id:String(skill.id||'').slice(0,80),
    label:String(skill.label||'').slice(0,120),
    status:String(skill.status||'idle').slice(0,40),
    runs:finiteNumber(skill.runs),
    successes:finiteNumber(skill.successes),
    failures:finiteNumber(skill.failures),
    lastEvent:safeEventName(skill.lastEvent),
    lastDurationMs:skill.lastDurationMs==null?null:finiteNumber(skill.lastDurationMs)
  }));

  const activeRegions=Object.values(state.regions||{}).filter(item=>
    !['idle','ready','offline','disconnected','complete'].includes(item?.status)
  ).length;
  const loopback=host==='127.0.0.1'||host==='localhost'||host==='::1';

  return {
    id:region.id,
    label:region.label,
    group:region.group,
    status:String(live.status||region.defaultStatus||'idle').slice(0,40),
    defaultStatus:region.defaultStatus,
    lastEvent:safeEventName(live.lastEvent),
    neighbors:(region.connections||[]).slice(0,24).map(neighborId=>({
      id:neighborId,
      label:NARA_REGIONS[neighborId]?.label||neighborId,
      status:String(state.regions?.[neighborId]?.status||NARA_REGIONS[neighborId]?.defaultStatus||'idle').slice(0,40)
    })),
    runtime:{
      lifecycle:String(state.lifecycle||'unknown').slice(0,40),
      activeRegions,
      totalEvents:finiteNumber(performance.totalEvents),
      eventsPerSecond:finiteNumber(performance.eventsPerSecond)
    },
    network:{
      scope:loopback?'loopback':'configured-bind',
      address:loopback?'127.0.0.1':'configured-host',
      port:Math.max(0,Math.min(65535,finiteNumber(port))),
      transport:'HTTP + SSE',
      discovery:'disabled'
    },
    server:{
      service:'NARA Core Live Studio',
      health:'online',
      mode:'local-studio',
      secrets:'redacted'
    },
    database:{
      state:'not_configured',
      connector:'none',
      credentials:'not_exposed'
    },
    diagnostics:{
      status:String(diagnostics.status||'idle').slice(0,40),
      errors:finiteNumber(diagnostics.counters?.errors),
      bugs:finiteNumber(diagnostics.counters?.bugs),
      fixed:finiteNumber(diagnostics.counters?.fixed),
      verified:finiteNumber(diagnostics.counters?.verified),
      lastRepairDurationMs:diagnostics.lastRepairDurationMs==null?null:finiteNumber(diagnostics.lastRepairDurationMs)
    },
    memory:{
      reads:finiteNumber(memory.counters?.read),
      writes:finiteNumber(memory.counters?.write),
      contextUsed:finiteNumber(memory.counters?.context_used),
      contextBlocked:finiteNumber(memory.counters?.context_blocked)
    },
    skills:regionSkills,
    security:{
      permissionBypass:false,
      arbitraryNetworkDiscovery:false,
      rawSecretsExposed:false,
      privateReasoningExposed:false
    }
  };
}

export function createNaraStudioServer({
  host='127.0.0.1',
  port=4178,
  creatorAuth:creatorOptions={},
  nara:providedNara=null,
  embedded=false,
  voiceBackend=null
}={}){
  const creatorEnv=resolveAleCoreCreatorCredentials(process.env);
  const bootstrapUsername=creatorOptions.username||creatorEnv.username;
  const bootstrapPassword=creatorOptions.password??creatorEnv.password;
  const ownerStorePath=String(creatorOptions.ownerStorePath||process.env.NARA_OWNER_STORE||'').trim();
  let ownerStore=creatorOptions.credentialStore||null,ownerStoreError='';
  if(!ownerStore&&ownerStorePath){
    try{
      const candidate=createOwnerStore({filePath:ownerStorePath});
      if(!candidate.configured()&&String(bootstrapPassword)){
        candidate.provision({username:bootstrapUsername,password:bootstrapPassword});
      }
      if(candidate.configured()){
        candidate.publicProfile();
        ownerStore=candidate;
      }
    }catch(error){
      ownerStoreError=String(error?.message||'Owner store NARA gagal dimuat.');
    }
  }

  const creator=createCreatorAuth({
    username:bootstrapUsername,
    password:bootstrapPassword,
    credentialStore:ownerStore,
    ttlMs:creatorOptions.ttlMs,
    maxSessions:creatorOptions.maxSessions,
    maxAttempts:creatorOptions.maxAttempts,
    attemptWindowMs:creatorOptions.attemptWindowMs
  });
  const creatorRequired=creatorOptions.required===false?false:(creator.configured||creatorOptions.required===true);
  const creatorMisconfigured=Boolean(ownerStoreError)||(creatorRequired&&!creator.configured);
  const nara=providedNara||createOrchestrator();
  const ownsNara=!providedNara;
  const telemetry=createStudioTelemetry();
  const skills=createSkillRegistry();
  const clients=new Set();
  const voiceActors=new Map();
  const voiceActor=session=>'studio:'+createHash('sha256').update(session.token).digest('hex');
  let server;

  const broadcast=(type,data)=>{
    for(const res of [...clients]){
      try{sendSse(res,type,data);}catch{clients.delete(res);}
    }
  };

  const projectState=state=>embedded?projectEmbeddedState(state):state;
  const projectTelemetry=data=>embedded?projectEmbeddedTelemetry(data):data;
  const projectSkills=data=>embedded?projectEmbeddedSkills(data):data;
  const stateOff=nara.state.subscribe(state=>broadcast('state',projectState(state)));
  const eventOff=nara.bus.onAny(envelope=>{
    telemetry.consume(envelope);
    skills.consume(envelope);
    if(!embedded)broadcast('event',envelope);
    if(embedded)broadcast('state',projectState(nara.snapshot()));
    broadcast('telemetry',projectTelemetry(telemetry.snapshot()));
    broadcast('skills',projectSkills(skills.snapshot()));
  });
  if(ownsNara)nara.start();

  server=http.createServer(async(req,res)=>{
    try{
      const expected=new URL(studioOrigin(host,server.address().port));
      const url=new URL(req.url||'/',expected);
      res.setHeader('x-content-type-options','nosniff');
      res.setHeader('referrer-policy','no-referrer');
      res.setHeader('content-security-policy',"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");

      if(url.pathname.startsWith('/api/')){
        // Bind reads too: DNS rebinding must not expose optional-auth development data.
        if(req.headers.host!==expected.host){
          return json(res,403,{ok:false,error:'Same-origin Studio request required.'});
        }
        // SameSite cookies also reach other localhost ports; validate mutation origins.
        if(MUTATION_METHODS.has(req.method)){
          if(req.headers.origin!==expected.origin){
            return json(res,403,{ok:false,error:'Same-origin Studio request required.'});
          }
          if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json'){
            return json(res,415,{ok:false,error:'JSON required.'});
          }
        }
      }

      if(req.method==='GET'&&THREE_VENDOR.has(url.pathname)){
        try{
          const content=await readFile(THREE_VENDOR.get(url.pathname));
          res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});
          return res.end(content);
        }catch{
          return json(res,503,{error:'Three.js belum tersedia. Jalankan npm install.'});
        }
      }

      if(req.method==='GET'&&url.pathname==='/public/robot-voice.js'){
        const content=await readFile(join(HERE,'../../public/robot-voice.js'));
        res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});return res.end(content);
      }

      if(req.method==='GET'&&url.pathname==='/api/creator/session'){
        const publicCreator=creator.publicSession(req);
        return json(res,200,{
          ...publicCreator,
          authenticated:creatorMisconfigured?false:publicCreator.authenticated,
          development:creatorMisconfigured?false:publicCreator.development,
          required:creatorRequired,
          misconfigured:creatorMisconfigured,
          persistentOwner:Boolean(ownerStore?.configured?.()),
          ...(embedded?{username:null,owner:null}:{owner:ownerStore?.publicProfile?.()||null})
        });
      }

      if(req.method==='POST'&&url.pathname==='/api/creator/login'){
        if(creatorMisconfigured)return json(res,503,{
          ok:false,
          error:ownerStoreError||'Creator auth diwajibkan tetapi owner store/password belum dikonfigurasi.'
        });
        const data=await bodyJson(req);
        const result=creator.login(req,{
          username:String(data.username||'').slice(0,120),
          password:String(data.password||'')
        });
        if(!result.ok)return json(res,result.status||401,{ok:false,error:result.error||'Login gagal.',errorCode:result.errorCode||'',retryAfterMs:result.retryAfterMs||0});
        if(result.token){
          const secure=String(req.headers['x-forwarded-proto']||'').toLowerCase()==='https';
          res.setHeader('set-cookie',creator.sessionCookie(result.token,{secure}));
        }
        const {token,...publicResult}=result;
        if(embedded)delete publicResult.username;
        return json(res,200,publicResult);
      }

      if(req.method==='POST'&&url.pathname==='/api/creator/logout'){
        const session=creator.getSession(req);
        if(session&&voiceBackend){const actor=voiceActor(session);await voiceBackend.stop(actor);voiceActors.delete(actor);}
        creator.logout(req);
        const secure=String(req.headers['x-forwarded-proto']||'').toLowerCase()==='https';
        res.setHeader('set-cookie',creator.clearCookie({secure}));
        return json(res,200,{ok:true});
      }

      if(req.method==='POST'&&url.pathname==='/api/creator/change-login'){
        if(embedded)return json(res,403,{ok:false,error:'Creator login changes are disabled in embedded Studio.'});
        const data=await bodyJson(req);
        const result=creator.changeCredentials(req,{
          currentPassword:String(data.currentPassword||'').slice(0,512),
          newUsername:String(data.newUsername||'').slice(0,120),
          newPassword:String(data.newPassword||'').slice(0,512)
        });
        if(!result.ok)return json(res,result.status||400,result);
        const secure=String(req.headers['x-forwarded-proto']||'').toLowerCase()==='https';
        res.setHeader('set-cookie',creator.clearCookie({secure}));
        return json(res,200,{
          ok:true,
          reloginRequired:true,
          owner:result.profile
        });
      }

      if(embedded&&req.method==='POST'&&url.pathname==='/api/reset'){
        return json(res,403,{ok:false,error:'Reset is disabled in embedded Studio.'});
      }

      const creatorSession=creator.getSession(req);
      if(creatorRequired&&!creatorSession&&url.pathname.startsWith('/api/')){
        return json(res,401,{ok:false,error:'Creator authentication required.'});
      }

      if(url.pathname.startsWith('/api/voice/')){
        // Voice never inherits standalone development authentication bypass.
        if(!creatorSession)return json(res,401,{error:'Creator authentication required.'});
        const configured=typeof voiceBackend?.synthesize==='function'&&typeof voiceBackend?.stop==='function';
        if(req.method==='GET'&&url.pathname==='/api/voice/status')return json(res,200,{configured});
        if(req.method!=='POST'||!['/api/voice/synthesize','/api/voice/stop'].includes(url.pathname))return json(res,404,{error:'Tidak ditemukan.'});
        const data=await bodyJson(req);
        if(!configured)return json(res,503,{error:'Local PCM voice unavailable.'});
        const actor=voiceActor(creatorSession);
        if(url.pathname==='/api/voice/stop'){await voiceBackend.stop(actor);voiceActors.delete(actor);return json(res,200,{ok:true});}
        if(typeof data.text!=='string'||!data.text.trim()||data.text.trim().length>2000)return json(res,400,{error:'Teks suara harus berisi 1–2000 karakter.'});
        const pending=voiceActors.get(actor)||new Set(),request=Symbol('voice');pending.add(request);voiceActors.set(actor,pending);
        try{
          const result=await voiceBackend.synthesize(actor,{text:data.text.trim(),style:'natural',voiceCharacter:'male'});
          if(!creator.getSession(req)){await voiceBackend.stop(actor);return json(res,401,{error:'Creator session expired.'});}
          if(typeof result?.audio!=='string'||result.audio.length>20000000||result.mime!=='audio/wav')return json(res,502,{error:'Invalid PCM voice response.'});
          return json(res,200,{audio:result.audio,mime:'audio/wav',voiceGender:result.voiceGender==='male'?'male':'unknown'});
        }finally{pending.delete(request);if(!pending.size&&voiceActors.get(actor)===pending)voiceActors.delete(actor);}
      }

      if(req.method==='GET'&&url.pathname.startsWith('/api/creator/region/')){
        let regionId='';
        try{regionId=decodeURIComponent(url.pathname.slice('/api/creator/region/'.length)).slice(0,80);}
        catch{return json(res,400,{error:'Region ID tidak valid.'});}
        const address=server.listening?server.address():null;
        const actualPort=typeof address==='object'&&address?address.port:port;
        const metadata=buildCreatorRegionMetadata({
          id:regionId,
          state:projectState(nara.snapshot()),
          telemetry:projectTelemetry(telemetry.snapshot()),
          skills:projectSkills(skills.snapshot()),
          host,
          port:actualPort
        });
        if(!metadata)return json(res,404,{error:'Region NARA tidak ditemukan.'});
        return json(res,200,{ok:true,region:metadata});
      }

      if(req.method==='GET'&&url.pathname==='/api/snapshot'){
        const state=projectState(nara.snapshot());
        const studioTelemetry=projectTelemetry(telemetry.snapshot());
        const studioSkills=projectSkills(skills.snapshot());
        return json(res,200,{
          state,
          regions:NARA_REGIONS,
          events:embedded?[]:nara.bus.recent({limit:50}),
          telemetry:studioTelemetry,
          skills:studioSkills,
          studio:{
            mode:'live',
            ...(embedded?{embedded:true}:{}),
            eventAllowlist:embedded?['brain.region.select']:STUDIO_EVENT_ALLOWLIST,
            creatorAuthRequired:creatorRequired,
            creator:creatorSession&&!embedded?{username:creatorSession.username}:null
          }
        });
      }

      if(req.method==='GET'&&url.pathname==='/api/stream'){
        res.writeHead(200,{
          'content-type':'text/event-stream; charset=utf-8',
          'cache-control':'no-store',
          'connection':'keep-alive'
        });
        clients.add(res);
        sendSse(res,'state',projectState(nara.snapshot()));
        sendSse(res,'telemetry',projectTelemetry(telemetry.snapshot()));
        sendSse(res,'skills',projectSkills(skills.snapshot()));
        sendSse(res,'ready',{ok:true});
        const timer=setInterval(()=>res.write(': keepalive\n\n'),15000);
        req.on('close',()=>{clearInterval(timer);clients.delete(res);});
        return;
      }

      if(req.method==='POST'&&url.pathname==='/api/event'){
        const data=await bodyJson(req);
        const event=String(data.event||'');
        if(embedded&&event!=='brain.region.select')return json(res,403,{ok:false,error:'Only region selection is enabled in embedded Studio.'});
        if(!allow.has(event))return json(res,403,embedded
          ?{ok:false,error:'Event tidak diizinkan dari NARA Studio.'}
          :{ok:false,error:'Event tidak diizinkan dari NARA Studio.',event});
        if(embedded&&!Object.hasOwn(NARA_REGIONS,String(data.payload?.region||''))){
          return json(res,400,{ok:false,error:'Region NARA tidak valid.'});
        }
        const result=nara.dispatch(event,safePayload(data.payload));
        return json(res,200,{ok:true,event:result.event,state:projectState(result.state)});
      }

      if(req.method==='POST'&&url.pathname==='/api/reset'){
        if(embedded)return json(res,403,{ok:false,error:'Reset is disabled in embedded Studio.'});
        nara.stop();telemetry.reset();skills.reset();nara.start();
        return json(res,200,{ok:true,state:nara.snapshot(),telemetry:telemetry.snapshot(),skills:skills.snapshot()});
      }

      if(req.method!=='GET')return json(res,405,{error:'Method tidak didukung.'});

      let pathname=url.pathname==='/'?'index.html':url.pathname.replace(/^\/+/, '');
      pathname=normalize(pathname).replace(/^([.][.][/\\])+/, '');
      const full=join(PUBLIC,pathname);
      if(!full.startsWith(PUBLIC))return json(res,403,{error:'Path ditolak.'});
      try{
        const content=await readFile(full);
        res.writeHead(200,{'content-type':mime[extname(full)]||'application/octet-stream','cache-control':'no-store'});
        res.end(content);
      }catch{
        json(res,404,{error:'Tidak ditemukan.'});
      }
    }catch(error){
      json(res,error.statusCode||500,{error:embedded?'Studio request failed.':error.message||'Studio error.'});
    }
  });

  return {
    nara,
    telemetry,
    skills,
    creator,
    ownerStore,
    ownerStoreError,
    creatorRequired,
    creatorMisconfigured,
    server,
    async start(){
      if(server.listening)return server.address();
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
      return server.address();
    },
    async stop(){
      if(voiceBackend)await Promise.allSettled([...voiceActors.keys()].map(actor=>voiceBackend.stop(actor)));voiceActors.clear();
      stateOff();eventOff();
      if(ownsNara&&nara.running)nara.stop();
      for(const res of [...clients])res.end();
      clients.clear();
      if(server.listening)await new Promise(resolve=>server.close(resolve));
    }
  };
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===normalize(process.argv[1])){
  const host=process.env.NARA_STUDIO_HOST||'127.0.0.1';
  const studio=createNaraStudioServer({
    host,
    port:Number(process.env.NARA_STUDIO_PORT)||4178,
    creatorAuth:{
      required:true,
      ownerStorePath:process.env.NARA_OWNER_STORE||join(homedir(),'.nara','owner.json')
    }
  });
  const address=await studio.start();
  const actualPort=typeof address==='object'&&address?address.port:4178;
  console.log(`NARA Core Live Studio aktif: ${studioOrigin(host,actualPort)}`);
  const shutdown=async()=>{await studio.stop();process.exit(0);};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
