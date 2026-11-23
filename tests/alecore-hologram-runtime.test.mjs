import test from 'node:test';
import assert from 'node:assert/strict';

await import('../sites/humanale-hologram/dist/nara-runtime.js');

test('AleCore hologram runtime exposes the canonical global and keeps its legacy alias',()=>{
  assert.ok(globalThis.AleCoreAIRuntime);
  assert.strictEqual(globalThis.AleCoreAIRuntime,globalThis.HumanALENaraRuntime);
});

test('AleCore lifecycle events drive the same runtime while legacy start/stop stay available',()=>{
  const cues=[];
  const regions=[{id:'NARA_CORE',label:'AleCore AI',defaultStatus:'ready'}];
  const runtime=globalThis.AleCoreAIRuntime.create({regions,onVoice:cue=>cues.push(cue)});
  const started=runtime.startAleCore();
  assert.equal(started.event,'alecore.start');
  assert.equal(runtime.snapshot().lifecycle,'active');
  assert.equal(cues.at(-1).text,'AleCore AI aktif. Sistem HumanALE siap.');
  const stopped=runtime.stopAleCore();
  assert.equal(stopped.event,'alecore.shutdown');
  assert.equal(runtime.snapshot().lifecycle,'offline');
  assert.equal(cues.at(-1).text,'AleCore AI dihentikan. Sampai bertemu kembali.');

  const legacy=globalThis.HumanALENaraRuntime.create({regions,onVoice:cue=>cues.push(cue)});
  assert.equal(legacy.start().event,'nara.start');
  assert.equal(cues.at(-1).text,'AleCore AI aktif. Sistem HumanALE siap.');
});

test('invalid region input never becomes spoken voice copy',()=>{
  const runtime=globalThis.AleCoreAIRuntime.create({regions:[]});
  assert.equal(runtime.voice.map({event:'brain.region.select',payload:{region:'UNKNOWN'}}).text,'Membuka modul AleCore AI.');
});
