const {app,BrowserWindow,ipcMain,shell,dialog,screen,desktopCapturer,Tray,Menu,nativeImage,globalShortcut,session}=require('electron');
const http=require('node:http');
const {readFile,writeFile}=require('node:fs/promises');
const {mkdtempSync,existsSync}=require('node:fs');
const path=require('node:path');
const {tmpdir,homedir}=require('node:os');
const {randomUUID}=require('node:crypto');
const {spawn}=require('node:child_process');

let win,panelWin,cloudLoginWin,server,origin,bridges,cloudMemory,agentHub,naraAgentCoordinator,terminalManager,terminalPolicy,indonesianStt,indonesianTts,nara,naraVoice,humanaleRuntime,ownerStore,ownerGate,systemObserver,dataFlowMeter,experienceStore,experienceSaveTimer,stopSystemObserver,dataFlowTimer,tray,saveTimer,pointerTimer,backdropTimer;
let cloudAllowedOrigins=new Set();
let announceNaraEvent=()=>{};
let baseWindowSize={width:420,height:480};
let panelZoomFactor=1;
let quitting=false;
let pendingDismiss='';
let passthrough=false;
let passthroughLocked=false;
let panelViewportOpen=false;
let backdropSampling=false;
const summonShortcut='CommandOrControl+Alt+5';
const ciSmoke=process.argv.includes('--ci-smoke');
if(process.platform==='win32')app.setAppUserModelId('id.my.aleprinting.dudidam');
if(ciSmoke)app.setPath('userData',mkdtempSync(path.join(tmpdir(),'dudidam-ci-smoke-')));
app.on('before-quit',()=>{
 try{stopSystemObserver?.();}catch{}
 try{if(dataFlowTimer)clearInterval(dataFlowTimer);}catch{}
 try{if(experienceSaveTimer)clearTimeout(experienceSaveTimer);}catch{}
 try{if(experienceStore&&nara?.experience)experienceStore.saveSync(nara.experience.snapshot());}catch{}
 try{humanaleRuntime?.stop();}catch{}
 try{nara?.stop();}catch{}
});

