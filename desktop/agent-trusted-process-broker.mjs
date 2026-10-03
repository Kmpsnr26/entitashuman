import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

function waitForClose(child,timeoutMs){
 if(child.exitCode!==null||child.signalCode!==null)return Promise.resolve(true);
 return new Promise(resolve=>{
  const finish=value=>{clearTimeout(timer);child.removeListener('close',closed);resolve(value);};
  const closed=()=>finish(true);
  const timer=setTimeout(()=>finish(false),timeoutMs);
  child.once('close',closed);
 });
}

// Callers spawn maintenance processes in a separate POSIX process group. On
// Windows taskkill targets the live parent and its descendants before rollback.
// A success exit from taskkill alone is insufficient: observe parent closure too.
export async function terminateMaintenanceProcessTree(child,{timeoutMs=10000}={}){
 if(!child||!Number.isInteger(child.pid)||child.pid<=0)return {terminationConfirmed:true};
 if(process.platform==='win32'&&(child.exitCode!==null||child.signalCode!==null))return {terminationConfirmed:false};
 const closed=waitForClose(child,timeoutMs);
 let treeStopped=false;
 if(process.platform==='win32'){
  treeStopped=await new Promise(resolve=>{
   const killer=spawn(join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});
   let settled=false;
   const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
   const timer=setTimeout(()=>{killer.kill();finish(false);},timeoutMs);
   killer.once('error',()=>finish(false));
   killer.once('close',code=>finish(code===0));
  });
 }else{
  try{process.kill(-child.pid,'SIGKILL');treeStopped=true;}
  catch(error){treeStopped=error?.code==='ESRCH';}
 }
 const parentClosed=await closed;
 if(process.platform!=='win32'&&treeStopped&&parentClosed){
  const deadline=Date.now()+timeoutMs;
  do{
   try{process.kill(-child.pid,0);}catch(error){return {terminationConfirmed:error?.code==='ESRCH'};}
   await delay(20);
  }while(Date.now()<deadline);
  return {terminationConfirmed:false};
 }
 return {terminationConfirmed:treeStopped&&parentClosed};
}

export function markMaintenanceProcessUnconfirmed(transaction){
 if(transaction)transaction.processTerminationUnconfirmed=true;
}

export function maintenanceProcessRecoveryError(cause){
 const error=new Error('Maintenance process termination is unconfirmed; repository lock retained for manual recovery.');
 error.code='AI_MAINTENANCE_MANUAL_RECOVERY_REQUIRED';
 error.cause=cause;
 return error;
}
