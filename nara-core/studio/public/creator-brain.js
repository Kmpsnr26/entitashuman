const TAU=Math.PI*2;

function mulberry32(seed){
  return function(){
    let t=seed+=0x6D2B79F5;
    t=Math.imul(t^t>>>15,t|1);
    t^=t+Math.imul(t^t>>>7,t|61);
    return ((t^t>>>14)>>>0)/4294967296;
  };
}

function brainMask(x,y){
  const left=((x+.34)/.72)**2+((y+.02)/.92)**2<1;
  const right=((x-.34)/.72)**2+((y+.02)/.92)**2<1;
  const lower=(x/.78)**2+((y-.48)/.52)**2<1;
  const notch=Math.abs(x)<.055&&y<-.42;
  return (left||right||lower)&&!notch&&y<.92;
}

function createNodes(random,count=112){
  const nodes=[];
  let guard=0;
  while(nodes.length<count&&guard<6000){
    guard+=1;
    const x=random()*2-1;
    const y=random()*2-1;
    if(!brainMask(x,y))continue;
    nodes.push({
      x,y,
      ox:x,oy:y,
      phase:random()*TAU,
      speed:.18+random()*.42,
      amp:.006+random()*.018,
      size:.65+random()*1.45,
      hue:178+random()*48
    });
  }
  return nodes;
}

function createLinks(nodes){
  const links=[];
  for(let i=0;i<nodes.length;i++){
    const distances=[];
    for(let j=i+1;j<nodes.length;j++){
      const dx=nodes[i].x-nodes[j].x;
      const dy=nodes[i].y-nodes[j].y;
      const d=dx*dx+dy*dy;
      if(d<.11)distances.push([d,j]);
    }
    distances.sort((a,b)=>a[0]-b[0]);
    for(const [,j] of distances.slice(0,3))links.push([i,j]);
  }
  return links.slice(0,220);
}

function createBits(random,count=86){
  return Array.from({length:count},()=>({
    x:random()*2-1,
    y:random()*2-1,
    value:random()>.5?'1':'0',
    phase:random()*TAU,
    drift:.035+random()*.09,
    alpha:.18+random()*.52,
    size:8+Math.floor(random()*7)
  })).filter(bit=>brainMask(bit.x,bit.y));
}

