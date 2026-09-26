import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateHumanALEVisualRealTestPreflight,HUMANALE_REAL_TEST_CHECKS} from '../public/humanale-visual-real-test.js';

const healthy={
 timestamp:1,
 runtime:{state:'idle',rendererMode:'eco'},
 performance:{fps:60,points:4200},
 health:{errorCount:0},
 skillCounts:{total:16,error:0}
};

test('real-test preflight is fail-closed without automated runtime evidence',()=>{
 const r=evaluateHumanALEVisualRealTestPreflight({});
 assert.equal(r.state,'PRECHECK_REQUIRED');
 assert.equal(r.readyForRealTest,false);
 assert.ok(r.blockers.includes('runtime-telemetry'));
});

test('healthy automated evidence becomes READY_FOR_REAL_TEST but never fakes real-device PASS',()=>{
 const r=evaluateHumanALEVisualRealTestPreflight({snapshot:healthy,testHistory:[{ok:true}]});
 assert.equal(r.readyForRealTest,true);
 assert.equal(r.fullyValidated,false);
 assert.equal(r.state,'READY_FOR_REAL_TEST');
 assert.equal(r.counts.realDevicePending,5);
 assert.equal(r.checks.find(x=>x.id==='visual-motion').status,'pending');
});

test('explicit real-device evidence is required for REAL_TEST_PASS',()=>{
 const evidence=Object.fromEntries(
  HUMANALE_REAL_TEST_CHECKS.filter(x=>x.kind==='real-device').map(x=>[x.id,{status:'pass',source:'operator',timestamp:2}])
 );
 const r=evaluateHumanALEVisualRealTestPreflight({snapshot:healthy,testHistory:[{ok:true}],evidence});
 assert.equal(r.state,'REAL_TEST_PASS');
 assert.equal(r.fullyValidated,true);
 assert.equal(r.counts.pending,0);
});
