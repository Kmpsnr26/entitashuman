import * as THREE from '/vendor/three/three.module.js';

const STATUS_COLORS=Object.freeze({
  offline:0x17262e,idle:0x28434e,ready:0x44dca2,active:0x42ddff,
  listening:0x42ddff,seeing:0x42ddff,speaking:0x42ddff,thinking:0x26bfff,
  processing:0x2c8fff,connected:0x44dca2,disconnected:0x3e4d54,syncing:0x8b6dff,
  login_required:0xffc45b,error:0xff5d70,bug:0xff784d,complete:0x44dca2,paused:0xffcf68
});

const GROUP_COLORS=Object.freeze({
  core:0xb9f8ff,cognitive:0x39dfff,execution:0x5ea4ff,connection:0x8e78ff,
  workflow:0x62e7af,safety:0xffcf68
});

const ACTIVE_STATUSES=new Set([
  'active','listening','seeing','speaking','thinking','processing','syncing','error','bug'
]);

const EVENT_REGIONS=Object.freeze({
  reason:'REASONER',plan:'PLANNER',memory:'MEMORY',context:'MEMORY',
  agent:'AGENT_MANAGER',program:'PROGRAM',verify:'FOLLOW_UP',bug:'BUG_HUNTER',
  error:'ERROR_MONITOR',sync:'SYNC',github:'GITHUB',copilot:'COPILOT',
  drive:'DRIVE',web:'WEB',work:'NARA_CORE',terminal:'TERMINAL'
});

const EVENT_ROUTES=Object.freeze({
  'work.start':['NARA_CORE','PLANNER'],
  'work.complete':['FOLLOW_UP','NARA_CORE'],
  'work.failed':['PROGRAM','ERROR_MONITOR'],
  'reason.start':['NARA_CORE','REASONER'],
  'reason.complete':['REASONER','PLANNER'],
  'plan.start':['REASONER','PLANNER'],
  'plan.complete':['PLANNER','AGENT_MANAGER'],
  'memory.read':['MEMORY','REASONER'],
  'memory.write':['NARA_CORE','MEMORY'],
  'memory.complete':['MEMORY','NARA_CORE'],
  'context.prepare':['MEMORY','REASONER'],
  'context.approved':['SAFETY','MEMORY'],
  'context.used':['MEMORY','PLANNER'],
  'context.blocked':['SAFETY','MEMORY'],
  'agent.start':['PLANNER','AGENT_MANAGER'],
  'agent.complete':['AGENT_MANAGER','FOLLOW_UP'],
  'agent.failed':['AGENT_MANAGER','BUG_HUNTER'],
  'program.start':['AGENT_MANAGER','PROGRAM'],
  'program.complete':['PROGRAM','FOLLOW_UP'],
  'verify.start':['PROGRAM','FOLLOW_UP'],
  'verify.complete':['FOLLOW_UP','REPORTING'],
  'error.detected':['PROGRAM','ERROR_MONITOR'],
  'bug.detected':['ERROR_MONITOR','BUG_HUNTER'],
  'bug.fixed':['BUG_HUNTER','FOLLOW_UP'],
  'sync.start':['NARA_CORE','SYNC'],
  'sync.complete':['SYNC','NARA_CORE'],
  'terminal.open':['TOOLS','TERMINAL']
});

const LINK_IDLE=0x123845;
const LINK_LIVE=0x42ddff;
const LINK_SELECTED=0xa9f7ff;
const ROUTE_POOL_SIZE=24;
const QUALITY_ORDER=['low','balanced','high'];

function statusColor(status,group){
  return STATUS_COLORS[status]??GROUP_COLORS[group]??0x42ddff;
}

function regionForEvent(event=''){
  const prefix=String(event).split('.')[0];
  return EVENT_REGIONS[prefix]||null;
}

function routeColor(event=''){
  const value=String(event);
  if(value.includes('failed')||value.includes('error'))return 0xff5d70;
  if(value.includes('bug.detected'))return 0xff784d;
  if(value.includes('complete')||value.includes('fixed'))return 0x59efad;
  if(value.startsWith('sync.'))return 0x9b7dff;
  if(value.startsWith('memory.')||value.startsWith('context.'))return 0x64e9ff;
  return 0xb9f8ff;
}

function linkKey(a,b){
  return [String(a),String(b)].sort().join(':');
}

function stableUnit(text=''){
  let hash=2166136261;
  for(const char of String(text)){
    hash^=char.charCodeAt(0);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0)/4294967295;
}

function positiveModulo(value,mod=1){
  return ((value%mod)+mod)%mod;
}

