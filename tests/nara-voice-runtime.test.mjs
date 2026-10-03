import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('NARA runtime publishes voice cues from the event bus without exposing arbitrary speech IPC',async()=>{
  const [main,preload,runtimeHost]=await Promise.all([
    readFile(new URL('desktop/main.cjs',root),'utf8'),
    readFile(new URL('desktop/preload.cjs',root),'utf8'),
    readFile(new URL('desktop/humanale-runtime-host.mjs',root),'utf8')
  ]);
  assert.match(main,/createVoiceFeedback/);
  assert.match(main,/voiceFeedback:naraVoice/);
  assert.match(main,/onExperienceDirty:scheduleExperienceSave/);
  assert.match(runtimeHost,/this\.nara\.bus\.onAny\(envelope=>\{/);
  assert.match(runtimeHost,/this\.consumeEnvelope\(envelope\)/);
  assert.match(runtimeHost,/this\.publishState\(this\.nara\.snapshot\(\)\)/);
  assert.match(runtimeHost,/this\.voiceFeedback\?\.consume\?\.\(envelope\)/);
  assert.match(runtimeHost,/autopilot\.task\.complete/);
  assert.match(runtimeHost,/dudidam:nara-voice/);
  assert.match(main,/announceNaraEvent\('nara\.start'\)/);
  assert.match(main,/announceNaraEvent\('nara\.shutdown'\)/);
  assert.match(preload,/onNaraVoice:callback/);
  assert.doesNotMatch(preload,/naraSpeak|naraVoiceText|naraRawSpeech/);
});

test('NARA voice queue is bounded, non-panel, and does not interrupt active speech',async()=>{
  const app=await readFile(new URL('public/app.js',root),'utf8');
  assert.match(app,/naraVoiceQueue/);
  assert.match(app,/if\(naraVoiceQueue\.length>6\)naraVoiceQueue\.pop\(\)/);
  assert.match(app,/if\(panelOnly\|\|!voice\|\|!cue\?\.text\)return/);
  assert.match(app,/naraSpeechBusy\(\)/);
  assert.match(app,/source:'nara',interrupt:false/);
  assert.match(app,/desktop\?\.onNaraVoice\?\.\(cue=>enqueueNaraVoice\(cue\)\)/);
});

test('adult robot style is available in UI, local Piper and native Indonesian fallback',async()=>{
  const [html,app,tts,python]=await Promise.all([
    readFile(new URL('public/index.html',root),'utf8'),
    readFile(new URL('public/app.js',root),'utf8'),
    readFile(new URL('desktop/indonesian-tts.mjs',root),'utf8'),
    readFile(new URL('desktop/speak_id.py',root),'utf8')
  ]);
  assert.match(html,/value="adult-robot">Pria dewasa · bas &amp; gema panjang/);
  assert.match(app,/const voiceStyle=HUMANALE_VOICE.style/);
  assert.match(app,/style==='adult-robot'/);
  assert.match(app,/source==='nara'&&!localTtsRejected&&desktop\?\.synthesize/);
  assert.match(app,/if\(speakNativeIndonesian\(text,style\)\)return;/);
  assert.match(tts,/\['natural','baby-robot','adult-robot'\]/);
  assert.match(python,/def adult_robot_effect/);
  assert.match(python,/style in \('baby-robot', 'adult-robot'\)/);
  assert.match(python,/elif style == 'adult-robot'/);
});

test('spoken output feeds real speech lifecycle back into NARA BrainState',async()=>{
  const app=await readFile(new URL('public/app.js',root),'utf8');
  assert.match(app,/naraDispatch\('speech\.start'/);
  assert.match(app,/naraDispatch\('speech\.energy'/);
  assert.match(app,/naraDispatch\('speech\.stop'/);
  assert.match(app,/lastNaraSpeechSent>140/);
});
