import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../',import.meta.url)), out = path.join(root,'dist');
fs.mkdirSync(out,{recursive:true});
for (const name of ['style.css','app.js','demo.js']) fs.copyFileSync(path.join(root,'web',name),path.join(out,name));
fs.writeFileSync(path.join(out,'index.html'),fs.readFileSync(path.join(root,'web/index.html'),'utf8').replace('data-demo="false"','data-demo="true"'));
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log('Built dist/: interactive preview, no model calls.');
