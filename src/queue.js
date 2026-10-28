import { randomUUID } from 'node:crypto';
export const DEFAULT_CONFIG = Object.freeze({ writable: false, retryMinutes: 30, maxAttempts: 3, timeoutMinutes: 60, carryContext: true });
export function validateConfig(input = {}, workspace = '') {
  const config = { ...DEFAULT_CONFIG, workspace };
  for (const key of ['writable', 'carryContext']) if (typeof input[key] === 'boolean') config[key] = input[key];
  for (const [key,min,max] of [['retryMinutes',1,1440],['maxAttempts',1,10],['timeoutMinutes',1,240]]) {
    if (input[key] !== undefined) { const value = Number(input[key]); if (!Number.isInteger(value) || value < min || value > max) throw Error(`Invalid ${key}: ${min}–${max}`); config[key] = value; }
  }
  return config;
}
export function newState() { return { version: 1, enabled: false, startAt: 0, config: { ...DEFAULT_CONFIG }, jobs: [], events: [] }; }
export function restoreState(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.jobs) || input.jobs.length > 200) throw Error('Invalid queue file. Preserve it and inspect it before starting.');
  const state = structuredClone(input); state.enabled = false; state.config = validateConfig(state.config); state.events = Array.isArray(state.events) ? state.events.slice(-100) : [];
  if (!Number.isFinite(state.startAt) || state.startAt < 0) throw Error('Invalid saved schedule.');
  const ids = new Set();
  for (const job of state.jobs) {
    if (typeof job.id !== 'string' || typeof job.prompt !== 'string' || !['codex','claude','demo','manual'].includes(job.provider) || !['pending','running','waiting','done','failed','interrupted','cancelled'].includes(job.status)) throw Error('Invalid saved task.');
    if (job.status === 'running') { job.status = 'interrupted'; job.error = 'The runner restarted during this task. Inspect partial work before retrying.'; }
    if (ids.has(job.id)) throw Error('Duplicate saved task ID.'); ids.add(job.id);
    if (job.prompt.length > 20000) throw Error('Saved prompt is too large.');
    job.attempts = Number.isInteger(job.attempts) && job.attempts >= 0 ? job.attempts : 0;
    job.nextAt = Number.isFinite(job.nextAt) && job.nextAt >= 0 ? job.nextAt : 0;
  }
  return state;
}
export class Queue {
  constructor({ state = newState(), save = () => {}, run, now = Date.now, workspace = '' }) {
    this.state = state; this.save = save; this.run = run; this.now = now; this.workspace = workspace; this.active = null; this.inFlight = false;
  }
  persist(message) {
    if (message) this.state.events.push({ at: this.now(), message });
    this.state.events = this.state.events.slice(-100); this.save(this.state);
  }
  add({ prompt, provider = 'codex', title = '' }) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20000) throw Error('任务内容需要 1–20000 字符。');
    if (!['codex','claude','demo','manual'].includes(provider)) throw Error('未知执行方式。');
    if (this.state.jobs.length >= 200) throw Error('队列最多 200 条；请先导出并清理已结束的任务。');
    const job = { id: randomUUID(), title: String(title || prompt.trim().split('\n')[0]).slice(0,100), prompt: prompt.trim(), provider, status:'pending', attempts:0, nextAt:0, output:'', error:'', createdAt:this.now() };
    this.state.jobs.push(job); this.persist('Added: ' + job.title); return job;
  }
  configure(input) { if (this.inFlight || this.state.enabled) throw Error('先暂停队列并等待当前任务结束，再修改设置。'); this.state.config = validateConfig(input); this.persist('Settings saved.'); }
  start(startAt = 0) {
    if (!Number.isFinite(startAt) || startAt < 0) throw Error('无效开始时间。');
    this.state.startAt = startAt; this.state.enabled = true; this.persist(startAt > this.now() ? 'Queue scheduled.' : 'Queue started.');
  }
  pause() { this.state.enabled = false; this.persist('Paused after the current task.'); }
  stop() { this.state.enabled = false; this.active?.abort(); this.persist('Stop requested. Partial work needs review.'); }
  action(id, action) {
    const job = this.state.jobs.find(j => j.id === id); if (!job) throw Error('找不到任务。');
    if (job.status === 'running') throw Error('先停止当前任务，再操作。');
    if (action === 'retry') {
      if (!['failed','interrupted','waiting','cancelled'].includes(job.status)) throw Error('只有失败、等待或取消的任务可以重试。');
      job.status = 'pending'; job.attempts = 0; job.nextAt = 0; job.error = '';
    } else if (action === 'skip') { if (job.status === 'done') throw Error('已完成任务不能跳过。'); job.status = 'cancelled'; }
    else if (action === 'complete') { if (job.provider !== 'manual' || job.status === 'done') throw Error('只有手动接力任务可手动标记完成。'); job.status = 'done'; job.output = 'Manually confirmed by the user.'; }
    else throw Error('未知操作。');
    this.persist(action + ': ' + job.title);
  }
  removeFinished() { if (this.inFlight || this.state.enabled) throw Error('请先暂停。'); this.state.jobs = this.state.jobs.filter(j => !['done','cancelled'].includes(j.status)); this.persist('Removed finished tasks.'); }
  async tick() {
    if (this.inFlight || !this.state.enabled || this.now() < this.state.startAt) return;
    const job = this.state.jobs.find(j => !['done','cancelled'].includes(j.status));
    if (!job) { this.state.enabled = false; this.persist('All tasks finished.'); return; }
    if (['failed','interrupted'].includes(job.status)) { this.state.enabled = false; this.persist('Review the blocked task before continuing.'); return; }
    if (job.provider === 'manual') { this.state.enabled = false; this.persist('Manual handoff: copy the prompt, then confirm completion.'); return; }
    if (job.nextAt > this.now()) return;
    this.inFlight = true; this.active = new AbortController();
    job.status = 'running'; job.attempts++; job.startedAt = this.now();
    try {
      this.persist('Running: ' + job.title);
      const previous = this.state.jobs.slice(0,this.state.jobs.indexOf(job)).filter(j => j.status === 'done' && j.provider === job.provider).at(-1);
      const config = validateConfig(this.state.config, this.workspace);
      const result = await this.run(job, config, config.carryContext ? previous?.output || '' : '', { signal: this.active.signal });
      job.output = String(result.output || '').slice(-64000); job.session = String(result.session || '').slice(0,200); job.error = String(result.error || '').slice(-8000);
      job.finishedAt = this.now();
      if (this.active.signal.aborted) { job.status = 'interrupted'; this.state.enabled = false; }
      else if (result.kind === 'done') job.status = 'done';
      else if (result.kind === 'rate-limit' && job.attempts < config.maxAttempts) {
        job.status = 'waiting'; job.nextAt = this.now() + config.retryMinutes * 60000;
      } else { job.status = 'failed'; this.state.enabled = false; }
      this.persist(job.status + ': ' + job.title);
    } catch (e) {
      job.status = 'failed'; job.error = String(e.message); this.state.enabled = false;
      try { this.persist('Runner failed: ' + job.title); } catch { /* Do not launch more work after persistence fails. */ }
    } finally { this.inFlight = false; this.active = null; }
  }
}
