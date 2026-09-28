import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../nara-core/brain/event-bus.js';
import {createMemoryManager} from '../nara-core/memory/index.js';

test('Memory Manager writes and reads finite JSON working memory',()=>{
  let time=1000;
  const memory=createMemoryManager({
    now:()=>++time,
    idFactory:()=> 'generated-1'
  });
  const written=memory.write({
    id:'task-1',
    kind:'working',
    tags:['project','active'],
    priority:.8,
    value:{goal:'test',step:1}
  });
  assert.equal(written.id,'task-1');
  assert.deepEqual(written.value,{goal:'test',step:1});
  assert.deepEqual(memory.read('task-1').value,{goal:'test',step:1});
  assert.equal(memory.snapshot().count,1);
  assert.equal(memory.snapshot().counters.writes,1);
  assert.equal(memory.snapshot().counters.reads,1);
});

test('Memory Manager rejects secrets, cycles, and oversized values',()=>{
  const memory=createMemoryManager({
    limits:{maxValueBytes:64}
  });
  assert.throws(()=>memory.write({
    id:'secret-1',
    sensitivity:'secret',
    value:{token:'x'}
  }),/Secret material is not accepted/);

  const cyclic={};
  cyclic.self=cyclic;
  assert.throws(()=>memory.write({
    id:'cycle-1',
    value:cyclic
  }),/JSON-compatible/);

  assert.throws(()=>memory.write({
    id:'large-1',
    value:{text:'x'.repeat(200)}
  }),/maxValueBytes/);
});

test('Memory Manager expires TTL entries deterministically',()=>{
  let now=2000;
  const memory=createMemoryManager({now:()=>now});
  memory.write({
    id:'ttl-1',
    ttlMs:100,
    value:{temporary:true}
  });
  assert.ok(memory.read('ttl-1'));
  now=2100;
  assert.equal(memory.read('ttl-1'),null);
  assert.equal(memory.snapshot().counters.expired,1);
});

test('capacity eviction preserves pinned memory and removes lowest-priority unpinned entry',()=>{
  let now=3000;
  const memory=createMemoryManager({
    now:()=>++now,
    limits:{maxEntries:2}
  });
  memory.write({id:'pinned',pinned:true,priority:.1,value:{a:1}});
  memory.write({id:'low',priority:.2,value:{a:2}});
  memory.write({id:'high',priority:.9,value:{a:3}});

  assert.ok(memory.read('pinned'));
  assert.equal(memory.read('low'),null);
  assert.ok(memory.read('high'));
  assert.equal(memory.snapshot().counters.evicted,1);
});

test('capacity fails closed when all existing entries are pinned',()=>{
  const memory=createMemoryManager({
    limits:{maxEntries:1}
  });
  memory.write({id:'pinned-only',pinned:true,value:{keep:true}});
  assert.throws(()=>memory.write({
    id:'new-entry',
    value:{drop:false}
  }),/all entries are pinned/);
  assert.ok(memory.read('pinned-only'));
});

test('context preparation is budgeted and sensitive memory is excluded by default',()=>{
  let seq=0;
  const memory=createMemoryManager({
    idFactory:()=> 'id-'+(++seq),
    limits:{contextMaxEntries:3,contextMaxBytes:1024}
  });
  memory.write({
    id:'normal-1',
    tags:['task'],
    priority:.7,
    value:{text:'normal'}
  });
  memory.write({
    id:'sensitive-1',
    tags:['task'],
    sensitivity:'sensitive',
    priority:1,
    value:{text:'private'}
  });

  const context=memory.prepareContext({tags:['task'],target:'planner'});
  assert.equal(context.items.length,1);
  assert.equal(context.items[0].id,'normal-1');
  assert.equal(context.sensitiveBlocked,1);
  assert.equal(memory.snapshot().counters.contextSensitiveBlocked,1);
});

test('explicit sensitive context mode can include sensitive working memory',()=>{
  let seq=0;
  const memory=createMemoryManager({idFactory:()=> 'ctx-'+(++seq)});
  memory.write({
    id:'sensitive-2',
    tags:['approved'],
    sensitivity:'sensitive',
    value:{text:'allowed-for-this-test'}
  });
  const context=memory.prepareContext({
    tags:['approved'],
    includeSensitive:true
  });
  assert.equal(context.items.length,1);
  assert.equal(context.items[0].id,'sensitive-2');
});

test('context selection orders pinned, relevance, priority, then recency deterministically',()=>{
  let now=5000;
  let seq=0;
  const memory=createMemoryManager({
    now:()=>++now,
    idFactory:()=> 'ctx-order-'+(++seq),
    limits:{contextMaxEntries:4,contextMaxBytes:4096}
  });
  memory.write({id:'priority',tags:['a'],priority:.9,value:{id:'priority'}});
  memory.write({id:'relevant',tags:['a','b'],priority:.4,value:{id:'relevant'}});
  memory.write({id:'pinned',tags:['a'],priority:.1,pinned:true,value:{id:'pinned'}});

  const context=memory.prepareContext({tags:['a','b'],limit:3});
  assert.deepEqual(context.items.map(item=>item.id),['pinned','relevant','priority']);
});

test('context byte budget never overfills even when more entries match',()=>{
  let seq=0;
  const memory=createMemoryManager({
    idFactory:()=> 'ctx-budget-'+(++seq),
    limits:{contextMaxBytes:80,contextMaxEntries:10,maxValueBytes:200}
  });
  memory.write({id:'one',tags:['budget'],priority:1,value:{text:'x'.repeat(30)}});
  memory.write({id:'two',tags:['budget'],priority:.9,value:{text:'y'.repeat(30)}});
  const context=memory.prepareContext({tags:['budget'],maxBytes:50});
  assert.ok(context.totalBytes<=50);
  assert.equal(context.items.length,1);
});

test('Memory Manager Event Bus emits metadata without stored values',()=>{
  const bus=createEventBus();
  const events=[];
  bus.onAny(event=>events.push(event));
  let seq=0;
  const memory=createMemoryManager({
    bus,
    idFactory:()=> 'event-'+(++seq)
  });

  memory.write({
    id:'event-memory',
    tags:['audit'],
    sensitivity:'sensitive',
    value:{secretText:'DO_NOT_EMIT'}
  });
  memory.read('event-memory');
  const context=memory.prepareContext({tags:['audit']});
  memory.useContext(context.id);

  const serialized=JSON.stringify(events);
  assert.equal(serialized.includes('DO_NOT_EMIT'),false);
  assert.match(serialized,/memory\.write/);
  assert.match(serialized,/memory\.read/);
  assert.match(serialized,/context\.blocked/);
  assert.match(serialized,/context\.approved/);
  assert.match(serialized,/context\.used/);
});

test('snapshot and metadata listing do not expose memory values',()=>{
  const memory=createMemoryManager();
  memory.write({
    id:'hidden-value',
    value:{private:'not-in-metadata'}
  });
  const metadata=memory.listMetadata();
  assert.equal(Object.hasOwn(metadata[0],'value'),false);
  assert.equal(JSON.stringify(memory.snapshot()).includes('not-in-metadata'),false);
});
