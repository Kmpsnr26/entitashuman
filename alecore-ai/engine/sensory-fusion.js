const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

function safeInterfaces(items=[]){
  if(!Array.isArray(items))return [];
  return items.slice(0,16).map(item=>({
    name:safeText(item?.name,80),
    family:safeText(item?.family,16),
    address:safeText(item?.address,80),
    internal:Boolean(item?.internal)
  })).filter(item=>item.name&&item.address);
}

export class AleSensoryFusion{
  constructor(){
    this.state={
      version:1,
      hearing:{active:false,energy:0,low:0,mid:0,high:0,updatedAt:0},
      vision:{active:false,activity:0,frameId:null,updatedAt:0},
      speech:{active:false,energy:0,updatedAt:0},
      system:{
        active:false,platform:'',hostname:'',arch:'',
        cpuLoad:0,memoryUsedRatio:0,processMemoryMb:0,
        interfaces:[],updatedAt:0
      },
      server:{
        active:false,scope:'none',host:'',port:0,transport:'',
        health:'unknown',updatedAt:0
      },
      dataFlow:{
        active:false,inBytes:0,outBytes:0,inEvents:0,outEvents:0,
        inRate:0,outRate:0,lastDirection:'',updatedAt:0
      },
      device:{
        active:false,platform:'',integrationMode:'permissioned',
        capabilities:[],updatedAt:0
      }
    };
  }

  consume(envelope){
    if(!envelope?.event)return null;
    const event=envelope.event,payload=envelope.payload||{},timestamp=Number(envelope.timestamp)||Date.now();

    if(event==='audio.energy'){
      this.state.hearing={
        active:clamp01(payload.energy)>.01,
        energy:clamp01(payload.energy),
        low:clamp01(payload.low),
        mid:clamp01(payload.mid),
        high:clamp01(payload.high),
        updatedAt:timestamp
      };
    }else if(event==='vision.frame'){
      this.state.vision={
        active:true,
        activity:clamp01(payload.activity??1),
        frameId:payload.frameId==null?null:safeText(payload.frameId,120),
        updatedAt:timestamp
      };
    }else if(event==='vision.stop'){
      this.state.vision={active:false,activity:0,frameId:null,updatedAt:timestamp};
    }else if(event==='speech.start'||event==='speech.energy'){
      this.state.speech={active:true,energy:clamp01(payload.energy??.35),updatedAt:timestamp};
    }else if(event==='speech.stop'){
      this.state.speech={active:false,energy:0,updatedAt:timestamp};
    }else if(event==='system.telemetry'){
      this.state.system={
        active:true,
        platform:safeText(payload.platform,40),
        hostname:safeText(payload.hostname,120),
        arch:safeText(payload.arch,40),
        cpuLoad:clamp01(payload.cpuLoad),
        memoryUsedRatio:clamp01(payload.memoryUsedRatio),
        processMemoryMb:Math.max(0,finite(payload.processMemoryMb)),
        interfaces:safeInterfaces(payload.interfaces),
        updatedAt:timestamp
      };
    }else if(event==='server.observe'){
      this.state.server={
        active:true,
        scope:['loopback','configured'].includes(payload.scope)?payload.scope:'configured',
        host:safeText(payload.host,120),
        port:Math.max(0,Math.min(65535,Math.round(finite(payload.port)))),
        transport:safeText(payload.transport,40),
        health:['online','degraded','offline','unknown'].includes(payload.health)?payload.health:'unknown',
        updatedAt:timestamp
      };
    }else if(event==='dataflow.sample'){
      const previous=this.state.dataFlow;
      this.state.dataFlow={
        active:true,
        inBytes:Math.max(0,finite(payload.inBytes,previous.inBytes)),
        outBytes:Math.max(0,finite(payload.outBytes,previous.outBytes)),
        inEvents:Math.max(0,Math.round(finite(payload.inEvents,previous.inEvents))),
        outEvents:Math.max(0,Math.round(finite(payload.outEvents,previous.outEvents))),
        inRate:Math.max(0,finite(payload.inRate)),
        outRate:Math.max(0,finite(payload.outRate)),
        lastDirection:['in','out','duplex'].includes(payload.lastDirection)?payload.lastDirection:'',
        updatedAt:timestamp
      };
    }else if(event==='device.integration'){
      this.state.device={
        active:Boolean(payload.active??true),
        platform:safeText(payload.platform,40),
        integrationMode:'permissioned',
        capabilities:Array.isArray(payload.capabilities)
          ?payload.capabilities.slice(0,32).map(value=>safeText(value,80)).filter(Boolean)
          :[],
        updatedAt:timestamp
      };
    }else return null;

    return this.snapshot();
  }

  snapshot(){
    return {
      version:this.state.version,
      hearing:{...this.state.hearing},
      vision:{...this.state.vision},
      speech:{...this.state.speech},
      system:{...this.state.system,interfaces:this.state.system.interfaces.map(item=>({...item}))},
      server:{...this.state.server},
      dataFlow:{...this.state.dataFlow},
      device:{...this.state.device,capabilities:[...this.state.device.capabilities]}
    };
  }

  reset(){
    const fresh=new AleSensoryFusion();
    this.state=fresh.state;
    return this.snapshot();
  }
}

export function createSensoryFusion(){return new AleSensoryFusion();}
