import {mkdir,open,rename,rm,writeFile} from 'node:fs/promises';
import {mkdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

const MAX_BYTES=512*1024;

export class NaraExperienceStore{
  constructor({filePath,maxBytes=MAX_BYTES}={}){
    this.filePath=String(filePath||'').trim();
    if(!this.filePath)throw new Error('Experience store path wajib diisi.');
    this.maxBytes=Math.max(16*1024,Math.min(2*1024*1024,Number(maxBytes)||MAX_BYTES));
  }

  async load(){
    let handle;
    try{
      handle=await open(this.filePath,'r');
      const info=await handle.stat();
      if(info.size<=0||info.size>this.maxBytes)throw new Error('Experience store NARA melebihi batas aman.');
      const raw=await handle.readFile({encoding:'utf8'});
      const data=JSON.parse(raw);
      if(data?.version!==1||!Array.isArray(data?.strategies)||!Array.isArray(data?.history)){
        throw new Error('Experience store NARA tidak valid.');
      }
      return data;
    }catch(error){
      if(error?.code==='ENOENT')return null;
      throw error;
    }finally{
      await handle?.close();
    }
  }

  payload(snapshot){
    const payload={
      version:1,
      strategies:Array.isArray(snapshot?.strategies)?snapshot.strategies.slice(0,500):[],
      history:Array.isArray(snapshot?.history)?snapshot.history.slice(-250):[]
    };
    const raw=JSON.stringify(payload,null,2);
    if(Buffer.byteLength(raw,'utf8')>this.maxBytes)throw new Error('Experience store NARA melebihi batas aman.');
    return {payload,raw};
  }

  async save(snapshot){
    const {payload,raw}=this.payload(snapshot);
    await mkdir(dirname(this.filePath),{recursive:true});
    const temp=this.filePath+'.tmp';
    await writeFile(temp,raw,{encoding:'utf8',mode:0o600});
    try{
      await rename(temp,this.filePath);
    }catch(error){
      if(!['EEXIST','EPERM'].includes(error?.code))throw error;
      await rm(this.filePath,{force:true});
      await rename(temp,this.filePath);
    }
    return payload;
  }

  saveSync(snapshot){
    const {payload,raw}=this.payload(snapshot);
    mkdirSync(dirname(this.filePath),{recursive:true});
    const temp=this.filePath+'.tmp';
    writeFileSync(temp,raw,{encoding:'utf8',mode:0o600});
    try{
      renameSync(temp,this.filePath);
    }catch(error){
      if(!['EEXIST','EPERM'].includes(error?.code))throw error;
      rmSync(this.filePath,{force:true});
      renameSync(temp,this.filePath);
    }
    return payload;
  }
}

export function createExperienceStore(options){return new NaraExperienceStore(options);}
