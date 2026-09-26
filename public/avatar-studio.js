import {
 AVATAR_STUDIO_DEFAULTS,
 normalizeAvatarStudioProfile
} from './avatar-studio-profile.js';

export const AVATAR_STUDIO_STORAGE_KEY='humanale.avatar-studio.v1';
export const AVATAR_STUDIO_MATERIAL_KEY='humanale.avatar-studio.material.v1';
export const AVATAR_STUDIO_SLOTS_KEY='humanale.avatar-studio.slots.v1';

const FIELDS=Object.freeze([
 'headWidth',
 'headHeight',
 'cheekVolume',
 'jawWidth',
 'eyeSpacing',
 'foreheadWidth',
 'foreheadHeight',
 'chinLength',
 'chinWidth',
 'noseDepth',
 'mouthWidth',
 'lipVolume',
 'earSize',
 'lightIntensity',
 'particleScale',
 'depth',
 'density'
]);

function readSaved(storage){
 try{
  const raw=storage?.getItem?.(AVATAR_STUDIO_STORAGE_KEY);
  return normalizeAvatarStudioProfile(raw?JSON.parse(raw):AVATAR_STUDIO_DEFAULTS);
 }catch{
  return normalizeAvatarStudioProfile(AVATAR_STUDIO_DEFAULTS);
 }
}

function writeSaved(storage,profile){
 try{
  storage?.setItem?.(AVATAR_STUDIO_STORAGE_KEY,JSON.stringify(profile));
  return true;
 }catch{
  return false;
 }
}

const MATERIALS=Object.freeze(['mixed','matrix','statistics','abstract','neural']);
const normalizeMaterial=value=>MATERIALS.includes(value)?value:'mixed';
const cleanName=(value,fallback)=>String(value||fallback).trim().slice(0,24)||fallback;

function readMaterial(storage){
 try{return normalizeMaterial(storage?.getItem?.(AVATAR_STUDIO_MATERIAL_KEY)||'mixed');}
 catch{return 'mixed';}
}
function writeMaterial(storage,material){
 try{storage?.setItem?.(AVATAR_STUDIO_MATERIAL_KEY,normalizeMaterial(material));return true;}
 catch{return false;}
}
function readSlots(storage){
 try{
  const raw=storage?.getItem?.(AVATAR_STUDIO_SLOTS_KEY);
  const parsed=raw?JSON.parse(raw):{};
  return {
   A:{name:cleanName(parsed?.A?.name,'Preset A'),profile:normalizeAvatarStudioProfile(parsed?.A?.profile||AVATAR_STUDIO_DEFAULTS),material:normalizeMaterial(parsed?.A?.material)},
   B:{name:cleanName(parsed?.B?.name,'Preset B'),profile:normalizeAvatarStudioProfile(parsed?.B?.profile||AVATAR_STUDIO_DEFAULTS),material:normalizeMaterial(parsed?.B?.material)}
  };
 }catch{
  return {
   A:{name:'Preset A',profile:normalizeAvatarStudioProfile(AVATAR_STUDIO_DEFAULTS),material:'mixed'},
   B:{name:'Preset B',profile:normalizeAvatarStudioProfile(AVATAR_STUDIO_DEFAULTS),material:'mixed'}
  };
 }
}
function writeSlots(storage,slots){
 try{storage?.setItem?.(AVATAR_STUDIO_SLOTS_KEY,JSON.stringify(slots));return true;}
 catch{return false;}
}

