const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

export const NARA_CAPABILITIES=Object.freeze({
  'sense.audio':Object.freeze({ownerOnly:false,osPermission:true,risk:'low'}),
  'sense.vision':Object.freeze({ownerOnly:false,osPermission:true,risk:'low'}),
  'system.read':Object.freeze({ownerOnly:true,osPermission:false,risk:'low'}),
  'server.read.configured':Object.freeze({ownerOnly:true,osPermission:false,risk:'low'}),
  'dataflow.read.app':Object.freeze({ownerOnly:true,osPermission:false,risk:'low'}),
  'device.integrate':Object.freeze({ownerOnly:true,osPermission:true,risk:'medium'}),
  'os.privileged.action':Object.freeze({ownerOnly:true,osPermission:true,risk:'high'}),
  'creator.login.change':Object.freeze({ownerOnly:true,osPermission:false,risk:'high'})
});

export class NaraCapabilityBroker{
  constructor({auditLimit=250}={}){
    this.auditLimit=Math.max(25,Math.min(2000,Number(auditLimit)||250));
    this.requests=new Map();
    this.grants=new Map();
    this.audit=[];
    this.sequence=0;
  }

  record(type,data={}){
    const item=Object.freeze({
      id:++this.sequence,
      type:safeText(type,80),
      timestamp:Date.now(),
      capability:safeText(data.capability,80),
      actor:safeText(data.actor,80),
      result:safeText(data.result,40)
    });
    this.audit.push(item);
    if(this.audit.length>this.auditLimit)this.audit.splice(0,this.audit.length-this.auditLimit);
    return item;
  }

  request(capability,{actor='nara-core',reason=''}={}){
    const id=safeText(capability,80);
    const definition=NARA_CAPABILITIES[id];
    if(!definition)throw new Error('Capability NARA tidak dikenal: '+id);
    const requestId='cap-'+Date.now().toString(36)+'-'+(++this.sequence).toString(36);
    const item={
      id:requestId,
      capability:id,
      actor:safeText(actor,80),
      reason:safeText(reason,240),
      status:'pending',
      createdAt:Date.now(),
      ownerOnly:Boolean(definition.ownerOnly),
      osPermission:Boolean(definition.osPermission),
      risk:definition.risk
    };
    this.requests.set(requestId,item);
    this.record('capability.requested',{capability:id,actor:item.actor,result:'pending'});
    return {...item};
  }

  approve(requestId,{actor='creator',osConfirmed=false,ttlMs=15*60*1000}={}){
    const item=this.requests.get(String(requestId||''));
    if(!item)throw new Error('Permintaan capability tidak ditemukan.');
    if(item.ownerOnly&&actor!=='creator')throw new Error('Capability hanya dapat disetujui creator.');
    if(item.osPermission&&!osConfirmed)throw new Error('Capability memerlukan konfirmasi izin OS.');
    const now=Date.now();
    const expiresAt=now+Math.max(30_000,Math.min(24*60*60*1000,Number(ttlMs)||15*60*1000));
    item.status='approved';
    item.approvedAt=now;
    item.expiresAt=expiresAt;
    this.grants.set(item.capability,{capability:item.capability,actor:'creator',createdAt:now,expiresAt});
    this.record('capability.approved',{capability:item.capability,actor:'creator',result:'approved'});
    return {...item};
  }

  deny(requestId,{actor='creator'}={}){
    const item=this.requests.get(String(requestId||''));
    if(!item)return null;
    item.status='denied';
    item.deniedAt=Date.now();
    this.record('capability.denied',{capability:item.capability,actor,result:'denied'});
    return {...item};
  }

  revoke(capability,{actor='creator'}={}){
    const id=safeText(capability,80);
    if(actor!=='creator')throw new Error('Hanya creator yang dapat mencabut capability.');
    const removed=this.grants.delete(id);
    this.record('capability.revoked',{capability:id,actor,result:removed?'revoked':'absent'});
    return removed;
  }

  authorize(capability){
    const id=safeText(capability,80);
    const definition=NARA_CAPABILITIES[id];
    if(!definition)return {ok:false,reason:'unknown-capability'};
    if(!definition.ownerOnly&&!definition.osPermission)return {ok:true,reason:'built-in'};
    const grant=this.grants.get(id);
    if(!grant)return {ok:false,reason:'owner-approval-required'};
    if(grant.expiresAt<=Date.now()){
      this.grants.delete(id);
      return {ok:false,reason:'grant-expired'};
    }
    return {ok:true,reason:'approved',expiresAt:grant.expiresAt};
  }

  snapshot(){
    const now=Date.now();
    for(const [id,grant] of this.grants)if(grant.expiresAt<=now)this.grants.delete(id);
    return {
      version:1,
      policy:{
        arbitraryNetworkDiscovery:false,
        credentialBypass:false,
        authenticationBypass:false,
        exploitEscalation:false,
        rootExploit:false,
        osElevation:'owner-and-os-confirmation'
      },
      grants:[...this.grants.values()].map(item=>({...item})),
      pending:[...this.requests.values()].filter(item=>item.status==='pending').map(item=>({...item})),
      audit:this.audit.slice(-50)
    };
  }
}

export function createCapabilityBroker(options){return new NaraCapabilityBroker(options);}
