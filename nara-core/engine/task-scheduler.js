const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

export class NaraTaskScheduler{
  constructor({limit=200}={}){
    this.limit=Math.max(10,Math.min(2000,Number(limit)||200));
    this.tasks=new Map();
    this.sequence=0;
  }

  enqueue({
    id='',
    goalId='',
    label='NARA task',
    handler='',
    priority=50,
    dependencies=[],
    capability=''
  }={}){
    const taskId=safeText(id||('task-'+(++this.sequence)),80);
    if(!SAFE_ID.test(taskId))throw new Error('Task ID NARA tidak valid.');
    if(this.tasks.has(taskId))throw new Error('Task NARA sudah ada: '+taskId);
    if(this.tasks.size>=this.limit)throw new Error('Antrian task NARA penuh.');
    const handlerId=safeText(handler,80);
    if(!SAFE_ID.test(handlerId))throw new Error('Handler task NARA tidak valid.');
    const deps=[...new Set((Array.isArray(dependencies)?dependencies:[]).map(value=>safeText(value,80)).filter(Boolean))].slice(0,16);
    const now=Date.now();
    const item={
      id:taskId,
      goalId:safeText(goalId,80),
      label:safeText(label,160),
      handler:handlerId,
      priority:Math.max(0,Math.min(100,Number(priority)||0)),
      dependencies:deps,
      capability:safeText(capability,80),
      status:'queued',
      attempts:0,
      createdAt:now,
      startedAt:0,
      finishedAt:0,
      lastError:''
    };
    this.tasks.set(taskId,item);
    return {...item,dependencies:[...item.dependencies]};
  }

  get(id){
    const item=this.tasks.get(String(id||''));
    return item?{...item,dependencies:[...item.dependencies]}:null;
  }

  dependenciesSatisfied(item){
    return item.dependencies.every(id=>this.tasks.get(id)?.status==='complete');
  }

  next(){
    const candidates=[...this.tasks.values()]
      .filter(item=>item.status==='queued'&&this.dependenciesSatisfied(item))
      .sort((a,b)=>b.priority-a.priority||a.createdAt-b.createdAt);
    const item=candidates[0];
    return item?{...item,dependencies:[...item.dependencies]}:null;
  }

  start(id){
    const item=this.tasks.get(String(id||''));
    if(!item)throw new Error('Task NARA tidak ditemukan.');
    if(item.status!=='queued')throw new Error('Task NARA tidak siap dijalankan.');
    if(!this.dependenciesSatisfied(item))throw new Error('Dependensi task NARA belum selesai.');
    item.status='running';
    item.attempts+=1;
    item.startedAt=Date.now();
    item.lastError='';
    return this.get(item.id);
  }

  complete(id){
    const item=this.tasks.get(String(id||''));
    if(!item)throw new Error('Task NARA tidak ditemukan.');
    item.status='complete';
    item.finishedAt=Date.now();
    item.lastError='';
    return this.get(item.id);
  }

  fail(id,error=''){
    const item=this.tasks.get(String(id||''));
    if(!item)throw new Error('Task NARA tidak ditemukan.');
    item.status='failed';
    item.finishedAt=Date.now();
    item.lastError=safeText(error,240);
    return this.get(item.id);
  }

  requeue(id){
    const item=this.tasks.get(String(id||''));
    if(!item)throw new Error('Task NARA tidak ditemukan.');
    if(item.status!=='failed')throw new Error('Hanya task gagal yang dapat diulang.');
    item.status='queued';
    item.startedAt=0;
    item.finishedAt=0;
    return this.get(item.id);
  }

  cancel(id){
    const item=this.tasks.get(String(id||''));
    if(!item)return null;
    if(item.status==='complete')return this.get(item.id);
    item.status='cancelled';
    item.finishedAt=Date.now();
    return this.get(item.id);
  }

  snapshot(){
    const tasks=[...this.tasks.values()].map(item=>({...item,dependencies:[...item.dependencies]}));
    return {
      version:1,
      total:tasks.length,
      queued:tasks.filter(item=>item.status==='queued').length,
      running:tasks.filter(item=>item.status==='running').length,
      failed:tasks.filter(item=>item.status==='failed').length,
      complete:tasks.filter(item=>item.status==='complete').length,
      tasks
    };
  }
}

export function createTaskScheduler(options){return new NaraTaskScheduler(options);}
