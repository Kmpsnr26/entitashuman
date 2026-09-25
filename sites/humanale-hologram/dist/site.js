// Reuse the exact NARA face engine and reference image from the local avatar.
const canvas = document.querySelector('#avatar');
const avatar = new window.NeuralAvatar(canvas, {
  referenceSrc: new URL('./assets/reference-face.png', import.meta.url).href
});
// The Site stage stays dark even when the visitor's OS theme is light.
avatar.setEnvironment('dark');
window.humanALEAvatar = avatar;

const state = document.querySelector('#state');
const showState = (label, delay = 1800) => {
  state.textContent = label;
  clearTimeout(showState.timer);
  if (delay) showState.timer = setTimeout(() => { state.textContent = 'SIAP'; }, delay);
};

let naraVoiceUnlocked=false,naraVoiceGeneration=0;
const speakNaraCue=cue=>{
  if(!naraVoiceUnlocked||!cue?.text||!window.speechSynthesis)return;
  const utterance=new SpeechSynthesisUtterance(cue.text);
  utterance.lang='id-ID';
  utterance.rate=.94;
  utterance.pitch=.76;
  utterance.voice=window.speechSynthesis.getVoices().find(voice=>voice.lang.toLowerCase().startsWith('id'))||null;
  const generation=++naraVoiceGeneration;
  utterance.onstart=()=>{if(generation===naraVoiceGeneration){avatar.setSpeaking(true);runtime.dispatch('speech.start',{energy:.55,source:'nara-site'});}};
  utterance.onend=utterance.onerror=()=>{if(generation===naraVoiceGeneration){avatar.setSpeaking(false);runtime.dispatch('speech.stop',{source:'nara-site'});}};
  window.speechSynthesis.speak(utterance);
};
const runtime=window.HumanALENaraRuntime.create({
  regions:avatar.neuralCore.regions,
  onVoice:cue=>{showState(cue.text.toUpperCase(),2200);speakNaraCue(cue);}
});
runtime.state.subscribe(snapshot=>avatar.setBrainState?.(snapshot));
avatar.onBrainRegionSelect=region=>{
  runtime.dispatch('brain.region.select',{region});
  showState('NARA · '+region.replaceAll('_',' '),0);
};
window.humanALENara=runtime;
const unlockNaraVoice=()=>{naraVoiceUnlocked=true;};
window.addEventListener('pointerdown',unlockNaraVoice,{once:true});
window.addEventListener('keydown',unlockNaraVoice,{once:true});

avatar.referencePromise.then(loaded => {
  showState(loaded ? 'WAJAH NARA SIAP' : 'PETA WAJAH GAGAL DIMUAT');
  runtime.start();
});

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  avatar.setMaterial(button.dataset.mode);
  document.querySelectorAll('[data-mode]').forEach(item => {
    const active = item === button;
    item.classList.toggle('selected', active);
    item.setAttribute('aria-pressed', String(active));
  });
  showState(button.textContent.toUpperCase());
}));

document.querySelector('#color').addEventListener('change', event => avatar.setAccent(event.target.value));
document.querySelector('#emotion').addEventListener('change', event => {
  avatar.setEmotion(event.target.value);
  showState(event.target.selectedOptions[0].textContent.toUpperCase());
});

const zoom = document.querySelector('#zoom');
avatar.onZoom = value => {
  zoom.value = String(value);
  document.querySelector('#zoom-value').textContent = value.toFixed(1) + '× · ' +
    (value < 1.5 ? 'wajah' : value < 2.15 ? 'rongga kepala' : value < 2.75 ? 'otak 3D' : value < 3.3 ? 'NARA neural' : 'node / modul');
};
zoom.addEventListener('input', event => avatar.setZoom(event.target.value));

let gestureTimer;
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  const action = button.dataset.action;
  clearTimeout(gestureTimer);
  avatar.gestureYaw = avatar.gesturePitch = 0;
  if (action === 'blink') avatar.blinkStart = performance.now();
  if (action === 'nod') avatar.gesturePitch = 0.17;
  if (action === 'shake') avatar.gestureYaw = 0.22;
  if (action !== 'blink') gestureTimer = setTimeout(() => {
    avatar.gestureYaw = avatar.gesturePitch = 0;
  }, 420);
  showState(button.textContent.toUpperCase());
}));
canvas.addEventListener('click', event => {
  const region=avatar.pickBrainRegion?.(event.clientX,event.clientY);
  if(region){avatar.selectBrainRegion?.(region);return;}
  avatar.blinkStart = performance.now();
});

let speechGeneration = 0;
const stopSpeaking = (generation, label = 'SIAP') => {
  if (generation !== speechGeneration) return;
  avatar.setSpeaking(false);
  showState(label);
};
document.querySelector('#speech').addEventListener('submit', event => {
  event.preventDefault();
  const words = document.querySelector('#words').value.trim();
  if (!words) return;
  if (!window.speechSynthesis) { showState('SUARA TIDAK TERSEDIA'); return; }
  const generation = ++speechGeneration;
  window.speechSynthesis.cancel();
  avatar.setSpeaking(false);
  const utterance = new SpeechSynthesisUtterance(words);
  utterance.lang = 'id-ID';
  utterance.rate = 0.95;
  utterance.voice = window.speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase().startsWith('id')) || null;
  utterance.onstart = () => {
    if (generation !== speechGeneration) return;
    avatar.setSpeaking(true);
    runtime.dispatch('speech.start',{energy:.55,source:'site-manual'});
    showState('BERBICARA', 0);
  };
  utterance.onend = () => {runtime.dispatch('speech.stop',{source:'site-manual'});stopSpeaking(generation);};
  utterance.onerror = () => {runtime.dispatch('speech.stop',{source:'site-manual'});stopSpeaking(generation, 'SUARA GAGAL DIPUTAR');};
  window.speechSynthesis.speak(utterance);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  speechGeneration++;naraVoiceGeneration++;
  window.speechSynthesis?.cancel();
  avatar.setSpeaking(false);
  runtime.dispatch('speech.stop',{source:'site-hidden'});
});
window.addEventListener('pagehide',()=>{naraVoiceUnlocked=false;runtime.stop();},{once:true});
