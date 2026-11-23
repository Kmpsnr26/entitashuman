import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Offline guard only: never starts services, changes DNS, or deploys.
const template = readFileSync(new URL('../nginx/nara-staging.conf', import.meta.url), 'utf8');

function serverBlocks(source) {
  const blocks = [];
  for (const match of source.matchAll(/\bserver\s*\{/g)) {
    let depth = 0;
    let end = -1;
    for (let i = source.indexOf('{', match.index); i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    assert.notEqual(end, -1, 'Unbalanced server block');
    blocks.push(source.slice(match.index, end));
  }
  return blocks;
}

function directive(block, name) {
  const matches = [...block.matchAll(new RegExp('^\\s*' + name + '\\s+([^;\\n]+);\\s*$', 'gm'))];
  assert.equal(matches.length, 1, 'Expected exactly one ' + name + ' directive');
  return matches[0][1].trim();
}

function validate(source) {
  const blocks = serverBlocks(source);
  assert.equal(blocks.length, 2, 'Exactly two TLS staging hosts required');
  for (const [host, port] of [
    ['staging-auth.aleprinting.my.id', 4100],
    ['staging-nara.aleprinting.my.id', 4200],
  ]) {
    const block = blocks.find(b => directive(b, 'server_name') === host);
    assert.ok(block, 'Missing host: ' + host);
    assert.equal(directive(block, 'listen'), '443 ssl');
    assert.equal(directive(block, 'ssl_certificate'), '/etc/letsencrypt/live/' + host + '/fullchain.pem');
    assert.equal(directive(block, 'ssl_certificate_key'), '/etc/letsencrypt/live/' + host + '/privkey.pem');
    assert.equal(directive(block, 'proxy_pass'), 'http://127.0.0.1:' + port);
    for (const header of ['Host', 'X-Real-IP', 'X-Forwarded-For', 'X-Forwarded-Proto']) {
      assert.match(block, new RegExp('^\\s*proxy_set_header\\s+' + header + '\\s+[^;\\n]+;', 'm'));
    }
  }
}

validate(template);
for (const [label, changed] of [
  ['missing certificate', template.replace(/^\s*ssl_certificate\s+[^;]+;/m, '')],
  ['missing certificate key', template.replace(/^\s*ssl_certificate_key\s+[^;]+;/m, '')],
  ['non-loopback upstream', template.replace('proxy_pass http://127.0.0.1:4100;', 'proxy_pass http://0.0.0.0:4100;')],
  ['incorrect hostname', template.replace('server_name staging-nara.aleprinting.my.id;', 'server_name invalid.example;')],
]) {
  assert.notEqual(changed, template, 'Fixture unchanged: ' + label);
  assert.throws(() => validate(changed), undefined, 'Unsafe fixture accepted: ' + label);
}
console.log('PASS: staging TLS, loopback upstream, headers, and four negative cases');
