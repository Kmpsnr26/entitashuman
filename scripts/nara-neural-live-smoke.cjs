const {app,BrowserWindow}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('use-gl','angle');
app.commandLine.appendSwitch('use-angle','swiftshader');

const ROOT=path.resolve(__dirname,'..');
const ARTIFACTS=path.join(ROOT,'artifacts');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitFor(win,expression,{timeout=15000,interval=150}={}){
  const started=Date.now();
  let lastError=null;
  while(Date.now()-started<timeout){
    try{
      if(await win.webContents.executeJavaScript(expression,true))return true;
    }catch(error){lastError=error;}
    await sleep(interval);
  }
  throw new Error('Timeout waiting for: '+expression+(lastError?' · '+lastError.message:''));
}

const evaluate=(win,source)=>win.webContents.executeJavaScript(source,true);

async function run(){
  mkdirSync(ARTIFACTS,{recursive:true});
  const moduleUrl=pathToFileURL(path.join(ROOT,'nara-core/studio/server.mjs')).href;
  const {createNaraStudioServer}=await import(moduleUrl);
  const studio=createNaraStudioServer({host:'127.0.0.1',port:0});
  const address=await studio.start();
  const url='http://127.0.0.1:'+address.port;

  const browserErrors=[];
  const rendererGone=[];
  const network=[];
  const win=new BrowserWindow({
    width:1440,height:960,show:true,backgroundColor:'#02070b',
    webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,sandbox:true}
  });

  win.webContents.on('console-message',(_event,level,message,line,sourceId)=>{
    if(level>=2)browserErrors.push({level,message,line,sourceId});
  });
  win.webContents.on('render-process-gone',(_event,details)=>rendererGone.push(details));
  win.webContents.session.webRequest.onCompleted(details=>{
    if(details.url.startsWith(url))network.push({
      url:details.url,statusCode:details.statusCode,
      method:details.method,resourceType:details.resourceType
    });
  });
  win.webContents.session.webRequest.onErrorOccurred(details=>{
    if(details.url.startsWith(url))network.push({
      url:details.url,error:details.error,
      method:details.method,resourceType:details.resourceType
    });
  });

  const report={startedAt:new Date().toISOString(),url,checks:{},webgl:null,hud:null,browserErrors,rendererGone,network,moduleProbe:null};

  try{
    await win.loadURL(url);
    await waitFor(win,"document.getElementById('connection')?.textContent==='LIVE'");
    report.checks.liveConnection=true;

    report.moduleProbe=await evaluate(win,"(async()=>{const urls=['/neural-space.js','/vendor/three/three.module.js'];const result={};for(const url of urls){try{const res=await fetch(url);const text=await res.text();result[url]={ok:res.ok,status:res.status,contentType:res.headers.get('content-type'),length:text.length,prefix:text.slice(0,120)};}catch(error){result[url]={ok:false,error:error.message};}}return result;})()");

    await evaluate(win,"document.getElementById('view3d').click(); true");
    await waitFor(win,"Boolean(document.querySelector('.neural3d-canvas'))");
    await waitFor(win,"document.getElementById('neural3dStatus')?.textContent.includes('LIVE')");
    report.checks.canvasCreated=true;

    report.webgl=await evaluate(win,"(()=>{const canvas=document.querySelector('.neural3d-canvas');const gl=canvas?.getContext('webgl2')||canvas?.getContext('webgl');if(!gl)return {available:false};const ext=gl.getExtension('WEBGL_debug_renderer_info');return {available:true,version:gl.getParameter(gl.VERSION),shadingLanguage:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),width:canvas.width,height:canvas.height};})()");
    if(!report.webgl.available)throw new Error('WebGL context unavailable');
    report.checks.webglContext=true;

    await evaluate(win,"(async()=>{const events=[['work.start',{id:'live-smoke',label:'Real browser smoke'}],['reason.start',{label:'Inspect realtime route'}],['reason.complete',{}],['plan.start',{label:'Build visual route'}],['plan.complete',{}],['memory.read',{label:'Read live context'}],['agent.start',{label:'Browser worker'}],['program.start',{label:'Renderer program'}],['error.detected',{message:'Live smoke simulated error'}],['bug.detected',{message:'Live smoke route check'}],['bug.fixed',{message:'Live smoke fixed'}],['verify.start',{}],['verify.complete',{}],['work.complete',{id:'live-smoke'}]];for(const [event,payload] of events){const res=await fetch('/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event,payload})});if(!res.ok)throw new Error(event+' -> '+res.status);await new Promise(resolve=>setTimeout(resolve,90));}return true;})()");
    await waitFor(win,"Number((document.getElementById('neural3dRoutes')?.textContent.match(/routes:\\s*(\\d+)/)||[])[1]||0)>=8");
    report.checks.semanticRoutes=true;

    await evaluate(win,"document.getElementById('neuralCore').click(); true");
    await sleep(350);
    report.checks.coreMode=await evaluate(win,"document.getElementById('neural3dPerf').textContent.includes('core')");

    await evaluate(win,"document.getElementById('neuralFocus').click(); true");
    await sleep(300);
    report.checks.focusMode=await evaluate(win,"document.getElementById('neural3dPerf').textContent.includes('focus')");

    await evaluate(win,"(()=>{const select=document.getElementById('neuralQuality');select.value='low';select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
    await sleep(300);
    report.checks.lowQuality=await evaluate(win,"document.getElementById('neural3dPerf').textContent.includes('quality low')");

    report.checks.keyboardFocus=await evaluate(win,"(()=>{const select=document.getElementById('neuralQuality');select.value='auto';select.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('neuralExplorer').click();const canvas=document.querySelector('.neural3d-canvas');canvas.focus();return document.activeElement===canvas;})()");
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'+'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'+'});
    await sleep(2200);

    report.hud=await evaluate(win,"({status:document.getElementById('neural3dStatus')?.textContent,selected:document.getElementById('neural3dSelected')?.textContent,roots:document.getElementById('neural3dRoots')?.textContent,routes:document.getElementById('neural3dRoutes')?.textContent,performance:document.getElementById('neural3dPerf')?.textContent,lastRoute:document.getElementById('neural3dLastRoute')?.textContent,detail:document.getElementById('neuralDetailLabel')?.textContent})");

    const fpsMatch=String(report.hud.performance||'').match(/fps\\s+(\\d+)/);
    report.checks.fpsMeasured=Number(fpsMatch?.[1]||0)>0;
    report.checks.noRendererCrash=rendererGone.length===0;
    const fatalErrors=browserErrors.filter(item=>/uncaught|referenceerror|typeerror|webgl.*(fail|error)|three\\.webglrenderer/i.test(item.message));
    report.checks.noFatalBrowserErrors=fatalErrors.length===0;
    report.fatalErrors=fatalErrors;

    const image=await win.capturePage();
    writeFileSync(path.join(ARTIFACTS,'nara-neural-live.png'),image.toPNG());

    const failed=Object.entries(report.checks).filter(([,value])=>value!==true);
    report.completedAt=new Date().toISOString();
    report.passed=failed.length===0;
    report.failedChecks=failed.map(([name])=>name);
    writeFileSync(path.join(ARTIFACTS,'nara-neural-live-report.json'),JSON.stringify(report,null,2));

    process.stdout.write(JSON.stringify(report,null,2)+'\\n');
    if(failed.length)throw new Error('Live browser checks failed: '+failed.map(([name])=>name).join(', '));
  }catch(error){
    report.completedAt=new Date().toISOString();
    report.passed=false;
    report.error={name:error.name,message:error.message,stack:error.stack};
    try{
      report.failureDom=await evaluate(win,"({status:document.getElementById('neural3dStatus')?.textContent,host:document.getElementById('neural3dHost')?.innerText,consoleLog:document.getElementById('consoleLog')?.textContent,connection:document.getElementById('connection')?.textContent})");
      const image=await win.capturePage();
      writeFileSync(path.join(ARTIFACTS,'nara-neural-live.png'),image.toPNG());
    }catch(captureError){
      report.captureError=captureError.message;
    }
    writeFileSync(path.join(ARTIFACTS,'nara-neural-live-report.json'),JSON.stringify(report,null,2));
    throw error;
  }finally{
    if(!win.isDestroyed())win.destroy();
    await studio.stop();
  }
}

app.whenReady().then(run).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});
