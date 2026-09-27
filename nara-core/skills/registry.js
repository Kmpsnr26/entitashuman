const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,79}$/i;

const DEFAULT_SKILLS=Object.freeze([
  {id:'reason',label:'Reasoning',category:'cognitive',region:'REASONER'},
  {id:'plan',label:'Planning',category:'cognitive',region:'PLANNER'},
  {id:'memory.read',label:'Memory Read',category:'memory',region:'MEMORY'},
  {id:'memory.write',label:'Memory Write',category:'memory',region:'MEMORY'},
  {id:'agent.manage',label:'Agent Manager',category:'agent',region:'AGENT_MANAGER'},
  {id:'program.execute',label:'Program Execution',category:'execution',region:'PROGRAM'},
  {id:'verify',label:'Verification',category:'workflow',region:'FOLLOW_UP'},
  {id:'bug.analyze',label:'Bug Analysis',category:'diagnostic',region:'BUG_HUNTER'},
  {id:'sync',label:'Synchronization',category:'connection',region:'SYNC'}
]);

const EVENT_MAP=Object.freeze({
  'reason.start':['reason','start'],
  'reason.complete':['reason','complete'],
  'plan.start':['plan','start'],
  'plan.complete':['plan','complete'],
  'memory.read':['memory.read','pulse'],
  'memory.write':['memory.write','pulse'],
  'agent.start':['agent.manage','start'],
  'agent.complete':['agent.manage','complete'],
  'agent.failed':['agent.manage','failed'],
  'program.start':['program.execute','start'],
  'program.complete':['program.execute','complete'],
  'verify.start':['verify','start'],
  'verify.complete':['verify','complete'],
  'bug.detected':['bug.analyze','start'],
  'bug.fixed':['bug.analyze','complete'],
  'sync.start':['sync','start'],
  'sync.complete':['sync','complete']
});

const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

export class NaraSkillRegistry{
  constructor({skills=DEFAULT_SKILLS}={}){
    this.skills=new Map();
    for(const skill of skills)this.register(skill);
  }

  register(definition){
    const id=safeText(definition?.id,80);
    if(!SAFE_ID.test(id))throw new Error('ID skill NARA tidak valid.');
    if(this.skills.has(id))throw new Error('Skill NARA sudah terdaftar: '+id);
    const item={
      id,
      label:safeText(definition?.label||id,120),
      category:safeText(definition?.category||'general',60),
      region:safeText(definition?.region||'',80),
      enabled:definition?.enabled!==false,
      status:'ready',
      runs:0,
      successes:0,
      failures:0,
      activeSince:0,
      lastDurationMs:null,
      lastLabel:'',
      lastEvent:'',
      updatedAt:0
    };
    this.skills.set(id,item);
    return this.get(id);
  }

  get(id){
    const item=this.skills.get(String(id||''));
    return item?{...item}:null;
  }

  list(){return [...this.skills.values()].map(item=>({...item}));}

  setEnabled(id,enabled){
    const item=this.skills.get(String(id||''));
    if(!item)throw new Error('Skill NARA tidak ditemukan: '+id);
    item.enabled=Boolean(enabled);
    item.status=item.enabled?'ready':'disabled';
    item.updatedAt=Date.now();
    return {...item};
  }

  start(id,{timestamp=Date.now(),label='',event=''}={}){
    const item=this.skills.get(String(id||''));
    if(!item||!item.enabled)return null;
    item.status='running';
    item.runs+=1;
    item.activeSince=Number(timestamp)||Date.now();
    item.lastLabel=safeText(label,160);
    item.lastEvent=safeText(event,120);
    item.updatedAt=item.activeSince;
    return {...item};
  }

  finish(id,{timestamp=Date.now(),ok=true,label='',event=''}={}){
    const item=this.skills.get(String(id||''));
    if(!item||!item.enabled)return null;
    const endedAt=Number(timestamp)||Date.now();
    item.lastDurationMs=item.activeSince?Math.max(0,endedAt-item.activeSince):0;
    item.activeSince=0;
    item.status=ok?'complete':'failed';
    if(ok)item.successes+=1;else item.failures+=1;
    if(label)item.lastLabel=safeText(label,160);
    item.lastEvent=safeText(event,120);
    item.updatedAt=endedAt;
    return {...item};
  }

  pulse(id,{timestamp=Date.now(),label='',event=''}={}){
    const started=this.start(id,{timestamp,label,event});
    if(!started)return null;
    return this.finish(id,{timestamp,ok:true,label,event});
  }

  consume(envelope){
    const mapped=EVENT_MAP[envelope?.event];
    if(!mapped)return null;
    const [id,action]=mapped;
    const options={
      timestamp:envelope.timestamp,
      label:envelope.payload?.label||envelope.payload?.message||'',
      event:envelope.event
    };
    if(action==='start')return this.start(id,options);
    if(action==='complete')return this.finish(id,{...options,ok:true});
    if(action==='failed')return this.finish(id,{...options,ok:false});
    return this.pulse(id,options);
  }

  reset(){
    for(const item of this.skills.values()){
      item.status=item.enabled?'ready':'disabled';
      item.runs=0;item.successes=0;item.failures=0;item.activeSince=0;
      item.lastDurationMs=null;item.lastLabel='';item.lastEvent='';item.updatedAt=0;
    }
    return this.snapshot();
  }

  snapshot(){
    const skills=this.list();
    return {
      version:1,
      total:skills.length,
      enabled:skills.filter(skill=>skill.enabled).length,
      running:skills.filter(skill=>skill.status==='running').length,
      failed:skills.filter(skill=>skill.status==='failed').length,
      skills
    };
  }
}

export function createSkillRegistry(options){return new NaraSkillRegistry(options);}
export {DEFAULT_SKILLS};
