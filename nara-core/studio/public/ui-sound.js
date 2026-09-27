function clamp(value,min,max,fallback){
  const number=Number(value);
  return Number.isFinite(number)?Math.max(min,Math.min(max,number)):fallback;
}

export function createUiSoundEngine({enabled=()=>true}={}){
  let context=null;
  let master=null;
  let ducked=false;
  let profile={masterVolume:.78,uiSfx:.62};

  function outputGain(){
    return .055*profile.masterVolume*profile.uiSfx*(ducked?.28:1);
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

  function refresh(){
    if(!master||!context||context.state==='closed')return;
    const time=context.currentTime;
    master.gain.cancelScheduledValues(time);
    master.gain.setTargetAtTime(Math.max(.0001,outputGain()),time,.015);
  }

  function tone({from=360,to=520,duration=.075,type='sine',peak=.16,offset=0}={}){
    const ctx=ensure();
    if(!ctx)return;
    const start=ctx.currentTime+Math.max(0,offset);
    const oscillator=ctx.createOscillator();
    const gain=ctx.createGain();
    oscillator.type=type;
    oscillator.frequency.setValueAtTime(Math.max(20,from),start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20,to),start+duration);
    gain.gain.setValueAtTime(.0001,start);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),start+.012);
    gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start+duration+.025);
  }

  function cue(name){
    if(!enabled())return false;
    const ctx=ensure();
    if(!ctx)return false;
    if(ctx.state==='suspended')ctx.resume().catch(()=>{});
    refresh();

    if(name==='hover'){
      tone({from:520,to:690,duration:.045,peak:.055});
    }else if(name==='click'){
      tone({from:330,to:265,duration:.07,type:'triangle',peak:.11});
    }else if(name==='panelOpen'){
      tone({from:180,to:560,duration:.16,type:'triangle',peak:.12});
      tone({from:420,to:780,duration:.12,offset:.035,peak:.055});
    }else if(name==='panelClose'){
      tone({from:560,to:190,duration:.14,type:'triangle',peak:.10});
    }else if(name==='confirm'||name==='success'){
      tone({from:410,to:620,duration:.11,peak:.11});
      tone({from:620,to:890,duration:.12,offset:.075,peak:.08});
    }else if(name==='warning'){
      tone({from:210,to:165,duration:.18,type:'sawtooth',peak:.095});
    }else if(name==='error'){
      tone({from:185,to:92,duration:.23,type:'square',peak:.085});
    }else if(name==='process'){
      tone({from:280,to:340,duration:.07,type:'triangle',peak:.075});
      tone({from:340,to:410,duration:.07,offset:.075,type:'triangle',peak:.065});
    }else if(name==='neuralPulse'){
      tone({from:96,to:62,duration:.22,peak:.15});
      tone({from:192,to:126,duration:.18,offset:.025,peak:.05});
    }else return false;
    return true;
  }

  function setProfile(next={}){
    profile={
      masterVolume:clamp(next.masterVolume,0,1,profile.masterVolume),
      uiSfx:clamp(next.uiSfx,0,1,profile.uiSfx)
    };
    refresh();
    return {...profile};
  }

  let lastHover=null;
  let lastHoverAt=0;
  function attach(root=document){
    root.addEventListener('pointerover',event=>{
      const target=event.target?.closest?.('button,select');
      if(!target)return;
      const now=performance.now();
      if(target===lastHover&&now-lastHoverAt<180)return;
      lastHover=target;
      lastHoverAt=now;
      cue('hover');
    },{passive:true});
    root.addEventListener('click',event=>{
      const target=event.target?.closest?.('button');
      if(!target||target.dataset.uiSoundManaged==='true')return;
      if(['edgeView3d','edgeView2d','neuralExplorer','neuralFocus','neuralCore'].includes(target.id))cue('neuralPulse');
      else cue('click');
    },{passive:true});
  }

  window.addEventListener('nara:voice-speaking',event=>{
    ducked=Boolean(event.detail?.active);
    refresh();
  });

  return {cue,setProfile,attach,getProfile:()=>({...profile})};
}
