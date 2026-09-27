const safeText=(value,max=180)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.min(5000,Number(ms)||0))));

export class NaraAgentCoordinator{
  constructor({nara,agentHub}={}){
    if(!nara?.registerAutopilotHandler||!nara?.queueAutopilotTask||!nara?.runAutopilotOnce){
      throw new Error('NARA Agent Coordinator membutuhkan NARA Core V2+.');
    }
    if(!agentHub?.run)throw new Error('NARA Agent Coordinator membutuhkan HumanALE Agent Hub.');
    this.nara=nara;
    this.agentHub=agentHub;
    this.pending=new Map();
    this.sequence=0;
    this.bound=false;
  }

  bind(){
    if(this.bound)return this;
    this.nara.registerAutopilotHandler(
      'humanale.agent.analyze',
      context=>this.execute(context,'analyze'),
      {timeoutMs:15*60*1000}
    );
    this.nara.registerAutopilotHandler(
      'humanale.agent.work',
      context=>this.execute(context,'work'),
      {timeoutMs:15*60*1000}
    );
    this.bound=true;
    return this;
  }

  normalize(value={}){
    const id=safeText(value.id||'humanale-orchestrator',80);
    const prompt=String(value.prompt||'').trim();
    if(!id)throw new Error('Agent ID wajib diisi.');
    if(!prompt||prompt.length>4000)throw new Error('Prompt agent harus berisi 1–4000 karakter.');
    const mode=value.mode==='work'?'work':'analyze';
    return {
      id,
      prompt,
      mode,
      memoryContext:value.memoryContext||null
    };
  }

  nextIds(mode){
    const suffix=(++this.sequence).toString(36);
    const stamp=Date.now().toString(36);
    return {
      goalId:'agent-goal-'+mode+'-'+stamp+'-'+suffix,
      taskId:'agent-task-'+mode+'-'+stamp+'-'+suffix
    };
  }

  async execute({task,heartbeat},expectedMode){
    const meta=this.pending.get(task.id);
    if(!meta)throw new Error('Metadata task Agent Hub tidak tersedia.');
    if(meta.mode!==expectedMode)throw new Error('Mode task Agent Hub tidak konsisten.');

    const label='Agent '+meta.id+' · '+(meta.mode==='work'?'mode kerja':'analisis');
    if(meta.memoryContext){
      this.nara.dispatch('context.used',{
        target:meta.memoryContext.target,
        count:meta.memoryContext.count,
        chars:meta.memoryContext.chars,
        source:'nara-agent-coordinator'
      });
    }

    this.nara.startWork({id:task.id,label});
    this.nara.dispatch('plan.start',{label:'Menyiapkan '+label,source:'nara-agent-coordinator'});
    this.nara.dispatch('agent.start',{label,source:'nara-agent-coordinator'});
    if(meta.mode==='work'){
      this.nara.dispatch('program.start',{
        label:'Menjalankan perubahan melalui '+meta.id,
        source:'nara-agent-coordinator'
      });
    }

    heartbeat();
    try{
      const result=await this.agentHub.run({
        id:meta.id,
        prompt:meta.prompt,
        mode:meta.mode,
        memoryContext:meta.memoryContext
      });
      heartbeat();
      if(result?.error)throw new Error(String(result.error));

      this.nara.dispatch('plan.complete',{source:'nara-agent-coordinator'});
      if(meta.mode==='work')this.nara.dispatch('program.complete',{source:'nara-agent-coordinator'});
      this.nara.dispatch('agent.complete',{label,source:'nara-agent-coordinator'});
      this.nara.dispatch('verify.start',{source:'nara-agent-coordinator'});
      this.nara.dispatch('verify.complete',{source:'nara-agent-coordinator'});
      this.nara.completeWork({source:'nara-agent-coordinator'});
      return result;
    }catch(error){
      this.nara.dispatch('agent.failed',{label,source:'nara-agent-coordinator'});
      this.nara.dispatch('work.failed',{id:task.id,label,source:'nara-agent-coordinator'});
      this.nara.dispatch('error.detected',{
        message:safeText(error?.message||'Agent gagal.',300),
        source:'nara-agent-coordinator'
      });
      throw error;
    }
  }

  async run(value={}){
    this.bind();
    const input=this.normalize(value);
    const {goalId,taskId}=this.nextIds(input.mode);
    const label=safeText(
      (input.mode==='work'?'Kerjakan':'Analisis')+' dengan '+input.id+': '+input.prompt,
      180
    );

    this.nara.createGoal({
      id:goalId,
      label,
      priority:input.mode==='work'?85:70,
      successCriteria:[
        'Agent Hub menyelesaikan task',
        'Hasil melewati lifecycle verifikasi NARA'
      ]
    });
    this.nara.activateGoal(goalId);
    this.pending.set(taskId,input);

    try{
      this.nara.queueAutopilotTask({
        id:taskId,
        goalId,
        label,
        handler:input.mode==='work'?'humanale.agent.work':'humanale.agent.analyze',
        priority:input.mode==='work'?85:70
      });

      let outcome=null;
      for(let cycle=0;cycle<3;cycle++){
        outcome=await this.nara.runAutopilotOnce();
        if(outcome.ok)break;
        if(outcome.reason==='autopilot-busy')break;
        if(outcome.decision?.action!=='retry')break;
        await delay(outcome.decision.delayMs);
      }

      if(outcome?.ok){
        const core=this.nara.snapshot();
        const goal=core.engine.goals.goals.find(item=>item.id===goalId)||null;
        return {
          ...outcome.result,
          nara:{
            goalId,
            taskId,
            goalStatus:goal?.status||'complete',
            metacognition:core.engine.metacognition
          }
        };
      }

      if(outcome?.reason==='autopilot-busy'){
        this.nara.scheduler.cancel(taskId);
        this.nara.failGoal(goalId,'Autopilot sedang menjalankan task lain.');
      }else{
        const current=this.nara.goals.get(goalId);
        if(current&&!['blocked','failed','complete'].includes(current.status)){
          this.nara.failGoal(goalId,outcome?.error||outcome?.reason||'Agent task gagal.');
        }
      }

      const core=this.nara.snapshot();
      const goal=core.engine.goals.goals.find(item=>item.id===goalId)||null;
      return {
        error:outcome?.error||outcome?.reason||'Agent task gagal.',
        nara:{
          goalId,
          taskId,
          goalStatus:goal?.status||'failed',
          metacognition:core.engine.metacognition
        }
      };
    }finally{
      this.pending.delete(taskId);
    }
  }

  snapshot(){
    return {
      version:1,
      bound:this.bound,
      pending:this.pending.size,
      handlers:['humanale.agent.analyze','humanale.agent.work']
    };
  }
}

export function createNaraAgentCoordinator(options){return new NaraAgentCoordinator(options);}
