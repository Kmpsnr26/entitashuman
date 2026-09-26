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

const EVENT_REGIONS=Object.freeze({
  reason:'REASONER',plan:'PLANNER',memory:'MEMORY',context:'MEMORY',
  agent:'AGENT_MANAGER',program:'PROGRAM',verify:'FOLLOW_UP',bug:'BUG_HUNTER',
  error:'ERROR_MONITOR',sync:'SYNC',github:'GITHUB',copilot:'COPILOT',
  drive:'DRIVE',web:'WEB',work:'NARA_CORE'
});

function statusColor(status,group){
  return STATUS_COLORS[status]??GROUP_COLORS[group]??0x42ddff;
}

function regionForEvent(event=''){
  const prefix=String(event).split('.')[0];
  return EVENT_REGIONS[prefix]||null;
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
  return new THREE.Points(geometry,new THREE.PointsMaterial({
    color:0x6bbfd2,size:.045,transparent:true,opacity:.42,depthWrite:false
  }));
}

export class Neural3DScene{
  constructor(container,{onSelect=()=>{}}={}){
    if(!container)throw new Error('Container Neural Space 3D tidak ditemukan.');
    this.container=container;
    this.onSelect=onSelect;
    this.regions={};
    this.state=null;
    this.nodes=new Map();
    this.links=[];
    this.selected=null;
    this.pointer={down:false,moved:false,x:0,y:0,button:0};
    this.target=new THREE.Vector3(0,-.3,0);
    this.radius=14;
    this.theta=.45;
    this.phi=1.18;
    this.focusTarget=null;
    this.focusRadius=null;
    this.clock=new THREE.Clock();

    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x02070b);
    this.scene.fog=new THREE.FogExp2(0x02070b,.032);

    this.camera=new THREE.PerspectiveCamera(48,1,.08,120);
    this.camera.position.set(8,6,10);

    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.15;
    this.renderer.domElement.className='neural3d-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.world=new THREE.Group();
    this.scene.add(this.world);
    this.scene.add(makeStarField());

    this.scene.add(new THREE.HemisphereLight(0x7deeff,0x031017,1.3));
    const key=new THREE.PointLight(0x65eaff,12,26,2);
    key.position.set(0,4,4);
    this.scene.add(key);

    this.raycaster=new THREE.Raycaster();
    this.ndc=new THREE.Vector2();
    this.bindControls();
    this.resize();
    this.updateCamera(true);
    this.renderer.setAnimationLoop(()=>this.animate());
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
      this.radius=Math.max(4.5,Math.min(32,this.radius*(1+Math.sign(event.deltaY)*.09)));
      this.focusRadius=null;
    },{passive:false});
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

  clearWorld(){
    for(const link of this.links){
      link.geometry.dispose();
      link.material.dispose();
      this.world.remove(link);
    }
    this.links=[];
    for(const entry of this.nodes.values()){
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
      entry.shell.geometry.dispose();
      entry.shell.material.dispose();
      this.world.remove(entry.group);
    }
    this.nodes.clear();
  }

  setRegions(regions={}){
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

      this.world.add(group);
      this.nodes.set(region.id,{
        group,mesh,shell,region,baseY:position.y,phase:Math.random()*Math.PI*2,pulse:0
      });
    }

    const seen=new Set();
    for(const region of Object.values(this.regions)){
      const from=this.nodes.get(region.id);
      if(!from)continue;
      for(const targetId of region.connections||[]){
        const to=this.nodes.get(targetId);
        if(!to)continue;
        const key=[region.id,targetId].sort().join(':');
        if(seen.has(key))continue;
        seen.add(key);
        const mid=from.group.position.clone().lerp(to.group.position,.5);
        mid.z+=(Math.sin(seen.size*1.71)*.55);
        const curve=new THREE.CatmullRomCurve3([
          from.group.position.clone(),
          mid,
          to.group.position.clone()
        ]);
        const points=curve.getPoints(22);
        const geometry=new THREE.BufferGeometry().setFromPoints(points);
        const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({
          color:0x245e6d,transparent:true,opacity:.28
        }));
        line.userData={from:region.id,to:targetId};
        this.world.add(line);
        this.links.push(line);
      }
    }

    this.setState(this.state||{regions:{}});
  }

  setState(state={}){
    this.state=state||{};
    this.selected=this.state.selectedRegion||null;
    for(const [id,entry] of this.nodes){
      const live=this.state.regions?.[id]||{};
      const color=statusColor(live.status||entry.region.defaultStatus,entry.region.group);
      entry.mesh.material.color.setHex(color);
      entry.mesh.material.emissive.setHex(color);
      entry.shell.material.color.setHex(color);
      const selected=id===this.selected;
      entry.mesh.scale.setScalar(selected?1.16:1);
      entry.shell.scale.setScalar(selected?1.12:1);
      entry.shell.material.opacity=selected?.34:(id==='NARA_CORE'?.2:.1);
      entry.mesh.material.emissiveIntensity=selected?1.6:(id==='NARA_CORE'?1.65:.78);
    }
    for(const link of this.links){
      const active=link.userData.from===this.selected||link.userData.to===this.selected;
      link.material.opacity=active?.62:.28;
      link.material.color.setHex(active?0x4ce6ff:0x245e6d);
    }
  }

  handleEvent(envelope={}){
    const id=regionForEvent(envelope.event);
    if(id&&this.nodes.has(id))this.nodes.get(id).pulse=1;
    if(envelope.event==='brain.region.select'&&envelope.payload?.region)this.focusRegion(envelope.payload.region);
  }

  focusRegion(id){
    const entry=this.nodes.get(id);
    if(!entry)return;
    this.focusTarget=entry.group.position.clone();
    this.focusRadius=id==='NARA_CORE'?6.4:5.2;
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

  animate(){
    const t=this.clock.getElapsedTime();
    this.updateCamera();
    for(const [id,entry] of this.nodes){
      const core=id==='NARA_CORE';
      const breathing=1+(core?Math.sin(t*1.35)*.035:0);
      entry.group.position.y=entry.baseY+Math.sin(t*.58+entry.phase)*(core?.08:.12);
      entry.group.rotation.y+=core?.0015:.0007;
      entry.shell.rotation.x+=core?.0011:.0005;
      entry.shell.rotation.y-=core?.0014:.0006;
      if(entry.pulse>0)entry.pulse=Math.max(0,entry.pulse-.025);
      const pulseScale=1+entry.pulse*.22;
      entry.group.scale.setScalar(breathing*pulseScale);
      if(core){
        entry.mesh.material.emissiveIntensity=1.55+Math.sin(t*1.35)*.25+entry.pulse*1.5;
        entry.shell.material.opacity=.16+Math.sin(t*1.1)*.04+entry.pulse*.22;
      }else if(id!==this.selected){
        entry.mesh.material.emissiveIntensity=.7+entry.pulse*1.2;
      }
    }
    this.renderer.render(this.scene,this.camera);
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
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function createNeural3DScene(container,options){
  return new Neural3DScene(container,options);
}
