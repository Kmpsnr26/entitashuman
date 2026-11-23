(function exposeHumanALENaraRuntime(global){
  const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));
  const safeEvent=value=>{
    const event=String(value||'').trim();
    if(!event||event.length>120||!/^[a-z0-9_.:-]+$/i.test(event))throw new Error('Nama event AleCore AI tidak valid.');
    return event;
  };
  const connectionEvents=Object.freeze({
    'github.connected':'GITHUB','copilot.connected':'COPILOT','drive.connected':'DRIVE',
    'email.connected':'OWNER_EMAIL','web.connected':'WEB','team.connected':'TEAM','online.connected':'ONLINE'
  });
  const disconnectionEvents=Object.freeze({
    'github.disconnected':'GITHUB','copilot.disconnected':'COPILOT','drive.disconnected':'DRIVE',
    'email.disconnected':'OWNER_EMAIL','web.disconnected':'WEB','team.disconnected':'TEAM','online.disconnected':'ONLINE'
  });

  class EventBus{
    constructor({historyLimit=250}={}){
      this.historyLimit=Math.max(10,Math.min(2000,Number(historyLimit)||250));
      this.listeners=new Map();this.anyListeners=new Set();this.history=[];this.sequence=0;
    }
    on(event,listener){
      const name=safeEvent(event);
      if(typeof listener!=='function')throw new TypeError('Listener AleCore AI harus berupa fungsi.');
      const bucket=this.listeners.get(name)||new Set();bucket.add(listener);this.listeners.set(name,bucket);
      return()=>{bucket.delete(listener);if(!bucket.size)this.listeners.delete(name);};
    }
    onAny(listener){
      if(typeof listener!=='function')throw new TypeError('Listener AleCore AI harus berupa fungsi.');
      this.anyListeners.add(listener);return()=>this.anyListeners.delete(listener);
    }
    emit(event,payload={},meta={}){
      const envelope=Object.freeze({
        id:++this.sequence,event:safeEvent(event),timestamp:Date.now(),
        payload:payload&&typeof payload==='object'?payload:{value:payload},
        meta:meta&&typeof meta==='object'?meta:{}
      });
      this.history.push(envelope);
      if(this.history.length>this.historyLimit)this.history.splice(0,this.history.length-this.historyLimit);
      for(const listener of [...(this.listeners.get(envelope.event)||[])])listener(envelope);
      for(const listener of [...this.anyListeners])listener(envelope);
      return envelope;
    }
    recent({event='',limit=25}={}){
      const max=Math.max(1,Math.min(250,Number(limit)||25));
      const items=event?this.history.filter(item=>item.event===event):this.history;
      return items.slice(-max);
    }
  }

  class BrainState{
    constructor(regions=[]){
      this.regionMeta=Object.fromEntries((regions||[]).map(region=>[region.id,region]));
      this.listeners=new Set();
      this.state={
        version:1,lifecycle:'idle',selectedRegion:'NARA_CORE',currentTask:null,
        regions:Object.fromEntries((regions||[]).map(region=>[
          region.id,{id:region.id,status:region.id==='NARA_CORE'?'ready':'idle',activity:0,lastEvent:'',message:'',updatedAt:0}
        ])),
        sensory:{
          hearing:{active:false,energy:0,low:0,mid:0,high:0},
          vision:{active:false,activity:0,frameId:null},
          speech:{active:false,energy:0}
        },
        lastEvent:null
      };
    }
    isRegionId(id){return typeof id==='string'&&Object.hasOwn(this.regionMeta,id);}
    subscribe(listener){
      if(typeof listener!=='function')throw new TypeError('Subscriber BrainState harus berupa fungsi.');
      this.listeners.add(listener);return()=>this.listeners.delete(listener);
    }
    snapshot(){
      return {
        ...this.state,
        regions:Object.fromEntries(Object.entries(this.state.regions).map(([id,value])=>[id,{...value}])),
        sensory:{
          hearing:{...this.state.sensory.hearing},
          vision:{...this.state.sensory.vision},
          speech:{...this.state.sensory.speech}
        },
        currentTask:this.state.currentTask?{...this.state.currentTask}:null,
        lastEvent:this.state.lastEvent?{...this.state.lastEvent}:null
      };
    }
    notify(change){
      const snapshot=this.snapshot();
      for(const listener of [...this.listeners])listener(snapshot,change);
    }
    setRegion(id,patch={},source='state.update'){
      if(!this.isRegionId(id))return null;
      const current=this.state.regions[id]||{id,status:'idle',activity:0,lastEvent:'',message:'',updatedAt:0};
      const next={...current,...patch,id,updatedAt:Date.now(),lastEvent:patch.lastEvent||source};
      this.state.regions={...this.state.regions,[id]:next};
      this.notify({type:'region',id,source,next:{...next}});
      return next;
    }
    selectRegion(id,source='brain.region.select'){
      if(!this.isRegionId(id))return null;
      this.state.selectedRegion=id;
      const current=this.state.regions[id]||{status:'idle',activity:0};
      const status=['idle','ready'].includes(current.status)?'active':current.status;
      this.setRegion(id,{status,activity:Math.max(.92,clamp01(current.activity)),lastEvent:source},source);
      return id;
    }
    applyEvent(envelope){
      if(!envelope?.event)return this.snapshot();
      const {event,payload={}}=envelope;
      this.state.lastEvent={id:envelope.id,event,timestamp:envelope.timestamp};
      if(event==='alecore.start'||event==='nara.start'){
        this.state.lifecycle='active';
        this.setRegion('NARA_CORE',{status:'active',activity:1,message:'AleCore AI aktif'},event);
      }else if(event==='alecore.shutdown'||event==='nara.shutdown'){
        this.state.lifecycle='offline';
        this.setRegion('NARA_CORE',{status:'offline',activity:0,message:'AleCore AI dihentikan'},event);
      }else if(event==='brain.region.select'&&this.isRegionId(payload.region)){
        this.selectRegion(payload.region,event);
      }else if(event==='context.prepare'){
        const targetRegion=payload.target==='planner'?'PLANNER':payload.target==='agent'?'AGENT_MANAGER':'REASONER';
        this.setRegion('MEMORY',{status:'processing',activity:.9,message:'Menyiapkan context memori'},event);
        this.setRegion(targetRegion,{status:'active',activity:.55,message:'Menunggu context memori'},event);
      }else if(event==='context.approved'){
        const targetRegion=payload.target==='planner'?'PLANNER':payload.target==='agent'?'AGENT_MANAGER':'REASONER';
        this.setRegion('MEMORY',{status:'complete',activity:.35,message:'Context memori disetujui'},event);
        this.setRegion(targetRegion,{status:'ready',activity:.55,message:'Context memori siap digunakan'},event);
      }else if(event==='context.used'){
        const targetRegion=payload.target==='planner'?'PLANNER':payload.target==='agent'?'AGENT_MANAGER':'REASONER';
        this.setRegion('MEMORY',{status:'active',activity:.7,message:'Context memori digunakan'},event);
        this.setRegion(targetRegion,{status:'processing',activity:.9,message:'Menggunakan context memori'},event);
      }else if(event==='context.blocked'){
        this.setRegion('MEMORY',{status:'paused',activity:.12,message:'Context memori tidak digunakan'},event);
      }else if(event==='observe.start'){
        this.setRegion('NARA_CORE',{status:'processing',activity:1,message:'Mengamati konteks kerja'},event);
      }else if(event==='observe.complete'){
        this.setRegion('NARA_CORE',{status:'ready',activity:.35,message:'Observasi selesai'},event);
      }else if(event==='reason.start'){
        this.setRegion('REASONER',{status:'thinking',activity:1,message:String(payload.label||'Menganalisis permintaan').slice(0,160)},event);
      }else if(event==='reason.complete'){
        this.setRegion('REASONER',{status:'complete',activity:.25,message:'Analisis selesai'},event);
      }else if(event==='plan.start'){
        this.setRegion('PLANNER',{status:'processing',activity:1,message:String(payload.label||'Menyusun rencana kerja').slice(0,160)},event);
      }else if(event==='plan.complete'){
        this.setRegion('PLANNER',{status:'complete',activity:.25,message:'Rencana siap'},event);
      }else if(event==='agent.start'){
        this.setRegion('AGENT_MANAGER',{status:'processing',activity:1,message:String(payload.label||'Agent bekerja').slice(0,160)},event);
      }else if(event==='agent.complete'){
        this.setRegion('AGENT_MANAGER',{status:'complete',activity:.25,message:'Agent selesai'},event);
      }else if(event==='agent.failed'){
        this.setRegion('AGENT_MANAGER',{status:'error',activity:1,message:'Agent gagal'},event);
      }else if(event==='memory.read'){
        this.setRegion('MEMORY',{status:'active',activity:.75,message:String(payload.label||'Membaca memori kerja').slice(0,160)},event);
      }else if(event==='memory.write'){
        this.setRegion('MEMORY',{status:'processing',activity:.9,message:String(payload.label||'Memperbarui memori kerja').slice(0,160)},event);
      }else if(event==='memory.complete'){
        this.setRegion('MEMORY',{status:'complete',activity:.2,message:'Memori kerja diperbarui'},event);
      }else if(event==='program.start'){
        this.setRegion('PROGRAM',{status:'processing',activity:1,message:String(payload.label||'Menjalankan pekerjaan program').slice(0,160)},event);
      }else if(event==='program.complete'){
        this.setRegion('PROGRAM',{status:'complete',activity:.2,message:'Pekerjaan program selesai'},event);
      }else if(event==='verify.start'){
        this.setRegion('FOLLOW_UP',{status:'processing',activity:1,message:'Memverifikasi hasil'},event);
        this.setRegion('REPORTING',{status:'active',activity:.6,message:'Mengumpulkan hasil verifikasi'},event);
      }else if(event==='verify.complete'){
        this.setRegion('FOLLOW_UP',{status:'complete',activity:.2,message:'Verifikasi selesai'},event);
        this.setRegion('REPORTING',{status:'complete',activity:.25,message:'Hasil siap dilaporkan'},event);
      }else if(event==='work.start'){
        this.state.currentTask={id:String(payload.id||'task-'+envelope.id),label:String(payload.label||'Pekerjaan AleCore AI').slice(0,160),startedAt:envelope.timestamp};
        this.setRegion('PROGRAM',{status:'processing',activity:1,message:this.state.currentTask.label},event);
        this.setRegion('FOLLOW_UP',{status:'active',activity:.7,message:'Memantau tindak lanjut'},event);
      }else if(event==='work.complete'){
        this.state.currentTask=null;
        this.setRegion('PROGRAM',{status:'complete',activity:.15,message:'Pekerjaan selesai'},event);
        this.setRegion('REPORTING',{status:'active',activity:.8,message:'Menyiapkan laporan'},event);
      }else if(event==='work.failed'){
        this.state.currentTask=null;
        this.setRegion('PROGRAM',{status:'error',activity:1,message:'Pekerjaan gagal'},event);
        this.setRegion('FOLLOW_UP',{status:'error',activity:.8,message:'Tindak lanjut diperlukan'},event);
      }else if(event==='error.detected'){
        this.setRegion('ERROR_MONITOR',{status:'error',activity:1,message:String(payload.message||'Error terdeteksi')},event);
        this.setRegion('BUG_HUNTER',{status:'processing',activity:.9,message:'Menganalisis error'},event);
      }else if(event==='bug.detected'){
        this.setRegion('BUG_HUNTER',{status:'bug',activity:1,message:String(payload.message||'Bug terdeteksi')},event);
      }else if(event==='bug.fixed'){
        this.setRegion('BUG_HUNTER',{status:'complete',activity:.25,message:'Perbaikan selesai dan siap diverifikasi'},event);
      }else if(event==='terminal.open'){
        this.setRegion('TERMINAL',{status:'active',activity:1,message:'Terminal aktif'},event);
      }else if(connectionEvents[event]){
        this.setRegion(connectionEvents[event],{status:'connected',activity:.55,message:'Terhubung'},event);
      }else if(disconnectionEvents[event]){
        this.setRegion(disconnectionEvents[event],{status:'disconnected',activity:0,message:'Terputus'},event);
      }else if(event==='login.required'&&this.isRegionId(payload.region)){
        this.setRegion(payload.region,{status:'login_required',activity:.8,message:'Login diperlukan'},event);
      }else if(event==='login.success'&&this.isRegionId(payload.region)){
        this.setRegion(payload.region,{status:'connected',activity:.45,message:'Login berhasil'},event);
      }else if(event==='login.failed'&&this.isRegionId(payload.region)){
        this.setRegion(payload.region,{status:'error',activity:.8,message:'Login gagal'},event);
      }else if(event==='sync.start'){
        this.setRegion('SYNC',{status:'syncing',activity:1,message:'Sinkronisasi berjalan'},event);
      }else if(event==='sync.complete'){
        this.setRegion('SYNC',{status:'complete',activity:.2,message:'Sinkronisasi selesai'},event);
      }else if(event==='report.created'){
        this.setRegion('REPORTING',{status:'complete',activity:.2,message:'Laporan dibuat'},event);
      }else if(event==='audio.energy'){
        const hearing=this.state.sensory.hearing={
          active:clamp01(payload.energy)>.01,energy:clamp01(payload.energy),
          low:clamp01(payload.low),mid:clamp01(payload.mid),high:clamp01(payload.high)
        };
        this.notify({type:'sensory',channel:'hearing',value:{...hearing}});
      }else if(event==='vision.frame'){
        const vision=this.state.sensory.vision={
          active:true,activity:clamp01(payload.activity??1),frameId:payload.frameId??null
        };
        this.notify({type:'sensory',channel:'vision',value:{...vision}});
      }else if(event==='vision.stop'){
        this.state.sensory.vision={active:false,activity:0,frameId:null};
        this.notify({type:'sensory',channel:'vision',value:{...this.state.sensory.vision}});
      }else if(event==='speech.start'||event==='speech.energy'){
        const speech=this.state.sensory.speech={active:true,energy:clamp01(payload.energy??.35)};
        this.notify({type:'sensory',channel:'speech',value:{...speech}});
      }else if(event==='speech.stop'){
        this.state.sensory.speech={active:false,energy:0};
        this.notify({type:'sensory',channel:'speech',value:{...this.state.sensory.speech}});
      }
      return this.snapshot();
    }
  }

  const short=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,120);
  class VoiceFeedback{
    constructor(regions=[]){
      this.labels=Object.fromEntries((regions||[]).map(region=>[region.id,region.label]));
      this.lastByKey=new Map();this.sequence=0;
    }
    map(envelope={}){
      const event=String(envelope.event||''),payload=envelope.payload||{},label=this.labels[payload.region]||'';
      switch(event){
        case 'alecore.start':case 'nara.start':return{key:'lifecycle:start',text:'AleCore AI aktif. Sistem HumanALE siap.',priority:'high',cooldownMs:8000};
        case 'alecore.shutdown':case 'nara.shutdown':return{key:'lifecycle:shutdown',text:'AleCore AI dihentikan. Sampai bertemu kembali.',priority:'high',cooldownMs:8000};
        case 'brain.region.select':return{key:'region:'+String(payload.region||''),text:label?'Membuka '+label+'.':'Membuka modul AleCore AI.',priority:'normal',cooldownMs:700};
        case 'work.start':return{key:'work:start',text:'Saya mulai mengerjakan.',priority:'normal',cooldownMs:1800};
        case 'work.complete':return{key:'work:complete',text:'Pekerjaan selesai. Menyiapkan laporan.',priority:'normal',cooldownMs:1800};
        case 'error.detected':return{key:'error:detected',text:'Terjadi kesalahan. Saya sedang menganalisis.',priority:'high',cooldownMs:5000};
        case 'bug.detected':return{key:'bug:detected',text:'Bug terdeteksi. Memulai analisis akar masalah.',priority:'high',cooldownMs:5000};
        case 'bug.fixed':return{key:'bug:fixed',text:'Perbaikan bug selesai. Memulai verifikasi.',priority:'normal',cooldownMs:3000};
        case 'terminal.open':return{key:'terminal:open',text:'Terminal siap.',priority:'low',cooldownMs:2200};
        case 'github.connected':return{key:'github:connected',text:'GitHub terhubung.',priority:'normal',cooldownMs:3500};
        case 'github.disconnected':return{key:'github:disconnected',text:'Koneksi GitHub terputus.',priority:'high',cooldownMs:3500};
        case 'copilot.connected':return{key:'copilot:connected',text:'GitHub Copilot terhubung.',priority:'normal',cooldownMs:3500};
        case 'copilot.disconnected':return{key:'copilot:disconnected',text:'Koneksi GitHub Copilot terputus.',priority:'high',cooldownMs:3500};
        case 'drive.connected':return{key:'drive:connected',text:'Drive terhubung.',priority:'normal',cooldownMs:3500};
        case 'drive.disconnected':return{key:'drive:disconnected',text:'Koneksi Drive terputus.',priority:'high',cooldownMs:3500};
        case 'sync.start':return{key:'sync:start',text:'Memulai sinkronisasi.',priority:'low',cooldownMs:2500};
        case 'sync.complete':return{key:'sync:complete',text:'Sinkronisasi selesai.',priority:'normal',cooldownMs:2500};
        case 'report.created':return{key:'report:created',text:'Laporan selesai dibuat.',priority:'normal',cooldownMs:2500};
        default:return null;
      }
    }
    consume(envelope={}){
      const mapped=this.map(envelope);if(!mapped)return null;
      const now=Date.now(),previous=this.lastByKey.get(mapped.key)||0;
      if(previous&&now-previous<(mapped.cooldownMs||1200))return null;
      this.lastByKey.set(mapped.key,now);
      return Object.freeze({
        id:++this.sequence,event:String(envelope.event||''),key:mapped.key,
        text:String(mapped.text||'').slice(0,240),priority:mapped.priority||'normal',
        style:'adult-robot',language:'id-ID',createdAt:now
      });
    }
  }

  function create({regions=[],onVoice=null}={}){
    const bus=new EventBus(),state=new BrainState(regions),voice=new VoiceFeedback(regions);
    bus.onAny(envelope=>{
      state.applyEvent(envelope);
      const cue=voice.consume(envelope);
      if(cue&&typeof onVoice==='function')onVoice(cue);
    });
    return Object.freeze({
      bus,state,voice,
      start:()=>bus.emit('nara.start'),
      startAleCore:()=>bus.emit('alecore.start'),
      stop:()=>bus.emit('nara.shutdown'),
      stopAleCore:()=>bus.emit('alecore.shutdown'),
      dispatch:(event,payload={},meta={})=>{const envelope=bus.emit(event,payload,meta);return{envelope,state:state.snapshot()};},
      snapshot:()=>state.snapshot()
    });
  }

  const api=Object.freeze({create,EventBus,BrainState,VoiceFeedback});
  global.AleCoreAIRuntime=api;
  global.HumanALENaraRuntime=api;
})(typeof window==='undefined'?globalThis:window);
