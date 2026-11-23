const safeText=(value,max=180)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.min(5000,Number(ms)||0))));
export const ALECORE_AI_AGENT_HANDLER_TIMEOUTS=Object.freeze({
  // Planner, Specialist, Worker, Reviewer and one verdict retry can run
  // sequentially. Analyze-stage agent timeouts are capped at five minutes.
  // Reserve five additional minutes for coordinator and cleanup overhead.
  analyzeMs:30*60*1000,
  // Work can include Planner (5m), Specialist (5m), Worker (10m),
  // Reviewer + bounded verdict retry (10m), Repair (10m), and
  // Final Reviewer (5m): up to 45m of sequential executor time.
  // Reserve ten additional minutes for transaction and cleanup overhead.
  workMs:55*60*1000
});

export class AleAgentCoordinator{
  constructor({ale,agentHub}={}){
    if(!ale?.registerAutopilotHandler||!ale?.queueAutopilotTask||!ale?.runAutopilotOnce){
      throw new Error('AleCore AI Agent Coordinator membutuhkan AleCore AI V2+.');
    }
    if(!agentHub?.run)throw new Error('AleCore AI Agent Coordinator membutuhkan HumanALE Agent Hub.');
    this.ale=ale;
    this.agentHub=agentHub;
    this.pending=new Map();
    this.sequence=0;
    this.bound=false;
  }

