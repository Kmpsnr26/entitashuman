function seeded(seed=0x4d415452){
  return ()=>{
    seed=(seed*1664525+1013904223)>>>0;
    return seed/4294967296;
  };
}

export function createMatrixTransitionField(canvas){
  if(!canvas)return {start(){},stop(){},burst(){},destroy(){}};
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)return {start(){},stop(){},burst(){},destroy(){}};

  const random=seeded();
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  let active=false,frame=0,last=0,width=1,height=1,dpr=1,intensity=.65,burstUntil=0;
  let columns=[];

  function resize(){
    const rect=canvas.getBoundingClientRect();
    width=Math.max(1,rect.width);
    height=Math.max(1,rect.height);
    dpr=Math.min(window.devicePixelRatio||1,1.35);
    canvas.width=Math.round(width*dpr);
    canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const spacing=18;
    const count=Math.ceil(width/spacing);
    columns=Array.from({length:count},(_,index)=>({
      x:index*spacing+spacing*.5,
      y:random()*height,
      speed:34+random()*92,
      phase:random()*Math.PI*2,
      length:5+Math.floor(random()*10)
    }));
  }

  function draw(timestamp){
    if(!active)return;
    if(timestamp-last<33){
      frame=requestAnimationFrame(draw);
      return;
    }
    const dt=Math.min(.06,(timestamp-last)/1000||.033);
    last=timestamp;
    const burst=timestamp<burstUntil?1.55:1;

    ctx.fillStyle='rgba(0,4,8,.18)';
    ctx.fillRect(0,0,width,height);
    ctx.textAlign='center';
    ctx.textBaseline='middle';

    for(let index=0;index<columns.length;index++){
      const column=columns[index];
      if(!reduced){
        column.y+=column.speed*dt*burst;
        if(column.y>height+220)column.y=-random()*180;
      }
      for(let row=0;row<column.length;row++){
        const y=column.y-row*16;
        if(y<-24||y>height+24)continue;
        const head=row===0;
        const alpha=(1-row/column.length)*(.13+intensity*.25)*(head?1.8:1);
        const bit=((index+row+Math.floor(timestamp/220))%2)?'1':'0';
        ctx.font=(head?12:10)+'px ui-monospace, SFMono-Regular, Consolas, monospace';
        ctx.fillStyle=head
          ?'rgba(187,252,255,'+Math.min(.9,alpha)+')'
          :'rgba('+(index%7===0?'126,109,255':'62,224,246')+','+alpha+')';
        ctx.fillText(bit,column.x,y);
      }
    }

    const scanY=(timestamp*.22)%Math.max(1,height);
    const gradient=ctx.createLinearGradient(0,scanY-28,0,scanY+28);
    gradient.addColorStop(0,'rgba(82,230,255,0)');
    gradient.addColorStop(.5,'rgba(140,248,255,'+(.04+intensity*.045)+')');
    gradient.addColorStop(1,'rgba(82,230,255,0)');
    ctx.fillStyle=gradient;
    ctx.fillRect(0,scanY-28,width,56);

    if(!reduced)frame=requestAnimationFrame(draw);
  }

  const observer=new ResizeObserver(()=>{resize();if(reduced&&active)draw(performance.now());});
  observer.observe(canvas);
  resize();

  return {
    start({compact=false}={}){
      active=true;
      intensity=compact?.42:.7;
      last=0;
      ctx.clearRect(0,0,width,height);
      if(reduced)draw(performance.now());
      else frame=requestAnimationFrame(draw);
    },
    burst(){
      burstUntil=performance.now()+520;
    },
    stop(){
      active=false;
      if(frame)cancelAnimationFrame(frame);
      frame=0;
    },
    destroy(){
      active=false;
      if(frame)cancelAnimationFrame(frame);
      observer.disconnect();
    }
  };
}
