const PHASES=[
  ['CREATOR VERIFIED','IDENTITY CHANNEL SECURED'],
  ['NARA CORE AWAKENING','INITIALIZING NEURAL MATRIX'],
  ['NEURAL LINKS SYNCHRONIZING','ROUTING LIVE SYSTEM STATE'],
  ['NEURAL SPACE 3D ONLINE','CREATOR ACCESS ESTABLISHED']
];

function reducedMotion(){
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
}

function playSyntheticCoreTone(){
  const AudioContext=window.AudioContext||window.webkitAudioContext;
  if(!AudioContext)return false;
  try{
    const context=new AudioContext();
    const master=context.createGain();
    master.gain.setValueAtTime(.0001,context.currentTime);
    master.gain.exponentialRampToValueAtTime(.075,context.currentTime+.08);
    master.gain.exponentialRampToValueAtTime(.0001,context.currentTime+1.65);
    master.connect(context.destination);

    const tones=[
      {frequency:110,start:0,duration:1.55,type:'sine'},
      {frequency:220,start:.16,duration:1.18,type:'sine'},
      {frequency:440,start:.42,duration:.72,type:'triangle'}
    ];
    for(const tone of tones){
      const oscillator=context.createOscillator();
      const gain=context.createGain();
      oscillator.type=tone.type;
      oscillator.frequency.setValueAtTime(tone.frequency,context.currentTime+tone.start);
      gain.gain.setValueAtTime(.0001,context.currentTime+tone.start);
      gain.gain.exponentialRampToValueAtTime(.32,context.currentTime+tone.start+.08);
      gain.gain.exponentialRampToValueAtTime(.0001,context.currentTime+tone.start+tone.duration);
      oscillator.connect(gain).connect(master);
      oscillator.start(context.currentTime+tone.start);
      oscillator.stop(context.currentTime+tone.start+tone.duration+.05);
    }
    setTimeout(()=>context.close().catch(()=>{}),1900);
    return true;
  }catch{
    return false;
  }
}

function chooseIndonesianVoice(){
  const voices=window.speechSynthesis?.getVoices?.()||[];
  return voices.find(voice=>/^id(?:-|$)/i.test(voice.lang||''))||voices[0]||null;
}

function speakCoreOnline(){
  if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined')return false;
  try{
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(
      'NARA Core online. Akses pencipta terverifikasi. Neural Space tiga dimensi diaktifkan.'
    );
    const voice=chooseIndonesianVoice();
    if(voice)utterance.voice=voice;
    utterance.lang=voice?.lang||'id-ID';
    utterance.rate=.92;
    utterance.pitch=.78;
    utterance.volume=.86;
    window.speechSynthesis.speak(utterance);
    return true;
  }catch{
    return false;
  }
}

export function createNeuralEntryExperience(){
  const root=document.getElementById('neuralEntryTransition');
  const phase=document.getElementById('neuralEntryPhase');
  const detail=document.getElementById('neuralEntryDetail');
  const audioButton=document.getElementById('edgeAudioToggle');
  let sequence=0;
  let audioEnabled=true;
  const timers=new Set();

  function later(callback,delay){
    const timer=setTimeout(()=>{
      timers.delete(timer);
      callback();
    },delay);
    timers.add(timer);
  }

  function clearTimers(){
    for(const timer of timers)clearTimeout(timer);
    timers.clear();
  }

  function updateAudioButton(){
    if(!audioButton)return;
    audioButton.textContent=audioEnabled?'AUDIO ON':'AUDIO OFF';
    audioButton.setAttribute('aria-pressed',audioEnabled?'true':'false');
  }

  audioButton?.addEventListener('click',()=>{
    audioEnabled=!audioEnabled;
    if(!audioEnabled&&'speechSynthesis' in window)window.speechSynthesis.cancel();
    updateAudioButton();
  });
  updateAudioButton();

  function play({announce=true,compact=false}={}){
    if(!root)return;
    clearTimers();
    sequence+=1;
    const current=sequence;
    const motionReduced=reducedMotion();
    const total=motionReduced?900:(compact?1450:2700);
    root.hidden=false;
    root.classList.toggle('neural-entry-compact',compact);
    root.classList.toggle('neural-entry-reduced',motionReduced);
    requestAnimationFrame(()=>root.classList.add('neural-entry-active'));

    if(audioEnabled){
      playSyntheticCoreTone();
      if(announce)speakCoreOnline();
    }

    const phases=compact?PHASES.slice(2):PHASES;
    phases.forEach((item,index)=>{
      later(()=>{
        if(sequence!==current)return;
        phase.textContent=item[0];
        detail.textContent=item[1];
        root.dataset.phase=String(index);
      },motionReduced?index*120:index*(compact?330:560));
    });

    later(()=>{
      if(sequence!==current)return;
      root.classList.add('neural-entry-complete');
    },Math.max(300,total-430));
    later(()=>{
      if(sequence!==current)return;
      root.hidden=true;
      root.classList.remove('neural-entry-active','neural-entry-complete','neural-entry-compact','neural-entry-reduced');
      delete root.dataset.phase;
    },total);
  }

  return {
    play,
    setAudioEnabled(value){
      audioEnabled=Boolean(value);
      updateAudioButton();
    },
    isAudioEnabled:()=>audioEnabled
  };
}
