(function exposeHumanALESensors(global){
  const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));
  const average=(data,start,end)=>{
    let total=0,count=0;
    for(let i=Math.max(0,start);i<Math.min(data.length,end);i++){total+=data[i];count++;}
    return count?total/count/255:0;
  };

  class HumanALESensorRouter{
    constructor({runtime,video=null,onStatus=null,mediaDevices=null,AudioContextClass=null}={}){
      if(!runtime?.dispatch)throw new Error('Runtime AleCore AI diperlukan untuk sensor.');
      this.runtime=runtime;
      this.video=video;
      this.onStatus=typeof onStatus==='function'?onStatus:()=>{};
      this.mediaDevices=mediaDevices||global.navigator?.mediaDevices||null;
      this.AudioContextClass=AudioContextClass||global.AudioContext||global.webkitAudioContext||null;
      this.microphone=null;
      this.camera=null;
      this.cameraFrame=0;
      this.cameraCanvas=null;
      this.cameraContext=null;
      this.previousVision=null;
    }

    status(channel,state,message=''){
      this.onStatus({channel,state,message,microphone:this.microphoneActive,camera:this.cameraActive});
    }
    get microphoneActive(){return Boolean(this.microphone?.stream);}
    get cameraActive(){return Boolean(this.camera?.stream);}
    snapshot(){return Object.freeze({microphone:this.microphoneActive,camera:this.cameraActive});}

    async startMicrophone(){
      if(this.microphoneActive)return this.snapshot();
      if(!this.mediaDevices?.getUserMedia)throw new Error('Mikrofon browser tidak tersedia.');
      if(!this.AudioContextClass)throw new Error('Web Audio tidak tersedia.');
      this.status('microphone','requesting','Menunggu izin mikrofon.');
      let stream=null,context=null;
      try{
        stream=await this.mediaDevices.getUserMedia({
          audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
          video:false
        });
        context=new this.AudioContextClass();
        if(context.state==='suspended')await context.resume?.();
        const source=context.createMediaStreamSource(stream);
        const analyser=context.createAnalyser();
        analyser.fftSize=512;
        analyser.smoothingTimeConstant=.72;
        source.connect(analyser);
        const frequencies=new Uint8Array(analyser.frequencyBinCount);
        const tick=timestamp=>{
          if(!this.microphoneActive)return;
          analyser.getByteFrequencyData(frequencies);
          if(timestamp-this.microphone.lastSent>=100){
            const length=frequencies.length;
            const low=average(frequencies,0,Math.max(2,Math.floor(length*.12)));
            const mid=average(frequencies,Math.floor(length*.12),Math.floor(length*.48));
            const high=average(frequencies,Math.floor(length*.48),length);
            const energy=clamp01(low*.38+mid*.42+high*.20);
            this.runtime.dispatch('audio.energy',{energy,low,mid,high,source:'site-microphone'});
            this.microphone.lastSent=timestamp;
          }
          this.microphone.raf=global.requestAnimationFrame(tick);
        };
        this.microphone={stream,context,source,analyser,frequencies,raf:0,lastSent:-Infinity};
        this.microphone.raf=global.requestAnimationFrame(tick);
        this.status('microphone','active','Mikrofon aktif untuk visual sensor AleCore AI.');
        return this.snapshot();
      }catch(error){
        stream?.getTracks?.().forEach(track=>track.stop());
        try{await context?.close?.();}catch{}
        this.microphone=null;
        this.runtime.dispatch('audio.energy',{energy:0,low:0,mid:0,high:0,source:'site-microphone'});
        this.status('microphone','error',String(error?.message||'Mikrofon gagal diaktifkan.'));
        throw error;
      }
    }

    async stopMicrophone(){
      const current=this.microphone;
      this.microphone=null;
      if(current?.raf)global.cancelAnimationFrame(current.raf);
      try{current?.source?.disconnect?.();}catch{}
      current?.stream?.getTracks?.().forEach(track=>track.stop());
      try{await current?.context?.close?.();}catch{}
      this.runtime.dispatch('audio.energy',{energy:0,low:0,mid:0,high:0,source:'site-microphone'});
      this.status('microphone','idle','Mikrofon berhenti.');
      return this.snapshot();
    }

    ensureVisionCanvas(){
      if(this.cameraCanvas)return;
      this.cameraCanvas=document.createElement('canvas');
      this.cameraCanvas.width=64;this.cameraCanvas.height=48;
      this.cameraContext=this.cameraCanvas.getContext('2d',{willReadFrequently:true});
    }

    sampleVision(){
      if(!this.cameraActive||!this.video?.videoWidth||!this.cameraContext)return;
      const context=this.cameraContext;
      context.drawImage(this.video,0,0,64,48);
      const pixels=context.getImageData(0,0,64,48).data;
      const grayscale=new Uint8Array(64*48);
      let totalDifference=0;
      for(let i=0,j=0;i<pixels.length;i+=4,j++){
        const value=Math.round(pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114);
        grayscale[j]=value;
        if(this.previousVision)totalDifference+=Math.abs(value-this.previousVision[j]);
      }
      const activity=this.previousVision?clamp01(totalDifference/(grayscale.length*32)):.18;
      this.previousVision=grayscale;
      this.runtime.dispatch('vision.frame',{
        activity:Math.max(.04,activity),
        frameId:'site-camera-'+(++this.cameraFrame),
        source:'site-camera'
      });
    }

    async startCamera(){
      if(this.cameraActive)return this.snapshot();
      if(!this.mediaDevices?.getUserMedia)throw new Error('Kamera browser tidak tersedia.');
      this.status('camera','requesting','Menunggu izin kamera.');
      let stream=null;
      try{
        stream=await this.mediaDevices.getUserMedia({
          audio:false,
          video:{facingMode:'user',width:{ideal:640},height:{ideal:480}}
        });
        if(!this.video)throw new Error('Elemen preview kamera tidak tersedia.');
        this.video.srcObject=stream;
        await this.video.play();
        this.video.hidden=false;
        this.ensureVisionCanvas();
        this.previousVision=null;
        this.camera={stream,timer:global.setInterval(()=>this.sampleVision(),450)};
        this.sampleVision();
        this.status('camera','active','Kamera aktif. Analisis gerak tetap lokal di browser.');
        return this.snapshot();
      }catch(error){
        stream?.getTracks?.().forEach(track=>track.stop());
        if(this.video){this.video.srcObject=null;this.video.hidden=true;}
        this.camera=null;this.previousVision=null;
        this.runtime.dispatch('vision.stop',{source:'site-camera'});
        this.status('camera','error',String(error?.message||'Kamera gagal diaktifkan.'));
        throw error;
      }
    }

    stopCamera(){
      const current=this.camera;
      this.camera=null;
      if(current?.timer)global.clearInterval(current.timer);
      current?.stream?.getTracks?.().forEach(track=>track.stop());
      if(this.video){this.video.pause?.();this.video.srcObject=null;this.video.hidden=true;}
      this.previousVision=null;
      this.runtime.dispatch('vision.stop',{source:'site-camera'});
      this.status('camera','idle','Kamera berhenti.');
      return this.snapshot();
    }

    async stopAll(){
      await this.stopMicrophone();
      this.stopCamera();
      return this.snapshot();
    }
  }

  global.HumanALESensors=Object.freeze({
    create:options=>new HumanALESensorRouter(options),
    HumanALESensorRouter
  });
})(typeof window==='undefined'?globalThis:window);
