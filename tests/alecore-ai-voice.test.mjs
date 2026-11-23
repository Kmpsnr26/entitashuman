import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceFeedback,ALECORE_AI_VOICE_PROFILE,voiceCueForEvent} from '../alecore-ai/voice/index.js';

test('AleCore AI voice profile uses Indonesian adult robot feedback without changing assistant voice settings',()=>{
  assert.equal(ALECORE_AI_VOICE_PROFILE.language,'id-ID');
  assert.equal(ALECORE_AI_VOICE_PROFILE.style,'adult-robot');
  assert.equal(ALECORE_AI_VOICE_PROFILE.maxQueue,6);
});

test('voice feedback maps meaningful AleCore AI events and ignores continuous sensory telemetry',()=>{
  assert.equal(voiceCueForEvent({event:'ale.start'}).text,'AleCore AI aktif. Sistem HumanALE siap.');
  assert.equal(voiceCueForEvent({event:'brain.region.select',payload:{region:'MEMORY'}}).text,'Membuka Memory.');
  assert.equal(voiceCueForEvent({event:'bug.detected'}).priority,'high');
  assert.equal(voiceCueForEvent({event:'audio.energy',payload:{energy:.8}}),null);
  assert.equal(voiceCueForEvent({event:'speech.energy',payload:{energy:.5}}),null);
  assert.equal(voiceCueForEvent({event:'vision.frame'}),null);
});

test('voice feedback deduplicates repeated events by cooldown while allowing distinct events',()=>{
  let now=10000;
  const voice=createVoiceFeedback({now:()=>now});
  const first=voice.consume({event:'terminal.open',payload:{}});
  assert.ok(first);
  assert.equal(first.style,'adult-robot');
  assert.equal(voice.consume({event:'terminal.open',payload:{}}),null);
  now+=2300;
  assert.ok(voice.consume({event:'terminal.open',payload:{}}));
  assert.ok(voice.consume({event:'github.connected',payload:{}}));
});
