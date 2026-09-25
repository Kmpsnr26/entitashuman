import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {NARA_REGION_IDS} from '../nara-core/brain/regions.js';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('3D neural core exposes the exact official NARA region set',async()=>{
  delete globalThis.NeuralCore;
  await import('../sites/humanale-hologram/dist/neural-core.js');
  const graph=globalThis.NeuralCore.create();
  assert.equal(graph.regions.length,NARA_REGION_IDS.length);
  assert.deepEqual([...graph.regionIds].sort(),[...NARA_REGION_IDS].sort());
  assert.deepEqual([...globalThis.NeuralCore.regionIds].sort(),[...NARA_REGION_IDS].sort());
  assert.equal(graph.brainCount,288);
  for(const region of graph.regions){
    assert.ok(NARA_REGION_IDS.includes(region.id),region.id);
    for(const axis of ['x','y','z'])assert.equal(Number.isFinite(region[axis]),true,region.id+' '+axis);
    assert.ok(Number.isInteger(region.anchorNode));
    assert.ok(region.anchorNode>=0&&region.anchorNode<graph.brainCount);
  }
});

test('every cortical node and data-spine lane has a valid semantic NARA target',async()=>{
  const graph=globalThis.NeuralCore.create();
  for(const node of graph.nodes.slice(0,graph.brainCount)){
    assert.ok(NARA_REGION_IDS.includes(node.region),'invalid cortical region '+node.region);
  }
  const stemNodes=graph.nodes.slice(graph.brainCount);
  assert.ok(stemNodes.length>0);
  for(const node of stemNodes){
    assert.equal(node.region,'stem');
    assert.ok(NARA_REGION_IDS.includes(node.targetRegion),'invalid stem target '+node.targetRegion);
  }
  assert.equal(graph.paths.length,9);
  assert.ok(graph.semanticLinks.length>0);
  for(const edge of graph.semanticLinks){
    assert.ok(NARA_REGION_IDS.includes(edge.from));
    assert.ok(NARA_REGION_IDS.includes(edge.to));
  }
});

test('avatar renderer binds live BrainState to deep-zoom semantic nodes without replacing face geometry',async()=>{
  const [avatar,faceRig,adapter]=await Promise.all([
    read('sites/humanale-hologram/dist/avatar.js'),
    read('sites/humanale-hologram/dist/face-rig.js'),
    read('public/humanale-avatar.js')
  ]);
  for(const feature of ['setBrainState','selectBrainRegion','brainRegionState','brainStatusColor','pickBrainRegion','brainRegionScreen']){
    assert.match(avatar,new RegExp(feature),feature);
  }
  assert.match(avatar,/graph\.semanticLinks/);
  assert.match(avatar,/selectedRegion/);
  assert.match(avatar,/smooth\(2\.15,2\.85,this\.zoom\)/);
  assert.match(faceRig,/referenceWarp/);
  assert.match(adapter,/class HumanALEAvatar extends BaseAvatar/);
  assert.doesNotMatch(adapter,/buildFallback\(|loadReference\(/);
});

test('HumanALE runtime synchronizes brain state, zoom and region selection through bounded NARA IPC',async()=>{
  const [app,html,preload]=await Promise.all([
    read('public/app.js'),
    read('public/index.html'),
    read('desktop/preload.cjs')
  ]);
  assert.match(app,/desktop\?\.onNaraState\?\.\(snapshot=>syncNaraBrainState\(snapshot\)\)/);
  assert.match(app,/if\(desktop\?\.naraSnapshot\)desktop\.naraSnapshot\(\)/);
  assert.match(app,/naraDispatch\('brain\.region\.select',\{region\}\)/);
  assert.match(app,/avatar\.pickBrainRegion\?\.\(e\.clientX,e\.clientY\)/);
  assert.match(app,/applyBrainZoom/);
  assert.match(html,/id="brainZoom"/);
  assert.match(html,/id="brainNodeInfo"/);
  assert.match(preload,/naraSnapshot/);
  assert.match(preload,/onNaraState/);
});

test('reference face asset remains present and substantial',async()=>{
  const asset=await stat(new URL('../sites/humanale-hologram/dist/assets/reference-face.png',import.meta.url));
  assert.ok(asset.size>100_000);
});
