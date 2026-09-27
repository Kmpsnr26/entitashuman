import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import {dirname} from 'node:path';
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';

const USER_RE=/^[A-Za-z0-9._-]{3,80}$/;

function safePassword(value){
  const password=String(value??'');
  if(password.length<10||password.length>512)throw new Error('Password Creator harus 10–512 karakter.');
  return password;
}

function safeUsername(value){
  const username=String(value??'').trim();
  if(!USER_RE.test(username))throw new Error('Username Creator harus 3–80 karakter dan hanya memakai huruf, angka, titik, garis bawah, atau minus.');
  return username;
}

function hashPassword(password,salt){
  return scryptSync(
    safePassword(password),
    Buffer.from(String(salt),'base64url'),
    64,
    {N:16384,r:8,p:1,maxmem:64*1024*1024}
  );
}

function secureEqual(left,right){
  const a=Buffer.from(String(left),'base64url');
  const b=Buffer.from(String(right),'base64url');
  return a.length===b.length&&timingSafeEqual(a,b);
}

export class NaraOwnerStore{
  constructor({filePath}={}){
    this.filePath=String(filePath||'').trim();
    if(!this.filePath)throw new Error('Owner store path wajib diisi.');
  }

  configured(){
    return existsSync(this.filePath);
  }

  read(){
    if(!this.configured())return null;
    let data;
    try{data=JSON.parse(readFileSync(this.filePath,'utf8'));}
    catch{throw new Error('Owner store NARA tidak dapat dibaca.');}
    if(
      data?.version!==1||
      typeof data.ownerId!=='string'||
      typeof data.deviceId!=='string'||
      typeof data.username!=='string'||
      typeof data.salt!=='string'||
      typeof data.passwordHash!=='string'
    )throw new Error('Owner store NARA tidak valid.');
    return data;
  }

  write(data){
    mkdirSync(dirname(this.filePath),{recursive:true});
    writeFileSync(this.filePath,JSON.stringify(data,null,2),{
      encoding:'utf8',
      mode:0o600
    });
  }

  provision({username='creator',password}={}){
    if(this.configured())throw new Error('Creator NARA sudah diprovision.');
    const now=Date.now();
    const salt=randomBytes(18).toString('base64url');
    const cleanUser=safeUsername(username);
    const passwordHash=hashPassword(password,salt).toString('base64url');
    const data={
      version:1,
      ownerId:randomUUID(),
      deviceId:randomUUID(),
      username:cleanUser,
      salt,
      passwordHash,
      createdAt:now,
      updatedAt:now
    };
    this.write(data);
    return this.publicProfile();
  }

  verify({username,password}={}){
    const data=this.read();
    if(!data)return false;
    const cleanUser=String(username??'').trim();
    if(cleanUser!==data.username)return false;
    let candidate;
    try{candidate=hashPassword(password,data.salt).toString('base64url');}
    catch{return false;}
    return secureEqual(candidate,data.passwordHash);
  }

  changeCredentials({
    currentUsername,
    currentPassword,
    newUsername,
    newPassword
  }={}){
    const data=this.read();
    if(!data)throw new Error('Creator NARA belum diprovision.');
    if(!this.verify({username:currentUsername,password:currentPassword})){
      throw new Error('Verifikasi Creator lama gagal.');
    }
    const username=safeUsername(newUsername||data.username);
    const password=safePassword(newPassword);
    const salt=randomBytes(18).toString('base64url');
    const next={
      ...data,
      username,
      salt,
      passwordHash:hashPassword(password,salt).toString('base64url'),
      updatedAt:Date.now()
    };
    this.write(next);
    return this.publicProfile();
  }

  publicProfile(){
    const data=this.read();
    if(!data)return {
      configured:false,
      ownerId:null,
      deviceId:null,
      username:null
    };
    return {
      configured:true,
      ownerId:data.ownerId,
      deviceId:data.deviceId,
      username:data.username,
      createdAt:data.createdAt,
      updatedAt:data.updatedAt
    };
  }
}

export function createOwnerStore(options){return new NaraOwnerStore(options);}
