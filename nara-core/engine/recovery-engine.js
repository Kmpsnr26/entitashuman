const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

export class NaraRecoveryEngine{
  constructor({maxRetries=2}={}){
    this.maxRetries=Math.max(0,Math.min(5,Number(maxRetries)||0));
  }

  decide({
    attempt=0,
    errorCategory='unknown',
    capabilityRequired=false,
    capabilityApproved=false,
    fallbackAvailable=false
  }={}){
    const tries=Math.max(0,Math.floor(Number(attempt)||0));
    const category=safeText(errorCategory,60)||'unknown';

    if(capabilityRequired&&!capabilityApproved){
      return {action:'escalate',reason:'owner-approval-required',delayMs:0};
    }
    if(['auth','permission','policy','blocked'].includes(category)){
      return {action:'escalate',reason:'policy-or-auth-boundary',delayMs:0};
    }
    if(tries<this.maxRetries){
      return {
        action:'retry',
        reason:'bounded-retry',
        delayMs:Math.min(30000,1000*Math.pow(2,tries))
      };
    }
    if(fallbackAvailable){
      return {action:'fallback',reason:'retry-exhausted',delayMs:0};
    }
    return {action:'escalate',reason:'retry-exhausted',delayMs:0};
  }
}

export function createRecoveryEngine(options){return new NaraRecoveryEngine(options);}
