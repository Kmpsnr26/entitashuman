import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('Windows real-test runner remains operator-driven and fail-closed',async()=>{
  const [ps1,doc]=await Promise.all([
    readFile(new URL('scripts/humanale-real-test.ps1',root),'utf8'),
    readFile(new URL('docs/humanale-visual-studio-real-test.md',root),'utf8')
  ]);
  assert.match(ps1,/REAL_TEST_INCOMPLETE/);
  assert.match(ps1,/operator-windows-real-test/);
  assert.match(ps1,/visual-motion/);
  assert.match(ps1,/voice-id/);
  assert.match(ps1,/display-scaling/);
  assert.match(ps1,/panel-interaction/);
  assert.match(ps1,/desktop-install/);
  assert.doesNotMatch(ps1,/NARA.*dispatch|naraDispatch|integrationUnlocked/);
  assert.match(doc,/FINAL REAL-TEST PREFLIGHT/);
  assert.match(doc,/100%/);
  assert.match(doc,/125%/);
  assert.match(doc,/150%/);
  assert.match(doc,/persetujuan eksplisit pencipta/);
});
