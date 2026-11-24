import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrchestrator} from '../nara-core/brain/orchestrator.js';
import {createBrainState} from '../nara-core/brain/brain-state.js';
import {ALECORE_LIFECYCLE_EVENTS,LEGACY_LIFECYCLE_EVENTS,canonicalLifecycleEvent} from '../nara-core/brain/lifecycle-events.js';

test('orchestrator emits canonical AleCore lifecycle events and keeps idempotent start/stop',()=>{
  const nara=createOrchestrator();
  const startEvents=[];
  nara.bus.onAny(envelope=>startEvents.push(envelope.event));

  nara.start();
  nara.start();
  assert.deepEqual(startEvents,[ALECORE_LIFECYCLE_EVENTS.start]);
  assert.equal(nara.snapshot().lifecycle,'active');

  nara.stop();
  nara.stop();
  assert.deepEqual(startEvents,[ALECORE_LIFECYCLE_EVENTS.start,ALECORE_LIFECYCLE_EVENTS.shutdown]);
  assert.equal(nara.snapshot().lifecycle,'offline');
});

test('brain state accepts canonical and legacy lifecycle events while preserving the original event in diagnostics',()=>{
  for(const [event,expectedLifecycle,expectedStatus] of [
    [ALECORE_LIFECYCLE_EVENTS.start,'active','active'],
    [ALECORE_LIFECYCLE_EVENTS.shutdown,'offline','offline'],
    [LEGACY_LIFECYCLE_EVENTS.start,'active','active'],
    [LEGACY_LIFECYCLE_EVENTS.shutdown,'offline','offline']
  ]){
    const state=createBrainState();
    state.applyEvent({id:1,event,payload:{},timestamp:123});
    const snapshot=state.snapshot();
    assert.equal(snapshot.lifecycle,expectedLifecycle,event);
    assert.equal(snapshot.regions.NARA_CORE.status,expectedStatus,event);
    assert.equal(snapshot.lastEvent.event,event);
  }
});

test('legacy lifecycle event mapping is narrow and leaves unrelated events untouched',()=>{
  assert.equal(canonicalLifecycleEvent(LEGACY_LIFECYCLE_EVENTS.start),ALECORE_LIFECYCLE_EVENTS.start);
  assert.equal(canonicalLifecycleEvent(LEGACY_LIFECYCLE_EVENTS.shutdown),ALECORE_LIFECYCLE_EVENTS.shutdown);
  assert.equal(canonicalLifecycleEvent('work.start'),'work.start');
});
