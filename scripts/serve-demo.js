import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const allowed = new Set(['index.html','style.css','app.js','demo.js']);
http.createServer((req,res) => {
  const name = new URL(req.url,'http://localhost').pathname.slice(1) || 'index.html';
  if (!allowed.has(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(path.join('dist',name)).pipe(res);
}).listen(4176,'127.0.0.1',() => console.log('Demo: http://127.0.0.1:4176'));
