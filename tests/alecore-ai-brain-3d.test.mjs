import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ALECORE_AI_REGION_IDS,ALECORE_AI_REGIONS} from '../alecore-ai/brain/regions.js';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
async function createGraph(){
  if(!globalThis.NeuralCore)await import('../sites/humanale-hologram/dist/neural-core.js');
  return globalThis.NeuralCore.create();
}

test('3D neural core exposes the exact official AleCore AI region set',async()=>{
  const graph=await createGraph();
  assert.equal(graph.regions.length,ALECORE_AI_REGION_IDS.length);
  assert.deepEqual([...graph.regionIds].sort(),[...ALECORE_AI_REGION_IDS].sort());
  assert.deepEqual([...globalThis.NeuralCore.regionIds].sort(),[...ALECORE_AI_REGION_IDS].sort());
  assert.equal(graph.brainCount,288);
  for(const region of graph.regions){
    assert.ok(ALECORE_AI_REGION_IDS.includes(region.id),region.id);
    const official=ALECORE_AI_REGIONS[region.id];
    assert.equal(region.label,official.label);
    assert.equal(region.group,official.group);
    assert.deepEqual([...region.connections].sort(),[...official.connections].sort());
    const expected={
      x:official.position.x*.37,
      y:-.30-official.position.y*.18,
      z:.135+official.position.z*.28
    };
    for(const axis of ['x','y','z']){
      assert.equal(Number.isFinite(region[axis]),true,region.id+' '+axis);
      assert.ok(Math.abs(region[axis]-expected[axis])<1e-9,region.id+' visual '+axis+' drifted from official position');
    }
    assert.ok(Number.isInteger(region.anchorNode));
    assert.ok(region.anchorNode>=0&&region.anchorNode<graph.brainCount);
  }
});

test('every cortical node and data-spine lane has a valid semantic AleCore AI target',async()=>{
  const graph=await createGraph();
  for(const node of graph.nodes.slice(0,graph.brainCount)){
    assert.ok(ALECORE_AI_REGION_IDS.includes(node.region),'invalid cortical region '+node.region);
  }
  const stemNodes=graph.nodes.slice(graph.brainCount);
  assert.ok(stemNodes.length>0);
  for(const node of stemNodes){
    assert.equal(node.region,'stem');
    assert.ok(ALECORE_AI_REGION_IDS.includes(node.targetRegion),'invalid stem target '+node.targetRegion);
  }
  assert.equal(graph.paths.length,9);
  assert.ok(graph.semanticLinks.length>0);
  for(const edge of graph.semanticLinks){
    assert.ok(ALECORE_AI_REGION_IDS.includes(edge.from));
    assert.ok(ALECORE_AI_REGION_IDS.includes(edge.to));
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
  assert.match(faceRig,/function depthAt\(x, y\)/);
  assert.match(faceRig,/function normalAt\(x, y\)/);
  assert.match(faceRig,/function deform\(x, y, z, pose, neck, breath = 0\)/);
  assert.doesNotMatch(faceRig,/referenceWarp|referenceSrc|new Image/);
  assert.match(adapter,/class HumanALEAvatar extends BaseAvatar/);
  assert.doesNotMatch(adapter,/buildFallback\(|loadReference\(/);
});

test('HumanALE runtime synchronizes brain state, zoom and region selection through bounded AleCore AI IPC',async()=>{
  const [app,html,preload]=await Promise.all([
    read('public/app.js'),
    read('public/index.html'),
    read('desktop/preload.cjs')
  ]);
  assert.match(app,/desktop\?\.onAleState\?\.\(snapshot=>syncAleBrainState\(snapshot\)\)/);
  assert.match(app,/if\(desktop\?\.aleSnapshot\)desktop\.aleSnapshot\(\)/);
  assert.match(app,/aleDispatch\('brain\.region\.select',\{region\}\)/);
  assert.match(app,/avatar\.pickBrainRegion\?\.\(e\.clientX,e\.clientY\)/);
  assert.match(app,/applyBrainZoom/);
  assert.match(html,/id="brainZoom"/);
  assert.match(html,/id="brainNodeInfo"/);
  assert.match(preload,/aleSnapshot/);
  assert.match(preload,/onAleState/);
});

test('procedural face geometry remains embedded in code with no required face image asset',async()=>{
  const [avatar,site]=await Promise.all([
    read('sites/humanale-hologram/dist/avatar.js'),
    read('sites/humanale-hologram/dist/site.js')
  ]);
  assert.match(avatar,/buildFallback\(\)/);
  assert.match(avatar,/for \(let y = -0\.68; y < 0\.74; y \+= 0\.009\)/);
  assert.match(avatar,/this\.addFacialCode\(points, hash\)/);
  assert.match(site,/new window\.NeuralAvatar\(canvas\);/);
  assert.doesNotMatch(site,/referenceSrc\s*:|reference-face\.png/);
});
