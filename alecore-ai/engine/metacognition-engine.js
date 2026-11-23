const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));

export class AleMetacognitionEngine{
  evaluate({
    brain={},
    sensory={},
    goals={},
    autopilot={},
    capabilities={},
    experience={}
  }={}){
    const goalList=Array.isArray(goals.goals)?goals.goals:[];
    const taskList=Array.isArray(autopilot.scheduler?.tasks)?autopilot.scheduler.tasks:[];
    const pendingCaps=Array.isArray(capabilities.pending)?capabilities.pending.length:0;
    const blockedGoals=goalList.filter(goal=>goal.status==='blocked').length;
    const failedGoals=goalList.filter(goal=>goal.status==='failed').length;
    const runningTasks=taskList.filter(task=>task.status==='running').length;
    const failedTasks=taskList.filter(task=>task.status==='failed').length;
    const queuedTasks=taskList.filter(task=>task.status==='queued').length;
    const activeGoals=goalList.filter(goal=>goal.status==='active').length;
    const serverProblem=['offline','degraded'].includes(String(sensory.server?.health||''));
    const errorRegion=brain.regions?.ERROR_MONITOR?.status==='error';

    const workload=clamp01((runningTasks+queuedTasks*.35+activeGoals*.5)/6);
    const blockedRatio=clamp01((blockedGoals+failedGoals+failedTasks+pendingCaps)/(Math.max(1,goalList.length+taskList.length)));
    const uncertainty=clamp01(
      blockedRatio*.5+
      (serverProblem ? .2 : 0)+
      (errorRegion ? .18 : 0)+
      (pendingCaps ? .12 : 0)+
      workload*.12
    );

    const strategies=Array.isArray(experience.strategies)?experience.strategies:[];
    const experienced=strategies.filter(item=>(Number(item.runs)||0)>=2);
    const averageScore=experienced.length
      ?experienced.reduce((sum,item)=>sum+(Number(item.score)||0),0)/experienced.length
      :.5;

    const confidence=clamp01(
      .72+
      (averageScore-.5)*.35-
      uncertainty*.65-
      blockedRatio*.2
    );

    let recommendation='continue';
    if(pendingCaps>0)recommendation='ask-owner';
    else if(errorRegion||failedTasks>0||failedGoals>0)recommendation='recover';
    else if(confidence<.52||uncertainty>.55)recommendation='verify';

    const flags=[];
    if(pendingCaps>0)flags.push('owner-approval-pending');
    if(serverProblem)flags.push('server-health-risk');
    if(errorRegion)flags.push('runtime-error');
    if(blockedGoals>0)flags.push('goal-blocked');
    if(failedTasks>0)flags.push('task-failed');
    if(workload>.75)flags.push('high-workload');

    return Object.freeze({
      version:1,
      confidence,
      uncertainty,
      workload,
      blockedRatio,
      recommendation,
      flags:Object.freeze(flags),
      observables:Object.freeze({
        activeGoals,
        blockedGoals,
        failedGoals,
        runningTasks,
        queuedTasks,
        failedTasks,
        pendingCapabilities:pendingCaps,
        experiencedStrategies:experienced.length
      })
    });
  }
}

export function createMetacognitionEngine(){return new AleMetacognitionEngine();}