function statePath(){return path.join(app.getPath('userData'),'window-state.json');}
function projectRootPath(){return path.join(app.getPath('userData'),'project-root.txt');}
async function readProjectRoot(){try{return (await readFile(projectRootPath(),'utf8')).trim();}catch{return '';}}
async function readWindowPosition(){try{const value=JSON.parse(await readFile(statePath(),'utf8'));return Number.isFinite(value?.x)&&Number.isFinite(value?.y)?value:null;}catch{return null;}}
function safePosition(saved,width,height){
 const display=saved?screen.getDisplayNearestPoint({x:Math.round(saved.x+width/2),y:Math.round(saved.y+height/2)}):screen.getPrimaryDisplay();
 const area=display.workArea;
 const fallback={x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2)};
 if(!saved)return fallback;
 return {x:Math.max(area.x-width+120,Math.min(area.x+area.width-120,Math.round(saved.x))),y:Math.max(area.y-height+120,Math.min(area.y+area.height-120,Math.round(saved.y)))};
}
function savePositionSoon(){
 clearTimeout(saveTimer);
 saveTimer=setTimeout(async()=>{if(!win||win.isDestroyed())return;const [x,y]=win.getPosition();try{await writeFile(statePath(),JSON.stringify({x,y}),'utf8');}catch{}},250);
}
function showAvatar(){
 if(!win||win.isDestroyed())return;
 pendingDismiss='';win.show();win.setAlwaysOnTop(true,'floating');win.moveTop();win.focus();
 if(!win.webContents.isLoading())win.webContents.send('dudidam:show');
}
function summonAvatar(){
 if(!win||win.isDestroyed())return;
 pendingDismiss='';win.show();win.center();win.setAlwaysOnTop(true,'floating');win.moveTop();
 if(!win.webContents.isLoading())win.webContents.send('dudidam:summon');
}
function finishDismiss(){
 const reason=pendingDismiss||'hide';pendingDismiss='';
 if(reason==='quit'){quitting=true;app.quit();return;}
 panelWin?.hide();
 win?.hide();
}
function requestDismiss(reason='hide'){
 if(!win||win.isDestroyed()){if(reason==='quit'){quitting=true;app.quit();}return;}
 if(reason==='quit')announceNaraEvent('nara.shutdown');
 pendingDismiss=reason==='quit'?'quit':'hide';
 if(!win.isVisible()||win.webContents.isLoading()){finishDismiss();return;}
 win.webContents.send('dudidam:dismiss',pendingDismiss);
}
function rebuildTrayMenu(){
 if(!tray||tray.isDestroyed())return;
 tray.setContextMenu(Menu.buildFromTemplate([
  {label:'Tampilkan HumanALE god egine',click:showAvatar},
  {label:'Panggil ALE (Ctrl+Alt+5)',click:summonAvatar},
  {label:'Sembunyikan',click:()=>requestDismiss('hide')},
  {type:'separator'},
  {label:'Selalu di atas',type:'checkbox',checked:win?.isAlwaysOnTop()??true,click:item=>win?.setAlwaysOnTop(item.checked,'floating')},
  {label:'Tembus klik penuh',type:'checkbox',checked:passthroughLocked,click:item=>setPassthroughLock(item.checked)},
  {type:'separator'},
  {label:'Keluar',click:()=>requestDismiss('quit')}
 ]));
}
function applyPassthrough(value){
 const next=Boolean(value);
 if(next===passthrough)return;
 passthrough=next;
 win?.setIgnoreMouseEvents(passthrough,{forward:true});
}
function setDynamicPassthrough(value){if(!passthroughLocked)applyPassthrough(value);}
function setPassthroughLock(value){passthroughLocked=Boolean(value);applyPassthrough(passthroughLocked);rebuildTrayMenu();}
function resizeForPanel(zoom=1,open=false){
 if(!win||win.isDestroyed())return;
 panelViewportOpen=Boolean(open);
 panelZoomFactor=Math.max(1,Math.min(1.45,Number(zoom)||1));
 const factor=panelViewportOpen?panelZoomFactor:1;
 const [oldW,oldH]=win.getSize(),[oldX,oldY]=win.getPosition();
 const center={x:Math.round(oldX+oldW/2),y:Math.round(oldY+oldH/2)};
 const display=screen.getDisplayNearestPoint(center),area=display.workArea;
 const width=Math.min(area.width,Math.round(baseWindowSize.width*factor));
 const height=Math.min(area.height,Math.round(baseWindowSize.height*factor));
 const x=Math.max(area.x,Math.min(area.x+area.width-width,Math.round(center.x-width/2)));
 const y=Math.max(area.y,Math.min(area.y+area.height-height,Math.round(center.y-height/2)));
 const [currentW,currentH]=win.getSize();
 if(currentW===width&&currentH===height)return;
 win.setBounds({x,y,width,height},false);
}
function resizeForAvatar(value=420){
 const size=Math.max(180,Math.min(540,Number(value)||420));
 baseWindowSize={width:Math.max(360,size+40),height:Math.max(420,size+100)};
 resizeForPanel(panelZoomFactor,panelViewportOpen);
}
async function openPanel(view='controls'){
 if(!win||win.isDestroyed())return;
 const allowed=['controls','chatDialog','agentDialog','terminalDialog'];
 const target=allowed.includes(view)?view:'controls';
 const bounds=win.getBounds(),display=screen.getDisplayNearestPoint({x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}),area=display.workArea;
 const terminalView=target==='terminalDialog';
 const width=Math.min(terminalView?900:460,area.width),height=Math.min(terminalView?720:680,area.height);
 if(panelWin&&!panelWin.isDestroyed()){
  const current=panelWin.getBounds();
  const x=Math.max(area.x,Math.min(area.x+area.width-width,current.x));
  const y=Math.max(area.y,Math.min(area.y+area.height-height,current.y));
  panelWin.setBounds({x,y,width,height},false);
  panelWin.show();panelWin.focus();panelWin.webContents.send('dudidam:panel-view',target);return;
 }
 const rightSpace=area.x+area.width-(bounds.x+bounds.width),leftSpace=bounds.x-area.x;
 let x;
 if(rightSpace>=width+16)x=bounds.x+bounds.width+16;
 else if(leftSpace>=width+16)x=bounds.x-width-16;
 else if(area.width>=bounds.width+width+16){
  const leftAvatarX=area.x+width+16;
  const rightAvatarX=area.x+area.width-width-16-bounds.width;
  const putPanelLeft=Math.abs(bounds.x-leftAvatarX)<=Math.abs(bounds.x-rightAvatarX);
  const avatarX=putPanelLeft?leftAvatarX:rightAvatarX;
  win.setPosition(avatarX,bounds.y);
  x=putPanelLeft?area.x:avatarX+bounds.width+16;
 }else x=rightSpace>=leftSpace?area.x+area.width-width:area.x;
 const y=Math.max(area.y,Math.min(area.y+area.height-height,bounds.y));
 panelWin=new BrowserWindow({width,height,x,y,minWidth:350,minHeight:360,backgroundColor:'#081610',frame:true,resizable:true,alwaysOnTop:true,show:false,title:'HumanALE god egine · Panel',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,spellcheck:false}});
 panelWin.setAlwaysOnTop(true,'floating');
 panelWin.webContents.setWindowOpenHandler(({url})=>{try{if(['https://chatgpt.com','https://github.com'].includes(new URL(url).origin))shell.openExternal(url);}catch{}return {action:'deny'};});
 panelWin.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/'))event.preventDefault();});
 panelWin.webContents.on('will-attach-webview',event=>event.preventDefault());
 panelWin.on('closed',()=>{panelWin=null;});
 try{
  await panelWin.loadURL(origin+'/?panel='+encodeURIComponent(target));
  if(ownerGate?.isUnlocked(String(win?.webContents?.id||'')))ownerGate.unlock(String(panelWin.webContents.id));
  panelWin?.show();panelWin?.focus();
 }
 catch(error){console.error('HumanALE god egine panel failed:',error);throw error;}
}
function safeCloudNavigation(value){
 try{return cloudAllowedOrigins.has(new URL(value).origin);}
 catch{return false;}
}

function publishGlobalPointer(){
 if(!win||win.isDestroyed()||!win.isVisible()||win.webContents.isLoading())return;
 const point=screen.getCursorScreenPoint(),areas=screen.getAllDisplays().map(display=>display.workArea);
 const left=Math.min(...areas.map(area=>area.x)),top=Math.min(...areas.map(area=>area.y));
 const right=Math.max(...areas.map(area=>area.x+area.width)),bottom=Math.max(...areas.map(area=>area.y+area.height));
 const bounds=win.getBounds(),centerX=bounds.x+bounds.width/2,centerY=bounds.y+bounds.height/2;
 const x=Math.max(-1,Math.min(1,(point.x-centerX)/Math.max(1,(right-left)/2)));
 const y=Math.max(-1,Math.min(1,(point.y-centerY)/Math.max(1,(bottom-top)/2)));
 win.webContents.send('dudidam:global-pointer',{x,y});
}

