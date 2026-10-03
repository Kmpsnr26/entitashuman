import test from 'node:test';
import assert from 'node:assert/strict';
import {assertLoadedPage, assertNativeEvidence, waitFor} from '../scripts/android/runtime-smoke.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const loaded = {origin: 'https://localhost', platform: 'android', ready: 'complete', avatar: true, prompt: true, chat: true, ownerGate: false, sendEnabled: true};
test('Android acceptance rejects a splash, desktop page and inaccessible composer', () => {
  assert.doesNotThrow(() => assertLoadedPage(loaded));
  for (const change of [{origin: 'http://localhost'}, {platform: 'web'}, {ready: 'loading'}, {avatar: false}, {prompt: false}, {chat: false}, {ownerGate: true}, {sendEnabled: false}]) {
    assert.throws(() => assertLoadedPage({...loaded, ...change}));
  }
});

test('startup observation receives remaining budget and cannot pass after its deadline', async () => {
  let observedBudget;
  await assert.rejects(waitFor(async remaining => {
    observedBudget = remaining;
    await delay(20);
    return 'loaded';
  }, value => value === 'loaded', 'startup', 10), /Timed out waiting for startup/);
  assert.ok(observedBudget > 0 && observedBudget <= 10);
  await assert.rejects(waitFor(async () => { throw new Error('CDP Runtime.evaluate timed out'); }, () => true, 'startup'), /CDP Runtime.evaluate timed out/);
});

test('native acceptance rejects dead process, wrong foreground and app/renderer crashes', () => {
  const native = {process: '24121\n', foreground: 'topResumedActivity=ActivityRecord{ u0 id.my.aleprinting.humanale/.MainActivity}', crash: ''};
  assert.doesNotThrow(() => assertNativeEvidence(native));
  for (const change of [{process: ''}, {process: 'not-a-pid'}, {foreground: 'topResumedActivity=ActivityRecord{ u0 com.android.launcher/.Launcher}'}, {crash: '>>> id.my.aleprinting.humanale <<<'}, {crash: 'Fatal signal 5 (SIGTRAP) in tid 1 (CrRendererMain)'}, {crash: 'FATAL EXCEPTION: main'}]) {
    assert.throws(() => assertNativeEvidence({...native, ...change}));
  }
  assert.doesNotThrow(() => assertNativeEvidence({...native, crash: 'Fatal signal 6 (SIGABRT) in tid 1 (bt_stack_manage)'}));
});
