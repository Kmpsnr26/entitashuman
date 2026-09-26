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
  return voices.find(voice=>/^id(?:-|$)/i.test(voice.lang||''))||
    voices.find(voice=>/^en(?:-|$)/i.test(voice.lang||''))||
    voices[0]||null;
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
      window.speechSynthesis.cancel();
      const utterance=new SpeechSynthesisUtterance(narration);
      const voice=chooseVoice();
      if(voice)utterance.voice=voice;
      utterance.lang=voice?.lang||'id-ID';
      utterance.rate=.92;
      utterance.pitch=.80;
      utterance.volume=.88;
      utterance.onstart=()=>setSpeaking(true);
      utterance.onend=()=>setSpeaking(false);
      utterance.onerror=()=>setSpeaking(false);
      window.speechSynthesis.speak(utterance);
      return true;
    }catch{
      setSpeaking(false);
      return false;
    }
  }

  replay?.addEventListener('click',()=>{if(current)speak(current,{force:true});});

  return {
    speak,
    stop(){
      if('speechSynthesis' in window)window.speechSynthesis.cancel();
      setSpeaking(false);
    },
    getCurrent:()=>current
  };
}
