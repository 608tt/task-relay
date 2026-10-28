import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Queue, newState, restoreState } from './queue.js';
import { saveAtomic, lockWorkspace } from './store.js';
import { runAgent, commandFor } from './adapters.js';
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const publicFiles = new Set(['index.html','app.js','style.css','demo.js']);

export async function demoRun(job, config, context, {signal}) {
  await new Promise(resolve => { const timer = setTimeout(resolve, 800); signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, {once:true}); });
  if (signal.aborted) return {kind:'failed',error:'Demo stopped.'};
  if (job.prompt.startsWith('[limit]') && job.attempts === 1) return {kind:'rate-limit',error:'Simulated rate limit; no provider was contacted.'};
  if (job.prompt.startsWith('[fail]')) return {kind:'failed',error:'Simulated failure; no provider was contacted.'};
  return {kind:'done',output:'演练完成。未调用任何模型，也未修改工作文件。\n\n任务：' + job.prompt + (context ? '\n\n已收到上一项演练输出作为上下文。' : '')};
}
export function authorize(req, token, port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!hosts.has(req.headers.host)) return false;
  if (req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin)) return false;
  const supplied = req.headers['x-relay-token'];
  return typeof supplied === 'string' && Buffer.byteLength(supplied) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
}
export async function startServer({ workspace, port = 4318, recover = false, run = runAgent, token = randomBytes(32).toString('hex') }) {
  workspace = fs.realpathSync(workspace);
  if (!fs.statSync(workspace).isDirectory()) throw Error('Workspace must be a folder.');
  const directory = path.join(workspace,'.task-relay'), file = path.join(directory,'queue.json');
  const unlock = lockWorkspace(directory, recover);
  let state;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 20 * 1024 * 1024) throw Error('Queue file is too large.');
    state = fs.existsSync(file) ? restoreState(JSON.parse(fs.readFileSync(file,'utf8'))) : newState();
  } catch (error) { unlock(); throw error; }
  const queue = new Queue({state,workspace,save:s => saveAtomic(file,s),run:(job,...args) => job.provider === 'demo' ? demoRun(job,...args) : run(job,...args)});
  try { queue.persist('Runner opened in paused mode.'); } catch (e) { unlock(); throw e; }
  let actualPort = port;
  const server = http.createServer(async (req,res) => {
    const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
    const json = (code,value) => { res.writeHead(code,{...headers,'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
    if (![ `127.0.0.1:${actualPort}`, `localhost:${actualPort}` ].includes(req.headers.host)) return json(403,{error:'Invalid host'});
    let url; try { url = new URL(req.url,`http://127.0.0.1:${actualPort}`); } catch { return json(400,{error:'Invalid URL'}); }
    if (url.pathname.startsWith('/api/')) {
      if (!authorize(req,token,actualPort)) return json(403,{error:'请使用启动终端给出的完整本地链接。'});
      if (req.method === 'GET' && url.pathname === '/api/state') return json(200,{...queue.state,workspace,commands:{codex:commandFor('codex',queue.state.config),claude:commandFor('claude',queue.state.config)}});
      if (req.method !== 'POST' || url.pathname !== '/api/action') return json(404,{error:'Not found'});
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(415,{error:'Expected JSON'});
      try {
        let body = ''; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 128000) return json(413,{error:'Request too large'}); body += chunk; }
        const {action,data = {}} = JSON.parse(body);
        if (action === 'add') queue.add(data);
        else if (action === 'configure') queue.configure(data);
        else if (action === 'start') queue.start(Number(data.startAt || 0));
        else if (action === 'pause') queue.pause();
        else if (action === 'stop') queue.stop();
        else if (['retry','skip','complete'].includes(action)) queue.action(data.id,action);
        else if (action === 'clear') queue.removeFinished();
        else throw Error('Unknown action');
        json(200,{ok:true});
      } catch (e) { json(400,{error:e.message}); }
      return;
    }
    if (req.method !== 'GET') return json(405,{error:'Method not allowed'});
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!publicFiles.has(name)) return json(404,{error:'Not found'});
    const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200,{...headers,'Content-Type':type+'; charset=utf-8'}); fs.createReadStream(path.join(webRoot,name)).pipe(res);
  });
  try { await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); }); }
  catch (e) { unlock(); throw e; }
  actualPort = server.address().port;
  const timer = setInterval(() => queue.tick().catch(() => { queue.state.enabled = false; }),500);
  const close = async () => {
    clearInterval(timer); queue.stop();
    const deadline = Date.now() + 5000;
    while (queue.inFlight && Date.now() < deadline) await new Promise(r => setTimeout(r,25));
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); unlock();
  };
  return { server,queue,close,port:actualPort,token,url:`http://127.0.0.1:${actualPort}/#token=${token}` };
}
