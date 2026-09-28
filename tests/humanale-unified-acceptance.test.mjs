import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('V3.6 one-click wrapper runs HumanALE unified smoke and physical NARA GPU acceptance',async()=>{
  const [bat,ps1]=await Promise.all([
    read('HumanALE-Unified-Acceptance.bat'),
    read('scripts/humanale-unified-acceptance.ps1')
  ]);

  assert.match(bat,/NARA \+ HumanALE V3 - Unified Physical Acceptance/);
  assert.match(bat,/scripts\\humanale-unified-acceptance\.ps1/);
  assert.match(ps1,/desktop\\main\.cjs/);
  assert.match(ps1,/--ci-smoke/);
  assert.match(ps1,/DUDIDAM_CAPTURE_SMOKE/);
  assert.match(ps1,/nara-neural-gpu-acceptance\.ps1/);
  assert.match(ps1,/NARA Core \+ HumanALE Unified Runtime V3 lolos physical acceptance/);
});

test('V3.6 acceptance produces bounded evidence without embedding Creator credentials',async()=>{
  const ps1=await read('scripts/humanale-unified-acceptance.ps1');
  for(const marker of [
    'humanale-unified-acceptance.json',
    'humanale-unified.png',
    'nara-neural-live-report.json',
    'creator-owner-gate',
    'unified-runtime-v3',
    'renderer-event-deny'
  ])assert.equal(ps1.includes(marker),true,marker+' missing');

  assert.doesNotMatch(ps1,/NARA_CREATOR_PASSWORD|password\s*=|access[_-]?token|api[_-]?key/i);
  assert.match(ps1,/\$passed = \$desktopPassed -and \$gpuPassed/);
  assert.match(ps1,/gpuModeMatched/);
});

test('V3.6 acceptance leaves optional provider and local-voice smoke disabled by default',async()=>{
  const ps1=await read('scripts/humanale-unified-acceptance.ps1');
  assert.doesNotMatch(ps1,/DUDIDAM_COPILOT_SMOKE\s*=\s*['"]1['"]/);
  assert.doesNotMatch(ps1,/DUDIDAM_VOICE_SMOKE\s*=\s*['"]1['"]/);
});
