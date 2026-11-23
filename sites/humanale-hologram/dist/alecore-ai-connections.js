(function exposeHumanALEConnections(global){
  const SERVICE_MAP=Object.freeze({
    github:{region:'GITHUB',connected:'github.connected',disconnected:'github.disconnected'},
    copilot:{region:'COPILOT',connected:'copilot.connected',disconnected:'copilot.disconnected'},
    drive:{region:'DRIVE',connected:'drive.connected',disconnected:'drive.disconnected'},
    web:{region:'WEB',connected:'web.connected',disconnected:'web.disconnected'},
    team:{region:'TEAM',connected:'team.connected',disconnected:'team.disconnected'},
    email:{region:'OWNER_EMAIL',connected:'email.connected',disconnected:'email.disconnected'}
  });
  const ALLOWED_STATUS=new Set(['connected','disconnected','login_required','error','idle','unknown']);
  const normalize=value=>{
    const status=String(value||'unknown').toLowerCase();
    return ALLOWED_STATUS.has(status)?status:'unknown';
  };

  class HumanALEConnectionMonitor{
    constructor({
      runtime,
      endpoint='/api/status',
      fetchImpl=null,
      navigatorObj=null,
      eventTarget=null,
      intervalMs=15000,
      onStatus=null
    }={}){
      if(!runtime?.dispatch)throw new Error('Runtime NARA diperlukan untuk monitor koneksi.');
      this.runtime=runtime;
      this.endpoint=String(endpoint||'/api/status');
      this.fetchImpl=fetchImpl||global.fetch?.bind(global)||null;
      this.navigatorObj=navigatorObj||global.navigator||{onLine:true};
      this.eventTarget=eventTarget||global;
      this.intervalMs=Math.max(5000,Math.min(120000,Number(intervalMs)||15000));
      this.onStatus=typeof onStatus==='function'?onStatus:()=>{};
      this.services={};
      this.authStatus='unknown';
      this.started=false;this.timer=null;
      this.onlineHandler=()=>this.applyNetwork(true);
      this.offlineHandler=()=>this.applyNetwork(false);
    }

    dispatchService(service,status){
      const meta=SERVICE_MAP[service];
      if(!meta)return;
      const next=normalize(status),previous=this.services[service]||'unknown';
      if(previous===next)return;
      this.services[service]=next;
      if(next==='connected')this.runtime.dispatch(meta.connected,{source:'site-connection-monitor'});
      else if(next==='disconnected')this.runtime.dispatch(meta.disconnected,{source:'site-connection-monitor'});
      else if(next==='login_required')this.runtime.dispatch('login.required',{region:meta.region,source:'site-connection-monitor'});
      else if(next==='error')this.runtime.dispatch('login.failed',{region:meta.region,source:'site-connection-monitor'});
      this.publish();
    }

    applyNetwork(online=Boolean(this.navigatorObj?.onLine)){
      const connected=Boolean(online);
      this.dispatchService('web',connected?'connected':'disconnected');
      const previous=this.services.online||'unknown';
      const next=connected?'connected':'disconnected';
      if(previous!==next){
        this.services.online=next;
        this.runtime.dispatch(connected?'online.connected':'online.disconnected',{source:'site-network'});
        this.publish();
      }
      return connected;
    }

    applyStatusResponse(data={}){
      if(!data||typeof data!=='object')return;
      const connections=data.connections&&typeof data.connections==='object'?data.connections:{};
      for(const service of Object.keys(SERVICE_MAP)){
        if(Object.hasOwn(connections,service))this.dispatchService(service,connections[service]);
      }
      if(typeof data.signedIn==='boolean'){
        const next=data.signedIn?'connected':'login_required';
        if(this.authStatus!==next){
          this.authStatus=next;
          this.runtime.dispatch(data.signedIn?'login.success':'login.required',{
            region:'ONLINE',source:'site-auth-status'
          });
          this.publish();
        }
      }
    }

    async refresh(){
      const online=this.applyNetwork();
      if(!online||!this.fetchImpl)return this.snapshot();
      try{
        const response=await this.fetchImpl(this.endpoint,{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
        if(!response?.ok)throw new Error('Status HTTP '+String(response?.status||'gagal'));
        const data=await response.json();
        this.applyStatusResponse(data);
      }catch(error){
        this.onStatus({type:'refresh-error',message:String(error?.message||'Status koneksi gagal dimuat.')});
      }
      return this.snapshot();
    }

    snapshot(){
      return Object.freeze({
        version:1,
        services:Object.freeze({...this.services}),
        authStatus:this.authStatus,
        online:Boolean(this.navigatorObj?.onLine),
        updatedAt:Date.now()
      });
    }

    publish(){
      const state=this.snapshot();
      this.onStatus({type:'state',state});
      return state;
    }

    start(){
      if(this.started)return this.snapshot();
      this.started=true;
      this.eventTarget?.addEventListener?.('online',this.onlineHandler);
      this.eventTarget?.addEventListener?.('offline',this.offlineHandler);
      this.applyNetwork();
      this.refresh();
      this.timer=global.setInterval(()=>this.refresh(),this.intervalMs);
      return this.snapshot();
    }

    stop(){
      this.eventTarget?.removeEventListener?.('online',this.onlineHandler);
      this.eventTarget?.removeEventListener?.('offline',this.offlineHandler);
      if(this.timer)global.clearInterval(this.timer);
      this.timer=null;this.started=false;
      return this.snapshot();
    }
  }

  global.HumanALEConnections=Object.freeze({
    services:SERVICE_MAP,
    create:options=>new HumanALEConnectionMonitor(options),
    HumanALEConnectionMonitor
  });
})(typeof window==='undefined'?globalThis:window);
