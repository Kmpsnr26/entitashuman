(function exposeHumanALEDataSpine(global){
  const LANE_DEFINITIONS=Object.freeze([
    Object.freeze({id:'CORE',region:'NARA_CORE',label:'NARA CORE',glyphs:Object.freeze(['01','AI'])}),
    Object.freeze({id:'MEMORY',region:'MEMORY',label:'MEMORY',glyphs:Object.freeze(['01','{}'])}),
    Object.freeze({id:'TERMINAL',region:'TERMINAL',label:'TERMINAL',glyphs:Object.freeze(['::','>_'])}),
    Object.freeze({id:'GITHUB',region:'GITHUB',label:'GITHUB',glyphs:Object.freeze(['<>','01'])}),
    Object.freeze({id:'COPILOT',region:'COPILOT',label:'COPILOT',glyphs:Object.freeze(['AI','<>'])}),
    Object.freeze({id:'WEB',region:'WEB',label:'WEB',glyphs:Object.freeze(['//','<>'])}),
    Object.freeze({id:'DRIVE',region:'DRIVE',label:'DRIVE',glyphs:Object.freeze(['{}','01'])}),
    Object.freeze({id:'SYNC',region:'SYNC',label:'SYNC',glyphs:Object.freeze(['01','::'])}),
    Object.freeze({id:'ERROR',region:'ERROR_MONITOR',label:'ERROR',glyphs:Object.freeze(['!!','<>'])})
  ]);
  const BY_ID=Object.freeze(Object.fromEntries(LANE_DEFINITIONS.map(item=>[item.id,item])));
  const BY_REGION=Object.freeze(Object.fromEntries(LANE_DEFINITIONS.map(item=>[item.region,item.id])));
  const EVENT_LANES=Object.freeze({
    'nara.start':'CORE','nara.shutdown':'CORE',
    'observe.start':'CORE','observe.complete':'CORE',
    'reason.start':'CORE','reason.complete':'CORE',
    'plan.start':'CORE','plan.complete':'CORE',
    'agent.start':'CORE','agent.complete':'CORE','agent.failed':'ERROR',
    'program.start':'CORE','program.complete':'CORE',
    'memory.read':'MEMORY','memory.write':'MEMORY','memory.complete':'MEMORY',
    'verify.start':'CORE','verify.complete':'CORE',
    'work.start':'CORE','work.complete':'CORE','report.created':'CORE',
    'terminal.open':'TERMINAL',
    'github.connected':'GITHUB','github.disconnected':'GITHUB',
    'copilot.connected':'COPILOT','copilot.disconnected':'COPILOT',
    'web.connected':'WEB','web.disconnected':'WEB',
    'online.connected':'WEB','online.disconnected':'WEB',
    'drive.connected':'DRIVE','drive.disconnected':'DRIVE',
    'sync.start':'SYNC','sync.complete':'SYNC',
    'error.detected':'ERROR','bug.detected':'ERROR','bug.fixed':'ERROR'
  });
  const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));
  const isDownEvent=event=>/\.(?:disconnected|failed)$/.test(event)||event==='nara.shutdown'||event==='error.detected'||event==='bug.detected';
  const ttlFor=event=>event==='error.detected'||event==='bug.detected'?3200:/connected|complete|fixed/.test(event)?2600:2200;

  class HumanALEDataSpine{
    constructor({runtime,onState=null,now=null,maxPackets=72}={}){
      if(!runtime?.bus?.onAny||!runtime?.snapshot)throw new Error('Runtime NARA diperlukan untuk Data Spine.');
      this.runtime=runtime;
      this.onState=typeof onState==='function'?onState:()=>{};
      this.now=typeof now==='function'?now:()=>global.performance?.now?.()??Date.now();
      this.maxPackets=Math.max(16,Math.min(160,Number(maxPackets)||72));
      this.sequence=0;this.started=false;this.offBus=null;
      this.packets=[];
      this.lanes=Object.fromEntries(LANE_DEFINITIONS.map(def=>[
        def.id,{...def,status:'idle',activity:0,lastEvent:'',updatedAt:0,packetCount:0}
      ]));
    }

    resolveLane(envelope={}){
      const event=String(envelope.event||'');
      if(EVENT_LANES[event])return EVENT_LANES[event];
      const region=envelope?.payload?.region;
      return BY_REGION[region]||null;
    }

    glyphFor(lane,event){
      if(event==='error.detected'||event==='bug.detected')return'!!';
      if(event.includes('connected'))return'<>';
      if(event.startsWith('sync.'))return'01';
      if(event==='terminal.open')return'>_';
      if(event.startsWith('work.'))return'AI';
      const glyphs=BY_ID[lane]?.glyphs||['01'];
      return glyphs[this.sequence%glyphs.length];
    }

    syncFromBrain(snapshot=this.runtime.snapshot()){
      for(const definition of LANE_DEFINITIONS){
        const region=snapshot?.regions?.[definition.region]||{};
        const lane=this.lanes[definition.id];
        lane.status=String(region.status||lane.status||'idle').slice(0,40);
        lane.activity=Math.max(clamp01(region.activity),this.packetActivity(definition.id));
        lane.lastEvent=String(region.lastEvent||lane.lastEvent||'').slice(0,100);
        lane.updatedAt=Number(region.updatedAt)||lane.updatedAt||0;
      }
    }

    packetActivity(laneId,at=this.now()){
      let activity=0;
      for(const packet of this.packets){
        if(packet.laneId!==laneId)continue;
        const age=at-packet.bornAt;
        if(age<0||age>packet.ttl)continue;
        activity=Math.max(activity,1-age/packet.ttl);
      }
      return clamp01(activity);
    }

    consume(envelope={}){
      const laneId=this.resolveLane(envelope);
      this.syncFromBrain(this.runtime.snapshot());
      if(!laneId){this.publish();return null;}
      const event=String(envelope.event||'event').slice(0,120);
      const now=this.now();
      const packet=Object.freeze({
        id:++this.sequence,
        laneId,
        region:BY_ID[laneId].region,
        event,
        glyph:this.glyphFor(laneId,event).slice(0,3),
        direction:isDownEvent(event)?'down':'up',
        bornAt:now,
        ttl:ttlFor(event)
      });
      this.packets.push(packet);
      if(this.packets.length>this.maxPackets)this.packets.splice(0,this.packets.length-this.maxPackets);
      const lane=this.lanes[laneId];
      lane.lastEvent=event;lane.updatedAt=Date.now();lane.activity=1;
      this.publish();
      return packet;
    }

    snapshot(){
      const now=this.now();
      const packets=this.packets.filter(packet=>now-packet.bornAt<=packet.ttl&&now>=packet.bornAt-50);
      const lanes={};
      for(const definition of LANE_DEFINITIONS){
        const lane=this.lanes[definition.id];
        const packetCount=packets.filter(packet=>packet.laneId===definition.id).length;
        lanes[definition.id]={
          id:lane.id,region:lane.region,label:lane.label,glyphs:[...lane.glyphs],
          status:lane.status,activity:Math.max(clamp01(lane.activity)*.72,this.packetActivity(definition.id,now)),
          lastEvent:lane.lastEvent,updatedAt:lane.updatedAt,packetCount
        };
      }
      return Object.freeze({
        version:1,
        lanes:Object.freeze(lanes),
        packets:Object.freeze(packets.map(packet=>({...packet}))),
        updatedAt:Date.now()
      });
    }

    publish(){const state=this.snapshot();this.onState(state);return state;}

    start(){
      if(this.started)return this.snapshot();
      this.started=true;
      this.syncFromBrain(this.runtime.snapshot());
      this.offBus=this.runtime.bus.onAny(envelope=>this.consume(envelope));
      return this.publish();
    }

    stop(){
      this.offBus?.();this.offBus=null;this.started=false;
      this.packets=[];for(const lane of Object.values(this.lanes)){lane.activity=0;lane.packetCount=0;}
      return this.publish();
    }
  }

  global.HumanALEDataSpine=Object.freeze({
    lanes:LANE_DEFINITIONS,
    create:options=>new HumanALEDataSpine(options),
    HumanALEDataSpine
  });
})(typeof window==='undefined'?globalThis:window);
