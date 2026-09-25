import {NARA_REGIONS,isRegionId} from './regions.js';

const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));
const connectionEvents=Object.freeze({
  'github.connected':'GITHUB',
  'copilot.connected':'COPILOT',
  'drive.connected':'DRIVE',
  'email.connected':'OWNER_EMAIL',
  'web.connected':'WEB',
  'team.connected':'TEAM',
  'online.connected':'ONLINE'
});
const disconnectionEvents=Object.freeze({
  'github.disconnected':'GITHUB',
  'copilot.disconnected':'COPILOT',
  'drive.disconnected':'DRIVE',
  'email.disconnected':'OWNER_EMAIL',
  'web.disconnected':'WEB',
  'team.disconnected':'TEAM',
  'online.disconnected':'ONLINE'
});

function initialRegions(){
  return Object.fromEntries(Object.values(NARA_REGIONS).map(region=>[
    region.id,
    {id:region.id,status:region.defaultStatus,activity:0,lastEvent:'',message:'',updatedAt:0}
  ]));
}

export class NaraBrainState{
  constructor(){
    this.listeners=new Set();
    this.state={
      version:1,
      lifecycle:'idle',
      selectedRegion:'NARA_CORE',
      currentTask:null,
      regions:initialRegions(),
      sensory:{
        hearing:{active:false,energy:0,low:0,mid:0,high:0},
        vision:{active:false,activity:0,frameId:null},
        speech:{active:false,energy:0}
      },
      lastEvent:null
    };
  }

  subscribe(listener){
    if(typeof listener!=='function')throw new TypeError('Subscriber BrainState harus berupa fungsi.');
    this.listeners.add(listener);return ()=>this.listeners.delete(listener);
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
    if(!isRegionId(id))throw new Error('Region NARA tidak dikenal: '+id);
    const current=this.state.regions[id];
    const next={...current,...patch,id,updatedAt:Date.now(),lastEvent:patch.lastEvent||source};
    this.state.regions={...this.state.regions,[id]:next};
    this.notify({type:'region',id,source,next:{...next}});
    return next;
  }

  selectRegion(id,source='brain.region.select'){
    if(!isRegionId(id))throw new Error('Region NARA tidak dikenal: '+id);
    this.state.selectedRegion=id;
    const current=this.state.regions[id]||{status:'idle',activity:0};
    const status=['idle','ready'].includes(current.status)?'active':current.status;
    this.setRegion(id,{status,activity:Math.max(.92,clamp01(current.activity)),lastEvent:source},source);
    return id;
  }

