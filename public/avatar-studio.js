import {
 AVATAR_STUDIO_DEFAULTS,
 normalizeAvatarStudioProfile
} from './avatar-studio-profile.js';

export const AVATAR_STUDIO_STORAGE_KEY='humanale.avatar-studio.v1';

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

 const status=root.querySelector?.('#avatarStudioStatus');
 const inputFor=key=>root.querySelector?.('[data-avatar-studio-key="'+key+'"]');
 const outputFor=key=>root.querySelector?.('[data-avatar-studio-output="'+key+'"]');

 const syncUi=(profile=current,label='LIVE PREVIEW')=>{
  current=normalizeAvatarStudioProfile(profile);
  for(const key of FIELDS){
   const input=inputFor(key),output=outputFor(key);
   const percent=Math.round(current[key]*100);
   if(input&&Number(input.value)!==percent)input.value=String(percent);
   if(output)output.textContent=percent+'%';
  }
  if(status)status.textContent=label+' · perubahan langsung diterapkan ke avatar.';
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

 root.querySelector?.('#avatarStudioOpen')?.addEventListener('click',()=>{
  syncUi(current,'LIVE PREVIEW');
  onOpen();
 });

 root.querySelector?.('#avatarStudioSave')?.addEventListener('click',()=>{
  const next=apply(readControls(),{persist:true,notify:true,label:'PRESET TERSIMPAN'});
  onToast('Avatar Live Studio · preset tersimpan.');
  return next;
 });

 root.querySelector?.('#avatarStudioRevert')?.addEventListener('click',()=>{
  apply(saved,{persist:false,notify:true,label:'PRESET TERSIMPAN DIPULIHKAN'});
  onToast('Avatar Live Studio · kembali ke preset tersimpan.');
 });

 root.querySelector?.('#avatarStudioReset')?.addEventListener('click',()=>{
  apply(AVATAR_STUDIO_DEFAULTS,{persist:false,notify:true,label:'DEFAULT PREVIEW'});
  onToast('Avatar Live Studio · default dipreview. Simpan jika ingin menjadikannya preset.');
 });

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
   if(data.type==='avatar-studio-sync'&&isPanel){
    if(data.saved)saved=normalizeAvatarStudioProfile(data.saved);
    this.applyRemote(data.profile||saved,false);
    return true;
   }
   return false;
  },
  syncPayload:()=>({
   type:'avatar-studio-sync',
   profile:{...current},
   saved:{...saved}
  }),
  syncUi
 });
}