async function sampleAvatarBackdrop(bounds){
 const columns=16,rows=20;
 const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:480,height:480},fetchWindowIcons:false});
 const displays=screen.getAllDisplays();
 const images=sources.map(source=>{
  const display=displays.find(item=>String(item.id)===String(source.display_id));
  if(!display||source.thumbnail.isEmpty())return null;
  return {bounds:display.bounds,size:source.thumbnail.getSize(),bytes:source.thumbnail.toBitmap()};
 }).filter(Boolean);
 if(!images.length)throw new Error('No display pixels available');
 const values=[];
 for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
  const sx=bounds.x+(column+.5)/columns*bounds.width;
  const sy=bounds.y+(row+.5)/rows*bounds.height;
  const image=images.find(item=>sx>=item.bounds.x&&sx<item.bounds.x+item.bounds.width&&sy>=item.bounds.y&&sy<item.bounds.y+item.bounds.height);
  if(!image){values.push(null);continue;}
  const px=Math.min(image.size.width-1,Math.max(0,Math.floor((sx-image.bounds.x)/image.bounds.width*image.size.width)));
  const py=Math.min(image.size.height-1,Math.max(0,Math.floor((sy-image.bounds.y)/image.bounds.height*image.size.height)));
  let sum=0,count=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const ix=Math.max(0,Math.min(image.size.width-1,px+dx));
   const iy=Math.max(0,Math.min(image.size.height-1,py+dy));
   const offset=(iy*image.size.width+ix)*4;
   sum+=(image.bytes[offset+2]*.2126+image.bytes[offset+1]*.7152+image.bytes[offset]*.0722)/255;
   count++;
  }
  values.push(sum/count);
 }
 return {columns,rows,values};
}
async function publishAvatarBackdrop(){
 if(backdropSampling||!win||win.isDestroyed()||!win.isVisible()||win.webContents.isLoading())return;
 backdropSampling=true;
 try{
  const grid=await sampleAvatarBackdrop(win.getBounds());
  if(win&&!win.isDestroyed()&&!win.webContents.isLoading())win.webContents.send('dudidam:backdrop',grid);
 }catch{}
 finally{backdropSampling=false;}
}