function makeStarField(count=420){
  const values=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    const r=18+Math.random()*36;
    const theta=Math.random()*Math.PI*2;
    const phi=Math.acos(2*Math.random()-1);
    values[i*3]=r*Math.sin(phi)*Math.cos(theta);
    values[i*3+1]=r*Math.cos(phi);
    values[i*3+2]=r*Math.sin(phi)*Math.sin(theta);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(values,3));
  const material=new THREE.PointsMaterial({
    color:0x6bbfd2,size:.045,transparent:true,opacity:.42,depthWrite:false
  });
  return new THREE.Points(geometry,material);
}

function makeDustField(count=180){
  const values=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    const r=5+Math.random()*13;
    const theta=Math.random()*Math.PI*2;
    const phi=Math.acos(2*Math.random()-1);
    values[i*3]=r*Math.sin(phi)*Math.cos(theta);
    values[i*3+1]=r*Math.cos(phi);
    values[i*3+2]=r*Math.sin(phi)*Math.sin(theta);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(values,3));
  return new THREE.Points(geometry,new THREE.PointsMaterial({
    color:0x8aefff,size:.022,transparent:true,opacity:.18,depthWrite:false,
    blending:THREE.AdditiveBlending
  }));
}

function makeGlowTexture(){
  const canvas=document.createElement('canvas');
  canvas.width=128;
  canvas.height=128;
  const ctx=canvas.getContext('2d');
  const gradient=ctx.createRadialGradient(64,64,1,64,64,62);
  gradient.addColorStop(0,'rgba(255,255,255,1)');
  gradient.addColorStop(.16,'rgba(255,255,255,.55)');
  gradient.addColorStop(.46,'rgba(255,255,255,.15)');
  gradient.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=gradient;
  ctx.fillRect(0,0,128,128);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}

function organicCurve(from,to,key){
  const start=from.clone();
  const end=to.clone();
  const delta=end.clone().sub(start);
  const distance=Math.max(.001,delta.length());
  const direction=delta.clone().normalize();
  const up=Math.abs(direction.y)>.88?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0);
  const side=new THREE.Vector3().crossVectors(direction,up).normalize();
  const lift=new THREE.Vector3().crossVectors(side,direction).normalize();

  const seedA=stableUnit(key+'a')-.5;
  const seedB=stableUnit(key+'b')-.5;
  const seedC=stableUnit(key+'c')-.5;
  const amplitude=Math.min(1.15,Math.max(.22,distance*.13));

  const p1=start.clone().addScaledVector(delta,.22)
    .addScaledVector(side,amplitude*(.55+seedA*.6))
    .addScaledVector(lift,amplitude*(seedB*.55));
  const p2=start.clone().addScaledVector(delta,.50)
    .addScaledVector(side,amplitude*(seedB*.72))
    .addScaledVector(lift,amplitude*(.36+seedC*.7));
  const p3=start.clone().addScaledVector(delta,.78)
    .addScaledVector(side,-amplitude*(.46+seedC*.55))
    .addScaledVector(lift,amplitude*(seedA*.5));

  return new THREE.CatmullRomCurve3([start,p1,p2,p3,end],false,'centripetal',.5);
}

export class Neural3DScene{
  constructor(container,{onSelect=()=>{},onMetrics=()=>{}}={}){
    if(!container)throw new Error('Container Neural Space 3D tidak ditemukan.');
    this.container=container;
    this.onSelect=onSelect;
    this.onMetrics=onMetrics;
    this.regions={};
    this.regionSignature='';
    this.state=null;
    this.nodes=new Map();
    this.links=[];
    this.linkIndex=new Map();
    this.adjacency=new Map();
    this.routePackets=[];
    this.routeCount=0;
    this.lastRoute='—';
    this.selected=null;
    this.active=true;
    this.animationLoop=()=>this.animate();
    this.mode='explorer';
    this.qualityMode='auto';
    this.effectiveQuality='balanced';
    this.qualityScale=.8;
    this.pointer={down:false,moved:false,x:0,y:0,button:0};
    this.target=new THREE.Vector3(0,-.3,0);
    this.homeTarget=this.target.clone();
    this.radius=14;
    this.homeRadius=14;
    this.theta=.45;
    this.phi=1.18;
    this.focusTarget=null;
    this.focusRadius=null;
    this.timer=new THREE.Timer();
    this.timer.connect(document);
    this.motionScale=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?.35:1;
    this.frameWindow={elapsed:0,frames:0,fps:60,cooldown:0};

    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x02070b);
    this.scene.fog=new THREE.FogExp2(0x02070b,.032);

