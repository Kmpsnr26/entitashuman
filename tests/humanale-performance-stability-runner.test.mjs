import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('performance stability runner is bounded and operator-evidence based',async()=>{
 const src=await readFile(new URL('scripts/humanale-performance-stability.ps1',root),'utf8');
 assert.match(src,/DurationSeconds = 60/);
 assert.match(src,/IntervalSeconds = 5/);
 assert.match(src,/humanale-performance-stability\/1/);
 assert.match(src,/PERFORMANCE_STABILITY_PASS/);
 assert.match(src,/allProcessesStayedAlive/);
 assert.match(src,/operatorStable/);
 assert.match(src,/rev-parse HEAD/);
 assert.doesNotMatch(src,/NARA.*dispatch|integrationUnlocked|authority-control/i);
});
