import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

const COOKIE_NAME='nara_creator_session';
const DEFAULT_TTL=8*60*60*1000;
const DEFAULT_WINDOW=10*60*1000;

function digest(value){
  return createHash('sha256').update(String(value??''),'utf8').digest();
}

function safeEqual(left,right){
  return timingSafeEqual(digest(left),digest(right));
}

function parseCookies(header=''){
  const result={};
  for(const part of String(header).split(';')){
    const index=part.indexOf('=');
    if(index<0)continue;
    const key=part.slice(0,index).trim();
    const value=part.slice(index+1).trim();
    if(key)result[key]=decodeURIComponent(value);
  }
  return result;
}

export function createCreatorAuth({
  username='creator',
  password='',
  ttlMs=DEFAULT_TTL,
  maxSessions=8,
  maxAttempts=5,
  attemptWindowMs=DEFAULT_WINDOW
}={}){
  const configured=Boolean(String(password));
  const sessions=new Map();
  const attempts=new Map();

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
    const token=parseCookies(req.headers.cookie||'')[COOKIE_NAME];
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
      return {ok:false,status:429,error:'Terlalu banyak percobaan login. Coba lagi nanti.'};
    }

    const user=String(input.username||'').slice(0,120);
    const pass=String(input.password||'').slice(0,512);
    if(!safeEqual(user,username)||!safeEqual(pass,password)){
      recordFailure(req);
      return {ok:false,status:401,error:'Identitas creator tidak valid.'};
    }

    attempts.delete(clientKey(req));
    const token=randomBytes(32).toString('base64url');
    const now=Date.now();
    sessions.set(token,{username,createdAt:now,expiresAt:now+ttlMs});
    prune(now);
    return {
      ok:true,
      authenticated:true,
      username,
      token,
      expiresAt:now+ttlMs
    };
  }

  function logout(req){
    const token=parseCookies(req.headers.cookie||'')[COOKIE_NAME];
    if(token)sessions.delete(token);
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
      username:session?.username||(configured?null:'creator'),
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
    username,
    getSession,
    login,
    logout,
    publicSession,
    sessionCookie,
    clearCookie
  };
}
