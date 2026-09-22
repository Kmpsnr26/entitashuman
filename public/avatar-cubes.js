// Procedural Dudidam Avatar 2 — front-facing voxel/cube entity.
// No PNG/image asset is used for this variant.
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const hash=(x,y,s=0)=>{
  const n=Math.sin(x*12.9898+y*78.233+s*37.719)*43758.5453;
  return n-Math.floor(n);
};

export class CubeAvatarLayer{
 constructor(){
  this.enabled=false;
  this.face=[];
  this.floaters=[];
  this.buildFace();
  this.buildFloaters();
 }

 setEnabled(value){this.enabled=Boolean(value);}

 buildFace(){
  this.face.length=0;

  // Stable voxel mask: recognisable head, but still abstract.
  for(let gy=-15;gy<=17;gy++){
   for(let gx=-11;gx<=11;gx++){
    const nx=gx/11;
    const ny=(gy+1)/17;
    const taper=1-Math.max(0,ny)*.12;
    const inside=(nx*nx)/(taper*taper)+(ny*ny)<1;

    if(!inside)continue;

    // Hollow eye sockets. No eyeball voxels are ever generated here.
    const leftEye=((nx+.34)/.23)**2+((ny+.18)/.105)**2<1;
    const rightEye=((nx-.34)/.23)**2+((ny+.18)/.105)**2<1;
    if(leftEye||rightEye)continue;

    // Keep a small mouth gap so lips read clearly.
    const mouthGap=Math.abs(nx)<.34&&Math.abs(ny-.43)<.055;
    if(mouthGap)continue;

    // Make edges slightly porous/abstract.
    const edge=Math.sqrt(nx*nx+ny*ny);
    const keep=hash(gx,gy,4);
    if(edge>.77&&keep<.28)continue;
    if(edge<.77&&keep<.08)continue;

    const zone=
      ny<-.34?"forehead":
      ny<.08?"upper":
      ny<.34?"cheek":
      "jaw";

    this.face.push({
      nx,ny,zone,
      seed:hash(gx,gy,1),
      phase:hash(gx,gy,2)*TAU,
      depth:hash(gx,gy,3)
    });
   }
  }
 }

 buildFloaters(){
  this.floaters=Array.from({length:72},(_,i)=>({
   seed:hash(i,3,9),
   phase:hash(i,7,11)*TAU,
   speed:.42+hash(i,5,13)*.8,
   side:i%2?-1:1,
   band:i%4
  }));
 }

 palette(seed,alpha){
  if(seed>.83)return {
   fill:`rgba(238,249,255,${alpha})`,
   edge:`rgba(255,255,255,${alpha*.88})`,
   shadow:`rgba(120,202,255,${alpha*.72})`
  };
  if(seed>.48)return {
   fill:`rgba(86,193,255,${alpha})`,
   edge:`rgba(201,239,255,${alpha*.82})`,
   shadow:`rgba(42,151,255,${alpha*.72})`
  };
  return {
   fill:`rgba(132,149,168,${alpha})`,
   edge:`rgba(214,225,235,${alpha*.7})`,
   shadow:`rgba(70,107,148,${alpha*.58})`
  };
 }

 drawCube(ctx,x,y,size,seed,alpha,lowCost=false,depth=0){
  if(alpha<=.01||size<=.4)return;

  const p=this.palette(seed,alpha);
  const z=.22+.28*depth;
  const off=Math.max(.6,size*z);

  ctx.save();
  ctx.shadowColor=p.shadow;
  ctx.shadowBlur=lowCost?size*.65:size*1.7;

  // Front face.
  ctx.fillStyle=p.fill;
  ctx.fillRect(x-size/2,y-size/2,size,size);

  // Tiny pseudo-3D top/right planes.
  if(!lowCost&&size>3){
   ctx.beginPath();
   ctx.moveTo(x-size/2,y-size/2);
   ctx.lineTo(x-size/2+off,y-size/2-off);
   ctx.lineTo(x+size/2+off,y-size/2-off);
   ctx.lineTo(x+size/2,y-size/2);
   ctx.closePath();
   ctx.fillStyle=`rgba(220,246,255,${alpha*.2})`;
   ctx.fill();

   ctx.beginPath();
   ctx.moveTo(x+size/2,y-size/2);
   ctx.lineTo(x+size/2+off,y-size/2-off);
   ctx.lineTo(x+size/2+off,y+size/2-off);
   ctx.lineTo(x+size/2,y+size/2);
   ctx.closePath();
   ctx.fillStyle=`rgba(40,111,171,${alpha*.24})`;
   ctx.fill();
  }

  ctx.strokeStyle=p.edge;
  ctx.lineWidth=Math.max(.45,size*.07);
  ctx.strokeRect(x-size/2,y-size/2,size,size);
  ctx.restore();
 }