  applyEvent(envelope){
    if(!envelope?.event)return null;
    const {event,payload={}}=envelope;
    this.state.lastEvent={id:envelope.id,event,timestamp:envelope.timestamp};

    if(event==='nara.start'){
      this.state.lifecycle='active';
      this.setRegion('NARA_CORE',{status:'active',activity:1,message:'NARA aktif'},event);
    }else if(event==='nara.shutdown'){
      this.state.lifecycle='offline';
      this.setRegion('NARA_CORE',{status:'offline',activity:0,message:'NARA dihentikan'},event);
    }else if(event==='brain.region.select'&&isRegionId(payload.region)){
      this.selectRegion(payload.region,event);
    }else if(event==='work.start'){
      this.state.currentTask={id:String(payload.id||'task-'+envelope.id),label:String(payload.label||'Pekerjaan NARA'),startedAt:envelope.timestamp};
      this.setRegion('PLANNER',{status:'thinking',activity:.92,message:'Menyusun langkah kerja'},event);
      this.setRegion('REASONER',{status:'thinking',activity:.72,message:'Menganalisis kebutuhan tugas'},event);
      this.setRegion('PROGRAM',{status:'processing',activity:1,message:this.state.currentTask.label},event);
      this.setRegion('FOLLOW_UP',{status:'active',activity:.7,message:'Memantau tindak lanjut'},event);
    }else if(event==='work.complete'){
      this.state.currentTask=null;
      this.setRegion('PLANNER',{status:'complete',activity:.18,message:'Rencana kerja selesai'},event);
      this.setRegion('REASONER',{status:'complete',activity:.16,message:'Analisis tahap ini selesai'},event);
      this.setRegion('PROGRAM',{status:'complete',activity:.15,message:'Pekerjaan selesai'},event);
      this.setRegion('REPORTING',{status:'active',activity:.8,message:'Menyiapkan laporan'},event);
    }else if(event==='planning.start'){
      this.setRegion('PLANNER',{status:'thinking',activity:1,message:'Menyusun langkah kerja'},event);
    }else if(event==='planning.complete'){
      this.setRegion('PLANNER',{status:'complete',activity:.2,message:'Rencana kerja siap'},event);
    }else if(event==='reasoner.start'){
      this.setRegion('REASONER',{status:'thinking',activity:1,message:'Menganalisis tugas'},event);
    }else if(event==='reasoner.complete'){
      this.setRegion('REASONER',{status:'complete',activity:.2,message:'Analisis tahap ini selesai'},event);
    }else if(event==='agent.start'){
      const mode=String(payload.mode||'analyze');
      this.setRegion('AGENT_MANAGER',{status:'processing',activity:1,message:'Agent '+String(payload.agentId||'agent')+' aktif'},event);
      this.setRegion('PROGRAM',{status:'processing',activity:.9,message:'Agent sedang bekerja'},event);
      if(mode==='work')this.setRegion('PLANNER',{status:'thinking',activity:.82,message:'Mengawasi langkah kerja agent'},event);
      else this.setRegion('REASONER',{status:'thinking',activity:.82,message:'Agent sedang menganalisis'},event);
    }else if(event==='agent.progress'){
      this.setRegion('AGENT_MANAGER',{status:'processing',activity:.85,message:'Agent masih bekerja'},event);
    }else if(event==='agent.complete'){
      this.setRegion('AGENT_MANAGER',{status:'complete',activity:.22,message:'Agent selesai'},event);
      this.setRegion('PROGRAM',{status:'complete',activity:.2,message:'Hasil agent siap ditinjau'},event);
    }else if(event==='agent.error'){
      this.setRegion('AGENT_MANAGER',{status:'error',activity:1,message:'Agent mengalami kesalahan'},event);
      this.setRegion('ERROR_MONITOR',{status:'error',activity:1,message:'Kesalahan agent terdeteksi'},event);
    }else if(event==='memory.record'){
      this.setRegion('MEMORY',{status:'complete',activity:.45,message:'Catatan aktivitas disimpan'},event);
    }else if(event==='memory.recall'){
      this.setRegion('MEMORY',{status:'processing',activity:.78,message:'Memory sedang diperiksa'},event);
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
    }else if(event==='login.required'&&isRegionId(payload.region)){
      this.setRegion(payload.region,{status:'login_required',activity:.8,message:'Login diperlukan'},event);
    }else if(event==='login.success'&&isRegionId(payload.region)){
      this.setRegion(payload.region,{status:'connected',activity:.45,message:'Login berhasil'},event);
    }else if(event==='login.failed'&&isRegionId(payload.region)){
      this.setRegion(payload.region,{status:'error',activity:.8,message:'Login gagal'},event);
    }else if(event==='sync.start'){
      this.setRegion('SYNC',{status:'syncing',activity:1,message:'Sinkronisasi berjalan'},event);
    }else if(event==='sync.complete'){
      this.setRegion('SYNC',{status:'complete',activity:.2,message:'Sinkronisasi selesai'},event);
    }else if(event==='report.created'){
      this.setRegion('REPORTING',{status:'complete',activity:.2,message:'Laporan dibuat'},event);
    }else if(event==='audio.energy'){
      const hearing=this.state.sensory.hearing={
        active:clamp01(payload.energy)>.01,
        energy:clamp01(payload.energy),
        low:clamp01(payload.low),
        mid:clamp01(payload.mid),
        high:clamp01(payload.high)
      };
      this.notify({type:'sensory',channel:'hearing',value:{...hearing}});
    }else if(event==='vision.frame'){
      const vision=this.state.sensory.vision={
        active:true,
        activity:clamp01(payload.activity??1),
        frameId:payload.frameId??null
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

export function createBrainState(){return new NaraBrainState();}
