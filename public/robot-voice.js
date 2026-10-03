export const HUMANALE_VOICE=Object.freeze({style:'adult-robot',character:'male',language:'id-ID',rate:.86,pitch:.80});
const profiles=Object.freeze({
 'adult-robot':Object.freeze({rate:HUMANALE_VOICE.rate,gain:.88,lead:.16,toneStart:170,toneEnd:95,toneDuration:.12,toneGain:.025,tail:.50}),
 'baby-robot':Object.freeze({rate:1.10,gain:.88,lead:.12,toneStart:340,toneEnd:680,toneDuration:.10,toneGain:.035,tail:0}),
 natural:Object.freeze({rate:1,gain:.88,lead:0,tail:0})
});
export const voiceProfile=style=>profiles[style]||profiles['adult-robot'];

// Keep dry consonants distinct; only the quiet echo branch loses upper detail.
function maleBassSamples(input,rate){
 if(!input.length)return new Float32Array();
 const length=input.length+Math.round(rate*profiles['adult-robot'].tail);
 const output=new Float32Array(length),echoSend=new Float32Array(length);
 const hpAlpha=Math.exp(-2*Math.PI*77/rate),bassAlpha=1-Math.exp(-2*Math.PI*180/rate);
 const echoHpAlpha=Math.exp(-2*Math.PI*180/rate),echoLpAlpha=1-Math.exp(-2*Math.PI*2000/rate);
 const delay1=Math.round(rate*.14),delay2=Math.round(rate*.29),delay3=Math.round(rate*.43),fade=Math.max(1,Math.round(rate*.012));
 let previous=0,highpass=0,bass=0,echoPrevious=0,echoHighpass=0,echoLowpass=0;
 for(let i=0;i<length;i++){
  const sample=i<input.length&&Number.isFinite(input[i])?input[i]:0;
  highpass=hpAlpha*(highpass+sample-previous);previous=sample;
  bass+=bassAlpha*(highpass-bass);
  const carrier=.988+.012*Math.sin(2*Math.PI*18*i/rate);
  const dry=(highpass+.413*bass)*carrier*.82;
  echoHighpass=echoHpAlpha*(echoHighpass+dry-echoPrevious);echoPrevious=dry;
  echoLowpass+=echoLpAlpha*(echoHighpass-echoLowpass);echoSend[i]=echoLowpass;
  let mixed=dry+(i>=delay1?echoSend[i-delay1]*.11:0)+(i>=delay2?echoSend[i-delay2]*.055:0)+(i>=delay3?echoSend[i-delay3]*.024:0);
  // A continuous soft knee reserves headroom without flat-topped clipping.
  const magnitude=Math.abs(mixed);
  if(magnitude>.8)mixed=Math.sign(mixed)*(.8+.18*Math.tanh((magnitude-.8)/.18));
  output[i]=mixed*Math.min(1,i/fade,(length-1-i)/fade);
 }
 return output;
}

// All presets run locally on PCM and never modify the original voice samples.
export function robotSamples(input,rate,style='adult-robot'){
 if(!Number.isFinite(rate)||rate<8000||rate>192000)throw new Error('Sample rate tidak valid.');
 if(!Object.hasOwn(profiles,style))style='adult-robot';
 if(style==='adult-robot')return maleBassSamples(input,rate);
 const output=new Float32Array(input.length),robot=style!=='natural';
 const delay=Math.round(rate*.018),fade=Math.max(1,Math.round(rate*.009));
 for(let i=0;i<input.length;i++){
  const sample=Number.isFinite(input[i])?input[i]:0;
  const carrier=robot?.84+.16*Math.sin(2*Math.PI*(style==='baby-robot'?42:32)*i/rate):1;
  const echo=robot&&i>=delay?(Number.isFinite(input[i-delay])?input[i-delay]:0)*.07:0;
  const edge=Math.min(1,i/fade,(input.length-1-i)/fade);
  output[i]=Math.max(-.98,Math.min(.98,(sample*carrier+echo)*edge));
 }
 return output;
}

