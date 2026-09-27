import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../nara-core/brain/event-bus.js';
import {
  APPROVAL_STATUS,
  createApprovalManager
} from '../nara-core/permissions/index.js';

test('approval starts pending and requires explicit owner decision',()=>{
  const approvals=createApprovalManager({now:()=>1000});
  const request=approvals.create({
    id:'approval-1',
    capability:'external.write',
    scope:'github.repo.entitashuman',
    requestedBy:'workflow'
  });
  assert.equal(request.status,APPROVAL_STATUS.PENDING);
  assert.equal(approvals.authorize({
    id:'approval-1',
    capability:'external.write',
    scope:'github.repo.entitashuman',
    timestamp:1001
  }).allowed,false);
  assert.throws(()=>approvals.decide('approval-1',{
    approved:true,
    authority:'system',
    timestamp:1001
  }),/Only owner/);
  assert.equal(approvals.get('approval-1',{timestamp:1001}).status,APPROVAL_STATUS.PENDING);
});

test('approved single-use permission requires exact capability and scope then consumes',()=>{
  const approvals=createApprovalManager();
  approvals.create({
    id:'approval-exact',
    capability:'memory.sensitive.read',
    scope:'workflow.wf-1',
    requestedBy:'workflow',
    singleUse:true,
    timestamp:100
  });
  approvals.decide('approval-exact',{approved:true,authority:'owner',timestamp:110});

  assert.equal(approvals.authorize({
    id:'approval-exact',
    capability:'memory.sensitive.write',
    scope:'workflow.wf-1',
    timestamp:120
  }).reason,'capability_mismatch');

  assert.equal(approvals.authorize({
    id:'approval-exact',
    capability:'memory.sensitive.read',
    scope:'workflow.wf-2',
    timestamp:120
  }).reason,'scope_mismatch');

  const ok=approvals.authorize({
    id:'approval-exact',
    capability:'memory.sensitive.read',
    scope:'workflow.wf-1',
    timestamp:120
  });
  assert.equal(ok.allowed,true);
  assert.equal(ok.consumed,true);
  assert.equal(approvals.get('approval-exact',{timestamp:121}).status,APPROVAL_STATUS.CONSUMED);

  assert.equal(approvals.authorize({
    id:'approval-exact',
    capability:'memory.sensitive.read',
    scope:'workflow.wf-1',
    timestamp:122
  }).allowed,false);
});

test('consume:false supports preflight without consuming single-use approval',()=>{
  const approvals=createApprovalManager();
  approvals.create({
    id:'approval-preflight',
    capability:'humanale.command',
    scope:'session.s1',
    timestamp:10
  });
  approvals.decide('approval-preflight',{approved:true,authority:'owner',timestamp:11});
  const preflight=approvals.authorize({
    id:'approval-preflight',
    capability:'humanale.command',
    scope:'session.s1',
    consume:false,
    timestamp:12
  });
  assert.equal(preflight.allowed,true);
  assert.equal(preflight.consumed,false);
  assert.equal(approvals.get('approval-preflight',{timestamp:12}).status,APPROVAL_STATUS.APPROVED);
});

test('approval expires and cannot be revived by later owner decision',()=>{
  const approvals=createApprovalManager({limits:{defaultTtlMs:50,maxTtlMs:100}});
  approvals.create({
    id:'approval-expire',
    capability:'external.write',
    scope:'github.repo.entitashuman',
    timestamp:100
  });
  assert.deepEqual(approvals.sweep({timestamp:151}),['approval-expire']);
  assert.equal(approvals.get('approval-expire',{timestamp:151}).status,APPROVAL_STATUS.EXPIRED);
  assert.throws(()=>approvals.decide('approval-expire',{
    approved:true,
    authority:'owner',
    timestamp:152
  }),/not pending/);
});

test('denied and revoked approvals cannot authorize',()=>{
  const approvals=createApprovalManager();
  approvals.create({id:'approval-deny',capability:'external.write',scope:'repo.a',timestamp:1});
  approvals.decide('approval-deny',{approved:false,authority:'owner',timestamp:2});
  assert.equal(approvals.authorize({
    id:'approval-deny',capability:'external.write',scope:'repo.a',timestamp:3
  }).allowed,false);

  approvals.create({id:'approval-revoke',capability:'external.write',scope:'repo.b',singleUse:false,timestamp:10});
  approvals.decide('approval-revoke',{approved:true,authority:'owner',timestamp:11});
  approvals.revoke('approval-revoke',{authority:'owner',timestamp:12});
  assert.equal(approvals.get('approval-revoke',{timestamp:13}).status,APPROVAL_STATUS.REVOKED);
  assert.equal(approvals.authorize({
    id:'approval-revoke',capability:'external.write',scope:'repo.b',timestamp:13
  }).allowed,false);
});

test('request schema rejects arbitrary payload fields and invalid scopes',()=>{
  const approvals=createApprovalManager();
  assert.throws(()=>approvals.create({
    id:'approval-unsafe',
    capability:'external.write',
    scope:'repo.a',
    payload:{secret:'DO_NOT_STORE'}
  }),/Unsupported approval request field: payload/);
  assert.throws(()=>approvals.create({
    id:'approval-scope',
    capability:'external.write',
    scope:'scope with spaces'
  }),/Invalid approval scope/);
});

test('bounded capacity evicts only terminal records, never active approvals',()=>{
  const approvals=createApprovalManager({limits:{maxRequests:2}});
  approvals.create({id:'a1',capability:'read',scope:'s1',timestamp:1});
  approvals.decide('a1',{approved:false,authority:'owner',timestamp:2});
  approvals.create({id:'a2',capability:'read',scope:'s2',timestamp:3});
  approvals.create({id:'a3',capability:'read',scope:'s3',timestamp:4});
  assert.equal(approvals.get('a1',{timestamp:4}),null);
  assert.ok(approvals.get('a2',{timestamp:4}));
  assert.ok(approvals.get('a3',{timestamp:4}));
});

test('capacity fails closed if all retained approvals are active',()=>{
  const approvals=createApprovalManager({limits:{maxRequests:2}});
  approvals.create({id:'a1',capability:'read',scope:'s1',timestamp:1});
  approvals.create({id:'a2',capability:'read',scope:'s2',timestamp:2});
  assert.throws(()=>approvals.create({
    id:'a3',capability:'read',scope:'s3',timestamp:3
  }),/capacity reached/);
});

test('Event Bus and snapshot contain approval metadata only',()=>{
  const bus=createEventBus();
  const events=[];
  bus.onAny(event=>events.push(event));
  const approvals=createApprovalManager({bus});
  approvals.create({
    id:'approval-event',
    capability:'humanale.command',
    scope:'session.s1',
    requestedBy:'workflow',
    timestamp:1
  });
  approvals.decide('approval-event',{approved:true,authority:'owner',timestamp:2});
  approvals.authorize({
    id:'approval-event',
    capability:'humanale.command',
    scope:'session.s1',
    timestamp:3
  });
  const serialized=JSON.stringify({events,snapshot:approvals.snapshot()});
  assert.match(serialized,/approval\.requested/);
  assert.match(serialized,/approval\.approved/);
  assert.match(serialized,/approval\.consumed/);
  assert.equal(serialized.includes('prompt'),false);
  assert.equal(serialized.includes('password'),false);
  assert.equal(serialized.includes('token'),false);
});

test('manager exposes no automatic approval method',()=>{
  const approvals=createApprovalManager();
  assert.equal(typeof approvals.autoApprove,'undefined');
  assert.equal(typeof approvals.learnAndApprove,'undefined');
  assert.equal(typeof approvals.grantAll,'undefined');
});
