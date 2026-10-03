import {createCinematicSoundEngine} from './cinematic-sound.js';
import {createMatrixTransitionField} from './matrix-transition.js';
import {studioVoice,voiceProfilePatch} from './voice-identity.js';

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

function speakCoreOnline(profile={}){
  void studioVoice().speak('NARA Core online. Akses pencipta terverifikasi. Neural Space tiga dimensi diaktifkan.',{volume:profile.voiceVolume}).catch(()=>{});
  return true;
}

export function createNeuralEntryExperience(){
  const root=document.getElementById('neuralEntryTransition');
  const phase=document.getElementById('neuralEntryPhase');
  const detail=document.getElementById('neuralEntryDetail');
  const audioButton=document.getElementById('edgeAudioToggle');
  const matrix=createMatrixTransitionField(document.getElementById('neuralEntryMatrix'));
  let sequence=0;
  let audioEnabled=true;
  let audioProfile={
    masterVolume:.78,transitionFx:.82,coreFx:.86,voiceVolume:.9,
    ...voiceProfilePatch()
  };
  const timers=new Set();
  const sound=createCinematicSoundEngine({enabled:()=>audioEnabled});
  sound.setProfile(audioProfile);

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
      void studioVoice().stop().catch(()=>{});
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
        if(sequence===current&&audioEnabled){
          if(audioProfile.droidCharacter)sound.cue('voiceBoot');
          later(()=>{if(sequence===current&&audioEnabled)speakCoreOnline(audioProfile);},audioProfile.droidCharacter?115:0);
        }
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
      if(!audioEnabled){sound.stop();void studioVoice().stop().catch(()=>{});}
      updateAudioButton();
    },
    applyAudioSettings(settings={}){
      const number=(key,min,max,fallback)=>{
        const value=Number(settings[key]);
        return Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
      };
      audioProfile={
        masterVolume:number('masterVolume',0,1,audioProfile.masterVolume),
        transitionFx:number('transitionFx',0,1,audioProfile.transitionFx),
        coreFx:number('coreFx',0,1,audioProfile.coreFx),
        voiceVolume:number('voiceVolume',0,1,audioProfile.voiceVolume),
        voiceRate:number('voiceRate',.72,1.15,audioProfile.voiceRate),
        voicePitch:number('voicePitch',.5,1.2,audioProfile.voicePitch),
        voiceProfile:typeof settings.voiceProfile==='string'?settings.voiceProfile:audioProfile.voiceProfile,
        voiceURI:typeof settings.voiceURI==='string'?settings.voiceURI:audioProfile.voiceURI,
        ...voiceProfilePatch()
      };
      sound.setProfile(audioProfile);
      return {...audioProfile};
    },
    getAudioSettings:()=>({...audioProfile}),
    isAudioEnabled:()=>audioEnabled
  };
}
