import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const siteFile = path => new URL(`../sites/humanale-hologram/${path}`, import.meta.url);

test('HumanALE Hologram Site contains its complete editable static source', async () => {
  const hosting = JSON.parse(await readFile(siteFile('.openai/hosting.json'), 'utf8'));
  const html = await readFile(siteFile('dist/index.html'), 'utf8');

  assert.equal(hosting.static.directory, 'dist');
  for (const script of ['face-rig.js', 'neural-core.js', 'avatar.js', 'site.js']) {
    assert.ok(html.includes(script), `${script} must load on the Site`);
    await stat(siteFile(`dist/${script}`));
  }
  const siteSource = await readFile(siteFile('dist/site.js'), 'utf8');
  const avatarSource = await readFile(siteFile('dist/avatar.js'), 'utf8');
  assert.doesNotMatch(siteSource, /reference-face\.png|referenceSrc\s*:|referencePromise/, 'Site must run the avatar in procedural-only mode');
  assert.doesNotMatch(avatarSource, /referenceSrc|referencePromise|referenceReady|referencePoints|loadReference|new Image/, 'Avatar engine must not contain an image-based face loader');
  await assert.rejects(stat(siteFile('dist/assets/reference-face.png')), error => error?.code === 'ENOENT');
});

test('Site renderer presents complete frames without rapid whole-face flashing', async () => {
  const source = await readFile(siteFile('dist/avatar.js'), 'utf8');
  assert.doesNotMatch(source, /desynchronized:\s*true/);
  assert.match(source, /if \(this\.canvas\.width !== width\) this\.canvas\.width = width/);
  assert.match(source, /if \(this\.canvas\.height !== height\) this\.canvas\.height = height/);
  assert.equal((source.match(/this\.frameRequest = requestAnimationFrame\(/g) ?? []).length, 4);
  assert.match(source, /blinkValue\(time\)/, 'natural eye blinking remains available');
});

test('main web, desktop and Android builds share the Site avatar source', async () => {
  const [build,server,desktopPackage,desktopMain,installer,android,adapter] = await Promise.all([
    readFile(new URL('../build.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../server.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../package-desktop.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/android-apk.yml', import.meta.url), 'utf8'),
    readFile(new URL('../public/humanale-avatar.js', import.meta.url), 'utf8')
  ]);

  for (const source of [build, server, desktopPackage, desktopMain]) assert.match(source, /humanale-hologram|humanale/, 'avatar assets must be routed or copied');
  for (const source of [build, desktopPackage, installer]) {
    assert.doesNotMatch(source, /reference-face\.png/, 'procedural avatar builds must not package a face PNG');
  }
  assert.match(android, /sites\/humanale-hologram\/dist\/\*\*/);
  for (const feature of ['setState','setListening','setTalking','setAudioLevel','setEarSpectrum','drawAudioSensors']) {
    assert.match(adapter, new RegExp(feature + '\\('), feature);
  }
});
