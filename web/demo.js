(function () {
  if (document.documentElement.dataset.demo !== 'true') return;
  const key = 'task-relay-preview-v1';
  let state;
  try { state = JSON.parse(localStorage.getItem(key)); } catch {}
  if (!state?.jobs) state = {enabled:false,startAt:0,config:{retryMinutes:1,maxAttempts:3,timeoutMinutes:60,writable:false,carryContext:true},jobs:[],events:[]};
  state.enabled = false; state.jobs.forEach(j => { if (j.status === 'running') j.status = 'interrupted'; });
  const save = message => { if (message) state.events.push({at:Date.now(),message}); state.events = state.events.slice(-100); localStorage.setItem(key,JSON.stringify(state)); };
  window.RelayDemo = { async request(action,data = {}) {
    if (!action) return structuredClone(state);
    if (action === 'add') {
      if (!data.prompt?.trim() || data.prompt.length > 20000 || state.jobs.length >= 200) throw Error('请输入任务（最多 200 条，每条 20000 字符）。');
      state.jobs.push({id:crypto.randomUUID(),title:data.title || data.prompt.slice(0,60),prompt:data.prompt,provider:data.provider,status:'pending',attempts:0,nextAt:0});
    } else if (action === 'start') { state.enabled = true; state.startAt = data.startAt || 0; }
    else if (action === 'pause' || action === 'stop') {
      state.enabled = false;
      if (action === 'stop') state.jobs.filter(j => j.status === 'running').forEach(j => j.status = 'interrupted');
    } else if (action === 'configure') { if (state.enabled || state.jobs.some(j => j.status === 'running')) throw Error('请先暂停。'); state.config = {...state.config,...data}; }
    else if (action === 'clear') { if (state.enabled || state.jobs.some(j => j.status === 'running')) throw Error('请先暂停。'); state.jobs = state.jobs.filter(j => !['done','cancelled'].includes(j.status)); }
    else {
      const job = state.jobs.find(j => j.id === data.id); if (!job) throw Error('找不到任务。');
      if (job.status === 'running') throw Error('请先停止。');
      if (action === 'retry') { job.status = 'pending'; job.attempts = 0; job.nextAt = 0; job.error = ''; }
      if (action === 'skip') job.status = 'cancelled';
      if (action === 'complete' && job.provider === 'manual') job.status = 'done';
    }
    save('演示：' + action); return {ok:true};
  }};
  setInterval(() => {
    const running = state.jobs.find(j => j.status === 'running');
    if (running) {
      if (Date.now() - running.started < 1600) return;
      if (running.prompt.startsWith('[limit]') && running.attempts === 1 && state.config.maxAttempts > 1) { running.status = 'waiting'; running.nextAt = Date.now() + state.config.retryMinutes*60000; running.error = '模拟额度不足，等待后重试。'; }
      else if (running.prompt.startsWith('[fail]')) { running.status = 'failed'; running.error = '模拟失败，请检查后重新排队或跳过。'; state.enabled = false; }
      else { running.status = 'done'; running.output = '演示完成，未调用任何模型。\n' + running.prompt; running.error = ''; }
      save('演示：' + running.status); return;
    }
    if (!state.enabled || Date.now() < state.startAt) return;
    const job = state.jobs.find(j => !['done','cancelled'].includes(j.status));
    if (!job) { state.enabled = false; save('演示队列已完成'); return; }
    if (['failed','interrupted'].includes(job.status) || job.provider === 'manual') { state.enabled = false; save('演示暂停：需要手动处理'); return; }
    if (job.nextAt > Date.now()) return;
    job.status = 'running'; job.started = Date.now(); job.attempts++; save('演示：开始 ' + job.title);
  },500);
})();
