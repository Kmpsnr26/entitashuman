const STORAGE_KEY='nara.visual.settings.v1';

export const DEFAULT_VISUAL_SETTINGS=Object.freeze({
  brainFrame:true,
  binary:true,
  frameGlow:1.45,
  aurora:true,
  auroraIntensity:1.35,
  nebula:true,
  particles:true,
  roots:true,
  rootGlow:1.15,
  dataFlow:true,
  coreScale:1,
  coreGlow:1.25,
  ringA:true,
  ringB:true,
  ringSpeedA:1,
  ringSpeedB:1,
  hudOpacity:.92,
  uiScale:1,
  audio:true,
  quality:'auto'
});

export const VISUAL_PRESETS=Object.freeze({
  minimal:{
    brainFrame:true,binary:true,frameGlow:.8,aurora:false,auroraIntensity:.4,nebula:false,particles:false,
    roots:true,rootGlow:.72,dataFlow:true,coreScale:.92,coreGlow:.95,ringA:true,ringB:false,
    ringSpeedA:.72,ringSpeedB:.72,hudOpacity:.78,uiScale:.94,audio:true,quality:'balanced'
  },
  'ai-lab':{
    brainFrame:true,binary:true,frameGlow:1.25,aurora:true,auroraIntensity:.9,nebula:false,particles:true,
    roots:true,rootGlow:1,dataFlow:true,coreScale:1,coreGlow:1.18,ringA:true,ringB:true,
    ringSpeedA:.9,ringSpeedB:1.05,hudOpacity:.94,uiScale:1,audio:true,quality:'auto'
  },
  'neural-galaxy':{
    brainFrame:true,binary:true,frameGlow:1.65,aurora:true,auroraIntensity:1.55,nebula:true,particles:true,
    roots:true,rootGlow:1.35,dataFlow:true,coreScale:1.04,coreGlow:1.5,ringA:true,ringB:true,
    ringSpeedA:1.08,ringSpeedB:1.2,hudOpacity:.86,uiScale:1,audio:true,quality:'high'
  },
  cinematic:{
    brainFrame:true,binary:true,frameGlow:1.5,aurora:true,auroraIntensity:1.35,nebula:true,particles:true,
    roots:true,rootGlow:1.2,dataFlow:true,coreScale:1.08,coreGlow:1.42,ringA:true,ringB:true,
    ringSpeedA:.82,ringSpeedB:1.08,hudOpacity:.82,uiScale:1.04,audio:true,quality:'high'
  },
  creator:{...DEFAULT_VISUAL_SETTINGS}
});

const BOOL_KEYS=new Set(['brainFrame','binary','aurora','nebula','particles','roots','dataFlow','ringA','ringB','audio']);
const NUMBER_RANGES=Object.freeze({
  frameGlow:[.35,2],
  auroraIntensity:[.2,2],
  rootGlow:[.35,2],
  coreScale:[.72,1.35],
  coreGlow:[.5,2],
  ringSpeedA:[.15,2.2],
  ringSpeedB:[.15,2.2],
  hudOpacity:[.45,1],
  uiScale:[.82,1.18]
});
const QUALITY=new Set(['auto','high','balanced','low']);

function clamp(value,min,max){
  return Math.max(min,Math.min(max,Number(value)));
}

export function sanitizeVisualSettings(input={}){
  const result={...DEFAULT_VISUAL_SETTINGS};
  for(const key of BOOL_KEYS){
    if(typeof input[key]==='boolean')result[key]=input[key];
  }
  for(const [key,[min,max]] of Object.entries(NUMBER_RANGES)){
    const value=Number(input[key]);
    if(Number.isFinite(value))result[key]=clamp(value,min,max);
  }
  if(QUALITY.has(input.quality))result.quality=input.quality;
  return result;
}

function load(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw)return {...DEFAULT_VISUAL_SETTINGS};
    return sanitizeVisualSettings(JSON.parse(raw));
  }catch{
    return {...DEFAULT_VISUAL_SETTINGS};
  }
}

function save(settings){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(settings));}catch{}
}

function applyCss(settings){
  const root=document.documentElement;
  root.style.setProperty('--nara-hud-opacity',String(settings.hudOpacity));
  root.style.setProperty('--nara-ui-scale',String(settings.uiScale));
}

function formatValue(key,value){
  if(['frameGlow','auroraIntensity','rootGlow','coreGlow'].includes(key))return Number(value).toFixed(2)+'×';
  if(key==='coreScale'||key==='uiScale')return Number(value).toFixed(2)+'×';
  if(key==='ringSpeedA'||key==='ringSpeedB')return Number(value).toFixed(2)+'×';
  if(key==='hudOpacity')return Math.round(Number(value)*100)+'%';
  return String(value);
}

export function createCustomSettingsPanel({
  onChange=()=>{},
  onAudioChange=()=>{},
  onQualityChange=()=>{}
}={}){
  const panel=document.getElementById('customSettingsPanel');
  const openButton=document.getElementById('edgeCustomSettings');
  const closeButton=document.getElementById('customSettingsClose');
  const resetButton=document.getElementById('customSettingsReset');
  const presetButtons=[...document.querySelectorAll('[data-visual-preset]')];
  const controls=[...document.querySelectorAll('[data-visual-setting]')];
  let settings=load();

  function syncControls(){
    for(const control of controls){
      const key=control.dataset.visualSetting;
      if(!(key in settings))continue;
      if(control.type==='checkbox')control.checked=Boolean(settings[key]);
      else control.value=String(settings[key]);
      const output=document.querySelector('[data-visual-value="'+key+'"]');
      if(output)output.textContent=formatValue(key,settings[key]);
    }
    applyCss(settings);
  }

  function emit({persist=true}={}){
    settings=sanitizeVisualSettings(settings);
    if(persist)save(settings);
    applyCss(settings);
    onChange({...settings});
    onAudioChange(Boolean(settings.audio));
    onQualityChange(settings.quality);
    syncControls();
  }

  function setOpen(open){
    if(!panel)return;
    panel.hidden=false;
    panel.classList.toggle('custom-settings-open',Boolean(open));
    openButton?.classList.toggle('settings-active',Boolean(open));
    openButton?.setAttribute('aria-expanded',open?'true':'false');
    if(!open)setTimeout(()=>{if(!panel.classList.contains('custom-settings-open'))panel.hidden=true;},260);
  }

  openButton?.addEventListener('click',()=>setOpen(!panel?.classList.contains('custom-settings-open')));
  closeButton?.addEventListener('click',()=>setOpen(false));

  for(const control of controls){
    const eventName=control.type==='range'?'input':'change';
    control.addEventListener(eventName,()=>{
      const key=control.dataset.visualSetting;
      if(control.type==='checkbox')settings[key]=control.checked;
      else if(control.type==='range')settings[key]=Number(control.value);
      else settings[key]=control.value;
      emit();
    });
  }

  for(const button of presetButtons){
    button.addEventListener('click',()=>{
      const preset=VISUAL_PRESETS[button.dataset.visualPreset];
      if(!preset)return;
      settings=sanitizeVisualSettings({...settings,...preset});
      emit();
    });
  }

  resetButton?.addEventListener('click',()=>{
    settings={...DEFAULT_VISUAL_SETTINGS};
    emit();
  });

  syncControls();

  return {
    open:()=>setOpen(true),
    close:()=>setOpen(false),
    getSettings:()=>({...settings}),
    applyToRuntime:()=>emit({persist:false}),
    setSettings(next,{persist=true}={}){
      settings=sanitizeVisualSettings({...settings,...next});
      emit({persist});
    }
  };
}
