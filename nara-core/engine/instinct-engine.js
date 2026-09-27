const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));

export class NaraInstinctEngine{
  evaluate({sensory={},diagnostics={},task={}}={}){
    const anomalies=[];
    let urgency=0,risk=0,attention=.2;

    const memory=clamp01(sensory.system?.memoryUsedRatio);
    const cpu=clamp01(sensory.system?.cpuLoad);
    const serverHealth=String(sensory.server?.health||'unknown');
    const failures=Math.max(0,Number(diagnostics.failures)||0);
    const errors=Math.max(0,Number(diagnostics.errors)||0);

    if(memory>.9){anomalies.push('memory-pressure');risk=Math.max(risk,.82);urgency=Math.max(urgency,.72);}
    else if(memory>.78){anomalies.push('memory-elevated');risk=Math.max(risk,.45);}

    if(cpu>.95){anomalies.push('cpu-saturation');risk=Math.max(risk,.7);urgency=Math.max(urgency,.6);}
    else if(cpu>.85){anomalies.push('cpu-elevated');risk=Math.max(risk,.4);}

    if(serverHealth==='offline'){anomalies.push('server-offline');risk=Math.max(risk,.9);urgency=Math.max(urgency,.9);}
    else if(serverHealth==='degraded'){anomalies.push('server-degraded');risk=Math.max(risk,.6);urgency=Math.max(urgency,.55);}

    if(errors>0||failures>0){
      anomalies.push('runtime-failure');
      risk=Math.max(risk,Math.min(1,.35+(errors+failures)*.12));
      urgency=Math.max(urgency,.45);
    }

    if(task.status==='stalled'){
      anomalies.push('task-stalled');
      risk=Math.max(risk,.72);
      urgency=Math.max(urgency,.75);
    }

    const hearing=clamp01(sensory.hearing?.energy);
    const vision=clamp01(sensory.vision?.activity);
    attention=Math.max(attention,hearing*.6,vision*.55,urgency);

    const confidence=clamp01(1-risk*.62-(anomalies.length?Math.min(.25,anomalies.length*.05):0));

    return Object.freeze({
      urgency:clamp01(urgency),
      risk:clamp01(risk),
      attention:clamp01(attention),
      confidence,
      anomalies:Object.freeze(anomalies)
    });
  }
}

export function createInstinctEngine(){return new NaraInstinctEngine();}