export function createAvatarStudioController({
 avatar,
 root=document,
 storage=globalThis.localStorage,
 channel=null,
 isPanel=false,
 onOpen=()=>{},
 onToast=()=>{}
}={}){
 let saved=readSaved(storage);
 let current=avatar?.setStudioProfile?.(saved)||saved;
 let savedMaterial=readMaterial(storage);
 let currentMaterial=savedMaterial;
 let slots=readSlots(storage);

 const status=root.querySelector?.('#avatarStudioStatus');
 const inputFor=key=>root.querySelector?.('[data-avatar-studio-key="'+key+'"]');
 const outputFor=key=>root.querySelector?.('[data-avatar-studio-output="'+key+'"]');
 const materialSelect=root.querySelector?.('#avatarStudioMaterial');
 const slotName=slot=>root.querySelector?.('#avatarStudioName'+slot);

 const syncMaterial=(material=currentMaterial)=>{
  currentMaterial=normalizeMaterial(material);
  avatar?.setMaterial?.(currentMaterial);
  if(materialSelect&&materialSelect.value!==currentMaterial)materialSelect.value=currentMaterial;
  return currentMaterial;
 };
 const syncSlotUi=()=>{
  for(const slot of ['A','B']){
   const input=slotName(slot);
   if(input&&input.value!==slots[slot].name)input.value=slots[slot].name;
  }
 };

 const syncUi=(profile=current,label='LIVE PREVIEW')=>{
  current=normalizeAvatarStudioProfile(profile);
  for(const key of FIELDS){
   const input=inputFor(key),output=outputFor(key);
   const percent=Math.round(current[key]*100);
   if(input&&Number(input.value)!==percent)input.value=String(percent);
   if(output)output.textContent=percent+'%';
  }
  if(status)status.textContent=label+' · perubahan langsung diterapkan ke avatar.';
  syncSlotUi();
  syncMaterial(currentMaterial);
  return current;
 };

 const readControls=()=>{
  const next={};
  for(const key of FIELDS){
   const input=inputFor(key);
   next[key]=(Number(input?.value)||100)/100;
  }
  return normalizeAvatarStudioProfile(next);
 };

 const broadcast=(profile,persist=false)=>{
  if(!isPanel||!channel?.postMessage)return;
  channel.postMessage({
   type:'avatar-studio-profile',
   profile,
   persist:Boolean(persist)
  });
 };
 const broadcastMaterial=(material,persist=false)=>{
  if(!isPanel||!channel?.postMessage)return;
  channel.postMessage({
   type:'avatar-studio-material',
   material:normalizeMaterial(material),
   persist:Boolean(persist)
  });
 };

 const apply=(profile,{persist=false,notify=true,label='LIVE PREVIEW'}={})=>{
  current=avatar?.setStudioProfile?.(profile)||normalizeAvatarStudioProfile(profile);
  current=syncUi(current,label);
  if(persist){
   saved=current;
   writeSaved(storage,current);
  }
  if(notify)broadcast(current,persist);
  return current;
 };

 for(const key of FIELDS){
  inputFor(key)?.addEventListener('input',()=>{
   apply(readControls(),{persist:false,notify:true,label:'LIVE PREVIEW'});
  });
 }
 materialSelect?.addEventListener('change',()=>{
  syncMaterial(materialSelect.value);
  broadcastMaterial(currentMaterial,false);
  if(status)status.textContent='LIVE MATERIAL · perubahan langsung diterapkan ke avatar.';
 });

 root.querySelector?.('#avatarStudioOpen')?.addEventListener('click',()=>{
  syncUi(current,'LIVE PREVIEW');
  onOpen();
 });

 root.querySelector?.('#avatarStudioSave')?.addEventListener('click',()=>{
  const next=apply(readControls(),{persist:true,notify:true,label:'PRESET TERSIMPAN'});
  savedMaterial=syncMaterial(materialSelect?.value||currentMaterial);
  writeMaterial(storage,savedMaterial);
  broadcastMaterial(savedMaterial,true);
  onToast('Avatar Live Studio · preset tersimpan.');
  return next;
 });

 root.querySelector?.('#avatarStudioRevert')?.addEventListener('click',()=>{
  apply(saved,{persist:false,notify:true,label:'PRESET TERSIMPAN DIPULIHKAN'});
  syncMaterial(savedMaterial);broadcastMaterial(savedMaterial,false);
  onToast('Avatar Live Studio · kembali ke preset tersimpan.');
 });

 root.querySelector?.('#avatarStudioReset')?.addEventListener('click',()=>{
  apply(AVATAR_STUDIO_DEFAULTS,{persist:false,notify:true,label:'DEFAULT PREVIEW'});
  syncMaterial('mixed');broadcastMaterial('mixed',false);
  onToast('Avatar Live Studio · default dipreview. Simpan jika ingin menjadikannya preset.');
 });

 const saveSlot=slot=>{
  const name=cleanName(slotName(slot)?.value,'Preset '+slot);
  const profile=readControls();
  const material=normalizeMaterial(materialSelect?.value||currentMaterial);
  slots={...slots,[slot]:{name,profile,material}};
  writeSlots(storage,slots);syncSlotUi();
  onToast('Avatar Live Studio · '+name+' disimpan.');
 };
 const previewSlot=slot=>{
  const entry=slots[slot];
  if(!entry)return;
  apply(entry.profile,{persist:false,notify:true,label:'COMPARE '+slot+' · '+entry.name});
  syncMaterial(entry.material);broadcastMaterial(entry.material,false);
 };
 root.querySelector?.('#avatarStudioSaveA')?.addEventListener('click',()=>saveSlot('A'));
 root.querySelector?.('#avatarStudioSaveB')?.addEventListener('click',()=>saveSlot('B'));
 root.querySelector?.('#avatarStudioPreviewA')?.addEventListener('click',()=>previewSlot('A'));
 root.querySelector?.('#avatarStudioPreviewB')?.addEventListener('click',()=>previewSlot('B'));

 syncMaterial(currentMaterial);
 syncUi(current,'PRESET TERSIMPAN');

 return Object.freeze({
  current:()=>({...current}),
  saved:()=>({...saved}),
  applyRemote(profile,persist=false){
   current=avatar?.setStudioProfile?.(profile)||normalizeAvatarStudioProfile(profile);
   current=syncUi(current,persist?'PRESET TERSIMPAN':'LIVE PREVIEW');
   if(persist){
    saved=current;
    writeSaved(storage,current);
   }
   return current;
  },
  handleMessage(data={}){
   if(data.type==='avatar-studio-profile'&&!isPanel){
    this.applyRemote(data.profile,Boolean(data.persist));
    return true;
   }
   if(data.type==='avatar-studio-material'&&!isPanel){
    currentMaterial=syncMaterial(data.material);
    if(data.persist){savedMaterial=currentMaterial;writeMaterial(storage,savedMaterial);}
    return true;
   }
   if(data.type==='avatar-studio-sync'&&isPanel){
    if(data.saved)saved=normalizeAvatarStudioProfile(data.saved);
    if(data.material)currentMaterial=syncMaterial(data.material);
    if(data.savedMaterial)savedMaterial=normalizeMaterial(data.savedMaterial);
    if(data.slots){
      slots={
       A:{name:cleanName(data.slots?.A?.name,'Preset A'),profile:normalizeAvatarStudioProfile(data.slots?.A?.profile||AVATAR_STUDIO_DEFAULTS),material:normalizeMaterial(data.slots?.A?.material)},
       B:{name:cleanName(data.slots?.B?.name,'Preset B'),profile:normalizeAvatarStudioProfile(data.slots?.B?.profile||AVATAR_STUDIO_DEFAULTS),material:normalizeMaterial(data.slots?.B?.material)}
      };
    }
    this.applyRemote(data.profile||saved,false);
    return true;
   }
   return false;
  },
  material:()=>currentMaterial,
  slots:()=>JSON.parse(JSON.stringify(slots)),
  syncPayload:()=>({
   type:'avatar-studio-sync',
   profile:{...current},
   saved:{...saved},
   material:currentMaterial,
   savedMaterial,
   slots
  }),
  syncUi
 });
}
