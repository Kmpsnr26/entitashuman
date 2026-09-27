import {spawn} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sanitizeMaintenanceEnvironment} from './agent-maintenance-guard.mjs';
import {redactSecrets} from './terminal-policy.mjs';

export const MAINTENANCE_VERIFIER_VERSION='1.0.0';

export const MAINTENANCE_VERIFIER_PROFILES=Object.freeze({
  focused:Object.freeze([
    Object.freeze({id:'npm-test',args:Object.freeze(['test'])})
  ]),
  full:Object.freeze([
    Object.freeze({id:'npm-verify',args:Object.freeze(['run','verify'])})
  ])
});

export const MAINTENANCE_VERIFIER_LIMITS=Object.freeze({
  timeoutMs:12*60*1000,
  maxOutputBytes:1024*1024,
  failureTailChars:12000
});

function npmExecutable(){
  return process.platform==='win32'?'npm.cmd':'npm';
}

async function canonicalDirectory(cwd){
  const value=await realpath(resolve(String(cwd||'')));
  if(!value)throw new Error('Maintenance verifier membutuhkan project root.');
  return value;
}

function boundedFailureTail(value,limit){
  const safe=redactSecrets(String(value||''));
  return safe.slice(-limit);
}

async function runExactNpmCheck(cwd,check,{
  timeoutMs=MAINTENANCE_VERIFIER_LIMITS.timeoutMs,
  maxOutputBytes=MAINTENANCE_VERIFIER_LIMITS.maxOutputBytes,
  failureTailChars=MAINTENANCE_VERIFIER_LIMITS.failureTailChars
}={}){
  const env=sanitizeMaintenanceEnvironment(process.env).env;
  const executable=npmExecutable();
  const startedAt=Date.now();

  return await new Promise(resolvePromise=>{
    const child=spawn(executable,[...check.args],{
      cwd,
      windowsHide:true,
      shell:false,
      stdio:['ignore','pipe','pipe'],
      env
    });

    let stdout='',stderr='',settled=false,timedOut=false,outputExceeded=false;
    const finish=(code,error=null)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      const combined=stdout+'\n'+stderr;
      const ok=code===0&&!timedOut&&!outputExceeded&&!error;
      resolvePromise(Object.freeze({
        id:check.id,
        ok,
        exitCode:Number.isInteger(code)?code:null,
        timedOut,
        outputExceeded,
        durationMs:Math.max(0,Date.now()-startedAt),
        failureCode:ok?null:
          timedOut?'CHECK_TIMEOUT':
          outputExceeded?'CHECK_OUTPUT_LIMIT':
          error?'CHECK_SPAWN_ERROR':
          'CHECK_FAILED',
        failureTail:ok?'':boundedFailureTail(combined,failureTailChars)
      }));
    };

    const timer=setTimeout(()=>{
      timedOut=true;
      child.kill();
      finish(null);
    },timeoutMs);

    const append=(target,data)=>{
      const next=target+String(data);
      if(Buffer.byteLength(next,'utf8')>maxOutputBytes){
        outputExceeded=true;
        child.kill();
        finish(null);
        return target;
      }
      return next;
    };

    child.stdout.on('data',data=>{stdout=append(stdout,data);});
    child.stderr.on('data',data=>{stderr=append(stderr,data);});
    child.on('error',error=>finish(null,error));
    child.on('close',code=>finish(code));
  });
}

export class TrustedMaintenanceVerifier{
  constructor({runner=runExactNpmCheck,now=()=>Date.now()}={}){
    if(typeof runner!=='function')throw new TypeError('Maintenance verifier runner harus function.');
    this.runner=runner;
    this.now=now;
  }

  async verify({cwd,profile='full'}={}){
    const checks=MAINTENANCE_VERIFIER_PROFILES[profile];
    if(!checks)throw new Error('Maintenance verifier profile tidak diizinkan: '+profile);
    const projectRoot=await canonicalDirectory(cwd);
    const startedAt=this.now();
    const results=[];

    for(const check of checks){
      const result=await this.runner(projectRoot,check);
      results.push(Object.freeze({
        id:result.id,
        ok:result.ok===true,
        exitCode:Number.isInteger(result.exitCode)?result.exitCode:null,
        timedOut:result.timedOut===true,
        outputExceeded:result.outputExceeded===true,
        durationMs:Number(result.durationMs)||0,
        failureCode:result.failureCode||null,
        failureTail:result.ok===true?'':boundedFailureTail(
          result.failureTail,
          MAINTENANCE_VERIFIER_LIMITS.failureTailChars
        )
      }));
      if(result.ok!==true)break;
    }

    const endedAt=this.now();
    const ok=results.length===checks.length&&results.every(item=>item.ok);
    return Object.freeze({
      version:MAINTENANCE_VERIFIER_VERSION,
      ok,
      profile,
      startedAt,
      endedAt,
      durationMs:Math.max(0,endedAt-startedAt),
      checks:Object.freeze(results),
      failureCode:ok?null:(results.find(item=>!item.ok)?.failureCode||'VERIFY_FAILED')
    });
  }
}

export function createMaintenanceVerifier(options){
  return new TrustedMaintenanceVerifier(options);
}
