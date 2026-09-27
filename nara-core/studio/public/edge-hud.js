const MONITORS=['connection','loading','error','progress','evolution','damage'];

function text(value,fallback='—'){
  if(value===null||value===undefined||value==='')return fallback;
  return String(value);
}

function createRow(label,value,state=''){
  const row=document.createElement('div');
  row.className='edge-monitor-row';
  if(state)row.dataset.state=state;
  const left=document.createElement('span');
  left.textContent=label;
  const right=document.createElement('strong');
  right.textContent=text(value);
  row.append(left,right);
  return row;
}

export function createEdgeHud({onView=()=>{}}={}){
  const root=document.getElementById('edgeHud');
  const drawer=document.getElementById('edgeMonitorDrawer');
  const drawerTitle=document.getElementById('edgeMonitorTitle');
  const drawerBody=document.getElementById('edgeMonitorBody');
  const state={
    connection:'LOCKED',
    snapshot:null,
    telemetry:null,
    skills:null,
    neural:null,
    monitor:null
  };

  function monitorRows(){
    const snapshot=state.snapshot||{};
    const telemetry=state.telemetry||{};
    const skills=state.skills||{};
    const neural=state.neural||{};
    const diagnostics=telemetry.diagnostics||{};
    const decision=telemetry.decision||{};
    const memory=telemetry.memory||{};
    const performance=telemetry.performance||{};
    const regions=snapshot.regions||{};
    const currentTask=snapshot.currentTask?.label||'idle';

    if(state.monitor==='connection'){
      return [
        ['STUDIO',state.connection,state.connection==='LIVE'?'ready':'active'],
        ['GITHUB',regions.GITHUB?.status||'idle',regions.GITHUB?.status],
        ['COPILOT',regions.COPILOT?.status||'idle',regions.COPILOT?.status],
        ['WEB',regions.WEB?.status||'idle',regions.WEB?.status],
        ['SYNC',regions.SYNC?.status||'idle',regions.SYNC?.status],
        ['ONLINE',regions.ONLINE?.status||'idle',regions.ONLINE?.status]
      ];
    }
    if(state.monitor==='loading'){
      return [
        ['LIFECYCLE',snapshot.lifecycle||'idle',snapshot.lifecycle],
        ['CURRENT TASK',currentTask],
        ['DECISION',decision.status||'idle',decision.status],
        ['CURRENT STAGE',decision.currentStage||'—'],
        ['ACTIVE ROUTES',neural.activeRoutes??0],
        ['EVENT RATE',performance.eventsPerSecond??0]
      ];
    }
    if(state.monitor==='error'){
      return [
        ['STATUS',diagnostics.status||'idle',diagnostics.status],
        ['ERRORS',diagnostics.counters?.errors??0],
        ['BUGS',diagnostics.counters?.bugs??0],
        ['CURRENT',diagnostics.current?.message||'none'],
        ['FAILED STAGES',decision.failedStages??0],
        ['SKILLS FAILED',skills.failed??0]
      ];
    }
    if(state.monitor==='progress'){
      return [
        ['DECISION',decision.status||'idle',decision.status],
        ['COMPLETED',decision.completedStages??0],
        ['FAILED',decision.failedStages??0],
        ['ROUTES',neural.routeCount??0],
        ['ACTIVE ROOTS',neural.activeLinks??0],
        ['SKILLS RUNNING',skills.running??0]
      ];
    }
    if(state.monitor==='evolution'){
      const active=Object.values(regions).filter(item=>!['idle','ready','offline','disconnected','complete'].includes(item?.status)).length;
      return [
        ['ACTIVE REGIONS',active],
        ['TOTAL EVENTS',performance.totalEvents??0],
        ['MEMORY READ',memory.counters?.read??0],
        ['MEMORY WRITE',memory.counters?.write??0],
        ['SKILLS ENABLED',skills.enabled??0],
        ['QUALITY',neural.quality||'—']
      ];
    }
    return [
      ['SYSTEM DAMAGE',diagnostics.status||'idle',diagnostics.status],
      ['ERRORS',diagnostics.counters?.errors??0],
      ['BUGS',diagnostics.counters?.bugs??0],
      ['FIXED',diagnostics.counters?.fixed??0],
      ['VERIFIED',diagnostics.counters?.verified??0],
      ['LAST REPAIR',diagnostics.lastRepairDurationMs==null?'—':Math.round(diagnostics.lastRepairDurationMs)+' ms']
    ];
  }

  function render(){
    if(!root)return;
    document.getElementById('edgeConnection').textContent=state.connection;
    document.getElementById('edgeLifecycle').textContent=text(state.snapshot?.lifecycle,'idle');
    document.getElementById('edgeSelected').textContent=text(state.snapshot?.selectedRegion,'NARA_CORE');
    document.getElementById('edgeFps').textContent='FPS '+text(state.neural?.fps,'—');
    document.getElementById('edgeQuality').textContent=text(state.neural?.quality,'auto');
    document.getElementById('edgeErrors').textContent='ERR '+text(state.telemetry?.diagnostics?.counters?.errors,0);
    document.getElementById('edgeBugs').textContent='BUG '+text(state.telemetry?.diagnostics?.counters?.bugs,0);
    document.getElementById('edgeRoutes').textContent='ROUTES '+text(state.neural?.routeCount,0);

    for(const button of root.querySelectorAll('[data-edge-monitor]')){
      button.classList.toggle('edge-active',button.dataset.edgeMonitor===state.monitor);
    }

    if(!state.monitor){
      drawer.hidden=true;
      return;
    }

    drawer.hidden=false;
    drawerTitle.textContent=state.monitor.toUpperCase()+' MONITOR';
    drawerBody.replaceChildren(...monitorRows().map(([label,value,rowState])=>createRow(label,value,rowState)));
  }

  root?.querySelectorAll('[data-edge-monitor]').forEach(button=>{
    button.addEventListener('click',()=>{
      const mode=button.dataset.edgeMonitor;
      if(!MONITORS.includes(mode))return;
      state.monitor=state.monitor===mode?null:mode;
      render();
    });
  });

  document.getElementById('edgeMonitorClose')?.addEventListener('click',()=>{
    state.monitor=null;
    render();
  });
  document.getElementById('edgeView2d')?.addEventListener('click',()=>onView('2d'));
  document.getElementById('edgeView3d')?.addEventListener('click',()=>onView('3d'));

  const clock=document.getElementById('edgeClock');
  const tick=()=>{if(clock)clock.textContent=new Date().toLocaleTimeString('id-ID');};
  tick();
  const clockTimer=setInterval(tick,1000);

  return {
    activate(){
      if(root)root.hidden=false;
      render();
    },
    update(patch={}){
      Object.assign(state,patch);
      render();
    },
    setConnection(value){
      state.connection=value;
      render();
    },
    destroy(){
      clearInterval(clockTimer);
    }
  };
}
