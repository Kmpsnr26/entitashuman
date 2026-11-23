const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const safeText=(value,max=200)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));

export class AleGoalManager{
  constructor({limit=100}={}){this.limit=Math.max(5,Math.min(1000,Number(limit)||100));this.goals=new Map();this.taskStatuses=new Map();this.sequence=0;}
  create({id='',label='AleCore AI goal',priority=50,parentId='',dependencies=[],successCriteria=[]}={}){
    const goalId=safeText(id||('goal-'+(++this.sequence)),80);
    if(!SAFE_ID.test(goalId))throw new Error('Goal ID AleCore AI tidak valid.');
    if(this.goals.has(goalId))throw new Error('Goal AleCore AI sudah ada: '+goalId);
    if(this.goals.size>=this.limit)throw new Error('Goal Manager AleCore AI penuh.');
    const parent=safeText(parentId,80);if(parent&&!this.goals.has(parent))throw new Error('Parent goal AleCore AI tidak ditemukan.');
    const deps=[...new Set((Array.isArray(dependencies)?dependencies:[]).map(value=>safeText(value,80)).filter(Boolean))].slice(0,16);
    for(const dep of deps)if(!this.goals.has(dep))throw new Error('Dependensi goal AleCore AI tidak ditemukan: '+dep);
    const criteria=(Array.isArray(successCriteria)?successCriteria:[]).slice(0,16)
      .map(value=>typeof value==='string'?safeText(value,180):safeText(value?.id||value?.description,180)).filter(Boolean);
    const now=Date.now();
    const item={id:goalId,label:safeText(label,200)||'AleCore AI goal',priority:Math.max(0,Math.min(100,Number(priority)||0)),
      parentId:parent,dependencies:deps,successCriteria:criteria,evidence:[],taskIds:[],status:'pending',progress:0,
      createdAt:now,activatedAt:0,completedAt:0,updatedAt:now,lastError:''};
    this.goals.set(goalId,item);return this.get(goalId);
  }
  get(id){
    const item=this.goals.get(String(id||''));
    return item?{...item,dependencies:[...item.dependencies],successCriteria:[...item.successCriteria],
      evidence:item.evidence.map(entry=>({...entry})),taskIds:[...item.taskIds]}:null;
  }
  dependenciesSatisfied(item){return item.dependencies.every(id=>this.goals.get(id)?.status==='complete');}
  next(){
    return [...this.goals.values()]
      .filter(item=>['pending','active'].includes(item.status)&&this.dependenciesSatisfied(item))
      .sort((a,b)=>b.priority-a.priority||a.createdAt-b.createdAt)
      .map(item=>this.get(item.id))[0]||null;
  }
  criteriaSatisfied(item){return item.successCriteria.every(criterion=>item.evidence.some(entry=>entry.criterion===criterion&&entry.verified===true&&entry.summary));}
  recordEvidence(id,{criterion,evidence,verified=false,source=''}={}){
    const item=this.goals.get(String(id||''));if(!item)throw new Error('Goal AleCore AI tidak ditemukan.');
    if(['complete','failed','cancelled'].includes(item.status))throw new Error('Goal terminal tidak dapat menerima bukti baru.');
    const key=safeText(criterion,180);if(!item.successCriteria.includes(key))throw new Error('Kriteria keberhasilan tidak terdaftar pada Goal.');
    const summary=safeText(typeof evidence==='string'?evidence:evidence?.summary,500);
    if(!summary)throw new Error('Bukti Goal wajib memiliki ringkasan.');
    const entry={criterion:key,summary,verified:Boolean(verified),source:safeText(source,100),recordedAt:Date.now()};
    const index=item.evidence.findIndex(value=>value.criterion===key);
    if(index>=0)item.evidence[index]=entry;else item.evidence.push(entry);
    item.updatedAt=Date.now();return this.get(item.id);
  }
  activate(id){
    const item=this.goals.get(String(id||''));if(!item)throw new Error('Goal AleCore AI tidak ditemukan.');
    if(!['pending','active'].includes(item.status))throw new Error('Goal AleCore AI tidak dapat diaktifkan.');
    if(!this.dependenciesSatisfied(item))throw new Error('Dependensi goal AleCore AI belum selesai.');
    item.status='active';item.activatedAt=item.activatedAt||Date.now();item.updatedAt=Date.now();return this.get(item.id);
  }
  attachTask(goalId,taskId){
    const item=this.goals.get(String(goalId||''));if(!item)throw new Error('Goal AleCore AI tidak ditemukan.');
    if(item.status==='complete')throw new Error('Goal yang selesai tidak dapat menerima task baru.');
    const id=safeText(taskId,80);if(!SAFE_ID.test(id))throw new Error('Task ID untuk goal tidak valid.');
    if(!item.taskIds.includes(id))item.taskIds.push(id);item.updatedAt=Date.now();return this.get(item.id);
  }
  reconcileTasks(tasks=[]){
    const byId=new Map((Array.isArray(tasks)?tasks:[]).map(task=>[String(task?.id||''),task]));
    for(const [id,task] of byId)this.taskStatuses.set(id,String(task?.status||''));
    const changes=[];
    for(const item of this.goals.values()){
      if(!item.taskIds.length||['complete','failed','cancelled'].includes(item.status))continue;
      const linked=item.taskIds.map(id=>byId.get(id)).filter(Boolean);if(!linked.length)continue;
      const complete=linked.filter(task=>task.status==='complete').length;
      const failed=linked.filter(task=>['failed','cancelled'].includes(task.status)).length;
      const running=linked.filter(task=>task.status==='running').length;
      const previousStatus=item.status,previousProgress=item.progress;
      item.progress=clamp01(complete/item.taskIds.length);
      if(failed>0)item.status='blocked';
      else if(complete===item.taskIds.length){
        if(this.criteriaSatisfied(item)){item.status='complete';item.progress=1;item.completedAt=Date.now();}
        else item.status='active';
      }else if(running>0||complete>0)item.status='active';
      item.updatedAt=Date.now();
      if(item.status!==previousStatus||item.progress!==previousProgress)changes.push(this.get(item.id));
    }
    return changes;
  }
  complete(id){
    const item=this.goals.get(String(id||''));if(!item)throw new Error('Goal AleCore AI tidak ditemukan.');
    if(['failed','cancelled'].includes(item.status))throw new Error('Goal terminal gagal/batal tidak dapat diselesaikan.');
    if(!this.criteriaSatisfied(item))throw new Error('Goal AleCore AI belum dapat diselesaikan: bukti terverifikasi untuk seluruh success criteria belum tersedia.');
    if(item.taskIds.some(taskId=>this.taskStatuses.get(taskId)!=='complete'))throw new Error('Goal AleCore AI belum dapat diselesaikan: seluruh task terkait harus selesai.');
    item.status='complete';item.progress=1;item.completedAt=Date.now();item.updatedAt=item.completedAt;item.lastError='';return this.get(item.id);
  }
  fail(id,error=''){
    const item=this.goals.get(String(id||''));if(!item)throw new Error('Goal AleCore AI tidak ditemukan.');
    item.status='failed';item.lastError=safeText(error,240);item.updatedAt=Date.now();return this.get(item.id);
  }
  cancel(id){const item=this.goals.get(String(id||''));if(!item)return null;if(item.status==='complete')return this.get(item.id);item.status='cancelled';item.updatedAt=Date.now();return this.get(item.id);}
  snapshot(){
    const goals=[...this.goals.values()].map(item=>this.get(item.id));
    return {version:1,total:goals.length,active:goals.filter(item=>item.status==='active').length,
      pending:goals.filter(item=>item.status==='pending').length,blocked:goals.filter(item=>item.status==='blocked').length,
      failed:goals.filter(item=>item.status==='failed').length,complete:goals.filter(item=>item.status==='complete').length,goals};
  }
}
export function createGoalManager(options){return new AleGoalManager(options);}
