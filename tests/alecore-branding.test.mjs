import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('first-party studio surfaces use AleCore AI branding while retaining internal region identifiers', async () => {
  const studio = await readFile(new URL('../nara-core/studio/public/index.html', import.meta.url), 'utf8');
  const avatar = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const visual = await readFile(new URL('../public/humanale-visual-studio.js', import.meta.url), 'utf8');
  const entry = await readFile(new URL('../nara-core/studio/public/neural-entry.js', import.meta.url), 'utf8');
  assert.match(studio, /<title>AleCore AI Live Studio<\/title>/);
  assert.match(studio, /ALECORE AI LIVE STUDIO/);
  assert.doesNotMatch(studio, /<strong>NARA CORE<\/strong>/);
  assert.match(avatar, /HUMANALE \/ ALECORE AI/);
  assert.match(avatar, /<dd id="visualStudioController">AleCore AI<\/dd>/);
  assert.match(visual, /controlledBy==='NARA_CORE'/);
  assert.match(entry, /AleCore AI online\./);
});
