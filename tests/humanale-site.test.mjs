import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const siteFile = path => new URL(`../sites/humanale-hologram/${path}`, import.meta.url);

test('HumanALE Hologram Site contains its complete editable static source', async () => {
  const hosting = JSON.parse(await readFile(siteFile('.openai/hosting.json'), 'utf8'));
  const html = await readFile(siteFile('dist/index.html'), 'utf8');
  const asset = await stat(siteFile('dist/assets/reference-face.png'));

  assert.equal(hosting.static.directory, 'dist');
  for (const script of ['face-rig.js', 'neural-core.js', 'avatar.js', 'site.js']) {
    assert.ok(html.includes(script), `${script} must load on the Site`);
    await stat(siteFile(`dist/${script}`));
  }
  assert.ok(asset.size > 100_000, 'reference face asset is incomplete');
});

test('Site renderer presents complete frames without rapid whole-face flashing', async () => {
  const source = await readFile(siteFile('dist/avatar.js'), 'utf8');
  assert.doesNotMatch(source, /desynchronized:\s*true/);
  assert.match(source, /if \(this\.canvas\.width !== width\) this\.canvas\.width = width/);
  assert.match(source, /if \(this\.canvas\.height !== height\) this\.canvas\.height = height/);
  assert.equal((source.match(/this\.frameRequest = requestAnimationFrame\(/g) ?? []).length, 4);
  assert.match(source, /blinkValue\(time\)/, 'natural eye blinking remains available');
});