 drawSocket(ctx,cx,cy,rx,ry,blink,side,lowCost){
  const close=clamp(blink,0,1);
  const vertical=Math.max(1.1,ry*(1-close*.92));

  ctx.save();
  ctx.shadowColor="rgba(20,112,180,.42)";
  ctx.shadowBlur=lowCost?4:11;
  ctx.fillStyle="rgba(0,5,11,.92)";
  ctx.beginPath();
  ctx.ellipse(cx,cy,rx,vertical,0,0,TAU);
  ctx.fill();

  ctx.strokeStyle=`rgba(118,209,255,${.35+.28*(1-close)})`;
  ctx.lineWidth=Math.max(1,rx*.055);
  ctx.beginPath();
  ctx.ellipse(cx,cy,rx,vertical,0,Math.PI,TAU);
  ctx.stroke();

  // Voxel eyelid shutters; still no pupil/eyeball.
  const lidY=cy-vertical*.72;
  for(let i=-2;i<=2;i++){
   const u=i/2;
   const x=cx+u*rx*.72;
   const curve=Math.sqrt(Math.max(0,1-u*u));
   const y=lidY-curve*vertical*.18+close*ry*.62;
   this.drawCube(ctx,x,y,Math.max(2.1,rx*.13),.75+side*.06,.48+.25*close,lowCost,.5);
  }
  ctx.restore();
 }

 drawEar(ctx,side,cx,cy,fw,fh,time,energy,lowCost){
  const x=cx+side*fw*.58;
  const y=cy+fh*.04;
  const cube=Math.max(2.2,fw*.034);
  const sway=Math.sin(time*.0017+side)*fh*.006;

  // Outer voxel ear silhouette.
  for(let i=0;i<7;i++){
   const a=-Math.PI*.62+i/6*Math.PI*1.24;
   const ex=x+side*Math.cos(a)*fw*.055;
   const ey=y+Math.sin(a)*fh*.105+sway;
   this.drawCube(ctx,ex,ey,cube*(.86+.15*(i%2)),.56+i*.03,.46+energy*.18,lowCost,.35);
  }

  // Inner ear mark.
  this.drawCube(ctx,x+side*fw*.018,y+sway,cube*.8,.92,.36+energy*.24,lowCost,.65);
 }

 drawMouth(ctx,cx,cy,fw,fh,speech,viseme,emotion,time,lowCost){
  const energy=clamp(speech,0,1);
  const opening=clamp(viseme*energy,0,1);
  const happy=emotion==="happy";
  const sad=emotion==="sad";
  const angry=emotion==="angry";
  const width=fw*(.255+.018*opening);
  const baseY=cy+fh*.255;
  const cube=Math.max(2.15,fw*.027);

  // Neutral closed lips at rest; curve reacts to emotion.
  for(let i=0;i<11;i++){
   if(lowCost&&i%2)continue;
   const u=i/10;
   const x=cx+(u-.5)*width*2;
   const arch=Math.sin(u*Math.PI);
   const mood=happy?-fh*.025*arch:sad?fh*.018*arch:angry?fh*.006*Math.sin(u*TAU):0;
   const wobble=energy*Math.sin(time*.01+i)*fh*.0025;
   const upper=baseY+mood-opening*fh*.017*arch+wobble;
   const lower=baseY+mood+opening*fh*.031*arch+wobble;
   this.drawCube(ctx,x,upper,cube,.86,.64+energy*.2,lowCost,.42);
   if(opening>.08)this.drawCube(ctx,x,lower,cube*.9,.64,.5+energy*.24,lowCost,.5);
  }

  if(opening>.1){
   ctx.save();
   ctx.fillStyle=`rgba(0,4,9,${.52+.28*opening})`;
   ctx.beginPath();
   ctx.ellipse(cx,baseY+fh*.008,width*.72,fh*(.008+.026*opening),0,0,TAU);
   ctx.fill();
   ctx.restore();
  }
 }

