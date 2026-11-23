import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAleCoreVoiceFeedback,
  createVoiceFeedback,
  ALECORE_AI_VOICE_PROFILE,
  NARA_VOICE_PROFILE,
  alecoreVoiceProfile,
  voiceCueForEvent
} from '../nara-core/voice/index.js';

test('AleCore AI voice profile is Indonesian adult robot feedback with legacy aliases',()=>{
  assert.equal(ALECORE_AI_VOICE_PROFILE.language,'id-ID');
  assert.equal(ALECORE_AI_VOICE_PROFILE.style,'adult-robot');
  assert.equal(ALECORE_AI_VOICE_PROFILE.maxQueue,6);
  assert.strictEqual(NARA_VOICE_PROFILE,ALECORE_AI_VOICE_PROFILE);
  assert.deepEqual(alecoreVoiceProfile(),{...ALECORE_AI_VOICE_PROFILE});
});

test('voice feedback maps meaningful events and ignores continuous sensory telemetry',()=>{
  assert.equal(voiceCueForEvent({event:'nara.start'}).text,'NARA aktif. Sistem HumanALE siap.');
  assert.equal(voiceCueForEvent({event:'brain.region.select',payload:{region:'MEMORY'}}).text,'Membuka Memory.');
  assert.equal(voiceCueForEvent({event:'bug.detected'}).priority,'high');
  assert.equal(voiceCueForEvent({event:'audio.energy',payload:{energy:.8}}),null);
  assert.equal(voiceCueForEvent({event:'speech.energy',payload:{energy:.5}}),null);
  assert.equal(voiceCueForEvent({event:'vision.frame'}),null);
});

test('AleCore voice feedback preserves deduplication and the deprecated factory alias',()=>{
  let now=10000;
  const voice=createAleCoreVoiceFeedback({now:()=>now});
  const first=voice.consume({event:'terminal.open',payload:{}});
  assert.ok(first);
  assert.equal(first.style,'adult-robot');
  assert.equal(voice.consume({event:'terminal.open',payload:{}}),null);
  now+=2300;
  assert.ok(voice.consume({event:'terminal.open',payload:{}}));
  assert.ok(voice.consume({event:'github.connected',payload:{}}));
  assert.equal(createVoiceFeedback().constructor.name,'AleCoreVoiceFeedback');
});
