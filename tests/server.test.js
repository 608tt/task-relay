import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {authorize,startServer} from '../src/server.js';
import {saveAtomic,lockWorkspace} from '../src/store.js';
test('API rejects foreign origins, hosts, missing tokens and unicode length tricks',() => {
  const request=headers=>({headers:{host:'127.0.0.1:4318','x-relay-token':'abcd',...headers}});
  assert.equal(authorize(request({}),'abcd',4318),true);
  assert.equal(authorize(request({origin:'https://evil.example'}),'abcd',4318),false);
  assert.equal(authorize(request({host:'evil.example:4318'}),'abcd',4318),false);
  assert.equal(authorize(request({'x-relay-token':'éééé'}),'abcd',4318),false);
  assert.equal(authorize(request({'x-relay-token':undefined}),'abcd',4318),false);
});
test('atomic state roundtrip and exclusive workspace lock',() => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-store-'));
  try { const unlock=lockWorkspace(root); assert.throws(()=>lockWorkspace(root)); assert.throws(()=>lockWorkspace(root,true)); saveAtomic(path.join(root,'queue.json'),{test:1}); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'queue.json'))),{test:1}); assert.equal(fs.existsSync(path.join(root,'queue.json.tmp')),false); unlock(); } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('HTTP integration: auth, queue mutation, sequential execution, persisted paused restart',async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-http-')); let app;
  try {
    const calls=[]; app=await startServer({workspace:root,port:0,run:async job=>{calls.push(job.prompt);return {kind:'done',output:'fixture output'};}});
    const origin=`http://127.0.0.1:${app.port}`; const headers={'X-Relay-Token':app.token,'Content-Type':'application/json'};
    assert.equal((await fetch(origin+'/api/state')).status,403);
    assert.equal((await fetch(origin+'/api/state',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(origin+'/src/server.js')).status,404);
    const post=(action,data={})=>fetch(origin+'/api/action',{method:'POST',headers,body:JSON.stringify({action,data})});
    assert.equal((await post('add',{prompt:'first'})).status,200); assert.equal((await post('add',{prompt:'second'})).status,200); await post('start');
    await app.queue.tick(); await app.queue.tick(); assert.deepEqual(calls,['first','second']);
    const response=await fetch(origin+'/api/state',{headers}); const state=await response.json(); assert.equal(state.jobs[1].status,'done'); assert.ok(!JSON.stringify(state).includes(app.token));
    await app.close(); app=await startServer({workspace:root,port:0}); assert.equal(app.queue.state.enabled,false); assert.equal(app.queue.state.jobs.length,2);
  } finally {if(app) await app.close();fs.rmSync(root,{recursive:true,force:true});}
});
