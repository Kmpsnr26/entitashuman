// Small local PCM effect: keep Indonesian words clear while adding a robot texture.
export function robotSamples(input,rate,style='adult-robot'){
 if(!Number.isFinite(rate)||rate<8000||rate>192000)throw new Error('Sample rate tidak valid.');
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
 async function play(bytes,{style='adult-robot',onstart=()=>{},onenergy=()=>{},onend=()=>{}}={}){
  stop();const token=serial,ctx=getContext();await ctx.resume();
  if(token!==serial)return false;
  if(ctx.state!=='running')throw new Error('Ketuk Uji suara untuk mengaktifkan audio.');
  const decoded=await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  if(token!==serial)return false;
  const buffer=ctx.createBuffer(decoded.numberOfChannels,decoded.length,decoded.sampleRate);
  for(let channel=0;channel<decoded.numberOfChannels;channel++)buffer.copyToChannel(robotSamples(decoded.getChannelData(channel),decoded.sampleRate,style),channel);
  source=ctx.createBufferSource();source.buffer=buffer;source.playbackRate.value=style==='adult-robot'?.94:style==='baby-robot'?1.10:1;
  gain=ctx.createGain();source.connect(gain);gain.connect(ctx.destination);
  const now=ctx.currentTime,start=now+(style==='natural'?0:.12),duration=buffer.duration/source.playbackRate.value;
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.88,start+.012);
  gain.gain.setValueAtTime(.88,start+Math.max(.013,duration-.02));gain.gain.linearRampToValueAtTime(0,start+duration);
  // Brief, quiet rising tone creates a transition into the robot reply.
  if(style!=='natural'){
   const oscillator=ctx.createOscillator(),toneGain=ctx.createGain();
   oscillator.type='sine';oscillator.frequency.setValueAtTime(340,now);oscillator.frequency.exponentialRampToValueAtTime(680,now+.09);
   toneGain.gain.setValueAtTime(0,now);toneGain.gain.linearRampToValueAtTime(.035,now+.015);toneGain.gain.exponentialRampToValueAtTime(.0001,now+.10);
   oscillator.connect(toneGain);toneGain.connect(ctx.destination);oscillator.start(now);oscillator.stop(now+.11);
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
