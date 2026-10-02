export const HUMANALE_REAL_TEST_PROTOCOL='humanale-visual-real-test/1';

export const HUMANALE_REAL_TEST_CHECKS=Object.freeze([
 Object.freeze({id:'runtime-telemetry',label:'Runtime telemetry live',kind:'automated'}),
 Object.freeze({id:'renderer-health',label:'Renderer FPS / face points',kind:'automated'}),
 Object.freeze({id:'runtime-errors',label:'Runtime tanpa error aktif',kind:'automated'}),
 Object.freeze({id:'skill-lab',label:'Skill & capability snapshot',kind:'automated'}),
 Object.freeze({id:'controlled-recovery',label:'Controlled test + restore',kind:'automated'}),
 Object.freeze({id:'visual-motion',label:'Blink, gaze, lips, ears, neural/core motion',kind:'real-device'}),
 Object.freeze({id:'voice-id',label:'Microphone + STT/TTS Indonesia + Wake ALE',kind:'real-device'}),
 Object.freeze({id:'display-scaling',label:'Windows scaling 100% / 125% / 150%',kind:'real-device'}),
 Object.freeze({id:'panel-interaction',label:'Click-through + detached panel',kind:'real-device'}),
 Object.freeze({id:'desktop-install',label:'Installer/portable di Windows target',kind:'real-device'})
]);

const freeze=value=>Object.freeze(value);
const safeStatus=value=>['pass','fail','pending','blocked'].includes(value)?value:'pending';
const bound=(value,max=180)=>String(value??'').trim().slice(0,max);

function evidenceMap(value={}){
 const out={};
 for(const item of HUMANALE_REAL_TEST_CHECKS){
  const row=value?.[item.id]||{};
  out[item.id]=freeze({
   status:safeStatus(row.status),
   note:bound(row.note,240),
   source:bound(row.source,80),
   timestamp:Number(row.timestamp)||0
  });
 }
 return freeze(out);
}

export function evaluateHumanALEVisualRealTestPreflight({snapshot={},testHistory=[],evidence={}}={}){
 const saved=evidenceMap(evidence);
 const history=Array.isArray(testHistory)?testHistory:[];
 const automated={
  'runtime-telemetry': snapshot?.timestamp&&snapshot?.runtime?.state&&snapshot?.runtime?.rendererMode
   ? {status:'pass',note:'Live snapshot tersedia.','source':'visual-studio'}
   : {status:'fail',note:'Live snapshot belum tersedia.','source':'visual-studio'},
  'renderer-health': Number(snapshot?.performance?.fps)>0&&Number(snapshot?.performance?.points)>0
   ? {status:'pass',note:Number(snapshot.performance.fps)+' FPS / '+Number(snapshot.performance.points)+' points','source':'renderer'}
   : {status:'fail',note:'FPS/points belum terbaca.','source':'renderer'},
  'runtime-errors': Number(snapshot?.health?.errorCount||0)===0
   ? {status:'pass',note:'Tidak ada runtime error aktif.','source':'health-scan'}
   : {status:'fail',note:Number(snapshot?.health?.errorCount||0)+' runtime error aktif.','source':'health-scan'},
  'skill-lab': Number(snapshot?.skillCounts?.total||0)>0&&Number(snapshot?.skillCounts?.error||0)===0
   ? {status:'pass',note:Number(snapshot.skillCounts.total)+' skill terdeteksi; error=0.','source':'skill-lab'}
   : {status:'fail',note:'Skill snapshot belum sehat/tersedia.','source':'skill-lab'},
  'controlled-recovery': history.some(item=>item?.ok===true)
   ? {status:'pass',note:'Minimal satu controlled test selesai dan restore.','source':'controlled-test'}
   : {status:'pending',note:'Jalankan minimal satu controlled test sampai PASS.','source':'controlled-test'}
 };
 const checks=HUMANALE_REAL_TEST_CHECKS.map(def=>{
  const source=def.kind==='automated'?automated[def.id]:saved[def.id];
  return freeze({...def,...source});
 });
 const automatedChecks=checks.filter(item=>item.kind==='automated');
 const realChecks=checks.filter(item=>item.kind==='real-device');
 const automatedBlocked=automatedChecks.some(item=>item.status==='fail'||item.status==='blocked');
 const automatedPending=automatedChecks.some(item=>item.status==='pending');
 const realFailed=realChecks.some(item=>item.status==='fail'||item.status==='blocked');
 const realPending=realChecks.some(item=>item.status!=='pass');
 const readyForRealTest=!automatedBlocked&&!automatedPending;
 const fullyValidated=readyForRealTest&&!realFailed&&!realPending;
 return freeze({
  protocol:HUMANALE_REAL_TEST_PROTOCOL,
  mode:'FAIL_CLOSED',
  readyForRealTest,
  fullyValidated,
  state:fullyValidated?'REAL_TEST_PASS':readyForRealTest?'READY_FOR_REAL_TEST':'PRECHECK_REQUIRED',
  counts:freeze({
   total:checks.length,
   pass:checks.filter(item=>item.status==='pass').length,
   fail:checks.filter(item=>item.status==='fail').length,
   blocked:checks.filter(item=>item.status==='blocked').length,
   pending:checks.filter(item=>item.status==='pending').length,
   realDevicePending:realChecks.filter(item=>item.status!=='pass').length
  }),
  checks:freeze(checks),
  blockers:freeze(checks.filter(item=>item.status==='fail'||item.status==='blocked').map(item=>item.id))
 });
}

export function normalizeHumanALERealTestEvidence(value={}){
 return evidenceMap(value);
}
