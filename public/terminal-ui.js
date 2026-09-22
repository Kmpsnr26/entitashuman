let currentUI=null;

function terminalCtor(){
 const ctor=window.Terminal?.Terminal||window.Terminal;
 if(typeof ctor!=='function')throw new Error('xterm.js belum dimuat.');
 return ctor;
}
function fitCtor(){
 const ctor=window.FitAddon?.FitAddon;
 if(typeof ctor!=='function')throw new Error('xterm FitAddon belum dimuat.');
 return ctor;
}
function shellLabel(id){return {pwsh:'PowerShell 7',powershell:'Windows PowerShell',cmd:'Command Prompt'}[id]||id;}
function safeText(value){return String(value??'');}

export function initTerminalUI({desktop,panelOnly=false,notify=()=>{}}={}){
 const api=desktop?.terminal,dialog=document.querySelector('#terminalDialog');
 if(!api||!dialog)return null;
 const sessions=new Map();
 let activeId='',detection=null;

 function openDialog(){
  if(panelOnly||document.body.classList.contains('detached-panel')){
   if(!dialog.open)dialog.showModal();
   setTimeout(()=>fitActive(),30);
  }else desktop.openPanel?.('terminalDialog');
 }
 function setStatus(text){const el=document.querySelector('#terminalStatus');if(el)el.textContent=text;}
 function updateMeta(meta){
  const cwd=document.querySelector('#terminalCwd'),state=document.querySelector('#terminalSessionStatus');
  if(cwd)cwd.textContent=meta?.cwd||detection?.workspaceRoot||'';
  if(state)state.textContent=meta?((meta.status==='running'?'● Running':'○ Stopped')+(meta.pid?' · PID '+meta.pid:'')):'No session';
 }
 function activate(id){
  if(!sessions.has(id))return;
  activeId=id;
  for(const [sessionId,item] of sessions){
   item.tab.classList.toggle('active',sessionId===id);
   item.view.hidden=sessionId!==id;
  }
  updateMeta(sessions.get(id).meta);
  setTimeout(()=>fitActive(),20);
 }
 function fitActive(){
  const item=sessions.get(activeId);if(!item||item.view.hidden)return;
  try{item.fit.fit();api.resize(activeId,item.term.cols,item.term.rows);}catch{}
 }
 async function findInBuffer(term){
  const query=window.prompt('Cari teks terminal:');
  if(!query)return;
  const buffer=term.buffer.active;
  for(let row=0;row<buffer.length;row++){
   const text=buffer.getLine(row)?.translateToString(true)||'',column=text.toLowerCase().indexOf(query.toLowerCase());
   if(column>=0){term.select(column,row,query.length);term.scrollToLine(row);return;}
  }
  notify('Teks tidak ditemukan di buffer terminal.');
 }
 function installKeys(item){
  item.term.attachCustomKeyEventHandler(event=>{
   if(event.type!=='keydown')return true;
   const ctrl=event.ctrlKey||event.metaKey;
   if(ctrl&&event.shiftKey&&event.key.toLowerCase()==='c'){
    const selected=item.term.getSelection();
    if(selected)navigator.clipboard?.writeText(selected).catch(()=>{});
    return false;
   }
   if(ctrl&&event.shiftKey&&event.key.toLowerCase()==='v'){
    navigator.clipboard?.readText().then(text=>{if(text)api.write(item.meta.id,text);}).catch(()=>{});
    return false;
   }
   if(ctrl&&!event.shiftKey&&event.key.toLowerCase()==='f'){findInBuffer(item.term);return false;}
   return true;
  });
 }
 async function attach(meta){
  if(!meta?.id)return;
  if(sessions.has(meta.id)){sessions.get(meta.id).meta={...sessions.get(meta.id).meta,...meta};activate(meta.id);return;}
  const Terminal=terminalCtor(),FitAddon=fitCtor();
  const tab=document.createElement('button');tab.type='button';tab.className='terminal-tab';
  const label=document.createElement('span');label.textContent=meta.title||shellLabel(meta.shell);
  const close=document.createElement('span');close.className='terminal-tab-close';close.textContent='×';close.title='Tutup terminal';
  tab.append(label,close);
  const view=document.createElement('div');view.className='terminal-view';view.hidden=true;
  document.querySelector('#terminalTabs')?.append(tab);
  document.querySelector('#terminalViews')?.append(view);
  const term=new Terminal({
   cursorBlink:true,convertEol:true,scrollback:5000,fontSize:13,
   fontFamily:'"Cascadia Code","Cascadia Mono",Consolas,monospace',
   theme:{background:'#07100d',foreground:'#d7f9e8',cursor:'#8fffd1',selectionBackground:'#245e4b99'}
  });
  const fit=new FitAddon();term.loadAddon(fit);term.open(view);
  const item={meta,tab,view,term,fit,resize:null};sessions.set(meta.id,item);
  installKeys(item);
  term.onData(data=>api.write(meta.id,data));
  tab.onclick=event=>{if(event.target===close)return;activate(meta.id);};
  close.onclick=async event=>{event.stopPropagation();await api.kill(meta.id);item.resize?.disconnect();term.dispose();tab.remove();view.remove();sessions.delete(meta.id);if(activeId===meta.id){activeId=sessions.keys().next().value||'';if(activeId)activate(activeId);else updateMeta(null);}};
  item.resize=new ResizeObserver(()=>{if(activeId===meta.id)fitActive();});item.resize.observe(view);
  try{const recent=await api.recent(meta.id);if(recent?.stdout)term.write(recent.stdout);}catch{}
  activate(meta.id);
 }
 async function syncSessions(){
  const result=await api.list();if(result?.error){setStatus(result.error);return;}
  for(const meta of result.sessions||[])await attach(meta);
 }
 async function refreshDetection(){
  detection=await api.detect();
  if(detection?.error){setStatus(detection.error);return detection;}
  const shellSelect=document.querySelector('#terminalShell');
  if(shellSelect){
   for(const option of shellSelect.options){
    if(option.value==='default')continue;
    const state=detection.shells?.[option.value]?.state;
    option.disabled=state!=='READY';
    option.textContent=shellLabel(option.value)+(state==='READY'?'':' · NOT FOUND');
   }
  }
  const status=[];
  for(const button of document.querySelectorAll('[data-terminal-profile]')){
   const profile=button.dataset.terminalProfile,item=detection.clis?.[profile];
   const ready=item?.state==='READY';button.disabled=!ready;button.dataset.state=item?.state||'NOT INSTALLED';
   button.title=(item?.title||profile)+' · '+(item?.state||'NOT INSTALLED');
   status.push((item?.title||profile)+': '+(item?.state||'NOT INSTALLED'));
  }
  const tools=document.querySelector('#terminalCliStatus');if(tools)tools.textContent=status.join(' · ');
  setStatus('Terminal engine siap · workspace '+(detection.workspaceRoot||''));
  updateMeta(sessions.get(activeId)?.meta||null);
  return detection;
 }
 async function createTerminal(options={}){
  openDialog();
  const result=await api.create(options);
  if(result?.error){notify(result.error);setStatus(result.error);return null;}
  await attach(result);return result;
 }
 async function open(options={}){
  openDialog();
  await refreshDetection();await syncSessions();
  if(options.profile)return await createTerminal({profile:options.profile});
  if(options.shell)return await createTerminal({shell:options.shell});
  if(!sessions.size)return await createTerminal({shell:'default'});
  fitActive();return sessions.get(activeId)?.meta||null;
 }

 document.querySelector('#terminalNew')?.addEventListener('click',()=>createTerminal({shell:document.querySelector('#terminalShell')?.value||'default'}));
 document.querySelector('#terminalRefresh')?.addEventListener('click',refreshDetection);
 document.querySelector('#terminalFolder')?.addEventListener('click',async()=>{const result=await desktop.chooseProjectRoot?.();if(result?.error)return notify(result.error);if(!result?.canceled){await refreshDetection();notify(result?.projectRootReady?'Workspace terminal diperbarui.':'Folder dipilih untuk terminal.');}});
 document.querySelector('#terminalClear')?.addEventListener('click',async()=>{const item=sessions.get(activeId);if(!item)return;item.term.clear();await api.clear(activeId);});
 document.querySelector('#terminalRestart')?.addEventListener('click',async()=>{if(!activeId)return;const result=await api.restart(activeId);if(result?.error)return notify(result.error);const old=sessions.get(activeId);if(old){old.term.reset();old.meta=result;updateMeta(result);}fitActive();});
 document.querySelector('#terminalKill')?.addEventListener('click',()=>activeId&&api.kill(activeId));
 document.querySelector('#terminalOpen')?.addEventListener('click',()=>open());
 for(const button of document.querySelectorAll('[data-terminal-profile]'))button.addEventListener('click',()=>createTerminal({profile:button.dataset.terminalProfile}));
 dialog.addEventListener('close',()=>{});
 api.onData(({sessionId,data})=>sessions.get(sessionId)?.term.write(safeText(data)));
 api.onExit(({sessionId,exitCode})=>{const item=sessions.get(sessionId);if(!item)return;item.meta={...item.meta,status:'stopped',exitCode};item.term.write('\r\n\x1b[90m[process exited'+(Number.isInteger(exitCode)?' · code '+exitCode:'')+']\x1b[0m\r\n');item.tab.classList.add('stopped');if(activeId===sessionId)updateMeta(item.meta);});
 api.onClear(({sessionId})=>sessions.get(sessionId)?.term.clear());
 function activeBufferText(){
  const item=sessions.get(activeId);if(!item)return '';
  const buffer=item.term.buffer.active,lines=[];
  for(let row=0;row<buffer.length;row++)lines.push(buffer.getLine(row)?.translateToString(true)||'');
  return lines.join('\n').slice(-65536);
 }
 currentUI={open,createTerminal,refreshDetection,syncSessions,fitActive,activeBufferText,get activeId(){return activeId;}};
 window.dudidamTerminalUI=currentUI;
 refreshDetection().then(syncSessions).catch(error=>setStatus(error?.message||'Terminal belum siap.'));
 return currentUI;
}

