(function () {
  'use strict';
  const $ = id => document.getElementById(id), demo = document.documentElement.dataset.demo === 'true';
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('token')) { sessionStorage.setItem('task-relay-token',fragment.get('token')); history.replaceState(null,'',location.pathname); }
  const token = sessionStorage.getItem('task-relay-token') || '';
  let state, loaded = false, rendered = '', polling = false;
  const labels = {pending:'等待执行',running:'执行中',waiting:'等待额度',done:demo?'演示完成':'已完成',failed:'需要检查',interrupted:'已中断',cancelled:'已跳过'};
  const names = {codex:'Codex CLI',claude:'Claude Code',manual:'手动接力',demo:'本地演练'};
  const notes = {codex:'需要已安装并登录 Codex CLI。默认继承 CLI 模型设置。',claude:'需要已安装并登录 Claude Code。仅开放选定的文件工具。',manual:'复制提示词到 ChatGPT 或其他网页，做完后回到这里标记完成。不会自动发送。',demo:'测试顺序执行，不调用模型、不修改工作文件。以 [limit] 或 [fail] 开头可演练等待或失败。'};
  $('demo-banner').hidden = !demo;
  if (demo) $('provider').value = 'demo';
  function message(text) { $('message').textContent = text; }
  function providerNote() { $('provider-note').textContent = notes[$('provider').value]; }
  providerNote(); $('provider').addEventListener('change',providerNote);
  async function api(action, data) {
    if (demo) return window.RelayDemo.request(action,data);
    const response = await fetch(action ? '/api/action' : '/api/state',{method:action?'POST':'GET',headers:{'X-Relay-Token':token,...(action?{'Content-Type':'application/json'}:{})},...(action?{body:JSON.stringify({action,data})}:{})});
    const result = await response.json(); if (!response.ok) throw Error(result.error || '请求失败'); return result;
  }
  const node = (tag,text,cls) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (cls) element.className = cls; return element; };
  async function action(name,data) { try { await api(name,data); await refresh(); return true; } catch (e) { message(e.message); return false; } }
  function button(label,callback) { const el = node('button',label); el.addEventListener('click',callback); return el; }
  function renderJobs() {
    const signature = JSON.stringify(state.jobs); if (signature === rendered) return; rendered = signature;
    const container = $('jobs'); container.replaceChildren();
    if (!state.jobs.length) container.append(node('div','从左边添加第一项任务。先用“本地演练”走一遍。','empty'));
    state.jobs.forEach((job,index) => {
      const card = node('article',undefined,'job'), head = node('div',undefined,'job-head');
      head.append(node('div',`${String(index+1).padStart(2,'0')}  ${job.title}`,'job-title'),node('span',labels[job.status] || job.status,`badge ${job.status}`));
      card.append(head,node('p',`${names[job.provider]} · 已尝试 ${job.attempts} 次${job.status === 'waiting' ? ' · 最早重试 ' + new Date(job.nextAt).toLocaleString() : ''}`,'muted'));
      const details = node('details'); details.append(node('summary','查看任务内容'),node('pre',job.prompt)); card.append(details);
      if (job.output) { const result = node('details'); result.append(node('summary','查看结果'),node('pre',job.output)); card.append(result); }
      if (job.error) card.append(node('p',job.error,'error'));
      const controls = node('div',undefined,'actions');
      controls.append(button('复制提示词',async () => { try { await navigator.clipboard.writeText(job.prompt); message('已复制提示词。'); } catch { message('复制不可用，请展开任务内容手动选择。'); } }));
      if (['failed','interrupted','waiting','cancelled'].includes(job.status)) controls.append(button('已检查，重新排队',() => action('retry',{id:job.id})));
      if (job.provider === 'manual' && !['done','running','cancelled'].includes(job.status)) controls.append(button('我已完成这一项',() => action('complete',{id:job.id})));
      if (!['done','running','cancelled'].includes(job.status)) controls.append(button('跳过',() => action('skip',{id:job.id})));
      card.append(controls); container.append(card);
    });
  }
  async function refresh() {
    if (polling) return; polling = true;
    try {
      state = await api();
      $('workspace').textContent = state.workspace || '演示工作区 · 浏览器本地数据';
      $('count').textContent = `${state.jobs.filter(j => j.status === 'done').length} / ${state.jobs.length}`;
      const running = state.jobs.some(j => j.status === 'running');
      $('queue-state').textContent = running ? '正在接力' : state.enabled ? state.startAt > Date.now() ? '已预约' : '队列已开启' : '已暂停';
      $('schedule').textContent = state.enabled && state.startAt > Date.now() ? `将在 ${new Date(state.startAt).toLocaleString()} 后检查第一项。` : '严格按顺序执行；前一项等待或失败时，后续项不会越过它。';
      $('start').disabled = running || state.enabled;
      $('settings-form').querySelectorAll('button,input').forEach(el => { if (el.id !== 'start-at') el.disabled = running || state.enabled; });
      if (!loaded) { for (const [key,value] of Object.entries(state.config)) if ($(key)) { if (typeof value === 'boolean') $(key).checked = value; else $(key).value = value; } loaded = true; }
      renderJobs();
      $('events').replaceChildren(...state.events.slice(-12).reverse().map(e => node('li',new Date(e.at).toLocaleTimeString() + '  ' + e.message)));
    } catch (e) { message(e.message); $('queue-state').textContent = '未连接'; }
    finally { polling = false; }
  }
  $('add-form').addEventListener('submit',async event => {
    event.preventDefault();
    try { await api('add',{provider:$('provider').value,title:$('title').value,prompt:$('prompt').value}); $('prompt').value = ''; $('title').value = ''; message('已加入队列。'); await refresh(); }
    catch (e) { message(e.message); }
  });
  $('settings-form').addEventListener('submit',async event => {
    event.preventDefault();
    const config = Object.fromEntries(['retryMinutes','maxAttempts','timeoutMinutes'].map(k => [k,Number($(k).value)]));
    config.writable = $('writable').checked; config.carryContext = $('carryContext').checked;
    if (await action('configure',config)) message('执行设置已保存。');
  });
  $('start').addEventListener('click',() => {
    const startAt = $('start-at').value ? new Date($('start-at').value).getTime() : 0;
    if (!Number.isFinite(startAt)) return message('请输入有效日期时间。');
    action('start',{startAt});
  });
  $('pause').addEventListener('click',() => action('pause'));
  $('stop').addEventListener('click',() => action('stop'));
  $('clear').addEventListener('click',() => { if (confirm('建议先导出备份。清理已完成和已跳过项？')) action('clear'); });
  $('export').addEventListener('click',() => {
    if (!state) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'task-relay-export.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),10000);
  });
  refresh(); setInterval(refresh,1500);
})();