export function createCreatorBrainBackdrop(canvas){
  if(!canvas)return {setState(){},destroy(){}};
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)return {setState(){},destroy(){}};

  const random=mulberry32(0x4e415241);
  const nodes=createNodes(random);
  const links=createLinks(nodes);
  const bits=createBits(random);
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  let state='idle';
  let active=true;
  let frame=0;
  let width=1,height=1,dpr=1;
  let last=0;

  function resize(){
    const rect=canvas.getBoundingClientRect();
    width=Math.max(1,rect.width);
    height=Math.max(1,rect.height);
    dpr=Math.min(window.devicePixelRatio||1,1.5);
    canvas.width=Math.round(width*dpr);
    canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  function transform(point){
    const scale=Math.min(width*.34,height*.43);
    const cx=width*.40;
    const cy=height*.50;
    return [cx+point.x*scale,cy+point.y*scale];
  }

  function palette(){
    if(state==='verified')return {line:'112,244,218',node:'151,255,228',binary:'96,255,207'};
    if(state==='error')return {line:'255,95,114',node:'255,158,170',binary:'255,112,129'};
    if(state==='verifying')return {line:'107,224,255',node:'184,250,255',binary:'120,233,255'};
    return {line:'66,211,240',node:'126,239,255',binary:'79,223,255'};
  }

  function draw(timestamp=0){
    if(!active)return;
    const interval=reduced?1000:33;
    if(timestamp-last<interval){
      frame=requestAnimationFrame(draw);
      return;
    }
    last=timestamp;
    const t=timestamp/1000;
    const colors=palette();

    ctx.clearRect(0,0,width,height);

    const glow=ctx.createRadialGradient(width*.40,height*.50,0,width*.40,height*.50,Math.min(width,height)*.48);
    glow.addColorStop(0,'rgba(33,220,255,.105)');
    glow.addColorStop(.44,'rgba(69,122,255,.035)');
    glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow;
    ctx.fillRect(0,0,width,height);

    for(const node of nodes){
      if(!reduced){
        node.x=node.ox+Math.sin(t*node.speed+node.phase)*node.amp;
        node.y=node.oy+Math.cos(t*(node.speed*.84)+node.phase)*node.amp;
      }
    }

    ctx.lineCap='round';
    for(let i=0;i<links.length;i++){
      const [aIndex,bIndex]=links[i];
      const a=nodes[aIndex],b=nodes[bIndex];
      const [ax,ay]=transform(a);
      const [bx,by]=transform(b);
      const pulse=.14+.12*(.5+.5*Math.sin(t*1.35+i*.31));
      ctx.strokeStyle='rgba('+colors.line+','+pulse+')';
      ctx.lineWidth=.55+(i%5===0?.45:0);
      ctx.beginPath();
      ctx.moveTo(ax,ay);
      const mx=(ax+bx)/2+(b.y-a.y)*10;
      const my=(ay+by)/2-(b.x-a.x)*10;
      ctx.quadraticCurveTo(mx,my,bx,by);
      ctx.stroke();
    }

    for(let i=0;i<nodes.length;i++){
      const node=nodes[i];
      const [x,y]=transform(node);
      const pulse=.45+.45*(.5+.5*Math.sin(t*1.9+node.phase));
      ctx.shadowBlur=state==='verified'?15:9;
      ctx.shadowColor='rgba('+colors.node+',.7)';
      ctx.fillStyle='rgba('+colors.node+','+(.18+pulse*.54)+')';
      ctx.beginPath();
      ctx.arc(x,y,node.size*(state==='verifying'?1.16:1),0,TAU);
      ctx.fill();
    }
    ctx.shadowBlur=0;

    ctx.font='11px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.textAlign='center';
    for(let i=0;i<bits.length;i++){
      const bit=bits[i];
      if(!reduced){
        bit.y-=bit.drift*.014;
        if(bit.y<-.96||!brainMask(bit.x,bit.y)){
          bit.y=.88-random()*.12;
          bit.x=random()*1.7-.85;
          if(!brainMask(bit.x,bit.y))bit.x*=.55;
          bit.value=random()>.5?'1':'0';
        }
      }
      const [x,y]=transform(bit);
      const shimmer=.55+.45*Math.sin(t*2+bit.phase);
      ctx.globalAlpha=bit.alpha*shimmer;
      ctx.font=bit.size+'px ui-monospace, SFMono-Regular, Consolas, monospace';
      ctx.fillStyle='rgb('+colors.binary+')';
      ctx.fillText(bit.value,x,y);
    }
    ctx.globalAlpha=1;

    const breath=.5+.5*Math.sin(t*1.35);
    ctx.strokeStyle='rgba('+colors.line+','+(.12+breath*.12)+')';
    ctx.lineWidth=1;
    ctx.setLineDash([4,8]);
    const cx=width*.40,cy=height*.50;
    const rx=Math.min(width*.285,height*.36),ry=Math.min(width*.24,height*.38);
    ctx.beginPath();
    ctx.ellipse(cx-rx*.34,cy,rx*.68,ry,-.10,0,TAU);
    ctx.ellipse(cx+rx*.34,cy,rx*.68,ry,.10,0,TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    if(!reduced)frame=requestAnimationFrame(draw);
  }

  const resizeObserver=new ResizeObserver(()=>{resize();if(reduced)draw(performance.now());});
  resizeObserver.observe(canvas);
  resize();
  draw(performance.now());

  return {
    setState(next){
      state=['idle','verifying','verified','error'].includes(next)?next:'idle';
      if(reduced)draw(performance.now());
    },
    setActive(value){
      const next=Boolean(value);
      if(active===next)return;
      active=next;
      if(active&&!reduced)frame=requestAnimationFrame(draw);
      else if(!active&&frame)cancelAnimationFrame(frame);
    },
    destroy(){
      active=false;
      if(frame)cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    }
  };
}
