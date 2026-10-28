import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function saveAtomic(file, state) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(state, null, 2)); fs.fsyncSync(fd); } catch (e) { fs.closeSync(fd); fs.unlinkSync(temporary); throw e; }
  fs.closeSync(fd);
  try { fs.renameSync(temporary, file); } catch (e) { fs.unlinkSync(temporary); throw e; }
}

export function lockWorkspace(directory, recover = false) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw Error('The state directory must not be a symlink.');
  const file = path.join(directory, 'runner.lock');
  if (recover && fs.existsSync(file)) {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid lock file. Inspect it manually.');
    try { process.kill(pid, 0); throw Error('A runner is still alive; do not remove its lock.'); }
    catch (e) { if (e.code !== 'ESRCH') throw e; }
    fs.unlinkSync(file);
  }
  try { fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code === 'EEXIST') throw Error('This workspace is locked. Close its existing runner. After a crash, inspect any remaining CLI processes, then use --recover-lock.'); throw e; }
  return () => { if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file); };
}
