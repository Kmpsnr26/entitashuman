import {spawn} from 'node:child_process';
import {access,realpath,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {getSkill} from '../nara-core/brain/skill-registry.js';
import {validateMemoryContext,memoryContextBlock} from './memory-context.mjs';
import {
 AI_MAINTENANCE_ALLOWED_CAPABILITIES,
 AI_MAINTENANCE_DENIED_CAPABILITIES,
 assertMaintenanceTaskAllowed,
 buildMaintenanceWorkPrompt,
 maintenancePolicySnapshot
} from './agent-maintenance-policy.mjs';
import {sanitizeMaintenanceEnvironment} from './agent-maintenance-guard.mjs';
import {beginMaintenanceTransaction,inspectMaintenanceReadiness} from './agent-maintenance-transaction.mjs';
import {maintenanceProcessRecoveryError,markMaintenanceProcessUnconfirmed,terminateMaintenanceProcessTree} from './agent-trusted-process-broker.mjs';

const maintenanceBoundaryLegacyMarker='Jangan git push, git merge, publish';

const agents=[
 {id:'humanale-orchestrator',name:'HumanALE Orchestrator',method:'Structured Planner → Worker → Reviewer',internal:true,canRun:false,url:'https://github.com/Kmpsnr26/entitashuman'},
 {id:'continue',name:'Continue',method:'CLI + MCP',commands:['cn'],envPath:'CONTINUE_CLI_PATH',canRun:true,url:'https://docs.continue.dev/cli/quickstart'},
 {id:'cody',name:'Sourcegraph Cody',method:'CLI + Sourcegraph MCP',commands:['cody'],envPath:'CODY_CLI_PATH',canRun:true,url:'https://sourcegraph.com/docs/cody/clients/install-cli'},
 {id:'pieces',name:'Pieces for Developers',method:'PiecesOS MCP',commands:['pieces-os','pieces'],envPath:'PIECES_CLI_PATH',configEnv:'PIECES_MCP_URL',url:'https://docs.pieces.app/'},
 {id:'askcodi',name:'AskCodi',method:'API Gateway',configEnv:'ASKCODI_API_KEY',secondaryEnv:'ASKCODI_MODEL',url:'https://www.askcodi.com/gateway'},
 {id:'phind',name:'Phind',method:'External',external:true,url:'https://www.phind.com/'},
 {id:'amazonq',name:'Amazon Q Developer',method:'CLI + MCP',commands:['qchat','q'],envPath:'AMAZON_Q_CLI_PATH',url:'https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/qdev-mcp.html'},
 {id:'windsurf',name:'Windsurf / Codeium',method:'IDE + MCP',commands:['windsurf'],envPath:'WINDSURF_CLI_PATH',url:'https://docs.windsurf.com/'},
 {id:'tabnine',name:'Tabnine',method:'IDE + MCP',commands:['tabnine','TabNine'],envPath:'TABNINE_CLI_PATH',url:'https://docs.tabnine.com/'},
 {id:'replit',name:'Replit AI / Agent',method:'Cloud Agent + MCP',url:'https://docs.replit.com/references/mcp/overview'},
 {id:'cursor',name:'Cursor',method:'CLI + MCP',commands:['agent','cursor-agent'],envPath:'CURSOR_AGENT_PATH',canRun:true,url:'https://prod.cursor.com/docs/cli/overview'},
 {id:'github-copilot',name:'GitHub Copilot',method:'CLI + custom agents',commands:['copilot'],envPath:'GITHUB_COPILOT_CLI_PATH',configEnvs:['COPILOT_GITHUB_TOKEN','GH_TOKEN','GITHUB_TOKEN'],canRun:true,url:'https://docs.github.com/en/copilot/how-tos/copilot-cli'},
 {id:'agent-copilot',name:'Agent / Copilot',method:'GitHub Copilot custom agent',commands:['copilot'],envPath:'GITHUB_COPILOT_CLI_PATH',url:'https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-custom-agents'},
 {id:'codex',name:'OpenAI Codex',method:'CLI + MCP',commands:['codex'],envPath:'CODEX_CLI_PATH',canRun:true,url:'https://developers.openai.com/codex/cli'},
 {id:'openai-api',name:'OpenAI API',method:'HumanALE god egine runtime API provider',runtime:true,configEnvs:['OPENAI_API_KEY'],url:'https://developers.openai.com/api/'},
 {id:'visual-copilot',name:'Visual Copilot',method:'Design-to-code external',external:true,url:'https://www.builder.io/c/docs/visual-copilot'},
 {id:'qodo',name:'Qodo',method:'IDE / review agent',commands:['qodo'],envPath:'QODO_CLI_PATH',url:'https://docs.qodo.ai/'},
 {id:'blackbox',name:'Blackbox AI',method:'IDE / external agent',external:true,url:'https://www.blackbox.ai/'},
 {id:'claude',name:'Claude Code · Fable 5',method:'Claude Code CLI + Fable 5 + HumanALE god egine runtime API',commands:['claude'],envPath:'CLAUDE_CLI_PATH',runtime:true,configEnvs:['ANTHROPIC_API_KEY'],canRun:true,model:'claude-fable-5',url:'https://docs.anthropic.com/en/docs/claude-code/overview'},
 {id:'microsoft-copilot',name:'Microsoft Copilot',method:'External / IDE',external:true,url:'https://learn.microsoft.com/en-us/copilot/'},
 {id:'deepseek-coder',name:'DeepSeek Coder',method:'HumanALE god egine runtime API provider',runtime:true,configEnvs:['DEEPSEEK_API_KEY'],url:'https://api-docs.deepseek.com/'},
 {id:'devin',name:'Devin AI',method:'Cloud software agent',external:true,url:'https://docs.devin.ai/'},
 {id:'codegeex',name:'CodeGeeX',method:'IDE coding assistant',external:true,url:'https://codegeex.cn/'},
 {id:'starcoder',name:'StarCoder',method:'Model / self-hosted endpoint',external:true,url:'https://huggingface.co/bigcode'},
 {id:'tabbyml',name:'TabbyML',method:'Self-hosted coding assistant',commands:['tabby'],envPath:'TABBY_CLI_PATH',url:'https://tabby.tabbyml.com/docs/'},
 {id:'grok',name:'Grok / xAI',method:'HumanALE god egine runtime API provider',runtime:true,configEnvs:['XAI_API_KEY'],url:'https://docs.x.ai/'},
 {id:'gemini',name:'Gemini / Google AI',method:'HumanALE god egine runtime API + CLI',runtime:true,commands:['gemini'],envPath:'GEMINI_CLI_PATH',configEnvs:['GEMINI_API_KEY','GOOGLE_API_KEY'],url:'https://github.com/google-gemini/gemini-cli'}
];

async function exists(path){try{await access(path);return true;}catch{return false;}}
function locateCommand(command){
 return new Promise(resolve=>{
  const finder=process.platform==='win32'?'where.exe':'which';
  const child=spawn(finder,[command],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  let out='';child.stdout.on('data',d=>out+=d);
  child.on('error',()=>resolve(null));
  child.on('close',code=>resolve(code===0?out.split(/\r?\n/).map(x=>x.trim()).find(Boolean)||null:null));
 });
}
async function locate(agent){
 const override=agent.envPath&&(process.env[agent.envPath]||'').trim();
 if(override&&await exists(override))return override;
 if(['github-copilot','agent-copilot'].includes(agent.id)&&process.platform==='win32'&&process.env.LOCALAPPDATA){
  const winget=join(process.env.LOCALAPPDATA,'Microsoft','WinGet','Links','copilot.exe');
  if(await exists(winget))return winget;
 }
 for(const command of agent.commands||[]){const found=await locateCommand(command);if(found)return found;}
 return null;
}

export function isCodexLoggedIn(text=''){
 const value=String(text);
 return !/\bnot logged in\b/i.test(value)&&/\blogged in\b/i.test(value);
}
export function parseCodexJsonOutput(stdout=''){
 let text='',failure=false,completed=false;
 for(const line of String(stdout).split(/\r?\n/)){
  try{
   const event=JSON.parse(line);
   if(event.type==='item.completed'&&event.item?.type==='agent_message'&&typeof event.item.text==='string')text=event.item.text;
   if(event.type==='turn.failed'||event.type==='error')failure=true;
   if(event.type==='turn.completed')completed=true;
  }catch{}
 }
 return {text:text.trim(),failure:failure||!completed||!text.trim()};
}
export function agentTimeoutMs(mode='analyze',env=process.env){
 const fallback=mode==='work'?600000:120000;
 const raw=Number(env.HUMANALE_AGENT_TIMEOUT_MS??env.DUDIDAM_AGENT_TIMEOUT_MS);
 if(!Number.isFinite(raw)||raw<=0)return fallback;
 return Math.max(30000,Math.min(900000,Math.round(raw)));
}
function runProcess(executable,args,{cwd,timeout=12000}={}){
 return new Promise(resolve=>{
  const child=spawn(executable,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NO_COLOR:'1'}});
  let stdout='',stderr='',settled=false;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish({code:null,stdout,stderr,timedOut:true});},timeout);
  child.stdout.on('data',data=>stdout+=data);
  child.stderr.on('data',data=>stderr=(stderr+data).slice(-16000));
  child.on('error',error=>finish({code:null,stdout,stderr,error}));
  child.on('close',code=>finish({code,stdout,stderr}));
 });
}
export function codexLoginProbe(result={}){
 const output=String(result.stdout||'')+'\n'+String(result.stderr||'');
 const ready=result.code===0&&isCodexLoggedIn(output);
 const errorCode=ready?null:result.error?.code?'CODEX_PROBE_'+result.error.code:result.timedOut?'CODEX_PROBE_TIMEOUT':result.code===0?'CODEX_PROBE_UNRECOGNIZED':/\bnot logged in\b/i.test(output)?'CODEX_NOT_LOGGED_IN':'CODEX_PROBE_FAILED';
 return {ready,errorCode};
}
function codexProbeMessage(auth){
 if(auth?.errorCode==='CODEX_NOT_LOGGED_IN')return 'Codex CLI terdeteksi tetapi belum login. Jalankan codex login lalu coba lagi.';
 if(auth?.errorCode==='CODEX_PROBE_ENOENT')return 'Pemeriksaan Codex gagal: folder proyek atau executable tidak tersedia. Pilih folder proyek yang masih ada.';
 if(auth?.errorCode==='CODEX_PROBE_TIMEOUT')return 'Pemeriksaan login Codex melewati batas waktu. Jalankan codex login status di terminal.';
 return 'Status login Codex belum dapat diperiksa. Jalankan codex login status di terminal untuk diagnosis.';
}
async function codexLoginStatus(executable,cwd){
 const result=await runProcess(executable,['login','status'],{cwd,timeout:12000});
 return {...result,...codexLoginProbe(result)};
}
export function agentDefinitions(){return agents.map(({commands,envPath,configEnv,configEnvs,secondaryEnv,...agent})=>({...agent}));}

