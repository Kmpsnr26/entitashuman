const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
export class NaraRecoveryEngine{
  constructor({maxRetries=2}={}){this.maxRetries=Math.max(0,Math.min(5,Number(maxRetries)||0));}
  decide({attempt=0,errorCategory='unknown',capabilityRequired=false,capabilityApproved=false,
    fallbackAvailable=false,idempotent=false,compensationConfirmed=false}={}){
    const tries=Math.max(0,Math.floor(Number(attempt)||0)),category=safeText(errorCategory,60)||'unknown';
    if(capabilityRequired&&!capabilityApproved)return {action:'escalate',reason:'owner-approval-required',delayMs:0};
    if(['auth','permission','policy','blocked'].includes(category))return {action:'escalate',reason:'policy-or-auth-boundary',delayMs:0};
    if(tries<this.maxRetries){
      if(!idempotent&&!compensationConfirmed)return {action:'escalate',reason:'unsafe-retry-requires-idempotency-or-confirmed-compensation',delayMs:0};
      return {action:'retry',reason:idempotent?'idempotent-retry':'compensation-confirmed-retry',
        delayMs:Math.min(30000,1000*Math.pow(2,tries))};
    }
    if(fallbackAvailable)return {action:'fallback',reason:'retry-exhausted',delayMs:0};
    return {action:'escalate',reason:'retry-exhausted',delayMs:0};
  }
}
export function createRecoveryEngine(options){return new NaraRecoveryEngine(options);}
