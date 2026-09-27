const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,79}$/i;

export class NaraExperienceModel{
  constructor({limit=250}={}){
    this.limit=Math.max(10,Math.min(2000,Number(limit)||250));
    this.records=new Map();
    this.history=[];
  }

  ensure(id){
    const key=String(id||'');
    if(!SAFE_ID.test(key))throw new Error('Strategy ID NARA tidak valid.');
    let item=this.records.get(key);
    if(!item){
      item={id:key,runs:0,successes:0,failures:0,score:.5,updatedAt:0};
      this.records.set(key,item);
    }
    return item;
  }

  record(id,{ok=true,durationMs=0}={}){
    const item=this.ensure(id);
    item.runs+=1;
    if(ok)item.successes+=1;else item.failures+=1;
    const outcome=ok?1:0;
    item.score=Math.max(.05,Math.min(.95,item.score*.8+outcome*.2));
    item.updatedAt=Date.now();
    const event={
      id:item.id,
      ok:Boolean(ok),
      durationMs:Math.max(0,Number(durationMs)||0),
      timestamp:item.updatedAt
    };
    this.history.push(event);
    if(this.history.length>this.limit)this.history.splice(0,this.history.length-this.limit);
    return {...item};
  }

  choose(candidates=[]){
    const ids=[...new Set((Array.isArray(candidates)?candidates:[]).map(String).filter(id=>SAFE_ID.test(id)))];
    if(!ids.length)return null;
    return ids
      .map(id=>this.ensure(id))
      .sort((a,b)=>b.score-a.score||a.failures-b.failures||a.id.localeCompare(b.id))[0].id;
  }

  snapshot(){
    return {
      version:1,
      strategies:[...this.records.values()].map(item=>({...item})),
      history:this.history.slice(-50).map(item=>({...item}))
    };
  }
}

export function createExperienceModel(options){return new NaraExperienceModel(options);}
