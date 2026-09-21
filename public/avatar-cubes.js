// Procedural cube/glow layer for Avatar 2. No PNG/image asset is used.
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class CubeAvatarLayer{
 constructor(count=118){
  this.enabled=false;
  this.particles=Array.from({length:count},(_,i)=>({
   seed:Math.random(),phase:Math.random()*TAU,speed:.35+Math.random()*.9,
   side:i%2?-1:1,zone:i%5,size:.45+Math.random()*1.7,depth:Math.random()
  }));
 }
 setEnabled(value){this.enabled=Boolean(value);}
 draw(ctx,{size,cx,cy,fw,fh,time=0,yaw=0,speech=0,thinking=false}){
  if(!this.enabled)return;
  const t=time*.001,profile=Math.max(.62,Math.cos(yaw)),yawShift=Math.sin(yaw)*fw*.16;
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(const p of this.particles){
   const faceZone=p.zone<3;
   const baseY=faceZone?cy+fh*(-.28+p.zone*.23):cy+fh*(-.48+(p.zone-3)*.82);
   const baseX=cx+yawShift+p.side*fw*(faceZone?(.14+.08*p.seed):(.39+.12*p.seed))*profile;
   const pulse=.5+.5*Math.sin(t*(1.2+p.speed)+p.phase);
   const turmoil=(thinking?.9:.45)+(speech*.7);
   const orbit=fw*(.012+.026*p.seed)*(1+turmoil*.35);
   let x=baseX+Math.sin(t*p.speed+p.phase)*orbit*p.side;
   let y=baseY+Math.cos(t*(p.speed*.73)+p.phase)*orbit*.72;
   if(!faceZone){x+=p.side*fw*(.05+.13*pulse);y+=Math.sin(t*.8+p.phase)*fh*.035;}
   const approach=.5+.5*Math.sin(t*(.55+p.speed*.22)+p.phase*1.7);
   x+=(cx+yawShift-x)*approach*(faceZone?.035:.085);
   y+=(cy-y)*approach*(faceZone?.018:.045);
   const cube=Math.max(1.2,size*(.0055+.009*p.size)*(faceZone?.7:1));
   const blue=p.seed>.36;
   const alpha=clamp((faceZone?.16:.11)+pulse*(faceZone?.42:.3)+speech*.13,0,.72);
   const glow=blue?'rgba(54,190,255,':'rgba(255,145,38,';
   ctx.shadowColor=glow+alpha+')';ctx.shadowBlur=cube*(1.4+3*pulse);
   ctx.fillStyle=glow+alpha+')';ctx.fillRect(x-cube/2,y-cube/2,cube,cube);
   ctx.shadowBlur=0;ctx.strokeStyle=(blue?'rgba(190,235,255,':'rgba(255,222,180,')+(alpha*.78)+')';
   ctx.lineWidth=Math.max(.45,cube*.08);ctx.strokeRect(x-cube/2,y-cube/2,cube,cube);
   if(cube>4){ctx.fillStyle='rgba(255,255,255,'+(alpha*.22)+')';ctx.fillRect(x-cube*.34,y-cube*.34,cube*.32,cube*.1);}
  }
  ctx.restore();
 }
}