export function classifyTaskDifficulty(prompt=''){
 const text=String(prompt||'').trim();
 let score=0;
 if(text.length>500)score++;
 if(/\b(refactor|migrat|arsitektur|architecture|integrat|debug|security|keamanan|release|deploy|runtime|database|android|electron|multi-agent|agent)\b/i.test(text))score++;
 if(/\b(lalu|kemudian|setelah|sekaligus|and then|after that|before|depends on|dependency)\b/i.test(text))score++;
 if(/\b(test|verify|build|audit|review|cek|perbaiki|fix|implement|ubah|edit)\b/i.test(text))score++;
 return score>=3?'high':score>=1?'medium':'low';
}
export function reviewVerdict(text=''){
 const value=String(text||'').toUpperCase();
 if(/\bVERDICT\s*:\s*NEEDS_FIX\b/.test(value))return 'needs_fix';
 if(/\bVERDICT\s*:\s*PASS\b/.test(value))return 'pass';
 return 'unknown';
}

export function requireIndependentWorkReview(result={}){
 const reviewers=Array.isArray(result?.stages)
  ?result.stages.filter(stage=>stage?.role==='reviewer')
  :[];
 const finalReviewer=reviewers.at(-1);
 if(!finalReviewer||reviewVerdict(finalReviewer.text)!=='pass'){
  const error=new Error('Mode Kerja memerlukan VERDICT: PASS dari tahap Reviewer independen terakhir. Status ringkasan tidak dapat menggantikan review tersebut.');
  error.code='AGENT_WORK_REVIEW_REQUIRED';
  error.category='verification';
  throw error;
 }
 return result;
}