export function createRobotVoicePlayer({AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext}={}){
 let context,source,gain,timer,transition,serial=0;
 const getContext=()=>{if(!AudioContext)throw new Error('Pemutar audio tidak tersedia.');return context||(context=new AudioContext());};
 const unlock=()=>{try{return getContext().resume();}catch(error){return Promise.reject(error);}};
 function stop(){
  serial++;clearInterval(timer);timer=null;
  if(transition){const cue=transition;transition=null;try{cue.oscillator.stop();}catch{}cue.oscillator.disconnect();cue.gain.disconnect();}
  if(source){const active=source,activeGain=gain;try{const now=context.currentTime;activeGain.gain.cancelScheduledValues(now);activeGain.gain.setTargetAtTime(0,now,.008);active.stop(now+.04);}catch{active.disconnect();activeGain.disconnect();}source=null;}
 }
 async function play(bytes,{style='adult-robot',volume=1,onstart=()=>{},onenergy=()=>{},onend=()=>{}}={}){
  stop();const token=serial,ctx=getContext();await ctx.resume();
  if(token!==serial)return false;
  if(ctx.state!=='running')throw new Error('Ketuk Uji suara untuk mengaktifkan audio.');
  const decoded=await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  if(token!==serial)return false;
  const profile=voiceProfile(style),first=robotSamples(decoded.getChannelData(0),decoded.sampleRate,style);
  const buffer=ctx.createBuffer(decoded.numberOfChannels,first.length,decoded.sampleRate);buffer.copyToChannel(first,0);
  for(let channel=1;channel<decoded.numberOfChannels;channel++)buffer.copyToChannel(robotSamples(decoded.getChannelData(channel),decoded.sampleRate,style),channel);
  source=ctx.createBufferSource();source.buffer=buffer;source.playbackRate.value=profile.rate;
  gain=ctx.createGain();source.connect(gain);gain.connect(ctx.destination);
  const now=ctx.currentTime,start=now+profile.lead,duration=buffer.duration/source.playbackRate.value;
  const level=profile.gain*Math.max(0,Math.min(1,Number.isFinite(volume)?volume:1));
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(level,start+.012);
  gain.gain.setValueAtTime(level,start+Math.max(.013,duration-.02));gain.gain.linearRampToValueAtTime(0,start+duration);
  // A low, short transition matches the adult voice without covering its words.
  if(style!=='natural'){
   const oscillator=ctx.createOscillator(),toneGain=ctx.createGain();
   oscillator.type='sine';oscillator.frequency.setValueAtTime(profile.toneStart,now);oscillator.frequency.exponentialRampToValueAtTime(profile.toneEnd,now+profile.toneDuration-.01);
   toneGain.gain.setValueAtTime(0,now);toneGain.gain.linearRampToValueAtTime(profile.toneGain*(level/profile.gain),now+.015);toneGain.gain.linearRampToValueAtTime(0,now+profile.toneDuration);
   oscillator.connect(toneGain);toneGain.connect(ctx.destination);oscillator.start(now);oscillator.stop(now+profile.toneDuration+.01);
   const cue={oscillator,gain:toneGain};transition=cue;
   oscillator.onended=()=>{oscillator.disconnect();toneGain.disconnect();if(transition===cue)transition=null;};
  }
  const active=source,activeGain=gain;let energyTimer;
  source.onended=()=>{clearInterval(energyTimer);active.disconnect();activeGain.disconnect();if(token!==serial)return;timer=null;source=null;onend();};
  source.start(start);onstart();
  timer=energyTimer=setInterval(()=>{
   const position=Math.floor(Math.max(0,ctx.currentTime-start)*buffer.sampleRate*active.playbackRate.value),samples=buffer.getChannelData(0);
   let sum=0,count=0;for(let i=position;i<Math.min(position+512,samples.length);i++){sum+=samples[i]*samples[i];count++;}
   onenergy(count?Math.min(1,Math.sqrt(sum/count)*3):0);
  },60);
  return true;
 }
 return Object.freeze({unlock,play,stop});
}
