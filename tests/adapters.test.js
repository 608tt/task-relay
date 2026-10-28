import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventParser,isRateLimit,commandFor,runAgent} from '../src/adapters.js';
test('Codex requires confirmed completion and zero exit status',() => {
  const parser=new EventParser('codex'); parser.feed('{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}\n'); assert.equal(parser.finish(0).kind,'failed'); parser.feed('{"type":"turn.completed"}\n'); assert.equal(parser.finish(0).kind,'done'); assert.equal(parser.finish(1).kind,'failed');
});
test('handles split JSONL and newline-free final event',() => {
  const p=new EventParser('codex'); p.feed('{"type":"turn.'); p.feed('completed"}'); assert.equal(p.finish(0).kind,'done');
});
test('mentioning quotas in assistant text never schedules retries',() => {
  const p=new EventParser('codex'); p.feed(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'rate_limit_exceeded'}})+'\n'); assert.equal(p.finish(1).kind,'failed');
});
test('structured limit errors are distinguished from authentication failures',() => {
  const p=new EventParser('codex'); p.feed(JSON.stringify({type:'turn.failed',error:{code:'rate_limit_exceeded',message:'Wait'}})+'\n'); assert.equal(p.finish(1).kind,'rate-limit'); assert.equal(isRateLimit({status:429}),true); assert.equal(isRateLimit('Invalid API key'),false);
});
test('Claude success, error and denied-tool events',() => {
  const p=new EventParser('claude'); p.line(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'ok',session_id:'test'})); assert.equal(p.finish(0).kind,'done');
  p.line(JSON.stringify({type:'result',subtype:'success',permission_denials:[{tool_name:'Bash'}]})); assert.equal(p.finish(0).kind,'failed');
  const q=new EventParser('claude'); q.line(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,errors:['rate limit exceeded']})); assert.equal(q.finish(1).kind,'rate-limit');
});
test('command construction does not accept arbitrary commands or bypass flags',() => {
  const c=commandFor('codex'); assert.ok(c.args.includes('read-only')); assert.ok(!c.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(commandFor('codex',{writable:true}).args.includes('workspace-write'));
  const a=commandFor('claude',{writable:true}); assert.ok(a.args.includes('dontAsk')); assert.ok(!a.args.join(' ').includes('Bash')); assert.throws(() => commandFor('sh'));
});
test('oversized protocol output fails closed',() => {
  const p=new EventParser('codex'); p.feed('x'.repeat(1048577)); assert.equal(p.finish(0).kind,'failed'); assert.equal(p.overflow,true);
});
test('real subprocess fixture receives literal stdin without shell execution',async () => {
  const literal='$(touch NEVER) `echo nope` "quoted"\n你好';
  const result=await runAgent({provider:'codex',prompt:literal},{workspace:process.cwd(),timeoutMinutes:1},'',{spawnImpl:(_file,_args,opts) => {
    assert.equal(opts.shell,false);
    return spawn(process.execPath,['-e',`let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:s}}));console.log(JSON.stringify({type:'turn.completed'}));});`],opts);
  }}); assert.equal(result.kind,'done'); assert.equal(result.output,literal);
});
test('missing executable fails with installation guidance',async () => {
  const result=await runAgent({provider:'codex',prompt:'x'},{workspace:process.cwd(),timeoutMinutes:1},'',{spawnImpl:(_f,a,o) => spawn('task-relay-nonexistent-test-executable',a,o)}); assert.equal(result.kind,'failed'); assert.match(result.error,/not installed/);
});
test('abort terminates a running fixture and never reports success',async () => {
  const controller=new AbortController();
  const resultPromise=runAgent({provider:'codex',prompt:'x'},{workspace:process.cwd(),timeoutMinutes:1},'',{signal:controller.signal,spawnImpl:(_f,_a,o) => spawn(process.execPath,['-e','process.stdin.resume();setInterval(()=>{},1000)'],o)});
  controller.abort(); const result=await resultPromise; assert.equal(result.kind,'failed'); assert.match(result.error,/Stopped/);
});
