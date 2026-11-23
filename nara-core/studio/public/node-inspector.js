function element(tag,className='',text=''){
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined&&text!==null)node.textContent=String(text);
  return node;
}

function valueText(value){
  if(value===null||value===undefined||value==='')return '—';
  if(typeof value==='boolean')return value?'YES':'NO';
  return String(value);
}

function row(label,value,state=''){
  const item=element('div','node-inspector-row');
  if(state)item.dataset.state=state;
  item.append(element('span','',label),element('strong','',valueText(value)));
  return item;
}

function section(title,rows=[]){
  const block=element('section','node-inspector-section');
  block.append(element('h3','',title));
  for(const item of rows)block.append(item);
  return block;
}

async function fetchRegion(id){
  const response=await fetch('/api/creator/region/'+encodeURIComponent(id),{
    method:'GET',
    credentials:'same-origin',
    headers:{accept:'application/json'}
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||('Region request gagal: '+response.status));
  return data.region;
}

export function createNodeInspector({
  onNavigate=()=>{},
  onFocus=()=>{},
  onMetadata=()=>{}
}={}){
  const root=document.getElementById('neuralNodeInspector');
  const title=document.getElementById('nodeInspectorTitle');
  const subtitle=document.getElementById('nodeInspectorSubtitle');
  const status=document.getElementById('nodeInspectorStatus');
  const body=document.getElementById('nodeInspectorBody');
  const close=document.getElementById('nodeInspectorClose');
  const focus=document.getElementById('nodeInspectorFocus');
  let currentId='';
  let currentMetadata=null;
  let requestSerial=0;

  function render(metadata){
    currentMetadata=metadata;
    currentId=metadata.id;
    title.textContent=metadata.label;
    const displayId=metadata.id==='NARA_CORE'?'AleCore AI':metadata.id;
    subtitle.textContent=displayId+' · '+metadata.group;
    status.textContent=metadata.status;
    status.dataset.state=metadata.status;

    const fragments=[];
    fragments.push(section('NEURAL IDENTITY',[
      row('REGION',displayId),
      row('GROUP',metadata.group),
      row('STATUS',metadata.status,metadata.status),
      row('LAST EVENT',metadata.lastEvent||'none')
    ]));

    fragments.push(section('RUNTIME',[
      row('LIFECYCLE',metadata.runtime?.lifecycle),
      row('ACTIVE REGIONS',metadata.runtime?.activeRegions),
      row('TOTAL EVENTS',metadata.runtime?.totalEvents),
      row('EVENT RATE',metadata.runtime?.eventsPerSecond)
    ]));

    fragments.push(section('NETWORK / SERVER',[
      row('SCOPE',metadata.network?.scope),
      row('ADDRESS',metadata.network?.address),
      row('PORT',metadata.network?.port),
      row('TRANSPORT',metadata.network?.transport),
      row('DISCOVERY',metadata.network?.discovery),
      row('SERVICE',metadata.server?.service),
      row('HEALTH',metadata.server?.health,metadata.server?.health)
    ]));

    fragments.push(section('DATABASE',[
      row('STATE',metadata.database?.state,metadata.database?.state),
      row('CONNECTOR',metadata.database?.connector),
      row('CREDENTIALS',metadata.database?.credentials)
    ]));

    fragments.push(section('DIAGNOSTICS',[
      row('STATUS',metadata.diagnostics?.status,metadata.diagnostics?.status),
      row('ERRORS',metadata.diagnostics?.errors),
      row('BUGS',metadata.diagnostics?.bugs),
      row('FIXED',metadata.diagnostics?.fixed),
      row('VERIFIED',metadata.diagnostics?.verified),
      row('LAST REPAIR',metadata.diagnostics?.lastRepairDurationMs==null?'—':metadata.diagnostics.lastRepairDurationMs+' ms')
    ]));

    fragments.push(section('MEMORY',[
      row('READS',metadata.memory?.reads),
      row('WRITES',metadata.memory?.writes),
      row('CONTEXT USED',metadata.memory?.contextUsed),
      row('CONTEXT BLOCKED',metadata.memory?.contextBlocked)
    ]));

    const skills=section('REGION SKILLS');
    if(Array.isArray(metadata.skills)&&metadata.skills.length){
      for(const skill of metadata.skills){
        const card=element('div','node-inspector-skill');
        card.append(
          element('strong','',skill.label||skill.id),
          element('span','',skill.status+' · runs '+skill.runs+' · success '+skill.successes+' · fail '+skill.failures)
        );
        skills.append(card);
      }
    }else{
      skills.append(element('p','node-inspector-empty','No registered skill bound to this region.'));
    }
    fragments.push(skills);

    const neighbors=section('NEURAL CONNECTIONS');
    const neighborGrid=element('div','node-neighbor-grid');
    for(const neighbor of metadata.neighbors||[]){
      const button=element('button','node-neighbor');
      button.type='button';
      button.dataset.region=neighbor.id;
      button.append(
        element('strong','',neighbor.label),
        element('span','',neighbor.id+' · '+neighbor.status)
      );
      button.addEventListener('click',()=>navigate(neighbor.id));
      neighborGrid.append(button);
    }
    if(!neighborGrid.childElementCount)neighborGrid.append(element('p','node-inspector-empty','No neural neighbors.'));
    neighbors.append(neighborGrid);
    fragments.push(neighbors);

    fragments.push(section('SECURITY BOUNDARY',[
      row('PERMISSION BYPASS',metadata.security?.permissionBypass),
      row('NETWORK DISCOVERY',metadata.security?.arbitraryNetworkDiscovery),
      row('RAW SECRETS',metadata.security?.rawSecretsExposed),
      row('PRIVATE REASONING',metadata.security?.privateReasoningExposed)
    ]));

    body.replaceChildren(...fragments);
    onMetadata(metadata);
  }

  async function open(id,{focusNode=false}={}){
    const next=String(id||'').slice(0,80);
    if(!next)return;
    const serial=++requestSerial;
    currentId=next;
    root.hidden=false;
    root.classList.add('node-inspector-open');
    title.textContent='LOADING';
    subtitle.textContent=next;
    status.textContent='SYNCING';
    status.dataset.state='syncing';
    body.replaceChildren(element('div','node-inspector-loading','Reading sanitized neural metadata…'));
    if(focusNode)onFocus(next);
    try{
      const metadata=await fetchRegion(next);
      if(serial!==requestSerial)return;
      render(metadata);
    }catch(error){
      if(serial!==requestSerial)return;
      status.textContent='ERROR';
      status.dataset.state='error';
      body.replaceChildren(element('div','node-inspector-error',error.message));
    }
  }

  function navigate(id){
    onNavigate(id);
    open(id,{focusNode:true});
  }

  function hide(){
    requestSerial+=1;
    root.classList.remove('node-inspector-open');
    root.hidden=true;
  }

  close?.addEventListener('click',hide);
  focus?.addEventListener('click',()=>{if(currentId)onFocus(currentId);});

  return {
    open,
    close:hide,
    getCurrent:()=>currentMetadata
  };
}
