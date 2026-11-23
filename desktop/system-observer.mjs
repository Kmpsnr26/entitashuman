import os from 'node:os';

const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));
const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

function cpuTotals(){
  let idle=0,total=0;
  for(const cpu of os.cpus()||[]){
    const times=cpu.times||{};
    const values=Object.values(times).map(Number).filter(Number.isFinite);
    const cpuTotal=values.reduce((sum,value)=>sum+value,0);
    idle+=Number(times.idle)||0;
    total+=cpuTotal;
  }
  return {idle,total};
}

function ownInterfaces(){
  const rows=[];
  const entries=os.networkInterfaces()||{};
  for(const [name,items] of Object.entries(entries)){
    for(const item of items||[]){
      const family=typeof item.family==='string'?item.family:String(item.family||'');
      if(!['IPv4','IPv6','4','6'].includes(family))continue;
      rows.push({
        name:safeText(name,80),
        family:family==='4'?'IPv4':family==='6'?'IPv6':family,
        address:safeText(item.address,80),
        internal:Boolean(item.internal)
      });
    }
  }
  return rows.slice(0,16);
}

export class AleSystemObserver{
  constructor({intervalMs=5000}={}){
    this.intervalMs=Math.max(1000,Math.min(60000,Number(intervalMs)||5000));
    this.timer=null;
    this.previousCpu=cpuTotals();
  }

  snapshot(){
    const current=cpuTotals();
    const idleDelta=Math.max(0,current.idle-this.previousCpu.idle);
    const totalDelta=Math.max(0,current.total-this.previousCpu.total);
    this.previousCpu=current;
    const cpuLoad=totalDelta>0?clamp01(1-idleDelta/totalDelta):0;
    const totalMemory=Math.max(1,os.totalmem());
    const freeMemory=Math.max(0,os.freemem());
    const rss=process.memoryUsage?.().rss||0;
    return {
      platform:os.platform(),
      release:os.release(),
      arch:os.arch(),
      hostname:os.hostname(),
      cpuLoad,
      memoryUsedRatio:clamp01((totalMemory-freeMemory)/totalMemory),
      processMemoryMb:Math.round(rss/1024/1024*10)/10,
      interfaces:ownInterfaces()
    };
  }

  deviceProfile(){
    return {
      platform:os.platform(),
      release:os.release(),
      arch:os.arch(),
      hostname:os.hostname(),
      runtime:'electron-node',
      adapters:['microphone','camera','admin-elevation']
    };
  }

  start(callback){
    if(typeof callback!=='function')throw new TypeError('System observer callback harus fungsi.');
    if(this.timer)return ()=>this.stop();
    const emit=()=>callback(this.snapshot());
    emit();
    this.timer=setInterval(emit,this.intervalMs);
    this.timer.unref?.();
    return ()=>this.stop();
  }

  stop(){
    if(this.timer)clearInterval(this.timer);
    this.timer=null;
  }
}

export class AleDataFlowMeter{
  constructor(){
    this.inBytes=0;
    this.outBytes=0;
    this.inEvents=0;
    this.outEvents=0;
    this.lastDirection='';
    this.lastAt=Date.now();
    this.lastInBytes=0;
    this.lastOutBytes=0;
  }

  size(value){
    try{return Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value??null),'utf8');}
    catch{return 0;}
  }

  recordIn(value){
    this.inBytes+=this.size(value);
    this.inEvents+=1;
    this.lastDirection=this.lastDirection==='out'?'duplex':'in';
  }

  recordOut(value){
    this.outBytes+=this.size(value);
    this.outEvents+=1;
    this.lastDirection=this.lastDirection==='in'?'duplex':'out';
  }

  snapshot(){
    const now=Date.now();
    const seconds=Math.max(.001,(now-this.lastAt)/1000);
    const result={
      inBytes:this.inBytes,
      outBytes:this.outBytes,
      inEvents:this.inEvents,
      outEvents:this.outEvents,
      inRate:Math.max(0,(this.inBytes-this.lastInBytes)/seconds),
      outRate:Math.max(0,(this.outBytes-this.lastOutBytes)/seconds),
      lastDirection:this.lastDirection
    };
    this.lastAt=now;
    this.lastInBytes=this.inBytes;
    this.lastOutBytes=this.outBytes;
    this.lastDirection='';
    return result;
  }
}

export function createSystemObserver(options){return new AleSystemObserver(options);}
export function createDataFlowMeter(){return new AleDataFlowMeter();}