  bind(){
    if(this.bound)return this;
    this.ale.registerAutopilotHandler(
      'humanale.agent.analyze',
      context=>this.execute(context,'analyze'),
      {timeoutMs:ALECORE_AI_AGENT_HANDLER_TIMEOUTS.analyzeMs,idempotent:true}
    );
    this.ale.registerAutopilotHandler(
      'humanale.agent.work',
      context=>this.execute(context,'work'),
      {timeoutMs:ALECORE_AI_AGENT_HANDLER_TIMEOUTS.workMs}
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

  async execute({task,heartbeat,signal},expectedMode){
    const meta=this.pending.get(task.id);
    if(!meta)throw new Error('Metadata task Agent Hub tidak tersedia.');
    if(meta.mode!==expectedMode)throw new Error('Mode task Agent Hub tidak konsisten.');

    const label='Agent '+meta.id+' · '+(meta.mode==='work'?'mode kerja':'analisis');
    if(meta.memoryContext){
      this.ale.dispatch('context.used',{
        target:meta.memoryContext.target,
        count:meta.memoryContext.count,
        chars:meta.memoryContext.chars,
        source:'alecore-ai-agent-coordinator'
      });
    }

    this.ale.startWork({id:task.id,label});
    this.ale.dispatch('plan.start',{label:'Menyiapkan '+label,source:'alecore-ai-agent-coordinator'});
    this.ale.dispatch('agent.start',{label,source:'alecore-ai-agent-coordinator'});
    if(meta.mode==='work'){
      this.ale.dispatch('program.start',{
        label:'Menjalankan perubahan melalui '+meta.id,
        source:'alecore-ai-agent-coordinator'
      });
    }

    heartbeat();
    try{
      const result=await this.agentHub.run({
        id:meta.id,
        prompt:meta.prompt,
        mode:meta.mode,
        memoryContext:meta.memoryContext,
        signal
      });
      heartbeat();
      if(result?.error)throw new Error(String(result.error));
      if(meta.mode==='work'&&Number(result?.maintenance?.changedFiles||0)<=0){
        const error=new Error('Mode Kerja belum menghasilkan perubahan berkas. Periksa hasil executor dan izin sandbox; gunakan Analisis untuk tugas baca saja.');
        error.code='AGENT_WORK_NO_CHANGES';error.category='blocked';throw error;
      }
      const outputSummary=safeText(result?.text||result?.summary||result?.output||'',500);
      if(!outputSummary)throw new Error('Agent Hub mengembalikan hasil kosong; AleCore AI tidak dapat memverifikasi Goal.');
      const reviewerStages=Array.isArray(result?.stages)?result.stages.filter(stage=>stage?.role==='reviewer'):[];
      const reviewerText=String(reviewerStages.at(-1)?.text||'');
      // A final reviewer NEEDS_FIX always wins; aggregate status is not an independent review.
      const reviewerPassed=reviewerStages.length>0&&new RegExp('\\bVERDICT\\s*:\\s*PASS\\b','i').test(reviewerText);
      if(meta.mode==='work'&&!reviewerPassed){
        const error=new Error('Mode Kerja belum lolos verifikasi reviewer independen. AleCore AI menolak menyelesaikan Goal tanpa VERDICT: PASS.');
        error.code='AGENT_WORK_REVIEW_REQUIRED';error.category='verification';throw error;
      }
      const verificationSummary=meta.mode==='work'
        ? 'Reviewer independen memberikan VERDICT: PASS dan perubahan berkas terdeteksi: '+Number(result?.maintenance?.changedFiles||0)+' file.'
        : 'Output analisis Agent Hub tersedia dan tidak mengandung status error.';
      this.ale.recordGoalEvidence(task.goalId,{
        criterion:'Agent Hub menyelesaikan task',
        evidence:outputSummary,verified:true,source:'agent-hub-result'
      });
      this.ale.recordGoalEvidence(task.goalId,{
        criterion:'Hasil melewati lifecycle verifikasi AleCore AI',
        evidence:verificationSummary,verified:true,source:'alecore-ai-output-contract'
      });

      this.ale.dispatch('plan.complete',{source:'alecore-ai-agent-coordinator'});
      if(meta.mode==='work')this.ale.dispatch('program.complete',{source:'alecore-ai-agent-coordinator'});
      this.ale.dispatch('agent.complete',{label,source:'alecore-ai-agent-coordinator'});
      this.ale.dispatch('verify.start',{source:'alecore-ai-agent-coordinator'});
      this.ale.dispatch('verify.complete',{source:'alecore-ai-agent-coordinator'});
      this.ale.completeWork({source:'alecore-ai-agent-coordinator'});
      return result;
    }catch(error){
      this.ale.dispatch('agent.failed',{label,source:'alecore-ai-agent-coordinator'});
      this.ale.dispatch('work.failed',{id:task.id,label,source:'alecore-ai-agent-coordinator'});
      this.ale.dispatch('error.detected',{
        message:safeText(error?.message||'Agent gagal.',300),
        source:'alecore-ai-agent-coordinator'
      });
      throw error;
    }
  }

  async run(value={}){
    this.bind();
    const input=this.normalize(value);
    const {goalId,taskId}=this.nextIds(input.mode);
    // Keep the raw prompt process-local. Goal/task labels are persisted in Core state,
    // so they must contain only bounded operational metadata.
    const label=safeText(
      'Agent '+input.id+' · '+(input.mode==='work'?'mode kerja':'analisis'),
      180
    );

    this.ale.createGoal({
      id:goalId,
      label,
      priority:input.mode==='work'?85:70,
      successCriteria:[
        'Agent Hub menyelesaikan task',
        'Hasil melewati lifecycle verifikasi AleCore AI'
      ]
    });
    this.ale.activateGoal(goalId);
    this.pending.set(taskId,input);

    try{
      this.ale.queueAutopilotTask({
        id:taskId,
        goalId,
        label,
        handler:input.mode==='work'?'humanale.agent.work':'humanale.agent.analyze',
        priority:input.mode==='work'?85:70
      });

      let outcome=null;
      let retried=false;
      for(let cycle=0;cycle<3;cycle++){
        outcome=await this.ale.runAutopilotOnce();
        if(outcome.ok)break;
        if(outcome.reason==='autopilot-busy')break;
        if(outcome.decision?.action!=='retry')break;
        retried=true;
        await delay(outcome.decision.delayMs);
      }

      if(outcome?.ok){
        if(retried||outcome.recovered){
          const monitor=this.ale.state?.snapshot?.().regions?.ERROR_MONITOR;
          if(monitor?.lastEvent==='autopilot.task.failed'){
            this.ale.state.setRegion('ERROR_MONITOR',{
              status:'complete',
              activity:.2,
              message:'Recovery autopilot berhasil'
            },'autopilot.task.recovered');
            this.ale.dispatch('autopilot.task.recovered',{
              id:taskId,
              goalId,
              source:'alecore-ai-agent-coordinator'
            });
          }
        }
        const core=this.ale.snapshot();
        const goal=core.engine.goals.goals.find(item=>item.id===goalId)||null;
        return {
          ...outcome.result,
          ale:{
            goalId,
            taskId,
            goalStatus:goal?.status||'complete',
            metacognition:core.engine.metacognition
          }
        };
      }

      if(outcome?.reason==='autopilot-busy'){
        this.ale.scheduler.cancel(taskId);
        this.ale.failGoal(goalId,'Autopilot sedang menjalankan task lain.');
      }else{
        const current=this.ale.goals.get(goalId);
        if(current&&!['blocked','failed','complete'].includes(current.status)){
          this.ale.failGoal(goalId,outcome?.error||outcome?.reason||'Agent task gagal.');
        }
      }

      const core=this.ale.snapshot();
      const goal=core.engine.goals.goals.find(item=>item.id===goalId)||null;
      return {
        error:outcome?.error||outcome?.reason||'Agent task gagal.',
        reason:outcome?.reason||null,
        decision:outcome?.decision||null,
        ale:{
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

export function createAleAgentCoordinator(options){return new AleAgentCoordinator(options);}
