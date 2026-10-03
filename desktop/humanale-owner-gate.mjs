const safeKey=value=>String(value??'').slice(0,120);

export function isOwnerTargetUnlocked(target,ownerGate){
  if(!target||target.isDestroyed?.())return false;
  const contents=target.webContents;
  if(!contents||contents.isDestroyed?.())return false;
  return Boolean(ownerGate?.isUnlocked?.(String(contents.id)));
}

export function authorizedDisplayMediaTarget(request,{targets=[],ownerGate,origin=''}={}){
  if(
    !request?.frame||
    !request.userGesture||
    !request.audioRequested||
    String(request.securityOrigin||'')!==String(origin||'')
  )return null;
  const target=(Array.isArray(targets)?targets:[]).find(item=>
    item?.webContents?.mainFrame===request.frame
  );
  return isOwnerTargetUnlocked(target,ownerGate)?target:null;
}

export class HumanALEOwnerGate{
  constructor({
    store,
    ttlMs=8*60*60*1000,
    maxAttempts=5,
    attemptWindowMs=60*1000
  }={}){
    if(!store?.publicProfile||!store?.verify||!store?.provision||!store?.changeCredentials){
      throw new Error('HumanALE Owner Gate membutuhkan NARA Owner Store.');
    }
    this.store=store;
    this.ttlMs=Math.max(5*60*1000,Math.min(24*60*60*1000,Number(ttlMs)||8*60*60*1000));
    this.maxAttempts=Math.max(3,Math.min(12,Number(maxAttempts)||5));
    this.attemptWindowMs=Math.max(10*1000,Math.min(15*60*1000,Number(attemptWindowMs)||60*1000));
    this.sessions=new Map();
    this.attempts=new Map();
  }

  key(actor){return safeKey(actor);}

  cleanup(){
    const now=Date.now();
    for(const [key,session] of this.sessions){
      if(session.expiresAt<=now)this.sessions.delete(key);
    }
    for(const [key,attempt] of this.attempts){
      if(now-attempt.startedAt>this.attemptWindowMs)this.attempts.delete(key);
    }
  }

  isUnlocked(actor){
    this.cleanup();
    const session=this.sessions.get(this.key(actor));
    return Boolean(session&&session.expiresAt>Date.now());
  }

  status(actor){
    this.cleanup();
    let profile;
    try{profile=this.store.publicProfile();}
    catch{return this.storeFailure();}
    const session=this.sessions.get(this.key(actor));
    const retryAfterMs=this.retryAfterMs(actor);
    return {
      configured:Boolean(profile.configured),
      unlocked:Boolean(session&&session.expiresAt>Date.now()),
      username:profile.username||null,
      sessionExpiresAt:session?.expiresAt||0,
      retryAfterMs,
      errorCode:retryAfterMs?'rate_limited':''
    };
  }

  storeFailure(){
    this.sessions.clear();
    return {ok:false,configured:true,unlocked:false,username:null,sessionExpiresAt:0,retryAfterMs:0,errorCode:'owner_store_unavailable',error:'Penyimpanan Owner tidak dapat dibaca. Data login dipertahankan; periksa akses penyimpanan sebelum mencoba lagi.'};
  }

  retryAfterMs(actor){
    const item=this.attempts.get(this.key(actor));
    return item&&item.count>=this.maxAttempts?Math.max(0,this.attemptWindowMs-(Date.now()-item.startedAt)+1):0;
  }

  failure(actor,error,extra={}){
    const status=this.status(actor);
    if(status.errorCode==='owner_store_unavailable')return status;
    return {ok:false,...status,...extra,error:String(error||'Akses Creator gagal.')};
  }

  recordFailure(actor){
    const key=this.key(actor);
    const now=Date.now();
    let item=this.attempts.get(key);
    if(!item||now-item.startedAt>this.attemptWindowMs)item={count:0,startedAt:now};
    item.count+=1;
    this.attempts.set(key,item);
    return item.count;
  }

  rateLimited(actor){
    this.cleanup();
    const item=this.attempts.get(this.key(actor));
    return Boolean(item&&item.count>=this.maxAttempts);
  }

  unlock(actor){
    const key=this.key(actor);
    const expiresAt=Date.now()+this.ttlMs;
    this.sessions.set(key,{expiresAt});
    this.attempts.delete(key);
    return expiresAt;
  }

  provision(actor,{username='creator',password='',confirmPassword=''}={}){
    if(this.store.configured())return this.failure(actor,'Creator HumanALE sudah diprovision.');
    if(String(password)!==String(confirmPassword))return this.failure(actor,'Konfirmasi password Creator tidak sama.');
    try{
      const profile=this.store.provision({username,password});
      const sessionExpiresAt=this.unlock(actor);
      return {ok:true,configured:true,unlocked:true,username:profile.username,sessionExpiresAt};
    }catch(error){
      return this.failure(actor,error?.message||'Provisioning Creator HumanALE gagal.');
    }
  }

  login(actor,{username='',password=''}={}){
    const status=this.status(actor);
    if(status.errorCode==='owner_store_unavailable')return status;
    if(!this.store.configured())return this.failure(actor,'Creator HumanALE belum diprovision.');
    if(this.rateLimited(actor))return this.failure(actor,'Terlalu banyak percobaan login. Tunggu hitung mundur sebelum mencoba lagi.',{rateLimited:true,errorCode:'rate_limited',retryAfterMs:this.retryAfterMs(actor)});
    let ok;
    try{ok=this.store.verify({username:String(username),password:String(password)});}
    catch{return this.storeFailure();}
    if(!ok){
      this.recordFailure(actor);
      return this.failure(actor,'Creator ID atau Access Key tidak cocok dengan Owner PC ini.',{errorCode:this.rateLimited(actor)?'rate_limited':'invalid_credentials',retryAfterMs:this.retryAfterMs(actor)});
    }
    const sessionExpiresAt=this.unlock(actor);
    return {ok:true,configured:true,unlocked:true,username:this.store.publicProfile().username,sessionExpiresAt};
  }

  logout(actor){
    this.sessions.clear();
    return {ok:true,...this.status(actor)};
  }

  changeCredentials(actor,input={}){
    if(!this.isUnlocked(actor))return this.failure(actor,'Creator unlock diperlukan.');
    try{
      const profile=this.store.changeCredentials({
        currentUsername:this.store.publicProfile().username,
        currentPassword:String(input.currentPassword||''),
        newUsername:String(input.newUsername||''),
        newPassword:String(input.newPassword||'')
      });
      this.sessions.clear();
      this.attempts.clear();
      return {
        ok:true,
        reloginRequired:true,
        configured:true,
        unlocked:false,
        username:profile.username
      };
    }catch(error){
      return this.failure(actor,error?.message||'Perubahan login Creator gagal.');
    }
  }

  revokeAll(){
    this.sessions.clear();
    return true;
  }
}

export function createHumanALEOwnerGate(options){return new HumanALEOwnerGate(options);}
