import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = path => new URL(`../${path}`, import.meta.url);

test('conversation stage keeps decorative artwork and dark colors scoped to browser stage', async () => {
  const css = await readFile(file('public/conversation-stage.css'), 'utf8');
  assert.match(css, /\.stage-contours\{display:none\}/);
  assert.match(css, /\.stage-surface \.stage-contours\{display:block/);
  assert.doesNotMatch(css, /(^|[;}])\s*\.conversation-stage[^{]*\{/);
  assert.match(css, /\.stage-surface #chatDialog\.conversation-stage/);
  assert.match(css, /orientation:landscape/);
  assert.match(css, /display:flex;flex-direction:column/);
  assert.match(css, /#messages\{flex:1;min-height:0/);
  assert.match(css, /#liveText:empty\{display:none\}/);
  assert.match(css, /camera-preview\{flex-shrink:0;max-height/);
});

test('conversation dock uses one persistent composer and accessible microphone control', async () => {
  const [html, app] = await Promise.all([
    readFile(file('public/index.html'), 'utf8'),
    readFile(file('public/app.js'), 'utf8')
  ]);
  for (const id of ['chatDialog', 'messages', 'prompt', 'chatForm', 'chatMic']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, `${id} must remain unique`);
  }
  assert.match(html, /class="mic-icon"/);
  assert.match(html, /aria-label="Tutup percakapan"/);
  assert.match(app, /dialog\[open\].*chatDialog.*stage-surface/);
  assert.match(app, /dialog'\)\.forEach\(dialog=>\{\s*if\(!\(dialog\.id==='chatDialog'&&document\.documentElement\.classList\.contains\('stage-surface'\)\)\)/);
  assert.match(app, /dialog\[open\]:not\(#chatDialog\)/);
  assert.match(app, /setChatMicLabel/);
  assert.match(app, /isComposing/);
  assert.match(app, /stageDockOpen/);
});

test('full-page dock is not closed when settings opens and is restored if closed', async () => {
  const [html, app] = await Promise.all([
    readFile(file('public/index.html'), 'utf8'),
    readFile(file('public/app.js'), 'utf8')
  ]);
  assert.match(html, /id="conversationSettings"/);
  assert.match(app, /d\.id==='chatDialog'&&document\.documentElement\.classList\.contains\('stage-surface'\)/);
  assert.match(app, /chatDialog'\)\.addEventListener\('close'.*stage-surface/);
});

test('microphone icon remains bounded outside the browser stage', async () => {
  const [css, app] = await Promise.all([
    readFile(file('public/style.css'), 'utf8'),
    readFile(file('public/app.js'), 'utf8')
  ]);
  assert.match(css, /\.mic-icon\{width:14px;height:14px;fill:none;stroke:currentColor/);
  assert.match(app, /class="mic-icon" width="14" height="14"/);
  assert.match(css, /#chatDialog #chatForm\{display:block\}/);
  assert.match(css, /#chatDialog \.composer-row\{display:flex;gap:8px\}/);
  assert.match(css, /#chatDialog #send\{width:auto;min-width:62px/);
});

test('stage uses layered ridge contours rather than three broad waves', async () => {
  const html = await readFile(file('public/index.html'), 'utf8');
  const contour = html.match(/class="stage-contours"[\s\S]*?<\/svg>/)?.[0] ?? '';
  assert.ok((contour.match(/<path\b/g) ?? []).length >= 16);
  assert.doesNotMatch(contour, /M-80 620|M-110 690|M-40 790/);
});
