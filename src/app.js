import { createInitialState, transition, getEvaluation, canPublish, restoreState, TEMPLATES, templateTypeOf, getMonitorMode } from './logic.js';

const STORAGE_KEY = 'agent-studio-demo-v5';
const app = document.querySelector('#app');
const profile = {
  a: { letter: 'A', icon: '✳', type: '用户互动 · 实时', accent: 'coral', blurb: '根据场景生成穿搭灵感，并推荐社区同款笔记。' },
  b: { letter: 'B', icon: '◇', type: '内容治理 · 批量', accent: 'blue', blurb: '输出类别、理由和政策依据，辅助人工判定。' },
  c: { letter: 'C', icon: '▣', type: '客服辅助 · 多轮', accent: 'green', blurb: '基于售后知识拟答，并给出可核对的来源。' },
};
const mockTeams = ['社区体验团队','社区生态团队','电商服务团队','内容运营团队','用户增长团队','搜索推荐团队','商业化团队','客户服务团队','风控与安全团队','基础架构团队'];
const views = [
  ['creation', '创建'], ['config', '配置'], ['debug', '调试'], ['evaluation', '评估'], ['release', '发布'], ['monitor', '监控'],
];

function loadState() {
  try {
    return restoreState(localStorage.getItem(STORAGE_KEY));
  } catch { /* Use a fresh demo when saved state is invalid. */ }
  return createInitialState();
}

