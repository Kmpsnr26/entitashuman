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
  density:0,
  foreheadWidth:5,
  noseDepth:.1,
  lipVolume:9,
  earSize:.1,
  lightIntensity:9,
  particleScale:.1
 });
 assert.equal(profile.headWidth,AVATAR_STUDIO_LIMITS.headWidth[1]);
 assert.equal(profile.headHeight,AVATAR_STUDIO_LIMITS.headHeight[0]);
 assert.equal(profile.cheekVolume,1.12);
 assert.equal(profile.jawWidth,AVATAR_STUDIO_DEFAULTS.jawWidth);
 assert.equal(profile.eyeSpacing,AVATAR_STUDIO_DEFAULTS.eyeSpacing);
 assert.equal(profile.depth,AVATAR_STUDIO_LIMITS.depth[0]);
 assert.equal(profile.density,AVATAR_STUDIO_LIMITS.density[0]);
 assert.equal(profile.foreheadWidth,AVATAR_STUDIO_LIMITS.foreheadWidth[1]);
 assert.equal(profile.noseDepth,AVATAR_STUDIO_LIMITS.noseDepth[0]);
 assert.equal(profile.lipVolume,AVATAR_STUDIO_LIMITS.lipVolume[1]);
 assert.equal(profile.earSize,AVATAR_STUDIO_LIMITS.earSize[0]);
 assert.equal(profile.lightIntensity,AVATAR_STUDIO_LIMITS.lightIntensity[1]);
 assert.equal(profile.particleScale,AVATAR_STUDIO_LIMITS.particleScale[0]);
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

 const foreheadBase=transformAvatarStudioPoint({x:.20,y:-.35,z:.22,baseX:.20,baseY:-.35},AVATAR_STUDIO_DEFAULTS);
 const foreheadWide=transformAvatarStudioPoint({x:.20,y:-.35,z:.22,baseX:.20,baseY:-.35},{...AVATAR_STUDIO_DEFAULTS,foreheadWidth:1.14});
 assert.ok(foreheadWide.x>foreheadBase.x);

 const chinBase=transformAvatarStudioPoint({x:.12,y:.43,z:.18,baseX:.12,baseY:.43},AVATAR_STUDIO_DEFAULTS);
 const chinLong=transformAvatarStudioPoint({x:.12,y:.43,z:.18,baseX:.12,baseY:.43},{...AVATAR_STUDIO_DEFAULTS,chinLength:1.16});
 assert.ok(chinLong.y>chinBase.y);

 const noseBase=transformAvatarStudioPoint({x:0,y:.08,z:.3,baseX:0,baseY:.08},AVATAR_STUDIO_DEFAULTS);
 const noseDeep=transformAvatarStudioPoint({x:0,y:.08,z:.3,baseX:0,baseY:.08},{...AVATAR_STUDIO_DEFAULTS,noseDepth:1.25});
 assert.ok(noseDeep.z>noseBase.z);

 const mouthBase=transformAvatarStudioPoint({x:.12,y:.285,z:.2,baseX:.12,baseY:.285,feature:'lip-upper'},AVATAR_STUDIO_DEFAULTS);
 const mouthWide=transformAvatarStudioPoint({x:.12,y:.285,z:.2,baseX:.12,baseY:.285,feature:'lip-upper'},{...AVATAR_STUDIO_DEFAULTS,mouthWidth:1.18,lipVolume:1.3});
 assert.ok(mouthWide.x>mouthBase.x);
 assert.ok(mouthWide.z>mouthBase.z);

 const earBase=transformAvatarStudioPoint({x:.44,y:.015,z:.1,baseX:.44,baseY:.015,feature:'ear-shell',earSide:1},AVATAR_STUDIO_DEFAULTS);
 const earLarge=transformAvatarStudioPoint({x:.44,y:.015,z:.1,baseX:.44,baseY:.015,feature:'ear-shell',earSide:1},{...AVATAR_STUDIO_DEFAULTS,earSize:1.25});
 assert.ok(earLarge.x>earBase.x);

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
 for(const key of ['headWidth','headHeight','cheekVolume','jawWidth','eyeSpacing','foreheadWidth','foreheadHeight','chinLength','chinWidth','noseDepth','mouthWidth','lipVolume','earSize','lightIntensity','particleScale','depth','density']){
  assert.match(html,new RegExp('data-avatar-studio-key="'+key+'"'));
 }
 assert.match(html,/id="avatarStudioSave"/);
 assert.match(html,/id="avatarStudioRevert"/);
 assert.match(html,/id="avatarStudioReset"/);
 assert.match(html,/id="avatarStudioMaterial"/);
 for(const id of ['avatarStudioSaveA','avatarStudioPreviewA','avatarStudioSaveB','avatarStudioPreviewB'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(app,/createAvatarStudioController/);
 assert.match(app,/avatarStudio\.handleMessage/);
 assert.match(app,/avatarStudio\.syncPayload/);
 assert.match(app,/getAvatarStudioProfile/);
 assert.match(controller,/humanale\.avatar-studio\.v1/);
 assert.match(controller,/humanale\.avatar-studio\.slots\.v1/);
 assert.match(controller,/humanale\.avatar-studio\.material\.v1/);
 assert.match(controller,/const MATERIALS=/);
 assert.match(controller,/avatar-studio-profile/);
 assert.match(adapter,/setStudioProfile/);
 assert.match(adapter,/transformAvatarStudioPoint/);
 assert.match(adapter,/transformFacePoint/);
 assert.doesNotMatch(adapter,/\n project\(x,y,z/);
 assert.match(adapter,/setDensity\(this\.studioProfile\.density\*100\)/);
 assert.match(adapter,/faceVisualTuning/);
 assert.match(desktop,/\['controls','avatarStudio','chatDialog','agentDialog','terminalDialog'\]/);
 assert.match(desktop,/Avatar Live Studio tidak siap di panel terpisah/);
 assert.match(desktop,/Avatar Live Studio tidak menerapkan perubahan realtime ke avatar utama/);
 assert.match(desktop,/Avatar Live Studio material tidak sinkron ke avatar utama/);
 const canonical=await readFile(new URL('../sites/humanale-hologram/dist/avatar.js',import.meta.url),'utf8');
 assert.match(canonical,/transformFacePoint\(point\)/);
 assert.match(canonical,/x, y, z, feature,/);
 assert.match(canonical,/'ear-shell'/);
});
