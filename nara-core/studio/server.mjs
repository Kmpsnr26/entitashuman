import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createOrchestrator,NARA_REGIONS} from '../brain/index.js';
import {createStudioTelemetry} from './telemetry.mjs';
import {createSkillRegistry} from '../skills/index.js';
import {createCreatorAuth} from './creator-auth.mjs';
import {createOwnerStore} from '../security/owner-store.mjs';

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
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};

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

export function createNaraStudioServer({host='127.0.0.1',port=4178,creatorAuth:creatorOptions={}}={}){
  const bootstrapUsername=creatorOptions.username||process.env.NARA_CREATOR_USERNAME||'creator';
  const bootstrapPassword=creatorOptions.password??process.env.NARA_CREATOR_PASSWORD??'';
  const ownerStorePath=String(creatorOptions.ownerStorePath||process.env.NARA_OWNER_STORE||'').trim();
  let ownerStore=null,ownerStoreError='';
  if(ownerStorePath){
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
  const nara=createOrchestrator();
  const telemetry=createStudioTelemetry();
  const skills=createSkillRegistry();
  const clients=new Set();
  let server;

  const broadcast=(type,data)=>{
    for(const res of [...clients]){
      try{sendSse(res,type,data);}catch{clients.delete(res);}
    }
  };

  const stateOff=nara.state.subscribe(state=>broadcast('state',state));
  const eventOff=nara.bus.onAny(envelope=>{
    telemetry.consume(envelope);
    skills.consume(envelope);
    broadcast('event',envelope);
    broadcast('telemetry',telemetry.snapshot());
    broadcast('skills',skills.snapshot());
  });
  nara.start();

  server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/',`http://${req.headers.host||host}`);
      res.setHeader('x-content-type-options','nosniff');
      res.setHeader('referrer-policy','no-referrer');
      res.setHeader('content-security-policy',"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");

      if(req.method==='GET'&&THREE_VENDOR.has(url.pathname)){
        try{
          const content=await readFile(THREE_VENDOR.get(url.pathname));
          res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});
          return res.end(content);
        }catch{
          return json(res,503,{error:'Three.js belum tersedia. Jalankan npm install.'});
        }
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
          owner:ownerStore?.publicProfile?.()||null
        });
      }

      if(req.method==='POST'&&url.pathname==='/api/creator/login'){
        if(creatorMisconfigured)return json(res,503,{ok:false,error:'Creator auth diwajibkan tetapi NARA_CREATOR_PASSWORD belum dikonfigurasi.'});
        const data=await bodyJson(req);
        const result=creator.login(req,{
          username:String(data.username||'').slice(0,120),
          password:String(data.password||'').slice(0,512)
        });
        if(!result.ok)return json(res,result.status||401,{ok:false,error:result.error||'Login gagal.'});
        if(result.token){
          const secure=String(req.headers['x-forwarded-proto']||'').toLowerCase()==='https';
          res.setHeader('set-cookie',creator.sessionCookie(result.token,{secure}));
        }
        const {token,...publicResult}=result;
        return json(res,200,publicResult);
      }

      if(req.method==='POST'&&url.pathname==='/api/creator/logout'){
        creator.logout(req);
        const secure=String(req.headers['x-forwarded-proto']||'').toLowerCase()==='https';
        res.setHeader('set-cookie',creator.clearCookie({secure}));
        return json(res,200,{ok:true});
      }

      if(req.method==='POST'&&url.pathname==='/api/creator/change-login'){
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

      const creatorSession=creator.getSession(req);
      if(creatorRequired&&!creatorSession&&url.pathname.startsWith('/api/')){
        return json(res,401,{ok:false,error:'Creator authentication required.'});
      }

      if(req.method==='GET'&&url.pathname.startsWith('/api/creator/region/')){
        let regionId='';
        try{regionId=decodeURIComponent(url.pathname.slice('/api/creator/region/'.length)).slice(0,80);}
        catch{return json(res,400,{error:'Region ID tidak valid.'});}
        const address=server.listening?server.address():null;
        const actualPort=typeof address==='object'&&address?address.port:port;
        const metadata=buildCreatorRegionMetadata({
          id:regionId,
          state:nara.snapshot(),
          telemetry:telemetry.snapshot(),
          skills:skills.snapshot(),
          host,
          port:actualPort
        });
        if(!metadata)return json(res,404,{error:'Region NARA tidak ditemukan.'});
        return json(res,200,{ok:true,region:metadata});
      }

      if(req.method==='GET'&&url.pathname==='/api/snapshot'){
        return json(res,200,{
          state:nara.snapshot(),
          regions:NARA_REGIONS,
          events:nara.bus.recent({limit:50}),
          telemetry:telemetry.snapshot(),
          skills:skills.snapshot(),
          studio:{
            mode:'live',
            eventAllowlist:STUDIO_EVENT_ALLOWLIST,
            creatorAuthRequired:creatorRequired,
            creator:creatorSession?{username:creatorSession.username}:null
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
        sendSse(res,'state',nara.snapshot());
        sendSse(res,'telemetry',telemetry.snapshot());
        sendSse(res,'skills',skills.snapshot());
        sendSse(res,'ready',{ok:true});
        const timer=setInterval(()=>res.write(': keepalive\n\n'),15000);
        req.on('close',()=>{clearInterval(timer);clients.delete(res);});
        return;
      }

      if(req.method==='POST'&&url.pathname==='/api/event'){
        const data=await bodyJson(req);
        const event=String(data.event||'');
        if(!allow.has(event))return json(res,403,{ok:false,error:'Event tidak diizinkan dari NARA Studio.',event});
        const result=nara.dispatch(event,safePayload(data.payload));
        return json(res,200,{ok:true,event:result.event,state:result.state});
      }

      if(req.method==='POST'&&url.pathname==='/api/reset'){
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
      json(res,error.statusCode||500,{error:error.message||'Studio error.'});
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
      stateOff();eventOff();
      if(nara.running)nara.stop();
      for(const res of [...clients])res.end();
      clients.clear();
      if(server.listening)await new Promise(resolve=>server.close(resolve));
    }
  };
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===normalize(process.argv[1])){
  const studio=createNaraStudioServer({
    host:process.env.NARA_STUDIO_HOST||'127.0.0.1',
    port:Number(process.env.NARA_STUDIO_PORT)||4178,
    creatorAuth:{
      ownerStorePath:process.env.NARA_OWNER_STORE||join(homedir(),'.nara','owner.json')
    }
  });
  const address=await studio.start();
  const actualPort=typeof address==='object'&&address?address.port:4178;
  console.log(`NARA Core Live Studio aktif: http://127.0.0.1:${actualPort}`);
  const shutdown=async()=>{await studio.stop();process.exit(0);};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