if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',showAvatar);
 app.whenReady().then(async()=>{
  const [{ChatGPTBridge},{CopilotBridge},{OpenAIBridge},{GrokBridge},{GeminiBridge},{ClaudeBridge},{DeepSeekBridge},{AskCodiBridge},{DeveloperAgentHub,agentDefinitions},{validateMemoryContext},{NaraCloudContextClient,normalizeOrigin},{TerminalManager},policyModule,{IndonesianStt},{IndonesianTts},{createSystemObserver,createDataFlowMeter}]=await Promise.all([import('./bridge.mjs'),import('./copilot.mjs'),import('./openai-api.mjs'),import('./grok.mjs'),import('./gemini.mjs'),import('./claude.mjs'),import('./deepseek.mjs'),import('./askcodi.mjs'),import('./agent-hub.mjs'),import('./memory-context.mjs'),import('./nara-cloud-context.mjs'),import('./terminal-manager.mjs'),import('./terminal-policy.mjs'),import('./indonesian-stt.mjs'),import('./indonesian-tts.mjs'),import('./system-observer.mjs')]);
  const [{createOrchestrator,createExperienceModel},{createVoiceFeedback},{createExperienceStore},{createOwnerStore},{createHumanALERuntimeHost},{createNaraAgentCoordinator},{createHumanALEOwnerGate}]=await Promise.all([
   import('../nara-core/brain/index.js'),
   import('../nara-core/voice/index.js'),
   import('../nara-core/persistence/experience-store.mjs'),
   import('../nara-core/security/owner-store.mjs'),
   import('./humanale-runtime-host.mjs'),
   import('./nara-agent-coordinator.mjs'),
   import('./humanale-owner-gate.mjs')
  ]);
  naraVoice=createVoiceFeedback();
  systemObserver=createSystemObserver({intervalMs:5000});
  dataFlowMeter=createDataFlowMeter();
  experienceStore=createExperienceStore({filePath:path.join(app.getPath('userData'),'nara-experience.json')});
  const ownerStorePath=ciSmoke
   ?path.join(app.getPath('userData'),'nara-owner.json')
   :(process.env.NARA_OWNER_STORE||path.join(homedir(),'.nara','owner.json'));
  ownerStore=createOwnerStore({filePath:ownerStorePath});
  const bootstrapOwnerPassword=String(process.env.NARA_CREATOR_PASSWORD||'');
  if(!ownerStore.configured()&&bootstrapOwnerPassword){
   ownerStore.provision({
    username:process.env.NARA_CREATOR_USERNAME||'creator',
    password:bootstrapOwnerPassword
   });
  }
  delete process.env.NARA_CREATOR_PASSWORD;
  ownerGate=createHumanALEOwnerGate({store:ownerStore});
  const experience=createExperienceModel();
  let restoredExperience=null;
  try{
   restoredExperience=await experienceStore.load();
   if(restoredExperience)experience.hydrate(restoredExperience);
  }catch(error){
   console.error('[NARA EXPERIENCE RESTORE]',error.message);
  }
  nara=createOrchestrator({deviceProfile:systemObserver.deviceProfile(),experience});
  nara.start();
  if(restoredExperience){
   try{nara.dispatch('experience.restored',{
    strategies:experience.snapshot().strategies.length
   },{source:'experience-store'});}catch{}
  }
  nara.configureDevice(systemObserver.deviceProfile());
  stopSystemObserver=systemObserver.start(snapshot=>{
    try{nara.dispatch('system.telemetry',snapshot,{source:'system-observer'});}catch{}
  });
  dataFlowTimer=setInterval(()=>{
    try{nara.dispatch('dataflow.sample',dataFlowMeter.snapshot(),{source:'dataflow-meter'});}catch{}
  },2000);
  dataFlowTimer.unref?.();
  bridges={chatgpt:new ChatGPTBridge(),copilot:new CopilotBridge(),openai:new OpenAIBridge(),grok:new GrokBridge(),gemini:new GeminiBridge(),claude:new ClaudeBridge(),deepseek:new DeepSeekBridge(),askcodi:new AskCodiBridge()};
  try{
   const cloudOrigin=normalizeOrigin(process.env.NARA_CLOUD_ORIGIN||'');
   const authOrigin=normalizeOrigin(process.env.NARA_AUTH_ORIGIN||cloudOrigin);
   if(!cloudOrigin&&authOrigin)throw new Error('NARA_AUTH_ORIGIN membutuhkan NARA_CLOUD_ORIGIN.');
   cloudAllowedOrigins=new Set([cloudOrigin,authOrigin].filter(Boolean));
   cloudMemory=new NaraCloudContextClient({
    origin:cloudOrigin,
    fetchImpl:(input,init)=>session.defaultSession.fetch(input,init),
    validateMemoryContext
   });
  }catch(error){
   console.error('[NARA CLOUD BRIDGE CONFIG]',error.message);
   cloudAllowedOrigins=new Set();
   cloudMemory=new NaraCloudContextClient({origin:''});
  }
  agentHub=new DeveloperAgentHub();
  naraAgentCoordinator=createNaraAgentCoordinator({nara,agentHub}).bind();
  const savedProjectRoot=await readProjectRoot();if(savedProjectRoot)agentHub.setProjectRoot(savedProjectRoot);
  terminalPolicy=policyModule;
  const emitTerminal=(channel,...args)=>{for(const target of [win,panelWin]){if(target&&!target.isDestroyed()&&!target.webContents.isLoading())target.webContents.send(channel,...args);}};
  terminalManager=new TerminalManager({
   workspace:agentHub.getProjectRoot(),
   onData:(id,data)=>emitTerminal('dudidam:terminal-data',id,data),
   onExit:(id,exitCode)=>emitTerminal('dudidam:terminal-exit',id,exitCode)
  });
  indonesianStt=new IndonesianStt();
  indonesianTts=new IndonesianTts();
  const agentLinks=Object.fromEntries(agentDefinitions().map(item=>[item.id,item.url]));
  const root=path.resolve(__dirname,'../public');
  const avatarSourceRoot=path.resolve(__dirname,'../sites/humanale-hologram/dist');
  const avatarRoot=existsSync(avatarSourceRoot)?avatarSourceRoot:path.resolve(root,'humanale');
  const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
  const vendorAssets={
   '/vendor/xterm.js':{path:path.resolve(__dirname,'../node_modules/@xterm/xterm/lib/xterm.js'),type:'text/javascript; charset=utf-8'},
   '/vendor/xterm.css':{path:path.resolve(__dirname,'../node_modules/@xterm/xterm/css/xterm.css'),type:'text/css; charset=utf-8'},
   '/vendor/addon-fit.js':{path:path.resolve(__dirname,'../node_modules/@xterm/addon-fit/lib/addon-fit.js'),type:'text/javascript; charset=utf-8'}
  };
  server=http.createServer(async(req,res)=>{try{
   const url=new URL(req.url,'http://localhost');
   const vendor=vendorAssets[url.pathname];
   if(vendor){const data=await readFile(vendor.path);res.writeHead(200,{'Content-Type':vendor.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);return;}
   const humanale=url.pathname.startsWith('/humanale/'),assetPath=humanale?url.pathname.slice('/humanale'.length):url.pathname;
   const base=humanale?avatarRoot:root;
   const asset=path.resolve(base,'.'+decodeURIComponent(assetPath==='/'?'/index.html':assetPath));
   if(!asset.startsWith(base+path.sep)||!types[path.extname(asset)]){res.writeHead(404);res.end();return;}
   const data=await readFile(asset);res.writeHead(200,{'Content-Type':types[path.extname(asset)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);
  }catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+server.address().port;
  try{
   nara.dispatch('server.observe',{
    scope:'loopback',
    host:'127.0.0.1',
    port:server.address().port,
    transport:'HTTP',
    health:'online'
   },{source:'desktop-server'});
  }catch{}
  const workArea=screen.getPrimaryDisplay().workAreaSize,width=Math.min(420,workArea.width),height=Math.min(480,workArea.height);baseWindowSize={width,height};
  const position=safePosition(await readWindowPosition(),width,height);
  win=new BrowserWindow({width,height,x:position.x,y:position.y,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,alwaysOnTop:true,skipTaskbar:true,title:'HumanALE god egine — Avatar Transparan',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,spellcheck:false}});
  win.setAlwaysOnTop(true,'floating');
  win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  const trusted=e=>(e.sender===win?.webContents||e.sender===panelWin?.webContents)&&e.senderFrame?.url?.startsWith(origin+'/');
  const ownerActor=e=>String(e?.sender?.id||'');
  const ownerTrusted=e=>trusted(e)&&ownerGate?.isUnlocked(ownerActor(e));
  if(ciSmoke&&!ownerStore.configured()){
   const ciPassword='CI-'+randomUUID()+'-Nara!';
   const provisioned=ownerGate.provision(String(win.webContents.id),{
    username:'ci-owner',
    password:ciPassword,
    confirmPassword:ciPassword
   });
   if(!provisioned.ok)throw new Error('CI Creator provisioning gagal: '+provisioned.error);
  }
  const scheduleExperienceSave=()=>{
   if(experienceSaveTimer)clearTimeout(experienceSaveTimer);
   experienceSaveTimer=setTimeout(async()=>{
    experienceSaveTimer=null;
    try{
     const saved=await experienceStore.save(nara.experience.snapshot());
     nara.dispatch('experience.persisted',{
      strategies:saved.strategies.length,
      history:saved.history.length
     },{source:'experience-store'});
    }catch(error){
     console.error('[NARA EXPERIENCE SAVE]',error.message);
    }
   },250);
   experienceSaveTimer.unref?.();
  };
  humanaleRuntime=createHumanALERuntimeHost({
   nara,
   voiceFeedback:naraVoice,
   dataFlowMeter,
   getTargets:()=>[win,panelWin].filter(target=>target&&ownerGate?.isUnlocked(String(target.webContents.id))),
   isTrustedEvent:ownerTrusted,
   onExperienceDirty:scheduleExperienceSave
  });
  humanaleRuntime.bindIpc(ipcMain);
  humanaleRuntime.start();
  announceNaraEvent=(event,payload={})=>humanaleRuntime.announce(event,payload);

  const publishOwnerState=()=>{
   for(const target of [win,panelWin]){
    if(!target||target.isDestroyed()||target.webContents.isLoading())continue;
    target.webContents.send('dudidam:owner-state',ownerGate.status(String(target.webContents.id)));
   }
  };
  ipcMain.handle('dudidam:owner-status',e=>trusted(e)?ownerGate.status(ownerActor(e)):{error:'Akses ditolak.'});
  ipcMain.handle('dudidam:owner-provision',(e,value)=>{
   if(!trusted(e))return {error:'Akses ditolak.'};
   const result=ownerGate.provision(ownerActor(e),value);publishOwnerState();return result;
  });
  ipcMain.handle('dudidam:owner-login',(e,value)=>{
   if(!trusted(e))return {error:'Akses ditolak.'};
   const result=ownerGate.login(ownerActor(e),value);publishOwnerState();return result;
  });
  ipcMain.handle('dudidam:owner-logout',e=>{
   if(!trusted(e))return {error:'Akses ditolak.'};
   const result=ownerGate.logout(ownerActor(e));publishOwnerState();return result;
  });
  ipcMain.handle('dudidam:owner-change-login',(e,value)=>{
   if(!trusted(e))return {error:'Akses ditolak.'};
   const result=ownerGate.changeCredentials(ownerActor(e),value);publishOwnerState();return result;
  });

  const openCloudLogin=()=>{
   if(!cloudMemory?.configured())return {error:'NARA_CLOUD_NOT_CONFIGURED'};
   if(cloudLoginWin&&!cloudLoginWin.isDestroyed()){cloudLoginWin.show();cloudLoginWin.focus();return {ok:true};}
   const loginUrl=cloudMemory.loginUrl();
   cloudLoginWin=new BrowserWindow({
    width:720,height:820,minWidth:520,minHeight:600,
    show:false,title:'NARA Cloud · Login',
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,spellcheck:false}
   });
   cloudLoginWin.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   cloudLoginWin.webContents.on('will-navigate',(event,url)=>{if(!safeCloudNavigation(url))event.preventDefault();});
   cloudLoginWin.on('closed',()=>{cloudLoginWin=null;});
   cloudLoginWin.loadURL(loginUrl).then(()=>{cloudLoginWin?.show();cloudLoginWin?.focus();}).catch(error=>{
    console.error('[NARA CLOUD LOGIN]',error.message);
    cloudLoginWin?.close();
   });
   cloudLoginWin.webContents.on('did-navigate',async()=>{
    try{
     const status=await cloudMemory.status();
     if(status?.authenticated&&status?.available)cloudLoginWin?.close();
    }catch{}
   });
   return {ok:true};
  };
  ipcMain.handle('dudidam:cloud-status',async e=>{
   if(!ownerTrusted(e))return {error:'Akses ditolak.'};
   try{return await cloudMemory.status();}catch(error){return {error:error.message};}
  });
  ipcMain.handle('dudidam:cloud-login',async e=>{
   if(!ownerTrusted(e))return {error:'Akses ditolak.'};
   return openCloudLogin();
  });
  ipcMain.handle('dudidam:cloud-context',async(e,value)=>{
   if(!ownerTrusted(e))return {error:'Akses ditolak.'};
   try{return await cloudMemory.context(value);}catch(error){return {error:error.message};}
  });

  const pickProvider=value=>['copilot','openai','grok','gemini','claude','deepseek','askcodi'].includes(value)?value:'chatgpt';
  ipcMain.handle('dudidam:status',async(e,provider)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{const selected=pickProvider(provider),result=await bridges[selected].status();if(selected==='copilot')nara.connection('COPILOT',Boolean(result?.configured));return result;}catch(error){if(provider==='copilot')nara.connection('COPILOT',false);return {configured:false,error:error.message};}});
  ipcMain.handle('dudidam:ask',async(e,value)=>{
   if(!ownerTrusted(e))return {error:'Akses ditolak.'};
   dataFlowMeter?.recordIn(value);
   const provider=pickProvider(value?.provider);
   let memoryContext=null;
   try{memoryContext=validateMemoryContext(value?.memoryContext,{allowedTargets:['reasoner']});}
   catch(error){nara.dispatch('context.blocked',{target:'reasoner',reason:'invalid-packet',source:'desktop'});return {error:error.message};}
   if(memoryContext)nara.dispatch('context.used',{target:'reasoner',count:memoryContext.count,chars:memoryContext.chars,source:'desktop'});
   nara.dispatch('observe.start',{label:'Menerima permintaan pengguna',source:'chat'});
   nara.dispatch('observe.complete',{source:'chat'});
   nara.dispatch('reason.start',{label:'Memproses jawaban melalui '+provider,source:'chat'});
   try{
    const payload={...value,memoryContext};delete payload.provider;
    const result=await bridges[provider].ask(payload);
    if(result?.error){
     nara.dispatch('reason.complete',{source:'chat'});
     nara.dispatch('error.detected',{message:String(result.error).slice(0,300),source:'chat'});
    }else{
     nara.dispatch('reason.complete',{source:'chat'});
    }
    dataFlowMeter?.recordOut(result);
    return result;
   }catch(error){
    nara.dispatch('reason.complete',{source:'chat'});
    nara.dispatch('error.detected',{message:error.message,source:'chat'});
    return {error:error.message};
   }
  });
  ipcMain.handle('dudidam:login',async e=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return await bridges.chatgpt.login();}catch(error){return {error:error.message};}});
  ipcMain.handle('dudidam:login-copilot',async e=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return await bridges.copilot.login();}catch(error){return {error:error.message};}});
  ipcMain.handle('dudidam:stt-status',async e=>{if(!ownerTrusted(e))return {configured:false,error:'Akses ditolak.'};return await indonesianStt.status();});
  ipcMain.handle('dudidam:transcribe',async(e,value)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return await indonesianStt.transcribe(value);}catch(error){return {error:error.message};}});
  ipcMain.handle('dudidam:tts-status',async e=>{if(!ownerTrusted(e))return {configured:false,error:'Akses ditolak.'};return await indonesianTts.status();});
  ipcMain.handle('dudidam:synthesize',async(e,value)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return await indonesianTts.synthesize(value);}catch(error){return {error:error.message};}});
  ipcMain.on('dudidam:panel-open',(e,view)=>{if(ownerTrusted(e))openPanel(view);});
  ipcMain.on('dudidam:panel-close',e=>{if(trusted(e))panelWin?.hide();});
  ipcMain.handle('dudidam:agents',async e=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return await agentHub.status();}catch(error){return {error:error.message};}});
  ipcMain.handle('dudidam:project-root-choose',async e=>{
   if(!ownerTrusted(e))return {error:'Akses ditolak.'};
   const result=await dialog.showOpenDialog(panelWin?.isVisible()?panelWin:win,{title:'Pilih folder checkout proyek HumanALE god egine',properties:['openDirectory']});
   if(result.canceled||!result.filePaths?.[0])return {canceled:true};
   const selected=path.resolve(result.filePaths[0]);
   agentHub.setProjectRoot(selected);terminalManager?.setWorkspace(selected);
   try{await writeFile(projectRootPath(),selected,'utf8');}catch(error){return {error:'Folder terpilih, tetapi pengaturan tidak dapat disimpan: '+error.message};}
   return {ok:true,...await agentHub.status()};
  });
  ipcMain.handle('dudidam:agent-run',async(e,value)=>{
   if(!ownerTrusted(e))return {error:'Akses ditolak.'};
   let memoryContext=null;
   try{memoryContext=validateMemoryContext(value?.memoryContext,{allowedTargets:['planner','agent']});}
   catch(error){
    nara.dispatch('context.blocked',{target:'agent',reason:'invalid-packet',source:'desktop'});
    return {error:error.message};
   }
   try{
    return await naraAgentCoordinator.run({...value,memoryContext});
   }catch(error){
    nara.dispatch('error.detected',{message:error.message,source:'nara-agent-coordinator'});
    return {error:error.message};
   }
  });
  ipcMain.handle('dudidam:agent-open',async(e,id)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};const url=agentLinks[String(id||'')];if(!url||!url.startsWith('https://'))return {error:'Tautan agent tidak valid.'};await shell.openExternal(url);return {ok:true};});
  ipcMain.handle('dudidam:terminal-create',async(e,value)=>{
   if(!ownerTrusted(e))return {error:'Akses ditolak.'};
   const shellId=['auto','pwsh','powershell','cmd'].includes(String(value?.shell||''))?String(value.shell):'auto';
   const profileId=['claude','codex','cursor','gemini'].includes(String(value?.profile||''))?String(value.profile):undefined;
   const options={shell:shellId,profile:profileId,title:String(value?.title||'').slice(0,80),cols:value?.cols,rows:value?.rows};
   try{const result=await terminalManager.create(options);nara.dispatch('terminal.open',{source:'terminal-manager'});return result;}catch(error){nara.dispatch('error.detected',{message:error.message,source:'terminal'});return {error:error.message};}
  });
  ipcMain.handle('dudidam:terminal-write',async(e,value)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return terminalManager.write(value?.sessionId,value?.data);}catch(error){return {error:error.message};}});
  ipcMain.handle('dudidam:terminal-resize',async(e,value)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return terminalManager.resize(value?.sessionId,value?.cols,value?.rows);}catch(error){return {error:error.message};}});
  ipcMain.handle('dudidam:terminal-kill',async(e,value)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return terminalManager.kill(value?.sessionId);}catch(error){return {error:error.message};}});
  ipcMain.handle('dudidam:terminal-restart',async(e,value)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return await terminalManager.restart(value?.sessionId);}catch(error){return {error:error.message};}});
  ipcMain.handle('dudidam:terminal-clear',async(e,value)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return terminalManager.clear(value?.sessionId);}catch(error){return {error:error.message};}});
  ipcMain.handle('dudidam:terminal-list',async e=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};return {sessions:terminalManager.list()};});
  ipcMain.handle('dudidam:terminal-detect',async e=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return await terminalManager.detect();}catch(error){return {error:error.message};}});
  ipcMain.handle('dudidam:terminal-recent',async(e,value)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};return {output:terminalManager.getRecentOutput(value?.sessionId,value?.limit)};});
  ipcMain.handle('dudidam:terminal-cwd',async(e,value)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};try{return await terminalManager.setCwd(value?.sessionId,value?.cwd);}catch(error){return {error:error.message};}});
  ipcMain.handle('dudidam:terminal-policy',async(e,value)=>{if(!ownerTrusted(e))return {error:'Akses ditolak.'};return terminalPolicy.classifyCommand(value?.command);});
  ipcMain.handle('dudidam:terminal-execute',async(e,value)=>{
   if(!ownerTrusted(e))return {error:'Akses ditolak.'};
   const command=String(value?.command||'').trim(),decision=terminalPolicy.classifyCommand(command);
   if(decision.category==='BLOCK')return {error:decision.reason,category:'BLOCK'};
   if(decision.category==='CONFIRM'){
    const result=await dialog.showMessageBox(panelWin?.isVisible()?panelWin:win,{type:'warning',title:'Konfirmasi command HumanALE god egine',message:'Command ini dapat mengubah project atau sistem.',detail:decision.reason+'\n\n'+command,buttons:['Jalankan','Batal'],defaultId:1,cancelId:1,noLink:true});
    if(result.response!==0)return {cancelled:true,category:'CONFIRM',reason:decision.reason};
   }
   try{terminalManager.write(value?.sessionId,command+'\r');return {ok:true,category:decision.category};}
   catch(error){return {error:error.message,category:decision.category};}
  });
  ipcMain.handle('dudidam:terminal-open',async e=>{
   if(!ownerTrusted(e))return {error:'Akses ditolak.'};
   try{
    const cwd=path.resolve(agentHub?.getProjectRoot?.()||process.env.DUDIDAM_PROJECT_ROOT||process.cwd());
    const child=spawn('powershell.exe',['-NoLogo','-NoExit'],{cwd,detached:true,stdio:'ignore',windowsHide:false});
    child.unref();
    nara.dispatch('terminal.open',{source:'external-powershell'});
    return {ok:true,cwd};
   }catch(error){return {error:'Terminal gagal dibuka: '+error.message};}
  });
  ipcMain.on('dudidam:center',e=>{if(trusted(e)){win.center();savePositionSoon();}});
  ipcMain.on('dudidam:minimize',e=>{if(trusted(e))requestDismiss('hide');});
  ipcMain.on('dudidam:close',e=>{if(trusted(e))requestDismiss('hide');});
  ipcMain.on('dudidam:dismiss-complete',e=>{if(trusted(e))finishDismiss();});
  ipcMain.on('dudidam:passthrough',(e,value)=>{if(e.sender===win?.webContents&&trusted(e))setDynamicPassthrough(value);});
  ipcMain.on('dudidam:passthrough-lock',(e,value)=>{if(trusted(e))setPassthroughLock(value);});
  ipcMain.on('dudidam:avatar-viewport',(e,value)=>{if(trusted(e))resizeForAvatar(value?.size);});
  ipcMain.on('dudidam:panel-viewport',(e,value)=>{if(e.sender===win?.webContents&&trusted(e))resizeForPanel(value?.zoom,Boolean(value?.open));});
  ipcMain.on('dudidam:move',(e,d)=>{if(!trusted(e)||passthrough||!Number.isFinite(d?.dx)||!Number.isFinite(d?.dy))return;const [x,y]=win.getPosition(),[currentWidth,currentHeight]=win.getSize();const next=safePosition({x:x+Math.max(-100,Math.min(100,d.dx)),y:y+Math.max(-100,Math.min(100,d.dy))},currentWidth,currentHeight);win.setPosition(next.x,next.y);});

  win.webContents.setWindowOpenHandler(({url})=>{try{if(new URL(url).origin==='https://chatgpt.com')shell.openExternal(url);}catch{}return {action:'deny'};});
  win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith(origin+'/'))e.preventDefault();});
  win.webContents.on('will-attach-webview',e=>e.preventDefault());
  win.webContents.session.setPermissionCheckHandler((contents,permission,requestingOrigin)=>(contents===win.webContents||contents===panelWin?.webContents)&&ownerGate.isUnlocked(String(contents.id))&&permission==='media'&&requestingOrigin===origin);
  win.webContents.session.setDisplayMediaRequestHandler(async(request,callback)=>{const ownerUnlocked=ownerGate.isUnlocked(String(win?.webContents?.id||''))||ownerGate.isUnlocked(String(panelWin?.webContents?.id||''));if(!ownerUnlocked||request.securityOrigin!==origin||!request.userGesture||!request.audioRequested){callback({});return;}try{const sources=await desktopCapturer.getSources({types:['screen']});if(!sources.length){callback({});return;}callback({video:sources[0],audio:'loopback'});}catch{callback({});}});
  win.webContents.session.setPermissionRequestHandler(async(contents,permission,callback,details)=>{if((contents!==win.webContents&&contents!==panelWin?.webContents)||!ownerGate.isUnlocked(String(contents.id))||!contents.getURL().startsWith(origin+'/')||permission!=='media'){callback(false);return;}const mediaTypes=details.mediaTypes||[];const result=await dialog.showMessageBox(panelWin?.isVisible()?panelWin:win,{type:'question',title:'Izin perangkat HumanALE god egine',message:'Izinkan '+(mediaTypes.includes('video')?'kamera':'mikrofon')+' untuk sesi ini?',detail:'Mikrofon dipakai hanya saat Wake ALE, dikte, atau reaksi suara yang kamu aktifkan; status Wake selalu terlihat di layar. Kamera hanya mengirim satu foto setelah tombol kirim foto ditekan.',buttons:['Izinkan','Batal'],defaultId:1,cancelId:1});callback(result.response===0);});

  const trayIcon=nativeImage.createFromPath(path.join(root,'reference.png')).resize({width:20,height:20,quality:'best'});
  tray=new Tray(trayIcon);
  tray.setToolTip('HumanALE god egine — asisten mengambang');
  tray.on('click',()=>win?.isVisible()?requestDismiss('hide'):showAvatar());
  rebuildTrayMenu();
  const shortcutRegistered=globalShortcut.register(summonShortcut,summonAvatar);
  if(!shortcutRegistered)console.warn('HumanALE god egine global summon shortcut unavailable:',summonShortcut);
  win.on('move',()=>{if(!panelViewportOpen)savePositionSoon();});
  win.on('close',event=>{if(!quitting){event.preventDefault();requestDismiss('hide');}});
  win.once('ready-to-show',()=>win.show());
  await win.loadURL(origin+'/');
  announceNaraEvent('nara.start');
  pointerTimer=setInterval(publishGlobalPointer,50);
  backdropTimer=setInterval(publishAvatarBackdrop,1800);
  publishAvatarBackdrop();
  if(ciSmoke){
   const rendererReady=await win.webContents.executeJavaScript("Boolean(document.querySelector('#avatar')) && Boolean(document.querySelector('#assistantPopup')) && typeof window.dudidamAvatar?.setAvatarState === 'function' && typeof window.dudidamDesktop?.onGlobalPointer === 'function' && typeof window.dudidamDesktop?.avatarViewport === 'function' && typeof window.dudidamDesktop?.openTerminal === 'function' && document.title.includes('HumanALE god egine')");
   if(!rendererReady)throw new Error('Renderer HumanALE god egine tidak siap.');
   const unifiedRuntimeReady=await win.webContents.executeJavaScript(`
    (async()=>{
      const api=window.dudidamDesktop;
      if(typeof api?.runtimeSnapshot!=='function'||typeof api?.naraDispatch!=='function')return false;
      const initial=await api.runtimeSnapshot();
      if(initial?.runtime?.version!==3||initial.runtime?.humanale?.role!=='nara-body')return false;
      if(initial.runtime?.core?.engine?.identity?.id!=='NARA')return false;
      const heard=await api.naraDispatch('audio.energy',{energy:.61,low:.2,mid:.4,high:.7});
      if(!heard?.ok)return false;
      const hearing=await api.runtimeSnapshot();
      if(!hearing?.runtime?.humanale?.body?.hearing?.active)return false;
      if(Math.abs(Number(hearing.runtime.humanale.body.hearing.high)-.7)>.001)return false;
      const speech=await api.naraDispatch('speech.start',{energy:.55});
      if(!speech?.ok)return false;
      const speaking=await api.runtimeSnapshot();
      if(speaking?.runtime?.humanale?.body?.state!=='speaking')return false;
      const blocked=await api.naraDispatch('memory.write',{label:'forbidden-renderer-write'});
      if(!blocked?.error)return false;
      await api.naraDispatch('speech.stop',{});
      await api.naraDispatch('audio.energy',{energy:0,low:0,mid:0,high:0});
      return true;
    })()
   `);
   if(!unifiedRuntimeReady)throw new Error('Unified NARA + HumanALE runtime V3 belum siap.');
   const wakeIdle=await win.webContents.executeJavaScript("Boolean(document.querySelector('#wakeToggle')) && !document.querySelector('#wakeToggle').checked && document.querySelector('#wakeIndicator')?.textContent?.includes('nonaktif')");
   if(!wakeIdle)throw new Error('Wake mic harus nonaktif saat HumanALE god egine mulai.');
   await openPanel('controls');
   const panelReady=await panelWin.webContents.executeJavaScript("new Promise(resolve=>{const deadline=Date.now()+2500;const check=()=>{const ready=document.body.classList.contains('detached-panel')&&document.querySelector('#controls')?.open&&document.documentElement.classList.contains('panel-surface');if(ready||Date.now()>deadline)resolve(Boolean(ready));else setTimeout(check,50);};check();})");
   if(!panelReady)throw new Error('Panel terpisah HumanALE god egine tidak siap.');
   const avatarControls=await panelWin.webContents.executeJavaScript("Boolean(document.querySelector('#emotion')) && Boolean(document.querySelector('#voiceStyle')) && document.querySelector('#voiceStyle').value==='baby-robot'");
   if(!avatarControls)throw new Error('Kontrol emosi dan suara bayi robot tidak siap.');
   const avatarBounds=win.getBounds(),panelBounds=panelWin.getBounds(),workArea=screen.getDisplayNearestPoint({x:avatarBounds.x+avatarBounds.width/2,y:avatarBounds.y+avatarBounds.height/2}).workArea;
   if(workArea.width>=avatarBounds.width+panelBounds.width+16&&avatarBounds.x<panelBounds.x+panelBounds.width&&panelBounds.x<avatarBounds.x+avatarBounds.width&&avatarBounds.y<panelBounds.y+panelBounds.height&&panelBounds.y<avatarBounds.y+avatarBounds.height)throw new Error(`Panel menutupi avatar walau layar cukup lebar: ${JSON.stringify({avatarBounds,panelBounds,workArea})}`);
   await panelWin.webContents.executeJavaScript("new BroadcastChannel('dudidam-avatar-panel').postMessage({type:'persona',provider:'copilot'})");
   const personaReady=await win.webContents.executeJavaScript("new Promise(resolve=>setTimeout(()=>resolve(document.querySelector('#personaBadge')?.textContent.includes('COPILOT')),100))");
   if(!personaReady)throw new Error('Tampilan Copilot tidak tersambung ke avatar.');
   if(process.env.DUDIDAM_CAPTURE_SMOKE){
    await new Promise(resolve=>setTimeout(resolve,700));
    await writeFile(process.env.DUDIDAM_CAPTURE_SMOKE,(await win.capturePage()).toPNG());
    await panelWin.webContents.executeJavaScript("{const el=document.querySelector('#emotion');el.value='happy';el.dispatchEvent(new Event('change',{bubbles:true}));}");
    await new Promise(resolve=>setTimeout(resolve,250));
    await writeFile(process.env.DUDIDAM_CAPTURE_SMOKE.replace(/\.png$/,'-happy.png'),(await win.capturePage()).toPNG());
   }
   if(process.env.DUDIDAM_VOICE_SMOKE==='1'){
    const voiceReady=await panelWin.webContents.executeJavaScript("Promise.all([window.dudidamDesktop.sttStatus(),window.dudidamDesktop.ttsStatus()]).then(([stt,tts])=>stt.configured&&tts.configured)");
    if(!voiceReady)throw new Error('Runtime suara Indonesia lokal belum siap.');
    const speechReady=await panelWin.webContents.executeJavaScript("window.dudidamDesktop.synthesize({text:'Halo dari HumanALE god egine.',style:'baby-robot'}).then(result=>result.mime==='audio/wav'&&result.audio?.length>1000)");
    if(!speechReady)throw new Error('Suara Indonesia lokal gagal dibuat lewat panel.');
   }
   if(process.env.DUDIDAM_COPILOT_SMOKE==='1'){
    const copilotReady=await panelWin.webContents.executeJavaScript("window.dudidamDesktop.ask({provider:'copilot',message:'Jawab satu kata: siap',history:[]}).then(result=>Boolean(result.text)&&!result.error)");
    if(!copilotReady)throw new Error('Percakapan GitHub Copilot dari panel gagal.');
   }
   console.log('HumanALE god egine CI smoke passed: packaged runtime, renderer, and detached panel loaded.');
   quitting=true;app.quit();return;
  }
  console.log('HumanALE god egine desktop ready: transparent=true; frame=false; alwaysOnTop=true; tray=true; systemAudio=loopback');
 }).catch(error=>{console.error('HumanALE god egine startup failed:',error);app.exit(1);});
 app.on('window-all-closed',()=>{});
  app.on('before-quit',()=>{quitting=true;globalShortcut.unregisterAll();clearTimeout(saveTimer);clearInterval(pointerTimer);clearInterval(backdropTimer);Object.values(bridges||{}).forEach(item=>item?.stop());agentHub?.stop();terminalManager?.killAll?.();indonesianStt?.stop();indonesianTts?.stop();panelWin?.destroy();server?.close();tray?.destroy();});
}