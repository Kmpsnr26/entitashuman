import {getRegion} from '../brain/regions.js';

const short=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,120);

export function voiceCueForEvent(envelope={}){
  const event=String(envelope.event||'');
  const payload=envelope.payload&&typeof envelope.payload==='object'?envelope.payload:{};
  const region=getRegion(payload.region);
  const label=region?.label||short(payload.region);

  switch(event){
    case 'ale.start': return {key:'lifecycle:start',text:'AleCore AI aktif. Sistem HumanALE siap.',priority:'high',cooldownMs:8000};
    case 'ale.shutdown': return {key:'lifecycle:shutdown',text:'AleCore AI dihentikan. Sampai bertemu kembali.',priority:'high',cooldownMs:8000};
    case 'brain.region.select': return {key:'region:'+String(payload.region||''),text:label?'Membuka '+label+'.':'Membuka modul AleCore AI.',priority:'normal',cooldownMs:700};
    case 'work.start': return {key:'work:start',text:'Saya mulai mengerjakan.',priority:'normal',cooldownMs:1800};
    case 'work.complete': return {key:'work:complete',text:'Pekerjaan selesai. Menyiapkan laporan.',priority:'normal',cooldownMs:1800};
    case 'loading.start': return {key:'loading:start',text:'Memulai pemuatan sistem.',priority:'low',cooldownMs:2500};
    case 'loading.complete': return {key:'loading:complete',text:'Pemuatan selesai.',priority:'low',cooldownMs:2500};
    case 'install.start': return {key:'install:start',text:'Memulai instalasi.',priority:'normal',cooldownMs:2500};
    case 'install.success': return {key:'install:success',text:'Instalasi berhasil.',priority:'normal',cooldownMs:2500};
    case 'install.failed': return {key:'install:failed',text:'Instalasi gagal. Saya sedang menganalisis.',priority:'high',cooldownMs:3500};
    case 'upgrade.start': return {key:'upgrade:start',text:'Memulai peningkatan sistem.',priority:'normal',cooldownMs:2500};
    case 'upgrade.success': return {key:'upgrade:success',text:'Peningkatan sistem selesai.',priority:'normal',cooldownMs:2500};
    case 'upgrade.failed': return {key:'upgrade:failed',text:'Peningkatan sistem gagal. Memulai pemeriksaan.',priority:'high',cooldownMs:3500};
    case 'login.required': return {key:'login:required:'+String(payload.region||''),text:label?'Autentikasi diperlukan untuk '+label+'.':'Autentikasi diperlukan.',priority:'high',cooldownMs:4000};
    case 'login.success': return {key:'login:success:'+String(payload.region||''),text:label?'Login '+label+' berhasil.':'Login berhasil.',priority:'normal',cooldownMs:3000};
    case 'login.failed': return {key:'login:failed:'+String(payload.region||''),text:label?'Login '+label+' gagal.':'Login gagal.',priority:'high',cooldownMs:4000};
    case 'error.detected': return {key:'error:detected',text:'Terjadi kesalahan. Saya sedang menganalisis.',priority:'high',cooldownMs:5000};
    case 'bug.detected': return {key:'bug:detected',text:'Bug terdeteksi. Memulai analisis akar masalah.',priority:'high',cooldownMs:5000};
    case 'bug.fixed': return {key:'bug:fixed',text:'Perbaikan bug selesai. Memulai verifikasi.',priority:'normal',cooldownMs:3000};
    case 'terminal.open': return {key:'terminal:open',text:'Terminal siap.',priority:'low',cooldownMs:2200};
    case 'github.connected': return {key:'github:connected',text:'GitHub terhubung.',priority:'normal',cooldownMs:3500};
    case 'github.disconnected': return {key:'github:disconnected',text:'Koneksi GitHub terputus.',priority:'high',cooldownMs:3500};
    case 'copilot.connected': return {key:'copilot:connected',text:'GitHub Copilot terhubung.',priority:'normal',cooldownMs:3500};
    case 'copilot.disconnected': return {key:'copilot:disconnected',text:'Koneksi GitHub Copilot terputus.',priority:'high',cooldownMs:3500};
    case 'drive.connected': return {key:'drive:connected',text:'Drive terhubung.',priority:'normal',cooldownMs:3500};
    case 'drive.disconnected': return {key:'drive:disconnected',text:'Koneksi Drive terputus.',priority:'high',cooldownMs:3500};
    case 'email.connected': return {key:'email:connected',text:'Email pemilik terhubung.',priority:'normal',cooldownMs:3500};
    case 'email.disconnected': return {key:'email:disconnected',text:'Koneksi email pemilik terputus.',priority:'high',cooldownMs:3500};
    case 'web.connected': return {key:'web:connected',text:'Koneksi web aktif.',priority:'low',cooldownMs:3500};
    case 'sync.start': return {key:'sync:start',text:'Memulai sinkronisasi.',priority:'low',cooldownMs:2500};
    case 'sync.complete': return {key:'sync:complete',text:'Sinkronisasi selesai.',priority:'normal',cooldownMs:2500};
    case 'report.created': return {key:'report:created',text:'Laporan selesai dibuat.',priority:'normal',cooldownMs:2500};
    default:return null;
  }
}
