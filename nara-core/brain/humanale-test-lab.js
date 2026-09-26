const freezeSteps=steps=>Object.freeze(steps.map(step=>Object.freeze({
 event:String(step.event),
 payload:Object.freeze({...step.payload}),
 waitMs:Math.max(0,Math.min(1200,Number(step.waitMs)||0))
})));

export const HUMANALE_TEST_SCENARIOS=Object.freeze({
 listening:Object.freeze({
  id:'listening',
  label:'Listening cycle',
  steps:freezeSteps([
   {event:'hearing.start',payload:{source:'visual-studio-test'},waitMs:420},
   {event:'hearing.stop',payload:{source:'visual-studio-test'},waitMs:180}
  ]),
  cleanup:Object.freeze(['hearing.stop'])
 }),
 thinking:Object.freeze({
  id:'thinking',
  label:'Thinking cycle',
  steps:freezeSteps([
   {event:'reason.start',payload:{label:'Visual Studio controlled thinking test',source:'visual-studio-test'},waitMs:420},
   {event:'reason.complete',payload:{source:'visual-studio-test'},waitMs:180}
  ]),
  cleanup:Object.freeze(['reason.complete'])
 }),
 speaking:Object.freeze({
  id:'speaking',
  label:'Speaking cycle',
  steps:freezeSteps([
   {event:'speech.start',payload:{energy:.72,source:'visual-studio-test'},waitMs:420},
   {event:'speech.stop',payload:{source:'visual-studio-test'},waitMs:180}
  ]),
  cleanup:Object.freeze(['speech.stop'])
 }),
 processing:Object.freeze({
  id:'processing',
  label:'Processing cycle',
  steps:freezeSteps([
   {event:'work.start',payload:{id:'visual-studio-test',label:'Visual Studio controlled work test',source:'visual-studio-test'},waitMs:420},
   {event:'work.complete',payload:{source:'visual-studio-test'},waitMs:180}
  ]),
  cleanup:Object.freeze(['work.complete'])
 }),
 error:Object.freeze({
  id:'error',
  label:'Error recovery cycle',
  steps:freezeSteps([
   {event:'error.detected',payload:{message:'Visual Studio synthetic diagnostic error',source:'visual-studio-test'},waitMs:420},
   {event:'diagnostic.reset',payload:{source:'visual-studio-test'},waitMs:180}
  ]),
  cleanup:Object.freeze(['diagnostic.reset'])
 }),
 full:Object.freeze({
  id:'full',
  label:'Full HumanALE state cycle',
  steps:freezeSteps([
   {event:'hearing.start',payload:{source:'visual-studio-test'},waitMs:260},
   {event:'hearing.stop',payload:{source:'visual-studio-test'},waitMs:120},
   {event:'reason.start',payload:{label:'Visual Studio full-cycle reasoning',source:'visual-studio-test'},waitMs:260},
   {event:'reason.complete',payload:{source:'visual-studio-test'},waitMs:120},
   {event:'speech.start',payload:{energy:.72,source:'visual-studio-test'},waitMs:260},
   {event:'speech.stop',payload:{source:'visual-studio-test'},waitMs:120},
   {event:'work.start',payload:{id:'visual-studio-full-test',label:'Visual Studio full-cycle work',source:'visual-studio-test'},waitMs:260},
   {event:'work.complete',payload:{source:'visual-studio-test'},waitMs:120},
   {event:'error.detected',payload:{message:'Visual Studio synthetic diagnostic error',source:'visual-studio-test'},waitMs:260},
   {event:'diagnostic.reset',payload:{source:'visual-studio-test'},waitMs:180}
  ]),
  cleanup:Object.freeze(['hearing.stop','reason.complete','speech.stop','work.complete','diagnostic.reset'])
 })
});

export function getHumanALETestScenario(value=''){
 const key=String(value||'').toLowerCase();
 return HUMANALE_TEST_SCENARIOS[key]||null;
}

export function listHumanALETestScenarios(){
 return Object.values(HUMANALE_TEST_SCENARIOS).map(({id,label,steps})=>({
  id,label,durationMs:steps.reduce((sum,step)=>sum+step.waitMs,0),steps:steps.length
 }));
}
