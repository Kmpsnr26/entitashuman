import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('HumanALE final readiness certificate stays fail-closed with three pending gates',async()=>{
  const raw=await readFile(new URL('docs/humanale-final-readiness-certificate.json',root),'utf8');
  const cert=JSON.parse(raw);
  assert.equal(cert.protocol,'humanale-final-readiness/1');
  assert.equal(cert.finalState,'LOCKED');
  assert.equal(cert.integrationUnlocked,false);
  assert.equal(cert.creatorApproval.approved,false);
  assert.equal(cert.summary.pass,6);
  assert.equal(cert.summary.pending,3);
  const map=Object.fromEntries(cert.gates.map(g=>[g.id,g]));
  assert.equal(map['performance-stability'].status,'pending');
  assert.equal(map['android-runtime'].status,'pending');
  assert.equal(map['release-security'].status,'pending');
  assert.equal(map['integration-boundary'].status,'pass');
});
