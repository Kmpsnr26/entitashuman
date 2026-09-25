const BaseAvatar=window.NeuralAvatar;
if(!BaseAvatar)throw new Error('Mesin avatar HumanALE belum dimuat.');

const clamp=value=>Math.max(0,Math.min(1,Number(value)||0));
const materialAliases={mixed:'hybrid',matrix:'binary',statistics:'cubes',abstract:'cubes',neural:'neural'};
const accentAliases={green:'emerald',gold:'amber',spectrum:'adaptive'};

export class HumanALEAvatar extends BaseAvatar{
 constructor(canvas,options={}){
  super(canvas,{
   bindPointer:false,
   popup:Boolean(options.popup),
   paused:Boolean(options.panelOnly),
   referenceSrc:options.panelOnly?'':options.referenceSrc
  });
  this.track=true;
  this.persona='chatgpt';
  this.mode='mixed';
  this.state='idle';
  this.listening=false;
  this._thinking=false;
  this._evolving=false;
  this.earSpectrum={low:0,mid:0,high:0};
  this.flowEnergy=1;
  this._gazePointer={x:0,y:0};
  this._gazeActive=false;
  this.onRender=(context,time)=>this.drawAudioSensors(context,time);
 }

 set track(value){
  this._track=Boolean(value);
  if(!this._track&&this._pointer)this._pointer={x:0,y:0,active:false,magnet:false};
 }
 get track(){return this._track!==false;}
 set pointer(value={}){
  const current=this._pointer||{x:0,y:0,active:false,magnet:false};
  const tracked=this._track!==false;
  this._pointer={
   x:tracked?Math.max(-1,Math.min(1,Number(value.x)||0)):0,
   y:tracked?Math.max(-1,Math.min(1,Number(value.y)||0)):0,
   active:tracked&&(value.active??current.active),
   magnet:tracked&&(value.magnet??current.magnet)
  };
 }
 get pointer(){return this._pointer;}
 set pointerActive(value){const active=this.track&&Boolean(value);this._pointer={...(this._pointer||{x:0,y:0}),active,magnet:active};}
 get pointerActive(){return Boolean(this._pointer?.active);}
 set gazePointer(value={}){
  this._gazePointer={x:Math.max(-1,Math.min(1,Number(value.x)||0)),y:Math.max(-1,Math.min(1,Number(value.y)||0))};
  if(this._gazeActive&&this.track)this.setPointer(this._gazePointer.x,this._gazePointer.y,true,false);
 }
 get gazePointer(){return this._gazePointer;}
 set gazeActive(value){
  this._gazeActive=Boolean(value);
  if(this._gazeActive&&this.track)this.setPointer(this._gazePointer.x,this._gazePointer.y,true,false);
 }
 get gazeActive(){return this._gazeActive;}
 set thinking(value){
  this._thinking=Boolean(value);
  if(this._thinking)this.setState('thinking');
  else if(this.state==='thinking')this.setState('idle');
 }
 get thinking(){return this._thinking;}

 setTheme(value='auto'){this.setEnvironment(value);}
 setAccent(value='cyan'){super.setAccent(accentAliases[value]||value);}
 setMaterial(value='mixed'){
  this.mode=value;
  super.setMaterial(materialAliases[value]||value);
 }
 setAvatarVariant(value='binary'){this.setMaterial(value==='cube'?'cubes':'hybrid');}
 setTalking(active=false){this.setSpeaking(active);}
 setAudioLevel(level=0){
  const next=clamp(level);
  this.externalSpeech=next>0?next:(this.speaking?null:0);
  this.flowEnergy=1+next*.9;
 }
 setSpeechEnergy(level=0){this.setAudioLevel(level);}
 setEarSpectrum(value={}){
  for(const band of ['low','mid','high'])this.earSpectrum[band]=clamp(value[band]);
 }
 setListening(value=false){
  this.listening=Boolean(value);
  if(this.listening)this.setState('listening');
  else if(this.state==='listening')this.setState('idle');
 }
 setState(value='idle'){
  this.state=['idle','listening','thinking','speaking','processing','error'].includes(value)?value:'idle';
  this.flowEnergy={idle:1,listening:1.45,thinking:1.7,speaking:1.8,processing:2,error:2.2}[this.state];
  if(this.state==='speaking')this.speaking=true;
 }
 setEvolving(value=false){
  this._evolving=Boolean(value);
  this.setState(this._evolving?'processing':'idle');
 }
 completeEvolution(){
  this._evolving=false;
  this.setState('processing');
  clearTimeout(this.evolutionTimer);
  this.evolutionTimer=setTimeout(()=>{if(!this.disposed&&this.state==='processing')this.setState('idle');},1400);
 }
 activateAllEffects(value=true){
  if(!value)return;
  this.animate=true;this.flow=true;this.track=true;this.setMaterial('mixed');this.setAccent('cyan');
 }
 trigger(action=''){
  if(action==='blink'){this.blinkStart=performance.now();return;}
  clearTimeout(this.gestureTimer);
  this.gestureYaw=action==='shake'?.22:0;
  this.gesturePitch=action==='nod'?.17:0;
  this.gestureTimer=setTimeout(()=>{this.gestureYaw=0;this.gesturePitch=0;},430);
 }
 pulse(){
  this.flowEnergy=Math.max(this.flowEnergy,2.35);
  clearTimeout(this.pulseTimer);
  this.pulseTimer=setTimeout(()=>{if(!this.disposed)this.setState(this.state);},620);
 }
 triggerGlitch(){
  this.gestureYaw=-.12;
  clearTimeout(this.glitchTimer);
  this.glitchTimer=setTimeout(()=>{if(!this.disposed)this.gestureYaw=0;},180);
 }
 reveal(){this.presence=1;this.visibleTarget=true;}
 awaken(duration=4200){this.presence=0;return this.setVisible(true,{duration});}
 dismiss(duration=3000){return this.setVisible(false,{duration});}
 destroy(){
  for(const timer of [this.gestureTimer,this.pulseTimer,this.glitchTimer,this.evolutionTimer])clearTimeout(timer);
  super.destroy();
 }

 drawAudioSensors(context,time){
  const bands=this.earSpectrum,active=this.listening?0.16:0;
  const energies=[Math.max(active,bands.low),Math.max(active,bands.mid),Math.max(active,bands.high)];
  if(Math.max(...energies)<.025)return;
  context.save();
  context.globalCompositeOperation=this.isLightEnvironment()?'source-over':'lighter';
  context.lineWidth=Math.max(.7,this.scale*.0015);
  for(const side of [-1,1])for(let band=0;band<3;band++){
   const energy=energies[band],origin=this.project(side*.405,.01,.10,time,true);
   const travel=(time*.00016*(1+band*.25)+band*.23)%1;
   const radius=this.scale*(.035+band*.018+travel*.055+energy*.028);
   context.globalAlpha=this.presence*(1-travel)*(.12+energy*.42);
   context.strokeStyle=band===0?'rgba(124,227,181,.9)':band===1?'rgba(142,225,244,.9)':'rgba(185,160,244,.9)';
   context.beginPath();
   context.arc(origin.x+side*radius*.16,origin.y,radius,-Math.PI*.44,Math.PI*.44,side<0);
   context.stroke();
  }
  context.restore();
 }
}