 draw(ctx,{
  size,cx,cy,fw,fh,time=0,yaw=0,speech=0,thinking=false,lowCost=false,
  viseme=0,emotion="neutral",listening=false,earSpectrum={},blink=0
 }){
  if(!this.enabled)return;

  const t=time*.001;
  // Keep Avatar 2 front-facing. Pointer/yaw only causes tiny parallax, never a strong turn.
  const yawShift=Math.sin(yaw)*fw*.045;
  const centerX=cx+yawShift;
  const speechEnergy=clamp(speech,0,1);
  const thought=thinking?1:0;
  const activity=clamp(.18+speechEnergy*.72+thought*.5,0,1);

  ctx.save();
  ctx.globalCompositeOperation="source-over";

  // Soft head glow.
  const glow=ctx.createRadialGradient(centerX,cy,fw*.08,centerX,cy,fw*.7);
  glow.addColorStop(0,"rgba(66,176,255,.075)");
  glow.addColorStop(.55,"rgba(35,111,181,.035)");
  glow.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=glow;
  ctx.beginPath();
  ctx.ellipse(centerX,cy,fw*.69,fh*.66,0,0,TAU);
  ctx.fill();

  // Dark eye sockets first, so the face voxels visually wrap around them.
  const eyeY=cy-fh*.105;
  const eyeRX=fw*.115;
  const eyeRY=fh*.052;
  this.drawSocket(ctx,centerX-fw*.19,eyeY,eyeRX,eyeRY,blink,-1,lowCost);
  this.drawSocket(ctx,centerX+fw*.19,eyeY,eyeRX,eyeRY,blink,1,lowCost);

  // Stable facial voxel structure.
  for(let i=0;i<this.face.length;i++){
   if(lowCost&&i%2)continue;
   const p=this.face[i];

   const regionBoost=(p.zone==="forehead"||p.zone==="cheek")?activity:activity*.42;
   const turbulence=Math.sin(t*(.65+p.seed*.85)+p.phase);
   const jitter=regionBoost*fw*(.0025+.009*p.seed);
   const breathe=Math.sin(t*.75+p.phase)*fh*.0023;

   let x=centerX+p.nx*fw*.49+turbulence*jitter;
   let y=cy+p.ny*fh*.48+breathe;

   // Cheeks and forehead "boil" more while speaking/thinking.
   if(p.zone==="cheek"){
    x+=Math.sin(t*1.75+p.phase)*jitter*.8;
    y+=Math.cos(t*1.42+p.phase)*jitter*.72;
   }else if(p.zone==="forehead"){
    y+=Math.sin(t*1.22+p.phase)*jitter*.9;
   }

   // Nose bridge receives a subtle forward/brighter treatment.
   const nose=Math.abs(p.nx)<.095&&p.ny>-.16&&p.ny<.28;
   const jaw=p.zone==="jaw";
   const cube=Math.max(1.8,size*(.0105+(nose?.0021:0)+(jaw?-.0011:0))*(.86+p.depth*.26));
   const alpha=clamp(.28+p.depth*.34+(nose?.16:0)+activity*.08,0,.79);
   this.drawCube(ctx,x,y,cube,p.seed,alpha,lowCost,nose?.86:p.depth);
  }

  // Defined nose tip/bridge.
  const noseCube=Math.max(2.3,fw*.029);
  for(let i=-2;i<=2;i++){
   this.drawCube(ctx,centerX,cy+fh*(.015+i*.045),noseCube*(.88+Math.abs(i)*.04),.7+i*.035,.55,lowCost,.78);
  }
  this.drawCube(ctx,centerX-fw*.035,cy+fh*.22,noseCube*.72,.57,.43,lowCost,.58);
  this.drawCube(ctx,centerX+fw*.035,cy+fh*.22,noseCube*.72,.81,.43,lowCost,.58);

  // Visible ears.
  const bands=[
   clamp(Number(earSpectrum.low)||0,0,1),
   clamp(Number(earSpectrum.mid)||0,0,1),
   clamp(Number(earSpectrum.high)||0,0,1)
  ];
  const earEnergy=Math.max(...bands,listening?.15:0);
  this.drawEar(ctx,-1,centerX,cy,fw,fh,time,earEnergy,lowCost);
  this.drawEar(ctx,1,centerX,cy,fw,fh,time,earEnergy,lowCost);

  // Floating cubes approach the head, concentrated around cheeks and forehead.
  ctx.globalCompositeOperation="lighter";
  for(let i=0;i<this.floaters.length;i++){
   if(lowCost&&i%2)continue;
   const p=this.floaters[i];
   const upper=p.band<2;
   const baseY=upper
    ?cy-fh*(.28+p.band*.17)
    :cy+fh*(.02+(p.band-2)*.23);
   const sideBase=p.side*fw*(upper?.38:.43);
   const pulse=.5+.5*Math.sin(t*(.8+p.speed)+p.phase);
   const approach=.15+.34*(.5+.5*Math.sin(t*(.42+p.speed*.19)+p.phase*1.7));
   let x=centerX+sideBase*(1-approach*.33);
   let y=baseY;
   const orbit=fw*(.035+.035*p.seed)*(1+activity*.24);
   x+=Math.sin(t*p.speed+p.phase)*orbit*p.side;
   y+=Math.cos(t*(p.speed*.73)+p.phase)*orbit*.7;

   const cube=Math.max(1.8,size*(.0065+.008*p.seed));
   const alpha=clamp(.11+pulse*.26+activity*.12,0,.54);
   this.drawCube(ctx,x,y,cube,.35+p.seed*.6,alpha,lowCost,p.seed);
  }

  ctx.globalCompositeOperation="source-over";
  this.drawMouth(ctx,centerX,cy,fw,fh,speechEnergy,viseme,emotion,time,lowCost);

  ctx.restore();
 }
}