export function selectStructuredRoles(available=[],preferredWorker=''){
 const allowed=new Set(['codex','github-copilot','cursor','claude']);
 const list=[...new Set((Array.isArray(available)?available:[]).filter(id=>allowed.has(id)))];
 if(!list.length)return null;
 if(preferredWorker){
  if(!list.includes(preferredWorker))return null;
  const worker=preferredWorker,others=list.filter(id=>id!==worker);
  const planner=others[0]||worker;
  const reviewer=others[1]||others[0]||worker;
  return {planner,worker,reviewer,degraded:reviewer===worker,executors:list};
 }
 const planner=list.includes('codex')?'codex':list[0];
 const worker=list.includes('github-copilot')&&planner!=='github-copilot'?'github-copilot':(list.find(id=>id!==planner)||planner);
 const others=list.filter(id=>id!==worker);
 const reviewer=others.find(id=>id!==planner)||others[0]||worker;
 return {planner,worker,reviewer,degraded:reviewer===worker,executors:list};
}

const STRUCTURED_ROLE_SKILL_IDS=Object.freeze({
 planner:Object.freeze(['reasoning','planner','memory']),
 worker:Object.freeze(['program','terminal','github','safety']),
 repair:Object.freeze(['program','terminal','safety','bug-hunter']),
 reviewer:Object.freeze(['bug-hunter','reasoning','safety','reporting'])
});

export function buildStructuredSkillPlan(){
 const plan={};
 for(const [role,ids] of Object.entries(STRUCTURED_ROLE_SKILL_IDS)){
  plan[role]=ids.map(id=>{
   const skill=getSkill(id);
   if(!skill)throw new Error('Skill NARA tidak ditemukan untuk role '+role+': '+id);
   return {id:skill.id,label:skill.label,group:skill.group,region:skill.region};
  });
 }
 return plan;
}

function structuredSkillInstructions(role,skills){
 const names=skills.map(skill=>skill.id+' ('+skill.label+')').join(', ');
 return 'NARA SKILL ASSIGNMENT untuk role '+role.toUpperCase()+': '+names+'. Gunakan skill ini sebagai panduan kemampuan dan fokus kerja. Label skill tidak memberikan izin tambahan; semua akses tetap tunduk pada trusted runtime, sandbox, dan maintenance policy.';
}

function structuredSkillSummary(plan){
 return Object.entries(plan).map(([role,skills])=>
  role.toUpperCase()+': '+skills.map(skill=>skill.id).join(', ')
 ).join(' | ');
}

function maintenanceChangeSetError(report){
 const error=new Error(
  'Perubahan AI maintenance diblokir: '+(report?.violations||[]).join(', ')
 );
 error.code='AI_MAINTENANCE_CHANGESET_BLOCKED';
 error.report=report;
 return error;
}

function looksLikeCopilotTrustPrompt(text=''){
 const value=String(text).replace(/\s+/g,' ').toLowerCase();
 return value.includes('trust the files in')||
  value.includes('trust this folder')||
  value.includes('trust this directory')||
  value.includes('confirm that you trust');
}

