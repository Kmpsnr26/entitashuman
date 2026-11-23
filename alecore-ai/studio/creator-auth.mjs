import {randomBytes,timingSafeEqual} from 'node:crypto';

const COOKIE_NAME='ale_creator_session';
const DEFAULT_TTL=8*60*60*1000;
const DEFAULT_WINDOW=10*60*1000;

function safeEqual(left,right){
  const leftBuffer=Buffer.from(String(left??''),'utf8');
  const rightBuffer=Buffer.from(String(right??''),'utf8');
  const comparisonLength=Math.max(leftBuffer.length,rightBuffer.length,1);
  const paddedLeft=Buffer.alloc(comparisonLength);
  const paddedRight=Buffer.alloc(comparisonLength);
  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);
  return timingSafeEqual(paddedLeft,paddedRight)&&leftBuffer.length===rightBuffer.length;
}

function readSessionCookie(header=''){
  let sessionToken=null;
  for(const part of String(header).split(';')){
    const index=part.indexOf('=');
    if(index<0)continue;
    const key=part.slice(0,index).trim();
    if(key!==COOKIE_NAME)continue;
    try{
      sessionToken=decodeURIComponent(part.slice(index+1).trim());
    }catch{
      sessionToken=null;
    }
  }
  return sessionToken;
}

export function createCreatorAuth({
  username='creator',
  password='',
  credentialStore=null,
  ttlMs=DEFAULT_TTL,
  maxSessions=8,
  maxAttempts=5,
  attemptWindowMs=DEFAULT_WINDOW
}={}){
  const storedProfile=credentialStore?.publicProfile?.()||null;
  const configured=Boolean(storedProfile?.configured||String(password));
  const sessions=new Map();
  const attempts=new Map();

  function currentUsername(){
    return credentialStore?.publicProfile?.()?.username||username;
  }

  function verifyCredentials(user,pass){
    if(credentialStore?.configured?.()){
      return Boolean(credentialStore.verify({username:user,password:pass}));
    }
    return safeEqual(user,username)&&safeEqual(pass,password);
  }

  function prune(now=Date.now()){
    for(const [token,session] of sessions){
      if(session.expiresAt<=now)sessions.delete(token);
    }
    for(const [key,state] of attempts){
      if(now-state.startedAt>=attemptWindowMs)attempts.delete(key);
    }
    if(sessions.size<=maxSessions)return;
    const ordered=[...sessions.entries()].sort((a,b)=>a[1].createdAt-b[1].createdAt);
    while(sessions.size>maxSessions&&ordered.length){
      sessions.delete(ordered.shift()[0]);
    }
  }

  function clientKey(req){
    return String(req.socket?.remoteAddress||'local').slice(0,120);
  }

  function recordFailure(req){
    const now=Date.now();
    const key=clientKey(req);
    let state=attempts.get(key);
    if(!state||now-state.startedAt>=attemptWindowMs){
      state={startedAt:now,count:0};
    }
    state.count+=1;
    attempts.set(key,state);
    return state;
  }

  function isRateLimited(req){
    const now=Date.now();
    const state=attempts.get(clientKey(req));
    return Boolean(state&&now-state.startedAt<attemptWindowMs&&state.count>=maxAttempts);
  }

  function getSession(req){
    prune();
    const token=readSessionCookie(req.headers.cookie||'');
    if(!token)return null;
    const session=sessions.get(token);
    if(!session||session.expiresAt<=Date.now()){
      if(token)sessions.delete(token);
      return null;
    }
    return {...session,token};
  }

  function login(req,input={}){
    prune();
    if(!configured){
      return {ok:true,development:true,authenticated:true,username:'creator'};
    }
    if(isRateLimited(req)){
      const attempt=attempts.get(clientKey(req));
      return {ok:false,status:429,errorCode:'rate_limited',retryAfterMs:Math.max(1,attemptWindowMs-(Date.now()-attempt.startedAt)),error:'Terlalu banyak percobaan login. Tunggu sebelum mencoba lagi.'};
    }

    const user=String(input.username||'').slice(0,120);
    const pass=String(input.password||'');
    let valid=false;
    try{valid=pass.length<=512&&verifyCredentials(user,pass);}
    catch{return {ok:false,status:503,errorCode:'owner_store_unavailable',error:'Penyimpanan Owner server tidak dapat dibaca. Data login dipertahankan.'};}
    if(!valid){
      recordFailure(req);
      return {ok:false,status:401,errorCode:'invalid_credentials',error:'Creator ID atau Access Key tidak cocok dengan Owner server ini.'};
    }

    attempts.delete(clientKey(req));
    const token=randomBytes(32).toString('base64url');
    const now=Date.now();
    sessions.set(token,{username:currentUsername(),createdAt:now,expiresAt:now+ttlMs});
    prune(now);
    return {
      ok:true,
      authenticated:true,
      username:currentUsername(),
      token,
      expiresAt:now+ttlMs
    };
  }

  function logout(req){
    const token=readSessionCookie(req.headers.cookie||'');
    if(token)sessions.delete(token);
  }

  function changeCredentials(req,input={}){
    const session=getSession(req);
    if(!session)return {ok:false,status:401,error:'Creator authentication required.'};
    if(!credentialStore?.configured?.()||typeof credentialStore.changeCredentials!=='function'){
      return {ok:false,status:409,error:'Persistent Creator owner store belum aktif.'};
    }
    const currentPassword=String(input.currentPassword||'').slice(0,512);
    const newUsername=String(input.newUsername||'').slice(0,120);
    const newPassword=String(input.newPassword||'').slice(0,512);
    try{
      const profile=credentialStore.changeCredentials({
        currentUsername:session.username,
        currentPassword,
        newUsername,
        newPassword
      });
      sessions.clear();
      return {ok:true,profile};
    }catch(error){
      return {ok:false,status:400,error:error.message||'Perubahan login Creator gagal.'};
    }
  }

  function sessionCookie(token,{secure=false}={}){
    const maxAge=Math.max(1,Math.floor(ttlMs/1000));
    return [
      COOKIE_NAME+'='+encodeURIComponent(token),
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      'Max-Age='+maxAge,
      secure?'Secure':null
    ].filter(Boolean).join('; ');
  }

  function clearCookie({secure=false}={}){
    return [
      COOKIE_NAME+'=',
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      'Max-Age=0',
      secure?'Secure':null
    ].filter(Boolean).join('; ');
  }

  function publicSession(req){
    const session=getSession(req);
    const authenticated=!configured||Boolean(session);
    return {
      configured,
      authenticated,
      development:!configured,
      username:session?.username||(configured?null:currentUsername()),
      expiresAt:session?.expiresAt||null,
      capabilities:[
        {id:'camera',label:'Camera',state:authenticated?'permission_required':'locked',authority:'browser-os'},
        {id:'microphone',label:'Microphone',state:authenticated?'permission_required':'locked',authority:'browser-os'},
        {id:'audio',label:'Audio',state:authenticated?'available':'locked',authority:'browser'},
        {id:'database',label:'Database',state:authenticated?'not_configured':'locked',authority:'server-connector'},
        {id:'localhost',label:'Localhost',state:authenticated?'ready':'locked',authority:'studio'},
        {id:'server',label:'Server',state:authenticated?'ready':'locked',authority:'studio'}
      ]
    };
  }

  return {
    configured,
    get username(){return currentUsername();},
    getSession,
    login,
    logout,
    changeCredentials,
    publicSession,
    sessionCookie,
    clearCookie
  };
}