    this.camera=new THREE.PerspectiveCamera(48,1,.08,120);
    this.camera.position.set(8,6,10);

    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.8));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.15;
    this.renderer.domElement.className='neural3d-canvas';
    this.renderer.domElement.tabIndex=0;
    this.renderer.domElement.setAttribute('role','application');
    this.renderer.domElement.setAttribute('aria-label','NARA Neural Space 3D. Arrow keys rotate, plus/minus zoom, F focus, C core, E explorer, Escape reset.');
    this.container.appendChild(this.renderer.domElement);

    this.world=new THREE.Group();
    this.scene.add(this.world);
    this.stars=makeStarField();
    this.dust=makeDustField();
    this.glowTexture=makeGlowTexture();
    this.scene.add(this.stars,this.dust);

    this.scene.add(new THREE.HemisphereLight(0x7deeff,0x031017,1.3));
    const key=new THREE.PointLight(0x65eaff,12,26,2);
    key.position.set(0,4,4);
    this.scene.add(key);

    this.packetGeometry=new THREE.SphereGeometry(.075,10,8);
    this.packetHaloGeometry=new THREE.SphereGeometry(.145,10,8);
    this.routePacketGeometry=new THREE.SphereGeometry(.095,12,9);
    this.routeHaloGeometry=new THREE.SphereGeometry(.19,12,9);
    this.initRoutePool();

    this.raycaster=new THREE.Raycaster();
    this.ndc=new THREE.Vector2();
    this.bindControls();
    this.setQuality('auto');
    this.resize();
    this.updateCamera(true);
    this.renderer.setAnimationLoop(this.animationLoop);
  }

  initRoutePool(){
    for(let i=0;i<ROUTE_POOL_SIZE;i++){
      const group=new THREE.Group();
      const packet=new THREE.Mesh(this.routePacketGeometry,new THREE.MeshBasicMaterial({
        color:0xb9f8ff,transparent:true,opacity:0,depthWrite:false,
        blending:THREE.AdditiveBlending
      }));
      const halo=new THREE.Mesh(this.routeHaloGeometry,new THREE.MeshBasicMaterial({
        color:0x64e9ff,transparent:true,opacity:0,depthWrite:false,
        blending:THREE.AdditiveBlending
      }));
      group.add(halo,packet);
      group.visible=false;
      this.world.add(group);
      this.routePackets.push({
        group,packet,halo,active:false,path:[],segment:0,progress:0,
        speed:1,event:'',startedAt:0
      });
    }
  }

  bindControls(){
    const el=this.renderer.domElement;
    el.addEventListener('contextmenu',event=>event.preventDefault());
    el.addEventListener('pointerdown',event=>{
      this.pointer.down=true;
      this.pointer.moved=false;
      this.pointer.x=event.clientX;
      this.pointer.y=event.clientY;
      this.pointer.button=event.button;
      el.focus({preventScroll:true});
      el.setPointerCapture?.(event.pointerId);
    });
    el.addEventListener('pointermove',event=>{
      if(!this.pointer.down)return;
      const dx=event.clientX-this.pointer.x;
      const dy=event.clientY-this.pointer.y;
      if(Math.abs(dx)+Math.abs(dy)>3)this.pointer.moved=true;
      this.pointer.x=event.clientX;this.pointer.y=event.clientY;
      if(this.pointer.button===2||this.pointer.button===1){
        const panScale=this.radius*.0016;
        const right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrix,0).multiplyScalar(-dx*panScale);
        const up=new THREE.Vector3().setFromMatrixColumn(this.camera.matrix,1).multiplyScalar(dy*panScale);
        this.target.add(right).add(up);
      }else{
        this.theta-=dx*.006;
        this.phi=Math.max(.18,Math.min(Math.PI-.18,this.phi+dy*.006));
      }
    });
    el.addEventListener('pointerup',event=>{
      const wasClick=!this.pointer.moved&&this.pointer.button===0;
      this.pointer.down=false;
      el.releasePointerCapture?.(event.pointerId);
      if(wasClick)this.pick(event);
    });
    el.addEventListener('dblclick',event=>{
      const id=this.pick(event,false);
      if(id)this.focusRegion(id);
    });
    el.addEventListener('wheel',event=>{
      event.preventDefault();
      this.radius=Math.max(4.2,Math.min(34,this.radius*(1+Math.sign(event.deltaY)*.09)));
      this.focusRadius=null;
    },{passive:false});
    el.addEventListener('keydown',event=>this.handleKey(event));
  }

  handleKey(event){
    const key=event.key.toLowerCase();
    let handled=true;
    if(key==='arrowleft')this.theta-=.12;
    else if(key==='arrowright')this.theta+=.12;
    else if(key==='arrowup')this.phi=Math.max(.2,this.phi-.09);
    else if(key==='arrowdown')this.phi=Math.min(Math.PI-.2,this.phi+.09);
    else if(key==='+'||key==='=')this.radius=Math.max(4.2,this.radius*.9);
    else if(key==='-'||key==='_')this.radius=Math.min(34,this.radius*1.1);
    else if(key==='f')this.setMode('focus');
    else if(key==='c')this.setMode('core');
    else if(key==='e')this.setMode('explorer');
    else if(key==='escape')this.resetView();
    else handled=false;
    if(handled)event.preventDefault();
  }

  setActive(active){
    const next=Boolean(active);
    if(this.active===next)return;
    this.active=next;
    if(next){
      this.timer.reset();
      this.renderer.setAnimationLoop(this.animationLoop);
    }else{
      this.renderer.setAnimationLoop(null);
    }
    this.emitMetrics();
  }

  setMode(mode){
    const next=['explorer','focus','core'].includes(mode)?mode:'explorer';
    this.mode=next;
    if(next==='core')this.focusRegion('NARA_CORE','core');
    else if(next==='focus')this.focusRegion(this.selected||'NARA_CORE','focus');
    else this.resetView(false);
    this.emitMetrics();
  }

  resetView(updateMode=true){
    if(updateMode)this.mode='explorer';
    this.focusTarget=this.homeTarget.clone();
    this.focusRadius=this.homeRadius;
    this.theta=.45;
    this.phi=1.18;
    this.emitMetrics();
  }

  setQuality(mode='auto'){
    this.qualityMode=['auto','high','balanced','low'].includes(mode)?mode:'auto';
    let effective=this.qualityMode;
    if(effective==='auto'){
      const cores=navigator.hardwareConcurrency||4;
      effective=cores>=8&&window.devicePixelRatio<=2?'high':cores>=4?'balanced':'low';
    }
    this.applyQuality(effective);
  }

  applyQuality(level){
    this.effectiveQuality=QUALITY_ORDER.includes(level)?level:'balanced';
    const config={
      high:{pixel:1.8,scale:1,fog:.030,dust:true},
      balanced:{pixel:1.35,scale:.8,fog:.033,dust:true},
      low:{pixel:1,scale:.55,fog:.037,dust:false}
    }[this.effectiveQuality];
    this.qualityScale=config.scale;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,config.pixel));
    this.scene.fog.density=config.fog;
    if(this.dust)this.dust.visible=config.dust;
    this.resize();
    this.emitMetrics();
  }

  emitMetrics(){
    this.onMetrics(this.getStats());
  }

  getStats(){
    return {
      nodes:this.nodes.size,
      links:this.links.length,
      activeLinks:this.links.filter(link=>link.active).length,
      selectedLinks:this.links.filter(link=>link.selected).length,
      activeRoutes:this.routePackets.filter(packet=>packet.active).length,
      routeCount:this.routeCount,
      lastRoute:this.lastRoute,
      fps:Math.round(this.frameWindow.fps||0),
      mode:this.mode,
      quality:this.qualityMode==='auto'?'auto/'+this.effectiveQuality:this.effectiveQuality
    };
  }

  getRegionDetails(id=this.selected||'NARA_CORE'){
    const region=this.regions[id];
    if(!region)return null;
    const neighbors=(this.adjacency.get(id)||[]).map(link=>link.from===id?link.to:link.from);
    return {
      id:region.id,
      label:region.label,
      group:region.group,
      status:this.state?.regions?.[id]?.status||region.defaultStatus,
      neighbors:[...new Set(neighbors)]
    };
  }

  updateCamera(force=false){
    if(this.focusTarget){
      this.target.lerp(this.focusTarget,force?1:.085);
      if(this.target.distanceTo(this.focusTarget)<.02)this.focusTarget=null;
    }
    if(this.focusRadius!==null){
      this.radius+=(this.focusRadius-this.radius)*(force?1:.09);
      if(Math.abs(this.focusRadius-this.radius)<.02)this.focusRadius=null;
    }
    const sinPhi=Math.sin(this.phi);
    this.camera.position.set(
      this.target.x+this.radius*sinPhi*Math.sin(this.theta),
      this.target.y+this.radius*Math.cos(this.phi),
      this.target.z+this.radius*sinPhi*Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  }

  disposeLink(link){
    for(const mesh of [link.sheath,link.glow,link.core]){
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    link.packet.material.dispose();
    link.halo.material.dispose();
    this.world.remove(link.group);
  }

  clearWorld(){
    for(const route of this.routePackets){
      route.active=false;
      route.group.visible=false;
      route.path=[];
    }
    for(const link of this.links)this.disposeLink(link);
    this.links=[];
    this.linkIndex.clear();
    this.adjacency.clear();

    for(const entry of this.nodes.values()){
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
      entry.shell.geometry.dispose();
      entry.shell.material.dispose();
      entry.halo?.material.dispose();
      this.world.remove(entry.group);
    }
    this.nodes.clear();
  }

  createLink(fromId,toId,index){
    const from=this.nodes.get(fromId);
    const to=this.nodes.get(toId);
    if(!from||!to)return null;

    const key=linkKey(fromId,toId);
    const curve=organicCurve(from.group.position,to.group.position,key);
    const distance=from.group.position.distanceTo(to.group.position);
    const radius=Math.min(.075,Math.max(.038,distance*.008));
    const tubularSegments=Math.max(22,Math.min(42,Math.round(distance*4.5)));

    const group=new THREE.Group();
    group.userData={from:fromId,to:toId,key};

    const sheath=new THREE.Mesh(
      new THREE.TubeGeometry(curve,tubularSegments,radius,6,false),
      new THREE.MeshBasicMaterial({
        color:LINK_IDLE,transparent:true,opacity:.13,depthWrite:false
      })
    );

    const glow=new THREE.Mesh(
      new THREE.TubeGeometry(curve,tubularSegments,radius*1.9,5,false),
      new THREE.MeshBasicMaterial({
        color:LINK_LIVE,transparent:true,opacity:.018,depthWrite:false,
        blending:THREE.AdditiveBlending
      })
    );

    const core=new THREE.Mesh(
      new THREE.TubeGeometry(curve,tubularSegments,radius*.32,5,false),
      new THREE.MeshBasicMaterial({
        color:LINK_LIVE,transparent:true,opacity:.08,depthWrite:false,
        blending:THREE.AdditiveBlending
      })
    );

    const packet=new THREE.Mesh(
      this.packetGeometry,
      new THREE.MeshBasicMaterial({
        color:LINK_SELECTED,transparent:true,opacity:0,depthWrite:false,
        blending:THREE.AdditiveBlending
      })
    );

    const halo=new THREE.Mesh(
      this.packetHaloGeometry,
      new THREE.MeshBasicMaterial({
        color:LINK_LIVE,transparent:true,opacity:0,depthWrite:false,
        blending:THREE.AdditiveBlending
      })
    );

    group.add(glow,sheath,core,halo,packet);
    this.world.add(group);

    const entry={
      key,from:fromId,to:toId,curve,group,sheath,glow,core,packet,halo,
      phase:stableUnit(key+'phase'),
      speed:.035+stableUnit(key+'speed')*.035,
      flowDirection:index%2?1:-1,
      intensity:.06,targetIntensity:.06,pulse:0,routePulse:0,
      selected:false,active:false,color:new THREE.Color(LINK_LIVE)
    };

    this.links.push(entry);
    this.linkIndex.set(key,entry);
    for(const regionId of [fromId,toId]){
      if(!this.adjacency.has(regionId))this.adjacency.set(regionId,[]);
      this.adjacency.get(regionId).push(entry);
    }
    return entry;
  }

  setRegions(regions={}){
    const signature=JSON.stringify(Object.values(regions||{}).map(region=>[
      region.id,region.position,region.connections
    ]));
    if(signature===this.regionSignature&&this.nodes.size)return;
    this.regionSignature=signature;
    this.clearWorld();
    this.regions=regions||{};

    for(const region of Object.values(this.regions)){
      const p=region.position||{x:0,y:0,z:0};
      const position=new THREE.Vector3(p.x*12,p.y*12,p.z*12);
      const group=new THREE.Group();
      group.position.copy(position);
      group.userData.regionId=region.id;

      const isCore=region.id==='NARA_CORE';
      const geometry=isCore
        ?new THREE.SphereGeometry(1.18,40,30)
        :new THREE.IcosahedronGeometry(region.group==='connection'?.46:.58,2);
      const base=statusColor(region.defaultStatus,region.group);
      const material=new THREE.MeshStandardMaterial({
        color:base,emissive:base,emissiveIntensity:isCore?1.65:.78,
        roughness:.28,metalness:.16,transparent:true,opacity:isCore?.94:.86
      });
      const mesh=new THREE.Mesh(geometry,material);
      mesh.userData.regionId=region.id;
      group.add(mesh);

      const shellGeometry=isCore
        ?new THREE.SphereGeometry(1.52,26,20)
        :new THREE.IcosahedronGeometry(region.group==='connection'?.64:.78,1);
      const shell=new THREE.Mesh(shellGeometry,new THREE.MeshBasicMaterial({
        color:base,wireframe:true,transparent:true,opacity:isCore?.2:.1,depthWrite:false
      }));
      shell.userData.regionId=region.id;
      group.add(shell);

      const halo=new THREE.Sprite(new THREE.SpriteMaterial({
        map:this.glowTexture,color:base,transparent:true,
        opacity:isCore?.22:.08,depthWrite:false,
        blending:THREE.AdditiveBlending
      }));
      const haloSize=isCore?4.6:2.2;
      halo.scale.set(haloSize,haloSize,1);
      group.add(halo);

      this.world.add(group);
      this.nodes.set(region.id,{
        group,mesh,shell,halo,region,baseY:position.y,
        phase:stableUnit(region.id+'node')*Math.PI*2,pulse:0
      });
    }

    const seen=new Set();
    let linkIndex=0;
    for(const region of Object.values(this.regions)){
      for(const targetId of region.connections||[]){
        if(!this.nodes.has(targetId))continue;
        const key=linkKey(region.id,targetId);
        if(seen.has(key))continue;
        seen.add(key);
        this.createLink(region.id,targetId,linkIndex++);
      }
    }

    this.setState(this.state||{regions:{}});
  }

  setState(state={}){
    this.state=state||{};
    this.selected=this.state.selectedRegion||null;
    const selectedNeighbors=new Set();
    for(const link of this.adjacency.get(this.selected)||[]){
      selectedNeighbors.add(link.from===this.selected?link.to:link.from);
    }

    for(const [id,entry] of this.nodes){
      const live=this.state.regions?.[id]||{};
      const color=statusColor(live.status||entry.region.defaultStatus,entry.region.group);
      entry.mesh.material.color.setHex(color);
      entry.mesh.material.emissive.setHex(color);
      entry.shell.material.color.setHex(color);
      entry.halo.material.color.setHex(color);

      const selected=id===this.selected;
      const neighbor=selectedNeighbors.has(id);
      entry.mesh.scale.setScalar(selected?1.16:neighbor?1.045:1);
      entry.shell.scale.setScalar(selected?1.12:neighbor?1.04:1);
      entry.shell.material.opacity=selected?.34:(neighbor?.18:(id==='NARA_CORE'?.2:.1));
      entry.mesh.material.emissiveIntensity=selected?1.6:(neighbor?1.05:(id==='NARA_CORE'?1.65:.78));
      entry.halo.material.opacity=(selected?.24:neighbor?.14:(id==='NARA_CORE'?.2:.065))*this.qualityScale;
    }

    for(const link of this.links){
      const fromState=this.state.regions?.[link.from]||{};
      const toState=this.state.regions?.[link.to]||{};
      link.selected=Boolean(this.selected&&(link.from===this.selected||link.to===this.selected));
      link.active=ACTIVE_STATUSES.has(fromState.status)||ACTIVE_STATUSES.has(toState.status);
      link.targetIntensity=link.selected?1:link.active?.7:.075;

      const selectedPeer=link.from===this.selected?link.to:link.to===this.selected?link.from:null;
      const activeRegion=ACTIVE_STATUSES.has(toState.status)?link.to:ACTIVE_STATUSES.has(fromState.status)?link.from:selectedPeer;
      const activeDef=activeRegion?this.regions[activeRegion]:null;
      const activeState=activeRegion?this.state.regions?.[activeRegion]:null;
      const color=link.selected
        ?LINK_SELECTED
        :activeDef?statusColor(activeState?.status||activeDef.defaultStatus,activeDef.group):LINK_LIVE;
      link.color.setHex(color);
      link.sheath.material.color.setHex(link.selected?0x357d8d:LINK_IDLE);
      link.core.material.color.copy(link.color);
      link.glow.material.color.copy(link.color);
      link.packet.material.color.copy(link.color);
      link.halo.material.color.copy(link.color);
    }
  }

  energizeRegion(id,amount=1){
    const entry=this.nodes.get(id);
    if(entry)entry.pulse=Math.max(entry.pulse,amount);
    for(const link of this.adjacency.get(id)||[]){
      link.pulse=Math.max(link.pulse,amount);
      link.flowDirection=link.to===id?1:-1;
    }
  }

  shortestPath(source,target){
    if(!this.nodes.has(source)||!this.nodes.has(target))return [];
    if(source===target)return [source];
    const queue=[source];
    const previous=new Map([[source,null]]);
    while(queue.length){
      const current=queue.shift();
      for(const link of this.adjacency.get(current)||[]){
        const next=link.from===current?link.to:link.from;
        if(previous.has(next))continue;
        previous.set(next,current);
        if(next===target){
          const path=[target];
          let cursor=current;
          while(cursor){
            path.push(cursor);
            cursor=previous.get(cursor);
          }
          return path.reverse();
        }
        queue.push(next);
      }
    }
    return [];
  }

  routeSegments(nodes){
    const result=[];
    for(let i=0;i<nodes.length-1;i++){
      const a=nodes[i],b=nodes[i+1];
      const link=this.linkIndex.get(linkKey(a,b));
      if(!link)continue;
      result.push({link,forward:link.from===a,from:a,to:b});
    }
    return result;
  }

  acquireRoutePacket(){
    const idle=this.routePackets.find(packet=>!packet.active);
    if(idle)return idle;
    return [...this.routePackets].sort((a,b)=>a.startedAt-b.startedAt)[0];
  }

  spawnRoute(envelope={}){
    const direct=EVENT_ROUTES[envelope.event];
    const fallback=regionForEvent(envelope.event);
    const source=direct?.[0]||(fallback&&fallback!=='NARA_CORE'?'NARA_CORE':null);
    const target=direct?.[1]||fallback;
    if(!source||!target||source===target)return false;

    const nodes=this.shortestPath(source,target);
    const path=this.routeSegments(nodes);
    if(!path.length)return false;

    const route=this.acquireRoutePacket();
    const color=routeColor(envelope.event);
    route.active=true;
    route.group.visible=true;
    route.path=path;
    route.segment=0;
    route.progress=0;
    route.speed=.72+Math.min(1.2,path.length*.08);
    route.event=envelope.event;
    route.startedAt=performance.now();
    route.packet.material.color.setHex(color);
    route.halo.material.color.setHex(color);
    route.packet.material.opacity=.95;
    route.halo.material.opacity=.32;
    route.group.position.copy(path[0].link.curve.getPointAt(path[0].forward?0:1));

    for(const segment of path){
      segment.link.routePulse=Math.max(segment.link.routePulse,1);
      segment.link.flowDirection=segment.forward?1:-1;
    }

    this.routeCount+=1;
    this.lastRoute=source+' → '+target+' · '+envelope.event;
    this.energizeRegion(target,.9);
    this.emitMetrics();
    return true;
  }

  handleEvent(envelope={}){
    const id=regionForEvent(envelope.event);
    if(id)this.energizeRegion(id,1);
    this.spawnRoute(envelope);
    if(envelope.event==='brain.region.select'&&envelope.payload?.region){
      this.focusRegion(envelope.payload.region);
      this.energizeRegion(envelope.payload.region,.55);
    }
  }

  focusRegion(id,mode='focus'){
    const entry=this.nodes.get(id);
    if(!entry)return;
    this.mode=mode;
    this.focusTarget=entry.group.position.clone();
    this.focusRadius=id==='NARA_CORE'?5.9:4.8;
    this.emitMetrics();
  }

  pick(event,dispatch=true){
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.ndc.x=((event.clientX-rect.left)/rect.width)*2-1;
    this.ndc.y=-((event.clientY-rect.top)/rect.height)*2+1;
    this.raycaster.setFromCamera(this.ndc,this.camera);
    const hits=this.raycaster.intersectObjects([...this.nodes.values()].flatMap(entry=>[entry.mesh,entry.shell]),false);
    const id=hits[0]?.object?.userData?.regionId||null;
    if(id&&dispatch)this.onSelect(id);
    return id;
  }

  animateLinks(t){
    for(const link of this.links){
      link.intensity+=(link.targetIntensity-link.intensity)*.075;
      if(link.pulse>0)link.pulse=Math.max(0,link.pulse-.014*this.motionScale);
      if(link.routePulse>0)link.routePulse=Math.max(0,link.routePulse-.022*this.motionScale);
      const energy=Math.min(1.6,link.intensity+link.pulse*.72+link.routePulse*1.05);
      const breathing=.5+.5*Math.sin(t*(1.1+link.phase*.55)+link.phase*Math.PI*2);

      link.sheath.material.opacity=(.07+energy*.16+breathing*.018)*this.qualityScale;
      link.core.material.opacity=(.025+energy*.48)*this.qualityScale;
      link.glow.material.opacity=(.008+energy*.115)*this.qualityScale;

      const visible=energy>.16||link.selected||link.active;
      link.packet.visible=visible;
      link.halo.visible=visible;
      if(!visible)continue;

      const speed=link.speed*(1+energy*2.3)*this.motionScale;
      const raw=link.phase+t*speed*link.flowDirection;
      const u=positiveModulo(raw,1);
      const point=link.curve.getPointAt(u);
      link.packet.position.copy(point);
      link.halo.position.copy(point);

      const flicker=.86+Math.sin(t*5.4+link.phase*8)*.14;
      const packetOpacity=Math.min(1,.2+energy*.72)*flicker*this.qualityScale;
      link.packet.material.opacity=packetOpacity;
      link.halo.material.opacity=Math.min(.42,.04+energy*.21)*flicker*this.qualityScale;
      const scale=.72+Math.min(1,energy)*.7;
      link.packet.scale.setScalar(scale);
      link.halo.scale.setScalar(.9+energy*.72);
    }
  }

  animateRoutes(delta,t){
    for(const route of this.routePackets){
      if(!route.active)continue;
      const segment=route.path[route.segment];
      if(!segment){
        route.active=false;
        route.group.visible=false;
        continue;
      }

      route.progress+=delta*route.speed*this.motionScale;
      while(route.progress>=1&&route.active){
        route.progress-=1;
        route.segment+=1;
        if(route.segment>=route.path.length){
          route.active=false;
          route.group.visible=false;
          this.energizeRegion(segment.to,.65);
          break;
        }
      }
      if(!route.active)continue;

      const current=route.path[route.segment];
      const u=current.forward?route.progress:1-route.progress;
      route.group.position.copy(current.link.curve.getPointAt(Math.max(0,Math.min(1,u))));
      current.link.routePulse=Math.max(current.link.routePulse,.75);
      current.link.flowDirection=current.forward?1:-1;

      const flicker=.86+.14*Math.sin(t*8+route.startedAt*.001);
      route.packet.material.opacity=.9*flicker;
      route.halo.material.opacity=.3*flicker*this.qualityScale;
      route.group.scale.setScalar(.82+.28*flicker);
    }
  }

  samplePerformance(delta){
    const state=this.frameWindow;
    state.elapsed+=delta;
    state.frames+=1;
    state.cooldown=Math.max(0,state.cooldown-delta);
    if(state.elapsed<1.25)return;
    state.fps=state.frames/state.elapsed;
    state.elapsed=0;
    state.frames=0;

    if(this.qualityMode==='auto'&&state.cooldown<=0){
      const index=QUALITY_ORDER.indexOf(this.effectiveQuality);
      if(state.fps<38&&index>0){
        this.applyQuality(QUALITY_ORDER[index-1]);
        state.cooldown=5;
      }else if(state.fps>57&&index<QUALITY_ORDER.length-1){
        this.applyQuality(QUALITY_ORDER[index+1]);
        state.cooldown=8;
      }
    }
    this.emitMetrics();
  }

  animate(){
    if(!this.active)return;
    this.timer.update();
    const delta=Math.min(.05,this.timer.getDelta());
    const t=this.timer.getElapsed();
    this.updateCamera();

    for(const [id,entry] of this.nodes){
      const core=id==='NARA_CORE';
      const motion=this.motionScale;
      const breathing=1+(core?Math.sin(t*1.35)*.035*motion:0);
      entry.group.position.y=entry.baseY+Math.sin(t*.58+entry.phase)*(core?.045:.065)*motion;
      entry.group.rotation.y+=core?.0015*motion:.0007*motion;
      entry.shell.rotation.x+=core?.0011*motion:.0005*motion;
      entry.shell.rotation.y-=core?.0014*motion:.0006*motion;
      if(entry.pulse>0)entry.pulse=Math.max(0,entry.pulse-.025*motion);
      const pulseScale=1+entry.pulse*.22;
      entry.group.scale.setScalar(breathing*pulseScale);
      if(core){
        entry.mesh.material.emissiveIntensity=1.55+Math.sin(t*1.35)*.25*motion+entry.pulse*1.5;
        entry.shell.material.opacity=.16+Math.sin(t*1.1)*.04*motion+entry.pulse*.22;
      }else if(id!==this.selected){
        entry.mesh.material.emissiveIntensity=.7+entry.pulse*1.2;
      }

      const haloBase=core?.2:.065;
      entry.halo.material.opacity=(haloBase+entry.pulse*.18+(id===this.selected?.12:0))*this.qualityScale;
      const haloScale=(core?4.6:2.2)*(1+entry.pulse*.16+(core?Math.sin(t*1.2)*.025:0));
      entry.halo.scale.set(haloScale,haloScale,1);
    }

    this.animateLinks(t);
    this.animateRoutes(delta,t);
    this.stars.rotation.y=t*.0025*this.motionScale;
    this.dust.rotation.x=t*.004*this.motionScale;
    this.dust.rotation.y=-t*.003*this.motionScale;
    const activeRoutes=this.routePackets.filter(packet=>packet.active).length;
    const targetExposure=1.08+Math.min(.18,activeRoutes*.012);
    this.renderer.toneMappingExposure+=(targetExposure-this.renderer.toneMappingExposure)*.04;
    this.renderer.render(this.scene,this.camera);
    this.samplePerformance(delta);
  }

  resize(){
    const width=Math.max(1,this.container.clientWidth);
    const height=Math.max(1,this.container.clientHeight);
    this.camera.aspect=width/height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width,height,false);
  }

  destroy(){
    this.renderer.setAnimationLoop(null);
    this.clearWorld();
    for(const route of this.routePackets){
      route.packet.material.dispose();
      route.halo.material.dispose();
      this.world.remove(route.group);
    }
    this.routePackets=[];
    this.packetGeometry.dispose();
    this.packetHaloGeometry.dispose();
    this.routePacketGeometry.dispose();
    this.routeHaloGeometry.dispose();
    this.glowTexture.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.dust.geometry.dispose();
    this.dust.material.dispose();
    this.timer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function createNeural3DScene(container,options){
  return new Neural3DScene(container,options);
}
