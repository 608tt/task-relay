import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Queue,newState,restoreState,validateConfig} from '../src/queue.js';
function fixture(run = async () => ({kind:'done',output:'ok'})) {
  let clock = 10000; const saved = [];
  const queue = new Queue({run,now:() => clock,save:s => saved.push(structuredClone(s))});
  return {queue,saved,advance:ms => { clock += ms; }};
}
test('starts only at scheduled time and preserves task order',async () => {
  const calls = [], {queue:q,advance} = fixture(async job => { calls.push(job.prompt); return {kind:'done'}; });
  q.add({prompt:'first'}); q.add({prompt:'second'}); q.start(20000);
  await q.tick(); assert.equal(calls.length,0); advance(10000); await q.tick(); assert.deepEqual(calls,['first']); await q.tick(); await q.tick(); assert.deepEqual(calls,['first','second']); assert.equal(q.state.enabled,false);
});
test('no concurrent dispatch and running state is persisted before invocation',async () => {
  let release, calls = 0; const {queue:q,saved} = fixture(() => { calls++; assert.equal(saved.at(-1).jobs[0].status,'running'); return new Promise(r => release=r); });
  q.add({prompt:'one'}); q.start(); const work = q.tick(); await q.tick(); assert.equal(calls,1); release({kind:'done'}); await work;
});
test('rate limits wait, block later work and stop at max attempts',async () => {
  const {queue:q,advance} = fixture(async () => ({kind:'rate-limit',error:'quota'}));
  q.configure({retryMinutes:1,maxAttempts:2}); q.add({prompt:'first'}); q.add({prompt:'second'}); q.start(); await q.tick();
  assert.equal(q.state.jobs[0].status,'waiting'); await q.tick(); assert.equal(q.state.jobs[0].attempts,1); assert.equal(q.state.jobs[1].attempts,0);
  advance(60000); await q.tick(); assert.equal(q.state.jobs[0].status,'failed'); assert.equal(q.state.enabled,false);
});
test('ordinary failure pauses without automatic retry',async () => {
  const {queue:q,advance} = fixture(async () => ({kind:'failed',error:'auth'})); q.add({prompt:'a'}); q.start(); await q.tick(); advance(999999); await q.tick(); assert.equal(q.state.jobs[0].attempts,1); assert.equal(q.state.enabled,false);
});
test('pause permits current completion; stop marks partial work interrupted',async () => {
  let release; const {queue:q} = fixture(() => new Promise(r => release=r));
  q.add({prompt:'a'}); q.start(); const first=q.tick(); q.pause(); release({kind:'done'}); await first; assert.equal(q.state.jobs[0].status,'done'); assert.equal(q.state.enabled,false);
  q.add({prompt:'b'}); q.start(); const second=q.tick(); q.stop(); release({kind:'done'}); await second; assert.equal(q.state.jobs[1].status,'interrupted');
});
test('restart cannot silently rerun interrupted work',() => {
  const state=newState(); state.enabled=true; state.jobs=[{id:'a',prompt:'work',provider:'codex',status:'running'}];
  const restored=restoreState(state); assert.equal(restored.enabled,false); assert.equal(restored.jobs[0].status,'interrupted');
});
test('manual handoff never invokes the runner',async () => {
  const {queue:q}=fixture(() => { throw Error('must not call'); }); q.add({prompt:'manual',provider:'manual'}); q.start(); await q.tick(); assert.equal(q.state.enabled,false); q.action(q.state.jobs[0].id,'complete'); assert.equal(q.state.jobs[0].status,'done');
});
test('only same-provider prior output is passed as optional context',async () => {
  const contexts=[]; const {queue:q}=fixture(async (job,config,context) => {contexts.push(context);return {kind:'done',output:job.prompt};});
  q.add({prompt:'first',provider:'codex'}); q.add({prompt:'unrelated',provider:'claude'}); q.add({prompt:'third',provider:'codex'}); q.start(); await q.tick(); await q.tick(); await q.tick(); assert.deepEqual(contexts,['','','first']);
});
test('state persistence error prevents execution',async () => {
  let calls=0; const q=new Queue({run:async () => {calls++;return {kind:'done'};}}); q.add({prompt:'a'}); q.start(); q.save=() => {throw Error('disk full');}; await q.tick(); assert.equal(calls,0); assert.equal(q.state.enabled,false);
});
test('validation bounds prevent tight loops and huge prompts',() => {
  assert.throws(() => validateConfig({retryMinutes:0})); assert.throws(() => validateConfig({maxAttempts:Infinity}));
  const {queue:q}=fixture(); assert.throws(() => q.add({prompt:''})); assert.throws(() => q.add({prompt:'a'.repeat(20001)})); assert.throws(() => q.add({prompt:'a',provider:'shell'}));
});
test('explicit review retry resets attempt budget, skip unblocks FIFO',async () => {
  const {queue:q}=fixture(async () => ({kind:'failed'})); q.add({prompt:'a'}); q.start(); await q.tick(); const id=q.state.jobs[0].id; q.action(id,'retry'); assert.equal(q.state.jobs[0].attempts,0); q.action(id,'skip'); assert.equal(q.state.jobs[0].status,'cancelled');
});
