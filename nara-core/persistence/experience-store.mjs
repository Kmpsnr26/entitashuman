import {mkdir,readFile,rename,stat,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

const MAX_BYTES=512*1024;

export class NaraExperienceStore{
  constructor({filePath,maxBytes=MAX_BYTES}={}){
    this.filePath=String(filePath||'').trim();
    if(!this.filePath)throw new Error('Experience store path wajib diisi.');
    this.maxBytes=Math.max(16*1024,Math.min(2*1024*1024,Number(maxBytes)||MAX_BYTES));
  }

  async load(){
    try{
      const info=await stat(this.filePath);
      if(info.size<=0||info.size>this.maxBytes)throw new Error('Experience store NARA melebihi batas aman.');
      const raw=await readFile(this.filePath,'utf8');
      const data=JSON.parse(raw);
      if(data?.version!==1||!Array.isArray(data?.strategies)||!Array.isArray(data?.history)){
        throw new Error('Experience store NARA tidak valid.');
      }
      return data;
    }catch(error){
      if(error?.code==='ENOENT')return null;
      throw error;
    }
  }

  async save(snapshot){
    const payload={
      version:1,
      strategies:Array.isArray(snapshot?.strategies)?snapshot.strategies.slice(0,500):[],
      history:Array.isArray(snapshot?.history)?snapshot.history.slice(-250):[]
    };
    const raw=JSON.stringify(payload,null,2);
    if(Buffer.byteLength(raw,'utf8')>this.maxBytes)throw new Error('Experience store NARA melebihi batas aman.');
    await mkdir(dirname(this.filePath),{recursive:true});
    const temp=this.filePath+'.tmp';
    await writeFile(temp,raw,{encoding:'utf8',mode:0o600});
    await rename(temp,this.filePath);
    return payload;
  }
}

export function createExperienceStore(options){return new NaraExperienceStore(options);}
