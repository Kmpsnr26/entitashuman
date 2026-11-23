import {HUMANALE_VOICE,createRobotVoicePlayer} from '../../../public/robot-voice.js';
export const VOICE_PROFILES=Object.freeze({adult:Object.freeze({label:'AleCore AI Adult',voiceRate:HUMANALE_VOICE.rate,voicePitch:HUMANALE_VOICE.pitch,droidCharacter:false})});
export function voiceProfilePatch(){return {voiceProfile:'adult',voiceURI:'auto',voiceRate:HUMANALE_VOICE.rate,voicePitch:HUMANALE_VOICE.pitch,droidCharacter:false};}
export function listAleCoreVoices(){
 const synthesis=globalThis.window?.speechSynthesis;
 return (synthesis?.getVoices?.()||[]).filter(voice=>/^id(?:-|$)/i.test(String(voice.lang||''))).sort((a,b)=>Number(/andika/i.test(b.name||''))-Number(/andika/i.test(a.name||''))||Number(Boolean(b.localService))-Number(Boolean(a.localService))||String(a.name||'').localeCompare(String(b.name||'')));
}
export function chooseAleCoreVoice(){return listAleCoreVoices()[0]||null;}
export function populateAleCoreVoiceSelect(select){
 if(!select)return 0;select.replaceChildren();const option=document.createElement('option');option.value='auto';option.textContent='HumanALE · Indonesia';select.append(option);select.value='auto';select.disabled=true;return listAleCoreVoices().length;
}
export function broadcastVoiceSpeaking(active){
 const detail={active:Boolean(active)};
 try{window.dispatchEvent(new CustomEvent('alecore:voice-speaking',{detail}));}catch{}
 try{window.dispatchEvent(new CustomEvent('nara:voice-speaking',{detail}));}catch{}
}
/** @deprecated Use listAleCoreVoices(). */
export const listNaraVoices=listAleCoreVoices;
/** @deprecated Use chooseAleCoreVoice(). */
export const chooseNaraVoice=chooseAleCoreVoice;
/** @deprecated Use populateAleCoreVoiceSelect(). */
export const populateNaraVoiceSelect=populateAleCoreVoiceSelect;
export function createStudioVoice({fetchImpl=globalThis.fetch,player=createRobotVoicePlayer(),synthesis=globalThis.window?.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance,chooseVoice=chooseAleCoreVoice,onStatus=()=>{}}={}){
 let serial=0,controller=null,activeEnd=null,stopPending=Promise.resolve();
 const finish=()=>{const end=activeEnd;activeEnd=null;broadcastVoiceSpeaking(false);end?.();};
 function stop(){
  serial++;controller?.abort();controller=null;player.stop();synthesis?.cancel();finish();
  stopPending=stopPending.catch(()=>{}).then(()=>fetchImpl('/api/voice/stop',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'})).then(response=>{if(!response.ok&&response.status!==503)throw new Error('Sesi suara perlu login ulang.');});
  stopPending.catch(()=>{});return stopPending;
 }
 async function speak(text,{onstart=()=>{},onend=()=>{},volume=.9}={}){
  const bounded=String(text||'').trim();if(!bounded||bounded.length>2000)throw new Error('Teks suara harus berisi 1–2000 karakter.');
  stop();const token=serial;player.unlock().catch(()=>{});
  try{
   await stopPending;if(token!==serial)return false;
   controller=new AbortController();
   const response=await fetchImpl('/api/voice/synthesize',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({text:bounded}),signal:controller.signal});
   if(token!==serial)return false;
   if(response.status===503){
    const voice=chooseVoice();if(!voice||!synthesis||!Utterance)throw new Error('Suara Indonesia perangkat tidak tersedia untuk AleCore AI.');
    const utterance=new Utterance(bounded);utterance.voice=voice;utterance.lang=HUMANALE_VOICE.language;utterance.rate=HUMANALE_VOICE.rate;utterance.pitch=HUMANALE_VOICE.pitch;utterance.volume=Math.max(0,Math.min(1,Number(volume)||0));
    activeEnd=onend;onStatus('Fallback perangkat · tanpa gema');
    utterance.onstart=()=>{if(token!==serial)return;broadcastVoiceSpeaking(true);onstart();};
    utterance.onend=utterance.onerror=()=>{if(token===serial)finish();};synthesis.speak(utterance);return true;
   }
   if(!response.ok)throw new Error(response.status===401?'Creator login diperlukan untuk suara.':'Suara AleCore AI belum tersedia.');
   const result=await response.json();if(token!==serial)return false;
   if(typeof result.audio!=='string'||result.audio.length>20000000)throw new Error('Audio suara tidak valid.');
   const bytes=Uint8Array.from(atob(result.audio),character=>character.charCodeAt(0));activeEnd=onend;
   onStatus(result.voiceGender==='male'?'Suara pria dewasa · gema AleCore AI':'Suara berat · gema AleCore AI');
   return await player.play(bytes,{style:HUMANALE_VOICE.style,volume,onstart:()=>{if(token!==serial)return;broadcastVoiceSpeaking(true);onstart();},onend:()=>{if(token===serial)finish();}});
  }catch(error){if(token!==serial||error.name==='AbortError')return false;finish();onStatus(error.message);throw error;}
 }
 return Object.freeze({speak,stop,unlock:()=>player.unlock()});
}
let shared;
export const studioVoice=()=>shared||(shared=createStudioVoice({onStatus:message=>{const target=document.getElementById('naraVoiceStatus');if(target)target.textContent=message;}}));
