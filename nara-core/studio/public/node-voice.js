import {createCinematicSoundEngine} from './cinematic-sound.js';

function readable(value=''){
  return String(value??'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
}

function number(value){
  const n=Number(value);
  return Number.isFinite(n)?n:0;
}

function neighborPhrase(neighbors=[]){
  const names=(Array.isArray(neighbors)?neighbors:[]).slice(0,6).map(item=>item.label||item.id).filter(Boolean);
  if(!names.length)return 'Tidak ada koneksi neural yang terdaftar.';
  const more=Math.max(0,(neighbors?.length||0)-names.length);
  return 'Terhubung ke '+names.join(', ')+(more?' dan '+more+' node lainnya.':'.');
}

export function buildOperationalNarration(metadata={}){
  const label=String(metadata.label||metadata.id||'Neural node').slice(0,120);
  const status=readable(metadata.status||'unknown');
  const runtime=metadata.runtime||{};
  const network=metadata.network||{};
  const server=metadata.server||{};
  const database=metadata.database||{};
  const diagnostics=metadata.diagnostics||{};
  const memory=metadata.memory||{};
  const skills=Array.isArray(metadata.skills)?metadata.skills:[];

  const parts=[
    label+'. Status '+status+'.',
    neighborPhrase(metadata.neighbors)
  ];

  if(metadata.id==='NARA_CORE'){
    parts.push(
      'NARA Core memantau '+number(runtime.activeRegions)+' region aktif dari sistem.',
      'Total event operasional '+number(runtime.totalEvents)+'.'
    );
  }else{
    parts.push('Lifecycle sistem '+readable(runtime.lifecycle||'unknown')+'.');
  }

  if(network.address||network.port){
    parts.push(
      'Koneksi server '+readable(server.health||'unknown')+
      ', melalui '+readable(network.scope||'unknown')+
      ' '+String(network.address||'').slice(0,80)+
      (network.port?' port '+number(network.port):'')+'.'
    );
  }

  if(database.state==='not_configured'){
    parts.push('Database untuk inspector ini belum dikonfigurasi.');
  }else{
    parts.push('Status database '+readable(database.state||'unknown')+'.');
  }

  const errors=number(diagnostics.errors);
  const bugs=number(diagnostics.bugs);
  const fixed=number(diagnostics.fixed);
  const verified=number(diagnostics.verified);
  if(errors||bugs||fixed||verified){
    parts.push(
      'Diagnostik mencatat '+errors+' error, '+bugs+' bug, '+fixed+
      ' perbaikan, dan '+verified+' verifikasi.'
    );
  }else{
    parts.push('Tidak ada error atau bug yang tercatat pada ringkasan diagnostik saat ini.');
  }

  const reads=number(memory.reads),writes=number(memory.writes);
  if(reads||writes){
    parts.push('Aktivitas memory: '+reads+' pembacaan dan '+writes+' penulisan.');
  }

  if(skills.length){
    const running=skills.filter(skill=>['running','active','processing'].includes(String(skill.status))).length;
    const failures=skills.reduce((sum,skill)=>sum+number(skill.failures),0);
    parts.push(
      skills.length+' skill terhubung pada region ini; '+running+
      ' sedang aktif dan total kegagalan tercatat '+failures+'.'
    );
  }

  parts.push('Credential, secret, dan private reasoning tidak ditampilkan.');
  return parts.join(' ').replace(/\s+/g,' ').trim().slice(0,1100);
}

function chooseVoice(){
  const voices=window.speechSynthesis?.getVoices?.()||[];
  const rank=voice=>{
    const lang=String(voice.lang||'');
    const name=String(voice.name||'');
    let score=0;
    if(/^id(?:-|$)/i.test(lang))score+=100;
    else if(/^en(?:-|$)/i.test(lang))score+=30;
    if(voice.localService)score+=8;
    if(/natural|neural|online|enhanced/i.test(name))score+=5;
    return score;
  };
  return [...voices].sort((a,b)=>rank(b)-rank(a))[0]||null;
}

function audioEnabled(){
  const control=document.getElementById('edgeAudioToggle');
  return !control||control.getAttribute('aria-pressed')!=='false';
}

export function createNodeVoice(){
  const transcript=document.getElementById('nodeInspectorVoiceText');
  const replay=document.getElementById('nodeInspectorSpeak');
  let current=null;
  let lastKey='';
  let lastSpokenAt=0;
  let pendingTimer=null;
  let voiceProfile={
    masterVolume:.78,transitionFx:.82,voiceVolume:.9,
    voiceRate:.86,voicePitch:.68,droidCharacter:true
  };
  const droidSound=createCinematicSoundEngine({enabled:audioEnabled});
  droidSound.setProfile(voiceProfile);

  function setSpeaking(value){
    document.body.classList.toggle('nara-node-speaking',Boolean(value));
    replay?.classList.toggle('speaking',Boolean(value));
  }

  function speak(metadata,{force=false}={}){
    if(!metadata)return false;
    current=metadata;
    const narration=buildOperationalNarration(metadata);
    if(transcript)transcript.textContent=narration;

    const diagnostics=metadata.diagnostics||{};
    const key=[
      metadata.id,metadata.status,metadata.lastEvent,
      diagnostics.errors,diagnostics.bugs,diagnostics.fixed,diagnostics.verified
    ].join(':');
    const now=Date.now();
    if(!force&&key===lastKey&&now-lastSpokenAt<1200)return false;
    lastKey=key;
    lastSpokenAt=now;

    if(!audioEnabled()||!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'){
      setSpeaking(false);
      return false;
    }

    try{
      if(pendingTimer){
        clearTimeout(pendingTimer);
        pendingTimer=null;
      }
      window.speechSynthesis.cancel();
      const utterance=new SpeechSynthesisUtterance(narration);
      const voice=chooseVoice();
      if(voice)utterance.voice=voice;
      utterance.lang=voice?.lang||'id-ID';
      utterance.rate=voiceProfile.voiceRate;
      utterance.pitch=voiceProfile.voicePitch;
      utterance.volume=voiceProfile.voiceVolume;
      utterance.onstart=()=>setSpeaking(true);
      utterance.onend=()=>setSpeaking(false);
      utterance.onerror=()=>setSpeaking(false);

      const begin=()=>{
        pendingTimer=null;
        if(!audioEnabled())return setSpeaking(false);
        window.speechSynthesis.speak(utterance);
      };
      if(voiceProfile.droidCharacter){
        droidSound.cue('voiceBoot');
        pendingTimer=setTimeout(begin,110);
      }else{
        begin();
      }
      return true;
    }catch{
      setSpeaking(false);
      return false;
    }
  }

  replay?.addEventListener('click',()=>{if(current)speak(current,{force:true});});

  return {
    speak,
    applyVoiceSettings(settings={}){
      const bounded=(key,min,max,fallback)=>{
        const value=Number(settings[key]);
        return Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
      };
      voiceProfile={
        masterVolume:bounded('masterVolume',0,1,voiceProfile.masterVolume),
        transitionFx:bounded('transitionFx',0,1,voiceProfile.transitionFx),
        voiceVolume:bounded('voiceVolume',0,1,voiceProfile.voiceVolume),
        voiceRate:bounded('voiceRate',.72,1.15,voiceProfile.voiceRate),
        voicePitch:bounded('voicePitch',.5,1.2,voiceProfile.voicePitch),
        droidCharacter:typeof settings.droidCharacter==='boolean'?settings.droidCharacter:voiceProfile.droidCharacter
      };
      droidSound.setProfile(voiceProfile);
      return {...voiceProfile};
    },
    getVoiceSettings:()=>({...voiceProfile}),
    stop(){
      if(pendingTimer){
        clearTimeout(pendingTimer);
        pendingTimer=null;
      }
      droidSound.stop();
      if('speechSynthesis' in window)window.speechSynthesis.cancel();
      setSpeaking(false);
    },
    getCurrent:()=>current
  };
}