export async function handleTerminalDirective(text,desktop){
 const api=desktop?.terminal;if(!api)return null;
 const value=String(text||'').trim();
 let match=value.match(/^\/terminal(?:\s+(pwsh|powershell|cmd|claude|codex|cursor|gemini))?\s*$/i);
 if(match){
  const target=(match[1]||'').toLowerCase();
  const profiles=['claude','codex','cursor','gemini'];
  if(currentUI)await currentUI.open(profiles.includes(target)?{profile:target}:target?{shell:target}:{});
  else desktop.openPanel?.('terminalDialog');
  return {handled:true,text:target?'Terminal '+target+' dibuka.':'Terminal Dudidam dibuka.'};
 }
 match=value.match(/^\/run\s+(.+)$/i)||value.match(/^jalankan\s+(.+)$/i);
 if(match){
  const result=await api.run(match[1]);
  if(result?.error)return {handled:true,text:result.error};
  if(result?.blocked)return {handled:true,text:'Command diblokir: '+(result.policy?.reason||'berisiko tinggi.')};
  if(result?.canceled)return {handled:true,text:'Command dibatalkan.'};
  if(result?.session){desktop.openPanel?.('terminalDialog');return {handled:true,text:'Command dijalankan di terminal: '+(result.command||match[1])};}
  return {handled:true,text:'Command tidak dijalankan.'};
 }
 match=value.match(/^(build|test|lint|typecheck|verify)(?:\s+project(?:\s+ini)?)?\s*$/i);
 if(match){
  const result=await api.runProjectTask(match[1].toLowerCase());
  if(result?.error)return {handled:true,text:result.error};
  if(result?.canceled)return {handled:true,text:'Task project dibatalkan.'};
  if(result?.session){desktop.openPanel?.('terminalDialog');return {handled:true,text:'Task '+match[1].toLowerCase()+' dijalankan dari script package.json workspace aktif.'};}
 }
 return null;
}
