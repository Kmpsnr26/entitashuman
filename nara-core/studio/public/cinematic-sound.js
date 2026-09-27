function now(context,offset=0){
  return context.currentTime+Math.max(0,offset);
}

export function createCinematicSoundEngine({enabled=()=>true}={}){
  let context=null;
  let master=null;
  let noiseBuffer=null;
  let profile={masterVolume:.78,transitionFx:.82,coreFx:.86,droidCharacter:true};
  let ducked=false;

  function clamp(value,min,max,fallback){
    const number=Number(value);
    return Number.isFinite(number)?Math.max(min,Math.min(max,number)):fallback;
  }

  function outputGain(){
    return .075*profile.masterVolume*(ducked?.34:1);
  }

  function levelForCue(name){
    return ['pulse','process','flow','voiceBoot'].includes(name)?profile.coreFx:profile.transitionFx;
  }

  function ensure(){
    if(context&&context.state!=='closed')return context;
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(!AudioContext)return null;
    context=new AudioContext();
    master=context.createGain();
    master.gain.value=outputGain();
    master.connect(context.destination);
    return context;
  }

  function gainEnvelope(start,duration,peak=.32){
    const ctx=ensure();
    if(!ctx)return null;
    const gain=ctx.createGain();
    gain.gain.setValueAtTime(.0001,start);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),start+Math.min(.06,duration*.18));
    gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    gain.connect(master);
    return gain;
  }

  function oscillator({type='sine',from=120,to=420,duration=.5,offset=0,peak=.25}={}){
    const ctx=ensure();
    if(!ctx)return;
    const start=now(ctx,offset);
    const osc=ctx.createOscillator();
    const gain=gainEnvelope(start,duration,peak);
    osc.type=type;
    osc.frequency.setValueAtTime(Math.max(20,from),start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20,to),start+duration);
    osc.connect(gain);
    osc.start(start);
    osc.stop(start+duration+.03);
  }

  function getNoise(){
    const ctx=ensure();
    if(!ctx)return null;
    if(noiseBuffer)return noiseBuffer;
    const length=Math.max(1,Math.floor(ctx.sampleRate*1.2));
    noiseBuffer=ctx.createBuffer(1,length,ctx.sampleRate);
    const data=noiseBuffer.getChannelData(0);
    let seed=0x4e415241;
    for(let i=0;i<data.length;i++){
      seed=(seed*1664525+1013904223)>>>0;
      data[i]=((seed/4294967296)*2-1)*.72;
    }
    return noiseBuffer;
  }

  function noiseSweep({from=260,to=980,duration=.8,offset=0,peak=.12}={}){
    const ctx=ensure();
    const buffer=getNoise();
    if(!ctx||!buffer)return;
    const start=now(ctx,offset);
    const source=ctx.createBufferSource();
    source.buffer=buffer;
    const filter=ctx.createBiquadFilter();
    filter.type='bandpass';
    filter.Q.value=2.2;
    filter.frequency.setValueAtTime(from,start);
    filter.frequency.exponentialRampToValueAtTime(to,start+duration);
    const gain=gainEnvelope(start,duration,peak);
    source.connect(filter).connect(gain);
    source.start(start);
    source.stop(start+duration+.03);
  }

  function cue(name,{offset=0}={}){
    if(!enabled())return false;
    const ctx=ensure();
    if(!ctx)return false;
    if(ctx.state==='suspended')ctx.resume().catch(()=>{});
    const t=ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(Math.max(.0001,outputGain()),t,.018);

    const level=levelForCue(name);
    if(name==='sweep'){
      noiseSweep({from:220,to:1500,duration:.62,offset,peak:.11*level});
      oscillator({type:'triangle',from:180,to:720,duration:.58,offset,peak:.12*level});
    }else if(name==='zoomIn'){
      oscillator({from:72,to:320,duration:.78,offset,peak:.2*level});
      oscillator({type:'triangle',from:145,to:740,duration:.72,offset:.04+offset,peak:.09*level});
    }else if(name==='zoomOut'){
      oscillator({from:360,to:88,duration:.7,offset,peak:.17*level});
      noiseSweep({from:900,to:180,duration:.66,offset,peak:.07*level});
    }else if(name==='process'){
      [0,.12,.24,.36].forEach((step,index)=>oscillator({
        type:index%2?'square':'triangle',
        from:260+index*75,to:330+index*82,duration:.09,offset:offset+step,peak:.065*level
      }));
    }else if(name==='pulse'){
      oscillator({from:78,to:48,duration:.38,offset,peak:.29*level});
      oscillator({type:'sine',from:156,to:92,duration:.34,offset:.055+offset,peak:.09*level});
    }else if(name==='flow'){
      noiseSweep({from:320,to:1180,duration:1.1,offset,peak:.085*level});
      oscillator({type:'sine',from:128,to:186,duration:1.05,offset,peak:.07*level});
    }else if(name==='voiceBoot'){
      oscillator({type:'sine',from:74,to:52,duration:.28,offset,peak:.22*level});
      oscillator({type:'triangle',from:148,to:92,duration:.22,offset:.025+offset,peak:.055*level});
    }else return false;
    return true;
  }

  function stop(){
    if(master&&context&&context.state!=='closed'){
      const t=context.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(.0001,t,.025);
    }
  }

  function setProfile(next={}){
    profile={
      masterVolume:clamp(next.masterVolume,0,1,profile.masterVolume),
      transitionFx:clamp(next.transitionFx,0,1,profile.transitionFx),
      coreFx:clamp(next.coreFx,0,1,profile.coreFx),
      droidCharacter:typeof next.droidCharacter==='boolean'?next.droidCharacter:profile.droidCharacter
    };
    if(master&&context&&context.state!=='closed'){
      const t=context.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(Math.max(.0001,outputGain()),t,.018);
    }
    return {...profile};
  }

  window.addEventListener('nara:voice-speaking',event=>{
    ducked=Boolean(event.detail?.active);
    if(master&&context&&context.state!=='closed'){
      const time=context.currentTime;
      master.gain.cancelScheduledValues(time);
      master.gain.setTargetAtTime(Math.max(.0001,outputGain()),time,.02);
    }
  });

  return {cue,stop,setProfile,getProfile:()=>({...profile})};
}
