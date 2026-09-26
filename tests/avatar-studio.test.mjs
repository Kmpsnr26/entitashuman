import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import {
 AVATAR_STUDIO_DEFAULTS,
 AVATAR_STUDIO_LIMITS,
 normalizeAvatarStudioProfile,
 transformAvatarStudioPoint
} from '../public/avatar-studio-profile.js';

test('Avatar Live Studio profile clamps malformed values to safe finite bounds',()=>{
 const profile=normalizeAvatarStudioProfile({
  headWidth:99,
  headHeight:-4,
  cheekVolume:'1.12',
  jawWidth:NaN,
  eyeSpacing:Infinity,
  depth:.2,
  density:0
 });
 assert.equal(profile.headWidth,AVATAR_STUDIO_LIMITS.headWidth[1]);
 assert.equal(profile.headHeight,AVATAR_STUDIO_LIMITS.headHeight[0]);
 assert.equal(profile.cheekVolume,1.12);
 assert.equal(profile.jawWidth,AVATAR_STUDIO_DEFAULTS.jawWidth);
 assert.equal(profile.eyeSpacing,AVATAR_STUDIO_DEFAULTS.eyeSpacing);
 assert.equal(profile.depth,AVATAR_STUDIO_LIMITS.depth[0]);
 assert.equal(profile.density,AVATAR_STUDIO_LIMITS.density[0]);
 for(const value of Object.values(profile))assert.equal(Number.isFinite(value),true);
});

test('Avatar Live Studio geometry transform stays finite and localizes cheek, jaw and eye shaping',()=>{
 const base=transformAvatarStudioPoint({x:.22,y:.10,z:.25},AVATAR_STUDIO_DEFAULTS);
 const cheek=transformAvatarStudioPoint({x:.22,y:.10,z:.25},{...AVATAR_STUDIO_DEFAULTS,cheekVolume:1.2});
 assert.ok(cheek.x>base.x);
 assert.ok(cheek.z>base.z);

 const jawBase=transformAvatarStudioPoint({x:.20,y:.38,z:.2},AVATAR_STUDIO_DEFAULTS);
 const jawWide=transformAvatarStudioPoint({x:.20,y:.38,z:.2},{...AVATAR_STUDIO_DEFAULTS,jawWidth:1.18});
 assert.ok(jawWide.x>jawBase.x);

 const eyeBase=transformAvatarStudioPoint({x:.205,y:-.067,z:.2},AVATAR_STUDIO_DEFAULTS);
 const eyeWide=transformAvatarStudioPoint({x:.205,y:-.067,z:.2},{...AVATAR_STUDIO_DEFAULTS,eyeSpacing:1.12});
 assert.ok(eyeWide.x>eyeBase.x);

 const invalid=transformAvatarStudioPoint({x:NaN,y:Infinity,z:'bad'},{headWidth:'bad'});
 assert.deepEqual(invalid,{x:0,y:0,z:0});
});

test('Avatar Live Studio is wired as a detached live editor with explicit save/revert/reset',async()=>{
 const [html,app,controller,adapter,desktop]=await Promise.all([
  readFile(new URL('../public/index.html',import.meta.url),'utf8'),
  readFile(new URL('../public/app.js',import.meta.url),'utf8'),
  readFile(new URL('../public/avatar-studio.js',import.meta.url),'utf8'),
  readFile(new URL('../public/humanale-avatar.js',import.meta.url),'utf8'),
  readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8')
 ]);
 assert.match(html,/id="avatarStudio"/);
 assert.match(html,/id="avatarStudioOpen"/);
 for(const key of ['headWidth','headHeight','cheekVolume','jawWidth','eyeSpacing','depth','density']){
  assert.match(html,new RegExp('data-avatar-studio-key="'+key+'"'));
 }
 assert.match(html,/id="avatarStudioSave"/);
 assert.match(html,/id="avatarStudioRevert"/);
 assert.match(html,/id="avatarStudioReset"/);
 assert.match(app,/createAvatarStudioController/);
 assert.match(app,/avatarStudio\.handleMessage/);
 assert.match(app,/avatarStudio\.syncPayload/);
 assert.match(app,/getAvatarStudioProfile/);
 assert.match(controller,/humanale\.avatar-studio\.v1/);
 assert.match(controller,/avatar-studio-profile/);
 assert.match(adapter,/setStudioProfile/);
 assert.match(adapter,/transformAvatarStudioPoint/);
 assert.match(adapter,/setDensity\(this\.studioProfile\.density\*100\)/);
 assert.match(desktop,/\['controls','avatarStudio','chatDialog','agentDialog','terminalDialog'\]/);
 assert.match(desktop,/Avatar Live Studio tidak siap di panel terpisah/);
 assert.match(desktop,/Avatar Live Studio tidak menerapkan perubahan realtime ke avatar utama/);
});
