import {createCinematicSoundEngine} from './cinematic-sound.js';
import {createMatrixTransitionField} from './matrix-transition.js';

const PHASES=[
  ['CREATOR VERIFIED','IDENTITY CHANNEL SECURED','sweep'],
  ['MATRIX GATE OPENING','ZOOMING INTO NEURAL LATTICE','zoomIn'],
  ['NARA CORE AWAKENING','CORE ENERGY PROTECTION ONLINE','pulse'],
  ['NEURAL FLOW PROCESSING','SYNCHRONIZING LIVE ROUTES','process'],
  ['NEURAL SPACE 3D ONLINE','DATA FLOW STABILIZED','flow']
];

function reducedMotion(){
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
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
    utterance.rate=.88;
    utterance.pitch=.70;
    utterance.volume=.88;
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
  const matrix=createMatrixTransitionField(document.getElementById('neuralEntryMatrix'));
  let sequence=0;
  let audioEnabled=true;
  const timers=new Set();
  const sound=createCinematicSoundEngine({enabled:()=>audioEnabled});

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
    if(!audioEnabled){
      if('speechSynthesis' in window)window.speechSynthesis.cancel();
      sound.stop();
    }
    updateAudioButton();
  });
  updateAudioButton();

  function play({announce=true,compact=false}={}){
    if(!root)return;
    clearTimers();
    sequence+=1;
    const current=sequence;
    const motionReduced=reducedMotion();
    const total=motionReduced?1050:(compact?1850:3600);
    const phaseStep=motionReduced?145:(compact?330:610);

    root.hidden=false;
    root.classList.toggle('neural-entry-compact',compact);
    root.classList.toggle('neural-entry-reduced',motionReduced);
    root.getBoundingClientRect();
    root.classList.add('neural-entry-active');
    matrix.start({compact});

    const phases=compact?PHASES.slice(2):PHASES;
    phases.forEach((item,index)=>{
      later(()=>{
        if(sequence!==current)return;
        phase.textContent=item[0];
        detail.textContent=item[1];
        root.dataset.phase=String(index);
        root.dataset.effect=item[2];
        matrix.burst();
        if(audioEnabled)sound.cue(item[2]);
      },index*phaseStep);
    });

    if(announce){
      later(()=>{
        if(sequence===current&&audioEnabled)speakCoreOnline();
      },motionReduced?260:(compact?520:980));
    }

    later(()=>{
      if(sequence!==current)return;
      if(audioEnabled)sound.cue('zoomOut');
      root.dataset.effect='zoomOut';
      root.classList.add('neural-entry-complete');
    },Math.max(420,total-620));

    later(()=>{
      if(sequence!==current)return;
      matrix.stop();
      root.hidden=true;
      root.classList.remove('neural-entry-active','neural-entry-complete','neural-entry-compact','neural-entry-reduced');
      delete root.dataset.phase;
      delete root.dataset.effect;
    },total);
  }

  return {
    play,
    setAudioEnabled(value){
      audioEnabled=Boolean(value);
      if(!audioEnabled)sound.stop();
      updateAudioButton();
    },
    isAudioEnabled:()=>audioEnabled
  };
}
