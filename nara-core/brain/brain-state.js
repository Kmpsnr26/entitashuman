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
      this.state.currentTask={id:String(payload.id||'task-'+envelope.id),label:String(payload.label||'Pekerjaan NARA').slice(0,160),startedAt:envelope.timestamp};
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
    }else if(event==='capability.requested'){
      this.setRegion('SAFETY',{status:'processing',activity:.85,message:'Memeriksa permintaan capability'},event);
    }else if(event==='capability.approved'){
      this.setRegion('SAFETY',{status:'complete',activity:.3,message:'Capability disetujui creator'},event);
    }else if(event==='capability.denied'||event==='capability.revoked'){
      this.setRegion('SAFETY',{status:'paused',activity:.25,message:'Capability ditolak atau dicabut'},event);
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
