export const VOICE_PROFILES=Object.freeze({
  deep:Object.freeze({label:'NARA Deep',voiceRate:.80,voicePitch:.56,droidCharacter:true}),
  calm:Object.freeze({label:'NARA Calm',voiceRate:.88,voicePitch:.72,droidCharacter:false}),
  droid:Object.freeze({label:'NARA Droid',voiceRate:.82,voicePitch:.58,droidCharacter:true}),
  natural:Object.freeze({label:'NARA Natural',voiceRate:.94,voicePitch:.92,droidCharacter:false})
});

export function voiceProfilePatch(name='deep'){
  const profile=VOICE_PROFILES[name]||VOICE_PROFILES.deep;
  return {
    voiceProfile:VOICE_PROFILES[name]?name:'deep',
    voiceRate:profile.voiceRate,
    voicePitch:profile.voicePitch,
    droidCharacter:profile.droidCharacter
  };
}

export function listNaraVoices(){
  if(!('speechSynthesis' in window))return [];
  const voices=window.speechSynthesis.getVoices?.()||[];
  return [...voices].sort((a,b)=>{
    const score=voice=>{
      const lang=String(voice.lang||'');
      let value=/^id(?:-|$)/i.test(lang)?100:/^en(?:-|$)/i.test(lang)?30:0;
      if(voice.localService)value+=8;
      if(/natural|neural|enhanced/i.test(String(voice.name||'')))value+=5;
      return value;
    };
    return score(b)-score(a)||String(a.name||'').localeCompare(String(b.name||''));
  });
}

export function chooseNaraVoice(preference={}){
  const voices=listNaraVoices();
  if(!voices.length)return null;
  const requested=String(preference.voiceURI||'auto');
  if(requested&&requested!=='auto'){
    const exact=voices.find(voice=>voice.voiceURI===requested||voice.name===requested);
    if(exact)return exact;
  }
  return voices[0]||null;
}

export function populateNaraVoiceSelect(select,selected='auto'){
  if(!select)return 0;
  const current=String(selected||'auto');
  const voices=listNaraVoices();
  select.replaceChildren();

  const automatic=document.createElement('option');
  automatic.value='auto';
  automatic.textContent='Auto · best available';
  select.append(automatic);

  for(const voice of voices){
    const option=document.createElement('option');
    option.value=voice.voiceURI||voice.name;
    option.textContent=(voice.name||'System voice')+' · '+(voice.lang||'unknown')+(voice.localService?' · local':'');
    select.append(option);
  }

  const available=[...select.options].some(option=>option.value===current);
  select.value=available?current:'auto';
  return voices.length;
}

export function broadcastVoiceSpeaking(active){
  try{
    window.dispatchEvent(new CustomEvent('nara:voice-speaking',{detail:{active:Boolean(active)}}));
  }catch{}
}
