#!/usr/bin/env node
import { startServer } from './server.js';
import path from 'node:path';
const args = process.argv.slice(2);
let workspace = process.cwd(), port = 4318, recover = false;
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && args[i+1]) workspace = path.resolve(args[++i]);
    else if (args[i] === '--port' && args[i+1]) port = Number(args[++i]);
    else if (args[i] === '--recover-lock') recover = true;
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Task Relay — local sequential queue\n\nnode src/cli.js [--workspace /path/to/project] [--port 4318]\n\nRequires Node.js 22+. No npm install needed.\nStart paused; use the printed local link. Keep this process and your computer awake.\n--recover-lock removes a stale lock only when its recorded process is absent.\nReview orphan CLI processes and partial work before recovery.'); process.exit(0);
    } else throw Error('Unknown or incomplete option: ' + args[i]);
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Port must be 1024–65535.');
  const app = await startServer({workspace,port,recover});
  console.log(`Task Relay · 任务接力\nWorkspace: ${workspace}\nOpen privately: ${app.url}\nKeep this terminal open. Ctrl+C stops the runner.\nAI providers use your existing CLI login/billing. Demo mode makes no model calls.`);
  let closing = false;
  for (const signal of ['SIGINT','SIGTERM','SIGHUP']) process.on(signal,async () => { if (closing) return; closing = true; await app.close(); process.exit(0); });
} catch (e) { console.error('Task Relay:',e.message); process.exitCode = 1; }