export function codexWorkspaceWriteRefusal(text=''){
 const value=String(text||'').replace(/\s+/g,' ').toLowerCase();
 return /\b(?:read[- ]only|readonly|hanya[- ]?baca)\b/.test(value)||
  /\b(?:cannot|can't|unable to|tidak dapat|tidak bisa|gagal)\b.{0,48}\b(?:write|writing|edit|mengedit|menulis)\b/.test(value)||
  /\b(?:write|writing|akses tulis)\b.{0,80}\b(?:blocked|denied|unavailable|ditolak|diblokir|tidak tersedia)\b/.test(value)||
  /\bsandbox\b.{0,80}\b(?:read[- ]only|readonly)\b/.test(value);
}
export class DeveloperAgentHub{
 constructor({processTerminator=terminateMaintenanceProcessTree,timeoutForMode=agentTimeoutMs,beforeExecutorSpawn=()=>{}}={}){
  if(typeof processTerminator!=='function'||typeof timeoutForMode!=='function'||typeof beforeExecutorSpawn!=='function')throw new TypeError('Trusted process lifecycle hooks must be functions.');
  this.child=null;this.pending=false;this.projectRoot='';this.maintenanceTransaction=null;
  this.processTerminator=processTerminator;this.timeoutForMode=timeoutForMode;
  this.beforeExecutorSpawn=beforeExecutorSpawn;
  this.maintenanceSignal=null;this.maintenanceAbortController=null;this.activeProcessStop=null;
 }
 setProjectRoot(value=''){this.projectRoot=String(value||'').trim();}
 getProjectRoot(){return (this.maintenanceTransaction?.cwd||this.projectRoot||process.env.HUMANALE_PROJECT_ROOT||process.env.DUDIDAM_PROJECT_ROOT||process.cwd()).trim();}
 async projectRootReady(){
  const root=this.getProjectRoot();
  try{await access(root);await access(join(root,'.git'));return true;}catch{return false;}
 }
 async status(){
  const projectRoot=this.getProjectRoot(),projectRootReady=await this.projectRootReady();
  const workReadiness=await inspectMaintenanceReadiness(projectRoot);
  const rows=await Promise.all(agents.map(async agent=>{
   if(agent.internal)return {id:agent.id,name:agent.name,method:agent.method,state:'setup',detail:'Menunggu executor lokal yang aman.',canRun:false,url:agent.url,executable:true};
   const executable=await locate(agent);
   const configNames=[agent.configEnv,...(agent.configEnvs||[])].filter(Boolean);
   const configured=configNames.length?Boolean(configNames.some(name=>(process.env[name]||'').trim())&&(!agent.secondaryEnv||(process.env[agent.secondaryEnv]||'').trim())):false;
   const codexAuth=agent.id==='codex'&&executable?await codexLoginStatus(executable,projectRoot):null;
   let state='available',detail='';
   if(agent.external){state='external';detail='Terdaftar di Agent Hub sebagai konektor eksternal; HumanALE god egine tidak menjalankannya langsung.';}
   else if(agent.runtime){state=configured?'configured':executable?'installed':'setup';detail=configured?'Kredensial provider runtime terdeteksi dari environment.':executable?'CLI lokal terdeteksi; provider runtime masih memerlukan kredensial environment.':'Provider tersedia di HumanALE god egine tetapi belum dikonfigurasi di environment.';}
   else if(agent.id==='replit'){state='mcp-client';detail='Replit Agent menerima remote MCP dari halaman Integrations.';}
   else if(agent.id==='pieces'){state=configured?'configured':executable?'installed':'setup';detail=configured?'PIECES_MCP_URL terdeteksi.':executable?'PiecesOS terdeteksi; salin URL MCP ke PIECES_MCP_URL bila ingin dipakai lintas agent.':'Install PiecesOS lalu ambil URL MCP lokal.';}
   else if(agent.id==='askcodi'){state=configured?'configured':'setup';detail=configured?'AskCodi API siap dipakai dari provider HumanALE god egine.':'Atur ASKCODI_API_KEY dan ASKCODI_MODEL.';}
   else if(agent.id==='codex'&&executable){state=codexAuth?.ready?'configured':'installed';detail=codexAuth?.ready?'Codex CLI terdeteksi dan login aktif.':codexProbeMessage(codexAuth);}
   else if(executable){state='installed';detail='CLI/aplikasi lokal terdeteksi.';}
   else{state='setup';detail=agent.method.includes('MCP')?'Belum terdeteksi lokal; integrasi MCP tetap didukung oleh produknya.':'Belum dikonfigurasi.';}
   return {id:agent.id,name:agent.name,method:agent.method,state,detail,canRun:Boolean(agent.canRun&&executable&&(agent.id!=='codex'||codexAuth?.ready)),url:agent.url,executable:executable?true:false,...(codexAuth?.errorCode?{errorCode:codexAuth.errorCode}:{})};
  }));
  const structuredExecutors=rows.filter(row=>['github-copilot','codex','cursor','claude'].includes(row.id)&&row.canRun);
  const orchestrator=rows.find(row=>row.id==='humanale-orchestrator');
  if(orchestrator){
   orchestrator.state=structuredExecutors.length?'configured':'setup';
   orchestrator.canRun=structuredExecutors.length>0;
   orchestrator.detail=structuredExecutors.length
    ?'Pipeline terstruktur siap: Planner membaca, Worker mengerjakan dengan izin terbatas, Reviewer memeriksa ulang. Executor: '+structuredExecutors.map(row=>row.name).join(', ')+'.'
    :'Pasang/login minimal satu executor: GitHub Copilot, OpenAI Codex, Cursor, atau Claude Code.';
  }
  return {
   projectRoot,
   projectRootReady,
   workReady:workReadiness.ready,workReadiness,
   workBlockReason:workReadiness.error,workBlockCode:workReadiness.code,
   maintenancePolicy:maintenancePolicySnapshot(),
   agents:rows
  };
 }
 async availableStructuredExecutors(){
  const cwd=this.getProjectRoot(),result=[];
  for(const id of ['codex','github-copilot','cursor','claude']){
   const agent=agents.find(item=>item.id===id);
   const executable=await locate(agent);
   if(!executable)continue;
   if(id==='codex'){
    const auth=await codexLoginStatus(executable,cwd);
    if(!auth.ready)continue;
   }else{
    const probe=await runProcess(executable,['--version'],{cwd,timeout:8000});
    if(probe.code!==0||probe.timedOut)continue;
   }
   result.push(id);
  }
  return result;
 }
 async runDirect(id,prompt,mode='analyze'){
  const signal=this.maintenanceSignal;
  const aborted=()=>Object.assign(new Error('Maintenance worker aborted.'),{code:'ABORTED'});
  if(signal?.aborted)throw aborted();
  const agent=agents.find(item=>item.id===id&&item.canRun&&!item.internal);
  if(!agent)throw new Error('Executor agent tidak tersedia.');
  if(mode==='work'&&!['github-copilot','codex','cursor','claude'].includes(id))throw new Error('Mode Kerja executor tidak didukung.');
  const executable=await locate(agent);
  if(!executable)throw new Error(agent.name+' belum ditemukan di PATH atau environment path khusus.');
  const cwd=this.getProjectRoot();
  this.beforeExecutorSpawn(Object.freeze({executable,id,mode,cwd}));
  if(mode==='work'&&!await this.projectRootReady())throw new Error('Folder proyek belum dipilih atau bukan checkout Git. Buka Developer agents → Pilih folder proyek, lalu pilih folder repo entitashuman.');
  if(mode==='work'&&!this.maintenanceTransaction)throw new Error('Mode kerja agent wajib berjalan di dalam AI maintenance transaction.');
  if(id==='codex'){
   const auth=await codexLoginStatus(executable,cwd);
   if(!auth.ready){
    const error=new Error(auth.errorCode==='CODEX_NOT_LOGGED_IN'?'Codex CLI terpasang tetapi belum login. Jalankan codex login di terminal lalu coba lagi.':codexProbeMessage(auth));
    error.code=auth.errorCode;throw error;
   }
  }
  const safeWorkPrompt=mode==='work'?buildMaintenanceWorkPrompt(prompt):prompt;
  const args=id==='continue'?['-p',prompt,'--readonly']
   :id==='cody'?['chat','-m',prompt]
   :id==='github-copilot'&&mode==='work'?['-p',safeWorkPrompt,'-s','--available-tools=view,grep,glob,edit,create,apply_patch','--allow-tool=write','--disable-builtin-mcps','--no-ask-user','--no-auto-update','--disallow-temp-dir']
   :id==='github-copilot'?['-p',prompt,'-s','--available-tools=view,grep,glob','--disable-builtin-mcps','--no-ask-user','--no-auto-update','--disallow-temp-dir']
   :id==='codex'&&mode==='work'?['exec','--json','--sandbox','workspace-write','--ephemeral','--ignore-user-config',safeWorkPrompt]
   :id==='codex'?['exec','--json','--sandbox','read-only','--ephemeral','--ignore-user-config',prompt]
   :id==='cursor'&&mode==='work'?['-p',safeWorkPrompt,'--sandbox','enabled','--output-format','text']
   :id==='cursor'?['-p',prompt,'--mode=ask','--sandbox','enabled','--output-format','text']
   :id==='claude'&&mode==='work'?['-p',safeWorkPrompt,'--model','claude-fable-5','--permission-mode','dontAsk','--tools','Read,Glob,Grep,Edit,Write,Bash','--allowedTools','Read,Glob,Grep,Edit,Write,Bash(npm test:*),Bash(npm run verify:*)','--output-format','text','--no-session-persistence']
   :id==='claude'?['-p',prompt,'--model','claude-fable-5','--permission-mode','plan','--tools','Read,Glob,Grep','--output-format','text','--no-session-persistence']
   :['-p',prompt,'--mode=ask','--output-format','text'];
  if(signal?.aborted)throw aborted();
  const timeoutMs=this.timeoutForMode(mode);
  const directResult=await new Promise((resolve,reject)=>{
   const transaction=this.maintenanceTransaction;
   const maintenanceEnv=sanitizeMaintenanceEnvironment(process.env,{
    isolatedHome:this.maintenanceTransaction?.isolatedHome||''
   }).env;
   const child=spawn(executable,args,{cwd,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:maintenanceEnv});
   this.child=child;let stdout='',stderr='',settled=false,stopping=false,stopPromise=null,terminationUnconfirmed=false;
   const finish=(error,value)=>{
    if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
    if(this.activeProcessStop===stop)this.activeProcessStop=null;
    if(this.child===child&&!terminationUnconfirmed)this.child=null;
    error?reject(error):resolve(value);
   };
   const stop=error=>{
    if(settled)return stopPromise;
    if(stopping)return stopPromise;
    stopping=true;
    stopPromise=(async()=>{
     let result;
     try{result=await this.processTerminator(child);}catch{result={terminationConfirmed:false};}
     if(result?.terminationConfirmed!==true){
      terminationUnconfirmed=true;
      markMaintenanceProcessUnconfirmed(transaction);
      finish(transaction?maintenanceProcessRecoveryError(error):Object.assign(new Error('Agent process termination is unconfirmed.'),{code:'WORKER_TERMINATION_UNCONFIRMED'}));
     }
     else finish(error);
     return result;
    })();
    return stopPromise;
   };
   const onAbort=()=>stop(aborted());
   this.activeProcessStop=stop;
   const timer=setTimeout(()=>stop(Object.assign(new Error(agent.name+' belum selesai dalam '+Math.round(timeoutMs/1000)+' detik.'),{code:'WORKER_TIMEOUT'})),timeoutMs);
   signal?.addEventListener('abort',onAbort,{once:true});
   if(signal?.aborted)onAbort();
   child.stdout.on('data',data=>{
    stdout+=data;
    if(id==='github-copilot'&&looksLikeCopilotTrustPrompt(stdout)){
     stop(new Error('GitHub Copilot meminta konfirmasi trust folder. Buka terminal di folder proyek, jalankan copilot sekali, trust folder tersebut, lalu jalankan lagi dari HumanALE god egine.'));
     return;
    }
    if(stdout.length>400000)stop(new Error('Output agent terlalu besar.'));
   });
   child.stderr.on('data',data=>{
    stderr=(stderr+data).slice(-16000);
    if(id==='github-copilot'&&looksLikeCopilotTrustPrompt(stderr)){
     stop(new Error('GitHub Copilot meminta konfirmasi trust folder. Buka terminal di folder proyek, jalankan copilot sekali, trust folder tersebut, lalu jalankan lagi dari HumanALE god egine.'));
    }
   });
   child.on('error',()=>{if(!stopping)finish(new Error(agent.name+' tidak dapat dijalankan.'));});
   child.on('close',code=>{
    if(stopping)return;
    if(id==='codex'){
     const parsed=parseCodexJsonOutput(stdout);
     const combined=(stderr+'\n'+stdout).trim();
     if(/not logged in|login required|authentication|unauthorized/i.test(combined))return finish(new Error('Login Codex tidak aktif. Jalankan codex login lalu coba lagi.'));
     if(code===0&&!parsed.failure)return finish(null,{id,name:agent.name,mode,text:parsed.text||'Codex selesai tanpa pesan teks.'});
     return finish(new Error((stderr||parsed.text||'Codex gagal dijalankan.').trim()));
    }
    return code===0?finish(null,{id,name:agent.name,mode,text:stdout.trim()||'Agent selesai tanpa output teks.'}):finish(new Error((stderr||stdout||agent.name+' gagal dijalankan.').trim()));
   });
  });
  if(mode==='work'){
   const inspection=await this.maintenanceTransaction.inspect();
   if(!inspection.allowed)throw maintenanceChangeSetError(inspection);
   if(inspection.paths.length===0){
    const writeBlocked=id==='codex'&&codexWorkspaceWriteRefusal(directResult.text);
    const error=new Error(writeBlocked
     ?'Codex tidak menghasilkan perubahan karena write workspace tidak efektif pada sesi ini. Gunakan HumanALE Orchestrator agar Planner/Reviewer Codex tetap dapat dipakai sementara Worker dialihkan ke executor aman lain.'
     :agent.name+' selesai tanpa menghasilkan perubahan berkas. Mode Kerja hanya dianggap berhasil setelah perubahan nyata terdeteksi.');
    error.code=writeBlocked?'CODEX_WORKSPACE_WRITE_UNAVAILABLE':'AGENT_WORK_NO_CHANGES';
    error.category='blocked';error.executor=id;
    throw error;
   }
   return {
    ...directResult,
    maintenance:Object.freeze({
     transactionId:inspection.transactionId,
     changedFiles:inspection.paths.length,
     totalBytes:inspection.totalBytes
    })
   };
  }
  return directResult;
 }
 async runStructured(prompt,mode,preferredWorker=''){
  if(mode==='work'&&!await this.projectRootReady())throw new Error('Folder proyek belum dipilih atau bukan checkout Git.');
  const available=await this.availableStructuredExecutors();
  if(!available.length)throw new Error('HumanALE Orchestrator memerlukan minimal satu executor lokal yang siap: Codex, GitHub Copilot, Cursor, atau Claude Code.');
  const difficulty=classifyTaskDifficulty(prompt);
  const roles=selectStructuredRoles(available,preferredWorker);
  if(!roles)throw new Error('HumanALE Orchestrator tidak menemukan executor terverifikasi.');
  const {planner,worker,reviewer,degraded}=roles;
  const skillPlan=buildStructuredSkillPlan();
  if(mode==='work'&&reviewer===worker)throw new Error('Mode Kerja memerlukan executor reviewer independen yang berbeda dari Worker. Hubungkan minimal dua executor sebelum menjalankan perubahan.');
  const planPrompt='Kamu adalah Planner HumanALE. '+structuredSkillInstructions('planner',skillPlan.planner)+' Analisis tugas berikut secara read-only. Pecah menjadi langkah berurutan, dependensi, file/area yang mungkin terdampak, risiko, dan kriteria selesai. Jangan edit file. Jangan menjalankan publish/push/merge. Tugas: '+prompt;
  const plan=await this.runDirect(planner,planPrompt,'analyze');
  const workPrompt='Kamu adalah Worker HumanALE. '+structuredSkillInstructions('worker',skillPlan.worker)+' Ikuti rencana Planner berikut dan fokus menyelesaikan tugas pengguna. Jika mode ini read-only, berikan implementasi/rencana konkret tanpa edit. Jika mode kerja, edit hanya yang perlu, jalankan test relevan, dan jangan push/merge/publish. TASK:\n'+prompt+'\n\nPLAN:\n'+plan.text;
  const work=await this.runDirect(worker,workPrompt,mode);
  const reviewPrompt='Kamu adalah Reviewer HumanALE. '+structuredSkillInstructions('reviewer',skillPlan.reviewer)+' Periksa tugas, rencana, dan hasil Worker. Dalam mode read-only, inspeksi proyek bila tersedia tetapi jangan edit. Fokus pada correctness, regression, security, test coverage, dan apakah permintaan benar-benar selesai. Akhiri tepat dengan salah satu baris: VERDICT: PASS atau VERDICT: NEEDS_FIX.\n\nTASK:\n'+prompt+'\n\nPLAN:\n'+plan.text+'\n\nWORKER RESULT:\n'+work.text;
  let review=await this.runDirect(reviewer,reviewPrompt,'analyze'),repair=null;
  let verdict=reviewVerdict(review.text);
  if(verdict==='unknown'){
   const retryPrompt=reviewPrompt+'\n\nPENTING: Respons sebelumnya tidak memiliki VERDICT valid. Ulangi review secara ringkas dan wajib akhiri tepat dengan VERDICT: PASS atau VERDICT: NEEDS_FIX.';
   review=await this.runDirect(reviewer,retryPrompt,'analyze');
   verdict=reviewVerdict(review.text);
   if(verdict==='unknown')throw new Error('Reviewer HumanALE tidak memberikan VERDICT valid setelah retry. Pipeline dihentikan fail-closed.');
  }
  if(mode==='work'&&verdict==='needs_fix'){
   const repairPrompt='Kamu adalah Repair Worker HumanALE. '+structuredSkillInstructions('repair',skillPlan.repair)+' Perbaiki hanya masalah konkret yang disebut Reviewer, tetap di folder proyek, tanpa push/merge/publish atau perubahan kredensial. Jalankan test relevan. TASK:\n'+prompt+'\n\nREVIEW:\n'+review.text;
   repair=await this.runDirect(worker,repairPrompt,'work');
   const finalPrompt='Kamu adalah Final Reviewer HumanALE. '+structuredSkillInstructions('reviewer',skillPlan.reviewer)+' Periksa ulang tugas setelah repair. Jangan edit. Akhiri tepat dengan VERDICT: PASS atau VERDICT: NEEDS_FIX.\n\nTASK:\n'+prompt+'\n\nREPAIR RESULT:\n'+repair.text;
   review=await this.runDirect(reviewer,finalPrompt,'analyze');
   verdict=reviewVerdict(review.text);
   if(verdict!=='pass')throw new Error('Final Reviewer HumanALE belum memberikan VERDICT: PASS. Pipeline dihentikan fail-closed.');
  }
  const stages=[
   {role:'planner',agent:planner,skills:skillPlan.planner,text:plan.text},
   {role:'worker',agent:worker,skills:skillPlan.worker,text:work.text},
   ...(repair?[{role:'repair',agent:worker,skills:skillPlan.repair,text:repair.text}]:[]),
   {role:'reviewer',agent:reviewer,skills:skillPlan.reviewer,text:review.text}
  ];
  const summary=[
   'HumanALE Orchestrator · '+difficulty.toUpperCase()+' · '+mode.toUpperCase()+(degraded?' · DEGRADED SINGLE-EXECUTOR':' · INDEPENDENT REVIEW'),
   'Planner: '+planner+' · Worker: '+worker+' · Reviewer: '+reviewer,
   'Skill map: '+structuredSkillSummary(skillPlan),
   '',
   '[PLAN]',
   plan.text,
   '',
   '[WORK]',
   work.text,
   ...(repair?['','[REPAIR]',repair.text]:[]),
   '',
   '[REVIEW]',
   review.text
  ].join('\n');
  return {id:'humanale-orchestrator',name:'HumanALE Orchestrator',mode,difficulty,stages,skillPlan,text:summary};
 }
 async runTrustedMaintenanceWork(prompt,{transaction,signal=null}={}){
  if(this.maintenanceTransaction?.processTerminationUnconfirmed)throw maintenanceProcessRecoveryError();
  if(this.pending)throw new Error('Tunggu agent sebelumnya selesai.');
  const task=String(prompt||'').trim();
  if(!task||task.length>4000)throw new Error('Prompt agent harus berisi 1–4000 karakter.');
  assertMaintenanceTaskAllowed(task,{mode:'work'});
  if(!transaction||transaction.released||typeof transaction.inspect!=='function'||typeof transaction.rollback!=='function'){
   const error=new Error('Trusted maintenance work memerlukan transaction aktif yang valid.');
   error.code='AI_MAINTENANCE_TRUSTED_TRANSACTION_REQUIRED';
   throw error;
  }
  const projectRoot=this.getProjectRoot();
  if(!await this.projectRootReady())throw new Error('AI maintenance memerlukan checkout Git proyek yang dipilih secara eksplisit.');
  const transactionRoot=String(transaction.cwd||'').trim();
  let sameRoot=false;
  if(transactionRoot){
   try{
    // A selected checkout can use a Windows junction/drive alias while the
    // transaction stores Git's canonical root. Resolve both before comparison.
    const [selected,active]=await Promise.all([realpath(projectRoot),realpath(transactionRoot)]);
    const samePath=process.platform==='win32'
     ?selected.toLowerCase()===active.toLowerCase()
     :selected===active;
    const [selectedDirectory,activeDirectory]=await Promise.all([
     stat(selected,{bigint:true}),stat(active,{bigint:true})
    ]);
    // File identity also rejects distinct case-sensitive Windows directories
    // even if their canonical path spellings match after case folding.
    sameRoot=samePath&&selectedDirectory.isDirectory()&&activeDirectory.isDirectory()&&
     selectedDirectory.dev===activeDirectory.dev&&selectedDirectory.ino===activeDirectory.ino;
   }catch{
    // Unresolvable or inaccessible identity remains a refusal before work.
   }
  }
  if(!transactionRoot||!sameRoot){
   const error=new Error('Trusted maintenance transaction tidak cocok dengan project root Agent Hub.');
   error.code='AI_MAINTENANCE_TRANSACTION_ROOT_MISMATCH';
   throw error;
  }

  this.pending=true;
  this.maintenanceTransaction=transaction;
  this.maintenanceAbortController=new AbortController();
  this.maintenanceSignal=signal?AbortSignal.any([signal,this.maintenanceAbortController.signal]):this.maintenanceAbortController.signal;
  try{
   const result=requireIndependentWorkReview(await this.runStructured(task,'work'));
   const finalInspection=await transaction.inspect({rollbackOnViolation:false});
   if(!finalInspection.allowed)throw maintenanceChangeSetError(finalInspection);
   return {
    ...result,
    maintenance:Object.freeze({
     transactionId:transaction.id,
     changedFiles:finalInspection.paths.length,
     totalBytes:finalInspection.totalBytes
    })
   };
  }finally{
   if(this.maintenanceTransaction===transaction&&!transaction.processTerminationUnconfirmed)this.maintenanceTransaction=null;
   this.maintenanceSignal=null;this.maintenanceAbortController=null;
   this.pending=false;
  }
 }

 async run(value){
  if(this.maintenanceTransaction?.processTerminationUnconfirmed)throw maintenanceProcessRecoveryError();
  if(this.pending)throw new Error('Tunggu agent sebelumnya selesai.');
  const id=String(value?.id||''),mode=value?.mode==='work'?'work':'analyze';
  const externalSignal=value?.signal||null;
  let prompt=String(value?.prompt||'').trim();
  if(!prompt||prompt.length>4000)throw new Error('Prompt agent harus berisi 1–4000 karakter.');
  if(externalSignal?.aborted)throw Object.assign(new Error('Agent Hub task aborted.'),{code:'ABORTED'});

  this.pending=true;
  let transaction=null;
  this.maintenanceSignal=externalSignal;
  try{
   if(mode==='work'){
    assertMaintenanceTaskAllowed(prompt,{mode});
    const cwd=this.getProjectRoot();
    if(!await this.projectRootReady())throw new Error('AI maintenance memerlukan checkout Git proyek yang dipilih secara eksplisit.');
    transaction=await beginMaintenanceTransaction(cwd);
    this.maintenanceTransaction=transaction;
    this.maintenanceAbortController=new AbortController();
    this.maintenanceSignal=externalSignal
     ?AbortSignal.any([externalSignal,this.maintenanceAbortController.signal])
     :this.maintenanceAbortController.signal;
   }

   if(mode==='work'&&value?.memoryContext!=null){
    const error=new Error('Mode kerja AI maintenance tidak menerima memory context langsung. Gunakan mode Analisis/Planner; trusted scoped context untuk Worker belum diaktifkan.');
    error.code='AI_MAINTENANCE_WORK_MEMORY_BLOCKED';
    throw error;
   }
   const memoryContext=validateMemoryContext(value?.memoryContext,{allowedTargets:['planner','agent']});
   const contextBlock=memoryContextBlock(memoryContext);
   if(contextBlock)prompt=contextBlock+'\n\nTugas pengguna:\n'+prompt;

   const result=id==='humanale-orchestrator'
    ?await this.runStructured(prompt,mode)
    :mode==='work'
     ?await this.runStructured(prompt,mode,id)
     :await this.runDirect(id,prompt,mode);
   // Every work-mode route, including a directly selected executor, must pass
   // through Planner → Worker → Reviewer and the final reviewer gate.
   if(mode==='work')requireIndependentWorkReview(result);

   if(transaction){
    const finalInspection=await transaction.inspect();
    if(!finalInspection.allowed)throw maintenanceChangeSetError(finalInspection);
    return {...result,maintenance:Object.freeze({transactionId:transaction.id,
     changedFiles:finalInspection.paths.length,totalBytes:finalInspection.totalBytes})};
   }
   return result;
  }catch(error){
   if(transaction?.processTerminationUnconfirmed)throw maintenanceProcessRecoveryError(error);
   if(transaction&&!transaction.released&&!transaction.processTerminationUnconfirmed){
    try{
     const rollback=await transaction.rollback('PIPELINE_FAILED');
     if(rollback?.rolledBack)error.maintenanceRollback=rollback;
    }catch(rollbackError){
     if(rollbackError?.code==='AI_MAINTENANCE_MANUAL_RECOVERY_REQUIRED'){
      const wrapped=new Error(
       String(error?.message||error)+
       ' Repository identity berubah; rollback otomatis dihentikan dan recovery manual diperlukan.'
      );
      wrapped.code='AI_MAINTENANCE_MANUAL_RECOVERY_REQUIRED';
      wrapped.cause=error;
      wrapped.rollback=rollbackError;
      throw wrapped;
     }
     error.maintenanceRollbackError=String(rollbackError?.message||rollbackError);
    }
   }
   throw error;
  }finally{
   if(transaction&&!transaction.released&&!transaction.processTerminationUnconfirmed){
    try{await transaction.release();}catch{}
   }
   if(this.maintenanceTransaction===transaction&&!transaction?.processTerminationUnconfirmed)this.maintenanceTransaction=null;
   this.maintenanceSignal=null;this.maintenanceAbortController=null;
   this.pending=false;
  }
 }
 stop(){
  this.maintenanceAbortController?.abort();
  if(this.activeProcessStop)return this.activeProcessStop(Object.assign(new Error('Maintenance worker aborted.'),{code:'ABORTED'}));
  if(this.child){
   const child=this.child;
   return Promise.resolve().then(()=>this.processTerminator(child)).then(result=>{
    if(result?.terminationConfirmed===true&&this.child===child)this.child=null;
    return result;
   },()=>({terminationConfirmed:false}));
  }
 }
}

export const agentMaintenanceCapabilities=Object.freeze({
 allowed:AI_MAINTENANCE_ALLOWED_CAPABILITIES,
 denied:AI_MAINTENANCE_DENIED_CAPABILITIES
});
