import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOrchestrator,NARA_REGIONS} from '../brain/index.js';
import {createStudioTelemetry} from './telemetry.mjs';

const HERE=fileURLToPath(new URL('.',import.meta.url));
const PUBLIC=join(HERE,'public');
const MAX_BODY=16*1024;

export const STUDIO_EVENT_ALLOWLIST=Object.freeze([
  'brain.region.select',
  'reason.start','reason.complete',
  'plan.start','plan.complete',
  'memory.read','memory.write','memory.complete',
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

export function createNaraStudioServer({host='127.0.0.1',port=4178}={}){
  const nara=createOrchestrator();
  const telemetry=createStudioTelemetry();
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
    broadcast('event',envelope);
    broadcast('telemetry',telemetry.snapshot());
  });
  nara.start();

  server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/',`http://${req.headers.host||host}`);
      res.setHeader('x-content-type-options','nosniff');
      res.setHeader('referrer-policy','no-referrer');
      res.setHeader('content-security-policy',"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'");

      if(req.method==='GET'&&url.pathname==='/api/snapshot'){
        return json(res,200,{
          state:nara.snapshot(),
          regions:NARA_REGIONS,
          events:nara.bus.recent({limit:50}),
          telemetry:telemetry.snapshot(),
          studio:{mode:'live',eventAllowlist:STUDIO_EVENT_ALLOWLIST}
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
        nara.stop();telemetry.reset();nara.start();
        return json(res,200,{ok:true,state:nara.snapshot(),telemetry:telemetry.snapshot()});
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
    port:Number(process.env.NARA_STUDIO_PORT)||4178
  });
  const address=await studio.start();
  const actualPort=typeof address==='object'&&address?address.port:4178;
  console.log(`NARA Core Live Studio aktif: http://127.0.0.1:${actualPort}`);
  const shutdown=async()=>{await studio.stop();process.exit(0);};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