let state = loadState();
const typeFor = id => templateTypeOf(id, state.agents[id]);
const profileFor = id => profile[typeFor(id)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function multiline(value) {
  return escapeHtml(value).replace(/\n/g, '<br />');
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

function update(action) {
  state = transition(state, action);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function getBadge(status) {
  const kind = status === '运行中' ? 'good' : status === '灰度中' ? 'accent' : status === '人工兜底' ? 'warn' : 'neutral';
  return `<span class="badge ${kind}"><span class="badge-dot"></span>${escapeHtml(status)}</span>`;
}

function agentStatus(id, agent) {
  if (!agent.liveVersion) return '草稿';
  if (agent.isExample && typeFor(id) === 'a' && agent.liveVersion === 'v1.0' && agent.status !== '已回退') return '待灰度';
  if (agent.isExample && typeFor(id) === 'b' && agent.liveVersion === 'v1.0' && agent.status !== '人工兜底') return '待审核';
  return agent.status;
}

function renderSidebar() {
  return `<aside class="sidebar">
    <div class="brand"><div class="brand-mark">✳</div><div><strong>Agent Studio</strong><small>企业 Agent 基建平台</small></div></div>
    <nav aria-label="主导航">
      <button class="side-link ${state.view === 'overview' ? 'active' : ''}" data-action="overview"><span class="nav-icon">◫</span>Agent 工作台</button>
      <button class="side-link ${state.view === 'manage' ? 'active' : ''}" data-action="manage"><span class="nav-icon">◇</span>Agent 管理</button>
    </nav>
    <div class="sidebar-bottom"><div class="demo-label"><span class="demo-pulse"></span> 演示数据 · 本地状态</div><button class="reset-link" data-action="reset">重置演示</button></div>
  </aside>`;
}

function renderTopbar() {
  const title = state.view === 'overview' ? 'Agent 工作台' : state.view === 'manage' ? 'Agent 管理' : ['templates','create'].includes(state.view) ? '新建 Agent' : state.agents[state.selectedAgent]?.name ?? 'Agent 管理';
  return `<header class="topbar"><div class="breadcrumb"><span>平台</span><b>/</b><span>${escapeHtml(title)}</span></div><div class="top-actions"><span class="demo-pill">演示数据</span><button class="mobile-reset" data-action="reset" aria-label="重置演示">重置</button><span class="avatar">PM</span></div></header>`;
}

function renderAgentCard(id, agent) {
  const info = profileFor(id);
  return `<button class="agent-card" data-action="selectAgent" data-agent="${escapeHtml(id)}">
    <div class="card-top"><span class="agent-avatar ${info.accent}">${info.icon}</span><span class="card-arrow">↗</span></div>
    <div class="agent-meta">${info.type}${agent.isExample ? ' · 示例' : ' · 自建'}</div><h3>${escapeHtml(agent.name)}</h3><p>${escapeHtml(agent.taskDescription ?? info.blurb)}</p>
    <div class="card-divider"></div><div class="card-bottom">${getBadge(agentStatus(id, agent))}<span>生产 ${agent.liveVersion ?? '未发布'}</span></div>
  </button>`;
}

function renderOverview() {
  const examples = ['a','b','c'].map(id => renderAgentCard(id, state.agents[id])).join('');
  const recent = Object.entries(state.agents).filter(([, agent]) => !agent.isExample).reverse().slice(0, 3);
  return `<section class="page-head with-action"><div><h1>Agent 工作台</h1><p>从模板创建业务 Agent，完成调试、评估与发布。</p></div><button class="btn btn-primary create-main" data-action="newAgent">＋ 新建 Agent</button></section>
    <section class="overview-stats" aria-label="平台概览"><div><strong>${String(Object.keys(state.agents).length).padStart(2,'0')}</strong><span>Agent 总数</span></div><div><strong>03</strong><span>业务模板</span></div><div><strong>06</strong><span>核心步骤</span></div><div class="stat-note">当前为需求评审原型<br />所有运行和指标数据均为模拟</div></section>
    <div class="section-heading"><div><h2>直接体验三个示例</h2></div></div>
    <section class="agent-grid" aria-label="示例 Agent">${examples}</section>
    ${recent.length ? `<div class="section-heading recent-heading"><div><h2>最近创建</h2></div><button class="text-action" data-action="manage">查看全部 →</button></div><section class="agent-grid" aria-label="最近 Agent">${recent.map(([id, agent]) => renderAgentCard(id, agent)).join('')}</section>` : ''}
    <section class="overview-bottom"><div class="lifecycle-card"><div class="section-heading compact"><div><h2>共用一套交付流程</h2></div></div><div class="lifecycle">${views.map(([view,label],i)=>`<button class="life-step" data-action="lifeStep" data-view="${view}"><span>${String(i+1).padStart(2,'0')}</span><strong>${label}</strong></button>`).join('')}</div></div>
      <button class="review-card review-entry" data-action="reviewB"><div class="review-icon">◉</div><div><h3>从失败拦截开始评审 →</h3><p>生态守护 Agent 的严重样本漏判如何阻断发布。</p></div></button></section>`;
}

function renderManage() {
  return `<section class="page-head with-action"><div><h1>Agent 管理</h1><p>查看全部 Agent，或从模板新建。</p></div><button class="btn btn-primary create-main" data-action="newAgent">＋ 新建 Agent</button></section>
    <div class="section-heading"><div><h2>全部 Agent · ${Object.keys(state.agents).length}</h2></div></div>
    <section class="agent-grid" aria-label="全部 Agent">${Object.entries(state.agents).map(([id, agent]) => renderAgentCard(id, agent)).join('')}</section>`;
}

function renderTemplates() {
  return `<section class="page-head"><button class="back-link" data-action="manage">← 返回 Agent 管理</button><h1>选择业务模板</h1><p>模板预填调用形态、输出格式和知识或规则。</p></section>
    <section class="agent-grid" aria-label="模板列表">${Object.keys(TEMPLATES).map(type => { const info = profile[type]; const base = state.agents[type]; return `<button class="agent-card template-card" data-action="chooseTemplate" data-template="${type}"><div class="card-top"><span class="agent-avatar ${info.accent}">${info.icon}</span><span class="card-arrow">选择 →</span></div><div class="agent-meta">${info.type}</div><h3>${base.name}</h3><p>${escapeHtml(TEMPLATES[type].taskDescription)}</p><div class="card-divider"></div><div class="template-foot">输出：${escapeHtml(TEMPLATES[type].outputFormat)}</div></button>`; }).join('')}</section>`;
}

function debugPromptPresets(type, agent) {
  const presets = {
    a: [
      ['concise', '简洁推荐', '请用简洁语言，根据用户场景给出一条穿搭建议，并附上相关笔记。'],
      ['scene', '优先匹配场景', '先识别天气、地点和活动，再给出适合场景的穿搭建议与相关笔记。'],
    ],
    b: [
      ['concise', '简洁分类', '简洁输出类别和理由；疑似严重违规时交由人工复核。'],
      ['strict', '严格按规则复核', '依据当前政策规则分类，说明命中依据；不确定时转人工复核。'],
    ],
    c: [
      ['concise', '简洁答复', '请简洁回答，并引用有效知识；缺少依据时转人工。'],
      ['ask-first', '先补齐信息', '信息不足时先追问；有知识依据后再答复并标明引用。'],
    ],
  };
  return [{ value: 'current', label: '当前配置指令', prompt: agent.prompt },
    ...presets[type].map(([value, label, prompt]) => ({ value, label, prompt })),
    { value: 'custom', label: '自定义提示词', prompt: agent.debugSystemPrompt ?? agent.prompt }];
}

function renderCreate() {
  const type = state.selectedTemplate;
  if (!TEMPLATES[type]) return renderTemplates();
  const template = TEMPLATES[type];
  const base = state.agents[type];
  return `<section class="page-head"><button class="back-link" data-action="newAgent">← 重新选择模板</button><h1>新建 ${escapeHtml(base.name)}</h1><p>填写业务信息，沿用模板能力。</p></section>
    <div class="content-grid"><section class="panel"><div class="panel-heading"><div><h2>基础信息</h2><p>名称必填；其余字段可在创建后继续编辑指令。</p></div></div><form id="create-form"><input type="hidden" name="templateType" value="${type}" /><label class="field-label" for="new-name">Agent 名称 <b class="required">*</b></label><input id="new-name" name="name" required placeholder="例如：评论风险初筛 Agent" autofocus /><label class="field-label" for="new-team">所属团队</label><select id="new-team" name="team">${mockTeams.map(team=>`<option value="${escapeHtml(team)}" ${team===base.team?'selected':''}>${escapeHtml(team)}</option>`).join('')}</select><label class="field-label" for="new-task">任务描述</label><textarea id="new-task" name="taskDescription" rows="3">${escapeHtml(template.taskDescription)}</textarea><label class="field-label" for="new-prompt">初始指令</label><textarea id="new-prompt" name="prompt" rows="5">${escapeHtml(base.prompt)}</textarea><div class="form-footer"><span class="muted">创建后仍需调试与评估，才能发布。</span><button class="btn btn-primary" type="submit">创建 Agent →</button></div></form></section>
    <aside class="panel side-panel"><h2>模板预填能力</h2><div class="info-row"><span>调用形态</span><b>${escapeHtml(template.callMode)}</b></div><div class="info-row"><span>输出格式</span><b>${escapeHtml(template.outputFormat)}</b></div><div class="info-row"><span>默认知识／规则</span><b>${escapeHtml(template.defaultResource)}</b></div></aside></div>`;
}

function renderWorkspaceHead(id, agent) {
  const info = profileFor(id);
  return `<section class="workspace-head"><div class="back-row"><button data-action="manage" class="back-link">← 返回 Agent 管理</button><span class="head-divider"></span><span>${escapeHtml(agent.team)}</span></div>
    <div class="workspace-title"><span class="agent-avatar large ${info.accent}">${info.icon}</span><div><div class="title-line"><h1>${escapeHtml(agent.name)}</h1>${getBadge(agentStatus(id, agent))}</div><p>${escapeHtml(agent.taskDescription ?? info.blurb)}</p></div></div>
    <div class="meta-strip"><span>调用形态 <b>${info.type}</b></span><span>生产版本 <b>${agent.liveVersion ?? '未发布'}</b></span><span>当前草稿 <b>${agent.draftVersion}</b></span></div></section>
    <nav class="workflow-tabs" aria-label="Agent 生命周期">${views.map(([view,label],i)=>`<button data-action="goView" data-view="${view}" class="workflow-tab ${state.view===view?'active':''}"><span class="tab-number">${i+1}</span>${label}</button>`).join('')}</nav>`;
}

function renderCreation(id, agent) {
  const type = typeFor(id);
  const template = TEMPLATES[type];
  return `<div class="content-grid"><section class="panel"><div class="panel-heading"><div><h2>创建信息</h2></div>${getBadge(agent.isExample ? '示例' : '已创建')}</div>
    <div class="info-row"><span>Agent 名称</span><b>${escapeHtml(agent.name)}</b></div><div class="info-row"><span>所属团队</span><b>${escapeHtml(agent.team)}</b></div><div class="info-row"><span>任务描述</span><b>${escapeHtml(agent.taskDescription)}</b></div><div class="info-row"><span>来源模板</span><b>${escapeHtml(state.agents[type].name)}</b></div><div class="info-row"><span>创建时间</span><b>${agent.createdAt ? formatTime(agent.createdAt) : '预置示例'}</b></div><div class="section-actions"><button class="btn btn-primary" data-action="goView" data-view="config">进入配置 →</button></div></section>
    <aside class="panel side-panel"><h2>模板能力</h2><div class="info-row"><span>调用形态</span><b>${escapeHtml(template.callMode)}</b></div><div class="info-row"><span>输出格式</span><b>${escapeHtml(template.outputFormat)}</b></div><div class="info-row"><span>知识或规则</span><b>${escapeHtml(template.defaultResource)}</b></div></aside></div>`;
}

function renderConfig(id, agent) {
  const type = typeFor(id);
  const special = type === 'a'
    ? `<div class="special-title"><span class="mini-icon coral">✳</span><div><h3>社区笔记检索</h3><p>示例中使用固定演示笔记 ID。</p></div></div><div class="info-row"><span>连接状态</span><b class="green-text">演示索引</b></div><div class="info-row"><span>输出要求</span><b>穿搭建议 + 笔记卡片</b></div><div class="strategy-box"><strong>推荐策略</strong><p>切换策略将改变模拟回答、离线评分和延迟。</p><div class="strategy-options"><button class="strategy-option ${agent.strategy==='speed'?'selected':''}" data-action="setStrategy" data-strategy="speed">优先响应速度<small>p95 0.9 秒 · 场景 10/12</small></button><button class="strategy-option ${agent.strategy==='relevance'?'selected':''}" data-action="setStrategy" data-strategy="relevance">优先场景相关性<small>p95 1.2 秒 · 场景 11/12</small></button></div></div>`
    : type === 'b'
      ? `<div class="special-title"><span class="mini-icon blue">◇</span><div><h3>政策规则</h3><p>结构化输出类别、理由和规则版本，供人工复核。</p></div></div><div class="info-row"><span>政策版本</span><b>${agent.policyVersion}</b></div><div class="rule-box ${agent.ruleEnabled?'enabled':''}"><div><strong>攻击性语言演示规则</strong><small>${agent.ruleEnabled?'已启用，重新评估可验证严重样本':'当前未启用，将导致 1 条严重样本漏判'}</small></div><button class="btn ${agent.ruleEnabled?'btn-light':'btn-primary'}" data-action="enableRule" ${agent.ruleEnabled?'disabled':''}>${agent.ruleEnabled?'已启用':'启用规则'}</button></div>`
      : `<div class="special-title"><span class="mini-icon green">▣</span><div><h3>售后知识</h3><p>知识更新会形成新快照，并使旧评估失效。</p></div></div><div class="info-row"><span>当前知识版本</span><b>${agent.knowledgeVersion}</b></div><div class="knowledge-box"><strong>《店铺换货规则》</strong><p>${agent.knowledgeVersion==='K-02'?'演示条款：符合签收时间及商品状态条件时，可在订单页申请换码。':'当前版本缺少具体换码条件，无法给出有依据的答复。'}</p></div><button class="btn ${agent.knowledgeVersion==='K-02'?'btn-light':'btn-primary'}" data-action="updateKnowledge" ${agent.knowledgeVersion==='K-02'?'disabled':''}>${agent.knowledgeVersion==='K-02'?'已更新至 K-02':'导入新版知识 K-02'}</button>`;
  return `<div class="content-grid"><section class="panel"><div class="panel-heading"><div><h2>配置草稿 ${agent.draftVersion}</h2><p>配置变更后需重新评估。</p></div><span class="outline-badge">草稿</span></div>
    <form id="prompt-form"><label class="field-label" for="prompt">Agent 指令</label><textarea id="prompt" name="prompt" rows="6">${escapeHtml(agent.prompt)}</textarea><div class="field-help">生产版本不会因编辑草稿而变化。</div><div class="form-footer"><button type="submit" class="btn btn-outline">保存草稿</button><button type="submit" name="next" value="debug" class="btn btn-primary">保存并调试 →</button></div></form></section>
    <aside class="panel side-panel"><h2>场景能力</h2>${special}<div class="side-note">${type==='b'?'最终违规判定由人工完成。':type==='c'?'缺少有效知识时必须转人工。':'业务效果需在灰度后由曝光与点击事件衡量。'}</div></aside></div>`;
}

function renderDebug(id, agent) {
  const type = typeFor(id);
  const nextInput = agent.debugInput ?? (type === 'c' && agent.debugStep === 1 ? '昨天签收，还没穿。' : agent.sampleInput);
  const presets = debugPromptPresets(type, agent);
  const selectedPreset = agent.debugPromptPreset ?? 'current';
  const systemPrompt = agent.debugSystemPrompt ?? agent.prompt;
  return `<div class="debug-layout"><section class="panel debug-panel"><div class="panel-heading"><div><h2>调试会话</h2></div><button class="small-link" data-action="resetDebug">清空会话</button></div>
    <div class="debug-prompt"><div class="debug-prompt-heading"><label class="field-label" for="debug-system-prompt">系统提示词</label><select id="debug-preset">${presets.map(item=>`<option value="${item.value}" ${selectedPreset===item.value?'selected':''}>${escapeHtml(item.label)}</option>`).join('')}</select></div><textarea id="debug-system-prompt" rows="2">${escapeHtml(systemPrompt)}</textarea></div>
    <div class="chat-area">${agent.debugHistory?.length?agent.debugHistory.map((output,index)=>`<div class="chat-bubble user"><span>${type==='c'&&index===1?'用户补充':'业务输入'}</span><p>${escapeHtml(agent.debugInputs?.[index] ?? agent.sampleInput)}</p></div><div class="chat-bubble assistant"><span>模拟回答</span><p>${multiline(output)}</p></div>`).join(''):`<div class="chat-empty"><div>✦</div><strong>等待运行样本</strong><span>输入内容后运行，查看模拟回答。</span></div>`}</div>
    <div class="debug-composer"><input id="debug-input" class="sample-input" type="text" value="${escapeHtml(nextInput)}" placeholder="输入本轮用户问题" aria-label="本轮用户问题" /><button class="btn btn-outline" data-action="runDebug">${type==='c'&&agent.debugStep===1?'继续对话':'运行模拟'}</button><button class="btn btn-primary" data-action="goView" data-view="evaluation">进入评估 →</button></div><p class="debug-hint">回答为确定性模拟；本轮提示词仅用于调试。</p></section></div>`;
}

function renderEvaluation(id, agent) {
  const type = typeFor(id);
  const result = getEvaluation(id, agent);
  const ran = ['passed','failed'].includes(agent.evaluation);
  const tone = !ran ? 'neutral' : agent.evaluation === 'passed' ? 'success' : 'danger';
  const icon = !ran ? '○' : agent.evaluation === 'passed' ? '✓' : '!';
  return `<div class="evaluation-layout"><section class="panel"><div class="panel-heading"><div><h2>离线样本评估</h2><p>配置变更后需重新评估。</p></div><div class="heading-actions"><button class="btn btn-outline" data-action="evaluate">${ran?'重新评估':'运行评估'}</button><button class="btn btn-primary" data-action="goView" data-view="release">进入发布 →</button></div></div>
    <div class="eval-summary ${tone}"><span class="eval-symbol">${icon}</span><div><strong>${agent.evaluation==='stale'?'旧评估已失效':!ran?'等待评估':agent.evaluation==='passed'?'评估通过':'发布被阻断'}</strong><p>${agent.evaluation==='stale'?'配置已变化，必须对当前草稿重新评估。':!ran?'运行当前草稿，查看场景专属质量门槛。':result.detail}</p></div><span class="eval-score">${ran?result.score:'—'}</span></div>
    <div class="table-head"><h3>${result.title}</h3><span>样本集 ${result.sampleSetVersion} · 演示数据</span></div><div class="check-list">${(ran?result.checks:[['固定样本集','待运行','点击“运行评估”查看结果']]).map(([name,status,detail])=>`<div class="check-row"><div><strong>${name}</strong><span>${detail}</span></div><span class="check-status ${status==='通过'?'pass':status==='未通过'?'fail':''}">${status}</span></div>`).join('')}</div>
    <div class="table-head samples-title"><h3>代表样本 · 输入 / 预期 / 实际</h3><span>${ran?`评估 ${agent.evaluationRunId}`:'运行后展示结果'}</span></div><div class="sample-list">${result.samples.map((item,index)=>`<details class="sample-row" ${ran&&!item.passed?'open':''}><summary><span class="sample-index">${String(index+1).padStart(2,'0')}</span><strong>${escapeHtml(item.input)}</strong><span class="check-status ${ran?(item.passed?'pass':'fail'):''}">${ran?(item.passed?'通过':'未通过'):'待运行'}</span></summary><div class="sample-detail"><div><b>预期</b><p>${escapeHtml(item.expected)}</p></div><div><b>实际${ran?'结果':'（预设模拟）'}</b><p>${ran?escapeHtml(item.actual):'运行评估后显示'}</p></div><div><b>依据</b><p>${escapeHtml(item.basis)}</p></div></div></details>`).join('')}</div></section>
    <aside class="panel evaluation-aside"><h2>发布门槛</h2><div class="info-row"><span>当前评估</span><b>${ran?agent.evaluationRunId:agent.evaluation==='stale'?'已失效':'未运行'}</b></div><div class="gate-item ${agent.evaluation==='passed'?'done':''}"><span>${agent.evaluation==='passed'?'✓':'1'}</span><div><strong>离线评估通过</strong><p>${type==='a'?'场景相关性、笔记有效性和延迟预算':type==='b'?'严重红线样本必须通过':'知识有依据或转人工'}</p></div></div>${type==='b'?`<div class="gate-item ${agent.approved?'done':''}"><span>${agent.approved?'✓':'2'}</span><div><strong>政策负责人审批</strong><p>通过评估后仍需人工签核。</p></div></div>`:''}<div class="side-note">${type==='a'?'线上采纳和点击要在灰度后观察。':type==='b'?'严重类别不能漏判。':'缺少依据时转人工。'}</div></aside></div>`;
}

function renderHistory(agent) {
  const type = agent.templateType;
  const rows = [...(agent.releaseHistory ?? [])].reverse().map(item => {
    const snapshot = item.snapshot;
    const resource = type==='a' ? `推荐策略：${snapshot?.strategy==='relevance'?'优先场景相关性':'优先响应速度'}` :
      type==='b' ? `规则：${snapshot?.ruleEnabled?'已启用':'未启用'} · 政策 ${escapeHtml(snapshot?.policyVersion ?? '—')}` :
      `售后知识：${escapeHtml(snapshot?.knowledgeVersion ?? '—')}`;
    return `<div class="history-row"><span class="history-dot"></span><div><strong>${escapeHtml(item.action)} · ${escapeHtml(item.version ?? '未发布')}</strong><p>${escapeHtml(item.detail)} · 发布评估 ${escapeHtml(item.evaluationRunId ?? '—')}</p><small>${formatTime(item.at)} · 模拟记录</small>${snapshot?`<details class="snapshot-details"><summary>查看当时配置快照</summary><p>指令：${escapeHtml(snapshot.prompt)}</p><p>${resource}</p></details>`:''}</div></div>`;
  }).join('');
  return `<div class="history-list">${rows || '<div class="empty-inline">尚无发布操作记录</div>'}</div>`;
}

function renderRelease(id, agent) {
  const type = typeFor(id);
  const ready = canPublish(id, agent);
  const canAdjustTraffic = Boolean(agent.liveVersion && agent.status !== '已回退' && (agent.previousVersion || agent.draftVersion === agent.liveVersion));
  const evaluationText = agent.evaluation==='passed'?'通过':agent.evaluation==='failed'?'未通过':agent.evaluation==='stale'?'已失效':'未运行';
  const changes = [
    !agent.liveConfig ? '首次发布：使用当前 Agent 指令' : agent.liveConfig.prompt !== agent.prompt ? 'Agent 指令已调整' : 'Agent 指令无变化',
    type==='a' ? agent.liveConfig ? `推荐策略：${agent.liveConfig.strategy==='relevance'?'场景相关性':'响应速度'} → ${agent.strategy==='relevance'?'场景相关性':'响应速度'}` : `首次配置推荐策略：${agent.strategy==='relevance'?'场景相关性':'响应速度'}` :
      type==='b' ? `规则 ${agent.policyVersion}：${agent.ruleEnabled?'攻击性语言规则已启用':'攻击性语言规则未启用'}` :
      `售后知识：${agent.liveConfig?.knowledgeVersion ?? '无'} → ${agent.knowledgeVersion}`,
    `对应评估：${agent.evaluationRunId ?? '尚未运行'} · ${getEvaluation(id, agent).sampleSetVersion}`,
  ];
  return `<div class="content-grid release-grid"><section class="panel"><div class="panel-heading"><div><h2>版本发布</h2><p>核对配置、评估和审批证据。</p></div>${getBadge(agentStatus(id,agent))}</div>
    <div class="version-track"><div><span>当前生产</span><strong>${agent.liveVersion ?? '未发布'}</strong><small>${type==='a'?(agent.traffic?`新版本流量 ${agent.traffic}%`:agent.previousVersion?'稳定版 100% · 新版 0%':agent.liveVersion?'当前稳定运行 · 新版待发布':'待首次发布'):'稳定运行'}</small></div><span class="track-arrow">→</span><div><span>待发布草稿</span><strong>${agent.draftVersion}</strong><small>${type==='c'?`知识 ${agent.knowledgeVersion}`:type==='b'?`政策 ${agent.policyVersion}`:`策略 ${agent.strategy==='relevance'?'场景相关性':'响应速度'}`}</small></div></div>
    <div class="release-evidence"><h3>${agent.liveVersion===agent.draftVersion?'当前版本证据':'本次变化与决策证据'}</h3>${changes.map(item=>`<div class="evidence-row">• ${escapeHtml(item)}</div>`).join('')}${type==='b'?`<div class="evidence-row">审批人：${escapeHtml(agent.approvalPerson ?? '社区生态政策负责人（模拟）')} · 状态：${agent.approved?`已审批（${formatTime(agent.approvedAt)}）`:'待审批'}</div>`:''}</div>
    <div class="release-checks"><div><span class="mini-check ${agent.evaluation==='passed'?'ok':''}">${agent.evaluation==='passed'?'✓':'!'}</span><div><strong>评估结果</strong><small>${evaluationText}</small></div></div>${type==='b'?`<div><span class="mini-check ${agent.approved?'ok':''}">${agent.approved?'✓':'!'}</span><div><strong>政策负责人审批</strong><small>${agent.approved?'已完成':'待完成'}</small></div></div>`:''}<div><span class="mini-check ok">✓</span><div><strong>发布记录</strong><small>版本、操作和时间保留在本地</small></div></div></div>
    ${type==='b'&&agent.evaluation==='passed'&&!agent.approved?`<div class="action-callout"><div><strong>评估已通过，等待人工审批</strong><span>由社区生态政策负责人模拟签核。</span></div><button class="btn btn-outline" data-action="approve">完成审批</button></div>`:''}
    <div class="release-actions"><button class="btn btn-primary" data-action="publish" ${!ready||agent.liveVersion===agent.draftVersion?'disabled':''}>${agent.liveVersion===agent.draftVersion?'当前版本已发布':type==='a'?'发布至 10% 灰度':'发布新版本'}</button><button class="btn btn-outline" data-action="goView" data-view="monitor">进入监控 →</button><span>${ready?'发布条件已满足':type==='b'?'请先完成评估和审批':'请先通过当前草稿评估'}</span></div></section>
    <aside class="panel side-panel"><h2>${type==='a'?'灰度与回退':'异常处置'}</h2>${type==='a'?`<p class="aside-intro">${canAdjustTraffic?'拖动滑块调整新版本流量；0% 时全部由稳定版本承接。':'评估并发布当前草稿后，可调整新版本流量。'}</p><label class="traffic-value" for="traffic-slider"><span>新版本流量</span><output id="traffic-value">${agent.traffic}%</output></label><input id="traffic-slider" class="traffic-slider" type="range" min="0" max="100" step="1" value="${agent.traffic}" style="--range-progress:${agent.traffic}%" ${!canAdjustTraffic?'disabled':''} aria-label="新版本灰度比例" /><div class="traffic-scale"><span>0% 稳定版本</span><span>100% 新版本</span></div><button class="btn btn-danger-outline full" data-action="rollback" ${!agent.previousVersion?'disabled':''}>${agent.previousVersion?`回退到 ${agent.previousVersion}`:'暂无可回退版本'}</button>`:`<p class="aside-intro">政策或知识可能过期，异常时暂停建议并转人工。</p><button class="btn btn-danger-outline full" data-action="pause" ${!agent.liveVersion||agent.status==='人工兜底'?'disabled':''}>暂停建议 · 转人工</button>`}</aside></div>
    <section class="panel history-panel"><div class="table-head"><h3>发布与处置记录</h3><span>模拟记录</span></div>${renderHistory(agent)}</section>`;
}

function renderMonitor(id, agent) {
  const type = typeFor(id);
  const mode = getMonitorMode(id, agent);
  const online = mode !== 'unpublished' && mode !== 'paused';
  const activeGray = ['gray-compare','gray-first'].includes(mode);
  const hasOldVersion = mode === 'gray-compare';
  const metrics = !online ? [] : type==='a'
    ? activeGray ? [[`${agent.traffic * 1200}`, '新版本模拟曝光', `灰度 ${agent.traffic}%`], [agent.liveConfig?.strategy==='relevance'?'73.4%':'70.8%', '新版本采纳率', hasOldVersion?'旧版本 68.0%':'首发 · 无旧版基线'], [agent.liveConfig?.strategy==='relevance'?'19.2%':'17.6%', '新版本笔记点击率', hasOldVersion?'旧版本 16.1%':'首发 · 无旧版基线']] : []
    : type==='b'
      ? [[agent.liveRuleEnabled?'0 / 1':'1 / 1','严重样本漏判','固定样本 · 模拟'],['98.2%','结构化输出率','模拟批次'],['240','待人工复核','演示条目']]
      : [[agent.liveKnowledgeVersion==='K-02'?'100%':'87.5%','有效知识引用','固定样本 · 模拟'],['68.4%','客服采纳率','演示数据'],['12.1%','转人工比例','演示数据']];
  const trace = !online ? [] : type==='a'
    ? [['R-1024','旅行穿搭请求',agent.liveVersion,agent.liveConfig?.strategy==='relevance'?'场景优先 · 推荐 #N-102 / #N-208':'速度优先 · 推荐 #N-102']]
    : type==='b'
      ? [['B-0042','评论判定',agent.liveVersion,`政策 ${agent.liveConfig?.policyVersion ?? agent.policyVersion} · 人工复核`]]
      : [['C-0198','换码咨询',agent.liveVersion,`知识 ${agent.liveKnowledgeVersion} · ${agent.liveKnowledgeVersion==='K-02'?'有引用':'转人工'}`]];
  const main = mode==='unpublished' ? '<div class="monitor-empty">尚未发布生产版本。先完成评估与发布，才会出现模拟线上结果。</div>' : mode==='paused' ? '<div class="monitor-empty">当前已暂停 Agent 建议，业务转人工处理。运行指标与调用追溯已停止展示；处置记录见下方。</div>' : type==='a'&&!activeGray
    ? `<div class="monitor-empty">${agent.status==='已回退'?`已回退到稳定版本 ${agent.liveVersion}，回退记录见下方。`:agent.traffic===0&&agent.previousVersion?`新版本流量为 0%，由稳定版本 ${agent.previousVersion} 承接。`:agent.traffic===0?'新版本流量为 0%，当前没有请求进入该版本。':'当前没有新版本灰度效果。'}</div>`
    : `<div class="monitor-metrics">${metrics.map(([value,label,trend])=>`<div class="metric-card"><span>${label}</span><strong>${value}</strong><small>${trend}</small></div>`).join('')}</div>
      <div class="monitor-split"><div class="chart-card"><div class="table-head"><h3>${type==='a'?(hasOldVersion?'灰度效果对比':'首发灰度趋势'):type==='b'?'审核质量趋势':'知识覆盖趋势'}</h3><span>近 7 天 · 模拟结果</span></div><div class="chart-legend"><span><i class="legend-dot red"></i>${type==='a'?`新版本 ${agent.liveVersion}`:'当前版本'}</span>${mode==='gray-first'?'':`<span><i class="legend-dot gray"></i>${type==='a'?`旧版本 ${agent.previousVersion}`:'参考基线'}</span>`}</div><div class="bar-chart">${[42,52,48,63,68,73,76].map((n,i)=>`<div class="bar-pair">${mode==='gray-first'?'':`<span class="bar old" style="height:${Math.max(25,n-15)}%"></span>`}<span class="bar new" style="height:${n}%"></span><small>${i+1}日</small></div>`).join('')}</div></div>
      <div class="trace-card"><div class="table-head"><h3>调用追溯</h3><span>模拟记录</span></div>${trace.map(([code,title,version,detail])=>`<div class="trace-row"><span class="trace-icon">⌁</span><div><strong>${title}</strong><small>${code} · ${version}</small><p>${detail}</p></div><span class="trace-arrow">↗</span></div>`).join('')}<div class="trace-foot">演示中不记录真实用户内容，生产需按权限脱敏查看。</div></div></div>`;
  return `<section class="panel monitor-panel"><div class="panel-heading"><div><h2>运行监控</h2><p>生产 ${agent.liveVersion ?? '未发布'} · ${agent.status} · 模拟结果</p></div><button class="btn btn-outline" data-action="goView" data-view="config">继续迭代 →</button></div>${main}<div class="table-head samples-title"><h3>发布与处置记录</h3><span>时间 · 版本 · 操作</span></div>${renderHistory(agent)}</section>`;
}

function render() {
  let content;
  if (state.view === 'overview') content = renderOverview();
  else if (state.view === 'manage') content = renderManage();
  else if (state.view === 'templates') content = renderTemplates();
  else if (state.view === 'create') content = renderCreate();
  else if (state.selectedAgent && state.agents[state.selectedAgent]) {
    const id = state.selectedAgent;
    const agent = state.agents[id];
    const page = { creation: renderCreation, config: renderConfig, debug: renderDebug, evaluation: renderEvaluation, release: renderRelease, monitor: renderMonitor }[state.view] ?? renderCreation;
    content = renderWorkspaceHead(id, agent) + page(id, agent);
  } else content = renderManage();
  app.innerHTML = `${renderSidebar()}<div class="main-shell">${renderTopbar()}<main class="main-content">${state.notice?`<div class="notice" role="status"><span>●</span>${escapeHtml(state.notice)}<button aria-label="关闭提示" data-action="clearNotice">×</button></div>`:''}${content}</main></div>`;
}

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  const agentId = button.dataset.agent ?? state.selectedAgent;
  if (action === 'overview') update({ type: 'navigate', view: 'overview' });
  else if (action === 'manage') update({ type: 'navigate', view: 'manage' });
  else if (action === 'newAgent') update({ type: 'navigate', view: 'templates' });
  else if (action === 'chooseTemplate') update({ type: 'chooseTemplate', templateType: button.dataset.template });
  else if (action === 'reviewB') { update({ type: 'selectAgent', agentId: 'b' }); update({ type: 'navigate', view: 'evaluation' }); }
  else if (action === 'lifeStep') {
    if (button.dataset.view === 'creation') update({ type: 'navigate', view: 'templates' });
    else update({ type: 'navigate', view: state.selectedAgent ? button.dataset.view : 'manage' });
  }
  else if (action === 'selectAgent') update({ type: 'selectAgent', agentId });
  else if (action === 'goView') {
    update({ type: 'navigate', view: state.selectedAgent ? button.dataset.view : 'manage' });
  }
  else if (action === 'clearNotice') { state.notice = ''; render(); }
  else if (action === 'reset') update({ type: 'reset' });
  else if (action === 'setTraffic') update({ type: action, agentId, traffic: Number(button.dataset.traffic) });
  else if (action === 'setStrategy') update({ type: action, agentId, strategy: button.dataset.strategy });
  else if (action === 'runDebug') update({ type: action, agentId,
    input: app.querySelector('#debug-input')?.value,
    systemPrompt: app.querySelector('#debug-system-prompt')?.value,
    preset: app.querySelector('#debug-preset')?.value });
  else update({ type: action, agentId });
});

app.addEventListener('input', event => {
  if (event.target.id === 'traffic-slider') {
    const output = app.querySelector('#traffic-value');
    if (output) output.textContent = `${event.target.value}%`;
    event.target.style.setProperty('--range-progress', `${event.target.value}%`);
  } else if (event.target.id === 'debug-system-prompt') {
    const preset = app.querySelector('#debug-preset');
    if (preset) preset.value = 'custom';
  }
});

app.addEventListener('change', event => {
  if (event.target.id === 'traffic-slider') {
    update({ type: 'setTraffic', agentId: state.selectedAgent, traffic: Number(event.target.value) });
  } else if (event.target.id === 'debug-preset') {
    const prompt = debugPromptPresets(typeFor(state.selectedAgent, state.agents[state.selectedAgent]), state.agents[state.selectedAgent])
      .find(item => item.value === event.target.value)?.prompt;
    const editor = app.querySelector('#debug-system-prompt');
    if (prompt && editor) editor.value = prompt;
  }
});

app.addEventListener('submit', event => {
  if (!['prompt-form','create-form'].includes(event.target.id)) return;
  event.preventDefault();
  const form = new FormData(event.target);
  if (event.target.id === 'create-form') update({ type: 'createAgent', templateType: form.get('templateType'), name: form.get('name'), team: form.get('team'), taskDescription: form.get('taskDescription'), prompt: form.get('prompt') });
  else {
    update({ type: 'editPrompt', agentId: state.selectedAgent, prompt: form.get('prompt') });
    if (event.submitter?.value === 'debug') update({ type: 'navigate', view: 'debug' });
  }
});

render();
