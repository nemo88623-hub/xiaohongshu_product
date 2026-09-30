import { icon } from './icons.js';
import { createInitialState, transition, getEvaluation, getEvaluationBaseline, canPublish, restoreState, TEMPLATES, templateTypeOf, getMonitorMode, getExperimentReadout, getMonitorSeries, getRunMeta, getWorkflowProgress, SKELETON, MODULES } from './logic.js';

const STORAGE_KEY = 'agent-studio-demo-v6';
const app = document.querySelector('#app');
const profile = {
  a: { letter: 'A', icon: icon('outfit'), type: '用户互动 · 实时', accent: 'coral', blurb: '根据场景生成穿搭灵感，并推荐社区同款笔记。' },
  b: { letter: 'B', icon: icon('shield'), type: '内容治理 · 批量', accent: 'blue', blurb: '输出类别、理由和政策依据，辅助人工判定。' },
  c: { letter: 'C', icon: icon('chat'), type: '客服辅助 · 多轮', accent: 'green', blurb: '基于售后知识拟答，并给出可核对的来源。' },
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

function formatCount(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 10000) return `${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)} 万`;
  return value.toLocaleString('zh-CN');
}

function truncate(value, limit) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

const pct = value => `${(value * 100).toFixed(1)}%`;
const signed = value => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;

function update(action) {
  const previousView = state.view;
  const focused = document.activeElement;
  const focusId = focused?.id;
  const focusData = focused?.dataset ? { ...focused.dataset } : null;
  state = transition(state, action);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  if (state.view !== previousView) {
    app.querySelector('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  } else if (focusId) {
    document.getElementById(focusId)?.focus({ preventScroll: true });
  } else if (focusData?.action) {
    [...app.querySelectorAll('[data-action]')].find(el => !el.disabled && Object.entries(focusData).every(([key,value]) => el.dataset[key] === value))?.focus({ preventScroll: true });
  }
}

function getBadge(status) {
  const kind = ['运行中','全量运行'].includes(status) ? 'good' : status === '灰度中' ? 'accent' : status === '人工兜底' ? 'warn' : 'neutral';
  return `<span class="badge ${kind}"><span class="badge-dot"></span>${escapeHtml(status)}</span>`;
}

/** Derived purely from real state — no decorative statuses that the rest of the app cannot honour. */
function agentStatus(id, agent) {
  if (!agent.liveVersion) return '草稿';
  if (agent.status === '人工兜底') return '人工兜底';
  if (typeFor(id) === 'a' && agent.traffic > 0 && agent.traffic < 100) return '灰度中';
  return agent.status;
}

function draftHint(agent) {
  if (!agent.liveVersion) return `草稿 ${agent.draftVersion} · 未发布`;
  if (agent.liveVersion === agent.draftVersion) return `草稿与生产一致`;
  if (agent.evaluation === 'passed') return `草稿 ${agent.draftVersion} · 待发布`;
  if (agent.evaluation === 'failed') return `草稿 ${agent.draftVersion} · 评估未通过`;
  if (agent.evaluation === 'stale') return `草稿 ${agent.draftVersion} · 评估已失效`;
  return `草稿 ${agent.draftVersion} · 待评估`;
}

function renderSidebar() {
  const managing = !['overview', 'platform'].includes(state.view);
  return `<a class="skip-link" href="#main-content">跳到主内容</a><aside class="sidebar">
    <div class="brand"><div class="brand-mark"><img src="./assets/xiaohongshu-logo.png" alt="小红书" /></div><div><strong>红薯 Agent Studio</strong></div></div>
    <div class="space-label">工作空间</div>
    <nav aria-label="主导航">
      <button class="side-link ${state.view === 'overview' ? 'active' : ''}" ${state.view === 'overview' ? 'aria-current="page"' : ''} data-action="overview">${icon('grid')}<span>工作台</span></button>
      <button class="side-link ${managing ? 'active' : ''}" ${managing ? 'aria-current="page"' : ''} data-action="manage">${icon('layers')}<span>Agent 管理</span><span class="nav-count">${Object.keys(state.agents).length}</span></button>
      <button class="side-link ${state.view === 'platform' ? 'active' : ''}" ${state.view === 'platform' ? 'aria-current="page"' : ''} data-action="platform">${icon('map')}<span>平台能力地图</span></button>
    </nav>
    <div class="sidebar-bottom"><button class="reset-link" data-action="reset">${icon('reset')}重置演示</button></div>
  </aside>`;
}

function renderTopbar() {
  const title = state.view === 'overview' ? '工作台' : state.view === 'manage' ? 'Agent 管理' : state.view === 'platform' ? '平台能力地图' : ['templates','create'].includes(state.view) ? '新建 Agent' : state.agents[state.selectedAgent]?.name ?? 'Agent 管理';
  return `<header class="topbar"><div class="breadcrumb"><span>${escapeHtml(title)}</span></div><div class="top-actions"><button class="mobile-reset" data-action="reset" aria-label="重置演示">重置</button><div class="profile-menu-wrap"><button class="avatar" data-action="toggleUserMenu" aria-label="打开用户信息" aria-expanded="false">HZ</button><div id="profile-menu" class="profile-menu" hidden><h3>用户信息</h3><div class="profile-row"><span>姓名</span><b>洪子琪</b></div><div class="profile-row"><span>部门</span><b>企业产品中心 · Agent 平台</b></div><div class="profile-row"><span>工号</span><b>XHS-1024</b></div><div class="profile-row"><span>工位</span><b>A3-18</b></div><div class="profile-row"><span>园区</span><b>上海 · 长宁园区</b></div></div></div></div></header>`;
}

function renderAgentCard(id, agent) {
  const info = profileFor(id);
  const focuses = { a: '灰度发布与效果对比', b: '质量门槛与人工审批', c: '知识更新与引用追溯' };
  return `<button class="agent-card ${info.accent}" data-action="selectAgent" data-agent="${escapeHtml(id)}">
    <div class="card-top"><span class="agent-avatar ${info.accent}">${info.icon}</span><span class="card-kind">${agent.isExample ? `场景 ${info.letter}` : '自建 Agent'}</span><span class="card-arrow">${icon('arrow')}</span></div>
    <div class="agent-meta">${info.type}</div><h3>${escapeHtml(agent.name)}</h3><p>${escapeHtml(agent.taskDescription ?? info.blurb)}</p>
    <div class="card-focus">${focuses[typeFor(id)]}</div>
    <div class="card-bottom">${getBadge(agentStatus(id, agent))}<span>${agent.liveVersion ?? '未发布'}</span></div>
    <div class="card-draft">${escapeHtml(draftHint(agent))}</div>
  </button>`;
}

function renderOverview() {
  const all = Object.values(state.agents);
  const recent = Object.entries(state.agents).filter(([, agent]) => !agent.isExample).reverse().slice(0, 3);
  const counts = [[all.length, '全部 Agent', 'layers'], [all.filter(a => a.liveVersion && a.status !== '人工兜底').length, '已上线', 'activity'], [all.filter(a => a.evaluation === 'passed' && a.draftVersion !== a.liveVersion).length, '评估通过 · 待发布', 'check'], [all.filter(a => a.evaluation === 'failed' || a.evaluation === 'stale').length, '需重新评估', 'file']];
  return `<section class="page-head with-action"><div><h1>Agent 工作台</h1><p>把业务想法，变成可持续迭代的 Agent。</p></div><button class="btn btn-primary create-main" data-action="newAgent">${icon('plus')}新建 Agent</button></section>
    <section class="overview-stats" aria-label="平台概览">${counts.map(([count,label,symbol])=>`<div><span class="stat-label">${label}${icon(symbol)}</span><strong>${String(count).padStart(2,'0')}</strong></div>`).join('')}</section>
    <div class="section-heading"><div><h2>从一个业务场景开始 <span class="section-count">3</span></h2><p>同一套基础能力，适配不同的业务需求。</p></div><button class="text-action" data-action="manage">全部 Agent ${icon('arrow')}</button></div>
    <section class="agent-grid" aria-label="示例 Agent">${['a','b','c'].map(id => renderAgentCard(id, state.agents[id])).join('')}</section>
    <button class="review-card review-entry" data-action="reviewB"><span class="review-icon">${icon('shield')}</span><div><span class="review-label">推荐评审路径</span><h3>一次未通过的评估，如何拦住风险上线？</h3><p>生态守护：发现漏判 → 修复规则 → 重评审批 → 发布</p></div><span class="review-link">开始体验 ${icon('arrow')}</span></button>
    ${recent.length ? `<div class="section-heading recent-heading"><div><h2>最近创建</h2></div><button class="text-action" data-action="manage">查看全部 ${icon('arrow')}</button></div><section class="agent-grid" aria-label="最近 Agent">${recent.map(([id, agent]) => renderAgentCard(id, agent)).join('')}</section>` : ''}
    <section class="lifecycle-card"><div class="section-heading compact"><div><h2>从创建到迭代，六步走通</h2></div><button class="text-action" data-action="platform">查看共用能力 ${icon('arrow')}</button></div><div class="lifecycle">${views.map(([view,label],i)=>`<button class="life-step" data-action="lifeStep" data-view="${view}"><span>${String(i+1).padStart(2,'0')}</span><strong>${label}</strong>${i<5?icon('arrow'):''}</button>`).join('')}</div></section>`;
}

function renderManage() {
  return `<section class="page-head with-action"><div><h1>Agent 管理</h1><p>管理业务 Agent 的配置、版本与上线状态。</p></div><button class="btn btn-primary create-main" data-action="newAgent">${icon('plus')}新建 Agent</button></section>
    <section class="panel manage-panel"><div class="manage-toolbar"><h2>全部 Agent <span class="section-count">${Object.keys(state.agents).length}</span></h2><label class="search-field">${icon('search')}<input id="agent-search" type="search" placeholder="搜索名称或团队" aria-label="搜索 Agent 名称或团队" /></label></div>
    <div class="agent-table"><div class="agent-table-head"><span>Agent / 所属团队</span><span>业务模板</span><span>生产状态</span><span>当前草稿</span><span></span></div>${Object.entries(state.agents).map(([id,agent])=>{const info=profileFor(id);return `<button class="agent-table-row" data-action="selectAgent" data-agent="${escapeHtml(id)}" data-search="${escapeHtml(`${agent.name} ${agent.team}`.toLowerCase())}"><span class="list-identity"><span class="agent-avatar ${info.accent}">${info.icon}</span><span><strong>${escapeHtml(agent.name)}</strong><small>${escapeHtml(agent.team)}</small></span></span><span class="list-type">${info.type}</span><span class="list-status">${getBadge(agentStatus(id,agent))}<small>${agent.liveVersion ?? '未发布'}</small></span><span class="list-draft">${escapeHtml(draftHint(agent))}</span><span class="card-arrow">${icon('arrow')}</span></button>`;}).join('')}</div><div class="search-empty" hidden>没有匹配的 Agent，试试其他名称或团队。</div></section>`;
}

function renderPlatform() {
  const mvp = MODULES.filter(item => item.phase === 'mvp');
  const next = MODULES.filter(item => item.phase === 'next');
  const layers = SKELETON.map(layer => {
    const rows = MODULES.filter(item => item.layer === layer.id).map(item => `<div class="module-row ${item.phase}">
      <div class="module-main"><div class="module-name"><strong>${escapeHtml(item.name)}</strong>${item.inDemo ? '<span class="demo-tag">Demo 已走通</span>' : ''}</div><p>${escapeHtml(item.reason)}</p></div>
      <span class="phase-tag ${item.phase}">${item.phase === 'mvp' ? 'MVP 一期' : '二期'}</span></div>`).join('');
    return `<section class="panel layer-panel"><div class="layer-head"><span class="layer-step">${layer.step}</span><div><h3>${escapeHtml(layer.name)}</h3><p>${escapeHtml(layer.purpose)}</p></div><button class="text-action" data-action="lifeStep" data-view="${layer.id === 'identity' ? 'creation' : layer.id}">去体验 →</button></div>${rows}</section>`;
  }).join('');
  return `<section class="page-head"><h1>平台能力地图</h1><p>三个业务需求差异很大，但要在生产稳定运行并持续迭代，都落在同一套六层骨架上。下面是完整模块清单与 MVP 边界。</p></section>
    <section class="overview-stats platform-stats" aria-label="模块概览"><div><strong>${SKELETON.length}</strong><span>层通用骨架</span></div><div><strong>${mvp.length}</strong><span>MVP 一期模块</span></div><div><strong>${next.length}</strong><span>二期模块</span></div><div class="stat-note">一期只解“从 0 到安全上线并能回退”这条主干<br />二期解规模化之后的效率与治理</div></section>
    <div class="section-heading"><div><h2>三个业务 × 同一套骨架</h2></div></div>
    <section class="panel matrix-panel"><div class="matrix">
      <div class="matrix-head"><span>能力</span><b>A 穿搭灵感</b><b>B 生态守护</b><b>C 售后答疑</b></div>
      ${[
        ['调用形态', '实时 · 日百万级', '批量 · 海量跑批', '多轮 · 大促波峰'],
        ['迭代驱动', '玩法与策略，每周', '政策更新，按需', '知识更新，按需'],
        ['质量门槛', '相关性 + 延迟预算', '严重样本零漏判', '引用有效或转人工'],
        ['上线方式', '灰度放量 + AB 对比', '全量 + 人工审批', '全量 + 随大促起落'],
        ['止血方式', '一键回退旧版本', '暂停并转人工', '暂停并转人工'],
      ].map(([name, ...cells]) => `<div class="matrix-row"><span>${name}</span>${cells.map(cell => `<b>${escapeHtml(cell)}</b>`).join('')}</div>`).join('')}
    </div><p class="matrix-note">差异集中在<b>配置项</b>（门槛、审批开关、发布方式、止血动作），而不在<b>流程骨架</b>。所以平台做一套骨架 + 可配置差异，而不是三套系统。</p></section>
    <div class="section-heading"><div><h2>六层骨架与模块清单</h2></div><span class="muted">带「Demo 已走通」标记的模块可在本原型中点击体验</span></div>
    ${layers}`;
}

function renderTemplates() {
  return `<section class="page-head"><button class="back-link" data-action="manage">← 返回 Agent 管理</button><h1>选择业务模板</h1><p>模板预填调用形态、输出格式和知识或规则。</p></section>
    <section class="agent-grid" aria-label="模板列表">${Object.keys(TEMPLATES).map(type => { const info = profile[type]; const base = state.agents[type]; return `<button class="agent-card template-card" data-action="chooseTemplate" data-template="${type}"><div class="card-top"><span class="agent-avatar ${info.accent}">${info.icon}</span><span class="card-arrow">${icon("arrow")}</span></div><div class="agent-meta">${info.type}</div><h3>${base.name}</h3><p>${escapeHtml(TEMPLATES[type].taskDescription)}</p><div class="card-divider"></div><div class="template-foot">输出：${escapeHtml(TEMPLATES[type].outputFormat)}</div></button>`; }).join('')}</section>`;
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
    <div class="content-grid"><section class="panel"><div class="panel-heading"><div><h2>基础信息</h2><p>名称必填；其余字段可在创建后继续编辑指令。</p></div></div><form id="create-form"><input type="hidden" name="templateType" value="${type}" /><label class="field-label" for="new-name">Agent 名称 <b class="required">*</b></label><input id="new-name" name="name" required placeholder="例如：评论风险初筛 Agent" /><label class="field-label" for="new-team">所属团队</label><select id="new-team" name="team">${mockTeams.map(team=>`<option value="${escapeHtml(team)}" ${team===base.team?'selected':''}>${escapeHtml(team)}</option>`).join('')}</select><label class="field-label" for="new-task">任务描述</label><textarea id="new-task" name="taskDescription" rows="3">${escapeHtml(template.taskDescription)}</textarea><label class="field-label" for="new-prompt">初始指令</label><textarea id="new-prompt" name="prompt" rows="5">${escapeHtml(base.prompt)}</textarea><div class="form-footer"><span class="muted">创建后仍需调试与评估，才能发布。</span><button class="btn btn-primary" type="submit">创建 Agent →</button></div></form></section>
    <aside class="panel side-panel"><h2>模板预填能力</h2><div class="info-row"><span>调用形态</span><b>${escapeHtml(template.callMode)}</b></div><div class="info-row"><span>输出格式</span><b>${escapeHtml(template.outputFormat)}</b></div><div class="info-row"><span>默认知识／规则</span><b>${escapeHtml(template.defaultResource)}</b></div>${renderHostedCapabilities()}</aside></div>`;
}

/** Read-only block that spells out what the platform hosts so business teams do not build it. */
function renderHostedCapabilities() {
  return `<details class="hosted-box"><summary class="hosted-title">平台托管能力 <span>5 项</span></summary>
    ${[['统一模型网关','统一接入'],['鉴权与团队配额','按团队分配'],['限流与降级','排队与兜底'],['日志与调用追溯','默认开启'],['成本核算','按调用统计']]
      .map(([name, value]) => `<div class="hosted-row"><span>${name}</span><b>${value}</b></div>`).join('')}<p class="field-help">能力展示均为模拟。</p></details>`;
}

function renderWorkspaceHead(id, agent) {
  const info = profileFor(id);
  const progress = getWorkflowProgress(state.view);
  return `<section class="workspace-head"><div class="back-row"><button data-action="manage" class="back-link">← Agent 管理</button><span class="head-divider"></span><span>${escapeHtml(agent.team)}</span></div>
    <div class="workspace-title"><span class="agent-avatar large ${info.accent}">${info.icon}</span><div><div class="title-line"><h1>${escapeHtml(agent.name)}</h1>${getBadge(agentStatus(id, agent))}</div><p>${escapeHtml(agent.taskDescription ?? info.blurb)}</p></div></div>
    <div class="meta-strip"><span>${info.type}</span><span>生产 <b>${agent.liveVersion ?? '未发布'}</b></span><span>草稿 <b>${agent.draftVersion}</b></span></div></section>
    <nav class="workflow-progress" aria-label="Agent 生命周期"><div class="workflow-scroll"><div class="workflow-tabs" style="--workflow-progress:${progress.percent / 100}">${views.map(([view,label],i)=>`<button data-action="goView" data-view="${view}" aria-label="${label}，第 ${i+1} 阶段，共 6 阶段" ${state.view===view?'aria-current="step"':''} class="workflow-tab ${i<progress.index?'completed':''} ${state.view===view?'active':''}"><span class="workflow-label">${label}</span><span class="workflow-node" aria-hidden="true"></span></button>`).join('')}</div></div></nav>`;
}

function renderCreation(id, agent) {
  const type = typeFor(id);
  const template = TEMPLATES[type];
  return `<div class="content-grid"><section class="panel"><div class="panel-heading"><div><h2>创建信息</h2></div>${getBadge(agent.isExample ? '示例' : '已创建')}</div>
    <div class="info-row"><span>Agent 名称</span><b>${escapeHtml(agent.name)}</b></div><div class="info-row"><span>所属团队</span><b>${escapeHtml(agent.team)}</b></div><div class="info-row"><span>任务描述</span><b>${escapeHtml(agent.taskDescription)}</b></div><div class="info-row"><span>来源模板</span><b>${escapeHtml(state.agents[type].name)}</b></div><div class="info-row"><span>创建时间</span><b>${agent.createdAt ? formatTime(agent.createdAt) : '预置示例'}</b></div>
    <div class="section-actions"><button class="btn btn-primary" data-action="goView" data-view="config">进入配置 →</button>${agent.isExample ? '' : '<button class="btn btn-danger-outline" data-action="deleteAgent">删除此 Agent</button>'}</div></section>
    <aside class="panel side-panel"><h2>模板能力</h2><div class="info-row"><span>调用形态</span><b>${escapeHtml(template.callMode)}</b></div><div class="info-row"><span>输出格式</span><b>${escapeHtml(template.outputFormat)}</b></div><div class="info-row"><span>知识或规则</span><b>${escapeHtml(template.defaultResource)}</b></div>${renderHostedCapabilities()}</aside></div>`;
}

function renderConfig(id, agent) {
  const type = typeFor(id);
  const special = type === 'a'
    ? `<div class="special-title"><span class="mini-icon coral">${icon("outfit")}</span><div><h3>社区笔记检索</h3><p>示例中使用固定演示笔记 ID。</p></div></div><div class="info-row"><span>连接状态</span><b class="green-text">演示索引</b></div><div class="info-row"><span>输出要求</span><b>穿搭建议 + 笔记卡片</b></div><div class="strategy-box"><strong>推荐策略</strong><p>切换策略将改变模拟回答、离线评分和延迟。</p><div class="strategy-options"><button class="strategy-option ${agent.strategy==='speed'?'selected':''}" data-action="setStrategy" data-strategy="speed" aria-pressed="${agent.strategy==='speed'}">优先响应速度<small>p95 0.9 秒 · 场景 10/12</small></button><button class="strategy-option ${agent.strategy==='relevance'?'selected':''}" data-action="setStrategy" data-strategy="relevance" aria-pressed="${agent.strategy==='relevance'}">优先场景相关性<small>p95 1.2 秒 · 场景 11/12</small></button></div></div>`
    : type === 'b'
      ? `<div class="special-title"><span class="mini-icon blue">${icon("shield")}</span><div><h3>政策规则</h3><p>结构化输出类别、理由和规则版本，供人工复核。</p></div></div><div class="info-row"><span>政策版本</span><b>${agent.policyVersion}</b></div><div class="rule-box ${agent.ruleEnabled?'enabled':''}"><div><strong>攻击性语言演示规则</strong><small>${agent.ruleEnabled?'已启用，重新评估可验证严重样本':'当前未启用，将导致 1 条严重样本漏判'}</small></div><button class="btn ${agent.ruleEnabled?'btn-light':'btn-primary'}" data-action="enableRule" ${agent.ruleEnabled?'disabled':''}>${agent.ruleEnabled?'已启用':'启用规则'}</button></div>`
      : `<div class="special-title"><span class="mini-icon green">${icon("chat")}</span><div><h3>售后知识</h3><p>知识更新会形成新快照，并使旧评估失效。</p></div></div><div class="info-row"><span>当前知识版本</span><b>${agent.knowledgeVersion}</b></div><div class="knowledge-box"><strong>《店铺换货规则》</strong><p>${agent.knowledgeVersion==='K-02'?'演示条款：符合签收时间及商品状态条件时，可在订单页申请换码。':'当前版本缺少具体换码条件，无法给出有依据的答复。'}</p></div><button class="btn ${agent.knowledgeVersion==='K-02'?'btn-light':'btn-primary'}" data-action="updateKnowledge" ${agent.knowledgeVersion==='K-02'?'disabled':''}>${agent.knowledgeVersion==='K-02'?'已更新至 K-02':'导入新版知识 K-02'}</button>`;
  return `<div class="content-grid config-layout"><section class="panel"><div class="panel-heading"><div><h2>配置草稿</h2><p>设定指令与场景能力，保存后进入调试。</p></div><span class="outline-badge">${agent.draftVersion}</span></div>
    <form id="prompt-form"><label class="field-label" for="prompt">Agent 指令</label><textarea id="prompt" name="prompt" rows="4">${escapeHtml(agent.prompt)}</textarea></form>
    <div class="config-capability">${special}</div><div class="form-footer"><button form="prompt-form" type="submit" class="btn btn-outline">保存草稿</button><button form="prompt-form" type="submit" name="next" value="debug" class="btn btn-primary">保存并调试 ${icon('arrow')}</button></div></section>
    <aside class="panel side-panel"><h2>配置说明</h2><div class="info-row"><span>输出格式</span><b>${escapeHtml(TEMPLATES[type].outputFormat)}</b></div><div class="info-row"><span>生产版本</span><b>${agent.liveVersion ?? '未发布'}</b></div><div class="side-note">${type==='b'?'最终违规判定由人工完成。':type==='c'?'缺少有效知识时转人工。':'效果指标在灰度发布后观察。'}<br />修改配置后需重新评估。</div>${renderHostedCapabilities()}</aside></div>`;
}

function renderDebug(id, agent) {
  const type = typeFor(id);
  const nextInput = agent.debugInput ?? (type === 'c' && agent.debugStep === 1 ? '昨天签收，还没穿。' : agent.sampleInput);
  const presets = debugPromptPresets(type, agent);
  const selectedPreset = agent.debugPromptPreset ?? 'current';
  const systemPrompt = agent.debugSystemPrompt ?? agent.prompt;
  const lastInput = agent.debugInputs?.[agent.debugInputs.length - 1] ?? '';
  const meta = getRunMeta(id, agent, lastInput);
  const metaStrip = agent.debugHistory?.length
    ? `<div class="run-meta"><span>本次模拟运行</span><b>${meta.latency} ms</b><b>${meta.promptTokens + meta.outputTokens} tokens</b><b>¥${meta.cost.toFixed(4)}</b><b>${escapeHtml(meta.route)}</b></div>`
    : '';
  const batch = type === 'b' ? `<aside class="panel side-panel"><h2>批量跑批</h2><p class="aside-intro">固定样本集的预设批量结果（模拟）。</p>
    <div class="info-row"><span>样本集</span><b>POLICY-2026.09 · 20 条</b></div><div class="info-row"><span>已完成</span><b>20 / 20</b></div><div class="info-row"><span>命中违规</span><b>${agent.ruleEnabled ? '4 条' : '3 条'}</b></div><div class="info-row"><span>严重样本漏判</span><b class="${agent.ruleEnabled ? 'green-text' : 'red-text'}">${agent.ruleEnabled ? '0 条' : '1 条'}</b></div><div class="info-row"><span>结构化输出率</span><b>100%</b></div>
    <div class="side-note">${agent.ruleEnabled ? '跑批结果可直接进入评估复核。' : '存在严重漏判，评估会阻断发布。'}</div></aside>` : '';
  return `<div class="${type === 'b' ? 'content-grid' : 'debug-layout'}"><section class="panel debug-panel"><div class="panel-heading"><div><h2>调试会话</h2><p>${type === 'b' ? '单条试跑用于定位问题，另附整批跑批结果。' : type === 'c' ? '多轮会话：先补齐信息，再给出有引用的答复。' : '实时请求形态：单条输入即时返回。'}</p></div><button class="small-link" data-action="resetDebug">清空会话</button></div>
    <div class="debug-prompt"><div class="debug-prompt-heading"><label class="field-label" for="debug-system-prompt">系统提示词</label><select id="debug-preset" aria-label="系统提示词预设">${presets.map(item=>`<option value="${item.value}" ${selectedPreset===item.value?'selected':''}>${escapeHtml(item.label)}</option>`).join('')}</select></div><textarea id="debug-system-prompt" rows="2">${escapeHtml(systemPrompt)}</textarea></div>
    <div class="chat-area">${agent.debugHistory?.length?agent.debugHistory.map((output,index)=>`<div class="chat-bubble user"><span>${type==='c'&&index===1?'用户补充':'业务输入'}</span><p>${escapeHtml(agent.debugInputs?.[index] ?? agent.sampleInput)}</p></div><div class="chat-bubble assistant"><span>模拟回答</span><p>${multiline(output)}</p></div>`).join(''):`<div class="chat-empty"><div>${icon("chat")}</div><strong>等待运行样本</strong><span>输入内容后运行，查看模拟回答。</span></div>`}</div>
    ${metaStrip}
    <div class="debug-composer"><input id="debug-input" class="sample-input" type="text" value="${escapeHtml(nextInput)}" placeholder="输入本轮用户问题" aria-label="本轮用户问题" /><button class="btn btn-outline" data-action="runDebug">${type==='c'&&agent.debugStep===1?'继续对话':'运行模拟'}</button><button class="btn btn-primary" data-action="goView" data-view="evaluation">进入评估 →</button></div><p class="debug-hint">模拟回答 · 提示词仅在本次调试中生效。</p></section>${batch}</div>`;
}

function renderEvaluation(id, agent) {
  const type = typeFor(id);
  const result = getEvaluation(id, agent);
  const ran = ['passed','failed'].includes(agent.evaluation);
  const stale = agent.evaluation === 'stale';
  const tone = !ran ? 'neutral' : agent.evaluation === 'passed' ? 'success' : 'danger';
  const icon = !ran ? '○' : agent.evaluation === 'passed' ? '✓' : '!';
  const log = agent.evaluationLog ?? [];
  const latest = log[log.length - 1];
  const baseline = getEvaluationBaseline(agent);
  const delta = ran && latest && baseline ? latest.passedCount - baseline.passedCount : null;
  const compare = ran && baseline
    ? `<div class="compare-strip ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}"><span>与上一次评估对比</span><b>${escapeHtml(baseline.runId)} ${escapeHtml(baseline.score)}</b><i>→</i><b>${escapeHtml(latest.runId)} ${escapeHtml(latest.score)}</b><em>${delta === null ? '' : delta > 0 ? `通过样本 ${signed(delta)} 条` : delta < 0 ? `通过样本 ${signed(delta)} 条` : '通过样本数持平'}</em></div>`
    : ran ? '<div class="compare-strip"><span>与上一次评估对比</span><em>这是该 Agent 的首次评估，暂无基线。</em></div>' : '';
  return `<div class="evaluation-layout"><section class="panel"><div class="panel-heading"><div><h2>离线样本评估</h2><p>配置变更后需重新评估。</p></div><div class="heading-actions"><button class="btn ${agent.evaluation==='passed'?'btn-outline':'btn-primary'}" data-action="evaluate">${log.length?'重新评估':'运行评估'}</button>${agent.evaluation==='failed'||stale?'<button class="btn btn-outline" data-action="goView" data-view="config">返回配置修复 →</button>':`<button class="btn ${agent.evaluation==='passed'?'btn-primary':'btn-outline'}" data-action="goView" data-view="release" ${agent.evaluation!=='passed'?'disabled':''}>进入发布 →</button>`}</div></div>
    <div class="eval-summary ${tone}"><span class="eval-symbol">${icon}</span><div><strong>${stale?'旧评估已失效':!ran?'等待评估':agent.evaluation==='passed'?'评估通过':'发布被阻断'}</strong><p>${stale?'配置已变化，必须对当前草稿重新评估。':!ran?'运行当前草稿，查看场景专属质量门槛。':result.detail}</p></div><span class="eval-score">${ran?result.score:'—'}</span></div>
    ${compare}
    <div class="table-head"><h3>${result.title}</h3><span>样本集 ${result.sampleSetVersion} · 演示数据</span></div><div class="check-list">${(ran?result.checks:[['固定样本集','待运行','点击“运行评估”查看结果']]).map(([name,status,detail])=>`<div class="check-row"><div><strong>${name}</strong><span>${detail}</span></div><span class="check-status ${status==='通过'?'pass':status==='未通过'?'fail':''}">${status}</span></div>`).join('')}</div>
    <div class="table-head samples-title"><h3>全部样本 · 输入 / 预期 / 实际</h3><span>${ran?`评估 ${agent.evaluationRunId}`:'运行后展示结果'}</span></div><div class="sample-list">${result.samples.map((item,index)=>`<details class="sample-row ${ran&&!item.passed?'failed':''}" ${ran?'open':''}><summary><span class="sample-index">${String(index+1).padStart(2,'0')}</span><strong>${escapeHtml(item.input)}</strong><span class="check-status ${ran?(item.passed?'pass':'fail'):''}">${ran?(item.passed?'通过':'未通过'):'待运行'}</span></summary>${ran&&!item.passed?`<div class="sample-warning"><span>!</span><strong>未通过</strong><span>该样本阻断当前发布，请修复配置后重新评估。</span></div>`:''}<div class="sample-detail"><div><b>预期</b><p>${escapeHtml(item.expected)}</p></div><div><b>实际${ran?'结果':'（预设模拟）'}</b><p>${ran?escapeHtml(item.actual):'运行评估后显示'}</p></div><div><b>依据</b><p>${escapeHtml(item.basis)}</p></div></div></details>`).join('')}</div>
    ${log.length?`<div class="table-head samples-title"><h3>评估历史</h3><span>共 ${log.length} 次</span></div><div class="eval-log">${[...log].reverse().map(item=>`<div class="eval-log-row"><span class="check-status ${item.passed?'pass':'fail'}">${item.passed?'通过':'未通过'}</span><strong>${escapeHtml(item.runId)}</strong><span>${escapeHtml(item.version)} · ${escapeHtml(item.score)}</span><small>${formatTime(item.at)}</small></div>`).join('')}</div>`:''}</section>
    <aside class="panel evaluation-aside"><h2>发布门槛</h2><div class="info-row"><span>当前评估</span><b>${ran?agent.evaluationRunId:stale?'已失效':'未运行'}</b></div><div class="gate-item ${agent.evaluation==='passed'?'done':''}"><span>${agent.evaluation==='passed'?'✓':'1'}</span><div><strong>离线评估通过</strong><p>${type==='a'?'场景相关性、笔记有效性和延迟预算':type==='b'?'严重红线样本必须通过':'知识有依据或转人工'}</p></div></div>${type==='b'?`<div class="gate-item ${agent.approved?'done':''}"><span>${agent.approved?'✓':'2'}</span><div><strong>政策负责人审批</strong><p>通过评估后仍需人工签核。</p></div></div>`:''}<div class="side-note">${type==='a'?'线上采纳和点击要在灰度后观察。':type==='b'?'严重类别不能漏判。':'缺少依据时转人工。'}</div></aside></div>`;
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
  const published = agent.liveVersion === agent.draftVersion;
  const canAdjustTraffic = Boolean(agent.liveVersion && agent.status !== '已回退' && (agent.previousVersion || published));
  const selectedTraffic = published ? agent.traffic : 10;
  const trafficMin = published ? 0 : 1;
  const canSelectTraffic = ready || canAdjustTraffic;
  const trafficActionLabel = published
    ? selectedTraffic === 0 ? '流量降至 0%' : selectedTraffic === 100 ? '全量至 100%' : `调整至 ${selectedTraffic}%`
    : selectedTraffic === 100 ? '全量发布' : `发布至 ${selectedTraffic}% 灰度`;
  const evaluationText = agent.evaluation==='passed'?'通过':agent.evaluation==='failed'?'未通过':agent.evaluation==='stale'?'已失效，需重新评估':'未运行';
  const evidenceEval = agent.evaluation === 'passed' || agent.evaluation === 'failed'
    ? `${agent.evaluationRunId} · ${getEvaluation(id, agent).sampleSetVersion}`
    : agent.evaluation === 'stale' ? '上一次评估已随配置变更失效，需重新运行' : '尚未运行';
  const rolled = (agent.rolledBack ?? []).find(item => item.version === agent.draftVersion);
  const changes = [
    !agent.liveConfig ? '首次发布：使用当前 Agent 指令' : agent.liveConfig.prompt !== agent.prompt ? 'Agent 指令已调整' : 'Agent 指令无变化',
    type==='a' ? agent.liveConfig ? (agent.liveConfig.strategy === agent.strategy ? `推荐策略无变化：${agent.strategy==='relevance'?'场景相关性':'响应速度'}` : `推荐策略：${agent.liveConfig.strategy==='relevance'?'场景相关性':'响应速度'} → ${agent.strategy==='relevance'?'场景相关性':'响应速度'}`) : `首次配置推荐策略：${agent.strategy==='relevance'?'场景相关性':'响应速度'}` :
      type==='b' ? `规则 ${agent.policyVersion}：${agent.ruleEnabled?'攻击性语言规则已启用':'攻击性语言规则未启用'}` :
      agent.liveConfig?.knowledgeVersion === agent.knowledgeVersion ? `售后知识无变化：${agent.knowledgeVersion}` : `售后知识：${agent.liveConfig?.knowledgeVersion ?? '无'} → ${agent.knowledgeVersion}`,
    `对应评估：${evidenceEval}`,
  ];
  const disposal = type==='a'
    ? `<p class="aside-intro">${published?'调整只改变当前版本流量，不生成新版本。':'选择当前草稿的首次发布比例；100% 为直接全量。'}</p><label class="traffic-value" for="traffic-slider"><span>${published?'当前版本流量':'首次发布流量'}</span><output id="traffic-value">${selectedTraffic}%</output></label><div class="traffic-number-wrap"><label for="traffic-number">精确设置</label><input id="traffic-number" type="number" min="${trafficMin}" max="100" step="1" value="${selectedTraffic}" ${!canSelectTraffic?'disabled':''} /><span>%</span></div><input id="traffic-slider" class="traffic-slider" type="range" min="${trafficMin}" max="100" step="1" value="${selectedTraffic}" style="--range-progress:${selectedTraffic}%" ${!canSelectTraffic?'disabled':''} aria-label="新版本灰度比例" /><div class="traffic-scale"><span>${published?'0% 稳定版本':'1% 最小灰度'}</span><span>100% 全量</span></div><button class="btn btn-danger-outline full" data-action="rollback" ${!agent.previousVersion?'disabled':''}>${agent.previousVersion?`回退到 ${agent.previousVersion}`:'暂无可回退版本'}</button>`
    : `<p class="aside-intro">政策或知识可能过期，异常时暂停建议并转人工；问题修复后可恢复接管。</p>${agent.status==='人工兜底'
        ? `<div class="paused-note">当前处于人工兜底状态，Agent 建议已停止下发。</div><button class="btn btn-primary full" data-action="resume">恢复 Agent 接管</button>`
        : `<button class="btn btn-danger-outline full" data-action="pause" ${!agent.liveVersion?'disabled':''}>暂停建议 · 转人工</button>`}`;
  return `<div class="content-grid release-grid"><section class="panel"><div class="panel-heading"><div><h2>版本发布</h2><p>核对配置、评估和审批证据。</p></div>${getBadge(agentStatus(id,agent))}</div>
    <div class="version-track"><div><span>当前生产</span><strong>${agent.liveVersion ?? '未发布'}</strong><small>${type==='a'?(agent.traffic===100?'新版本全量 100%':agent.traffic?`新版本流量 ${agent.traffic}%`:agent.previousVersion?'稳定版 100% · 新版 0%':agent.liveVersion?'当前稳定运行 · 新版待发布':'待首次发布'):!agent.liveVersion?'待首次发布':agent.status==='人工兜底'?'已暂停 · 人工兜底':'稳定运行'}</small></div><span class="track-arrow">→</span><div><span>待发布草稿</span><strong>${agent.draftVersion}</strong><small>${type==='c'?`知识 ${agent.knowledgeVersion}`:type==='b'?`政策 ${agent.policyVersion}`:`策略 ${agent.strategy==='relevance'?'场景相关性':'响应速度'}`}</small></div></div>
    ${rolled?`<div class="rollback-warn"><strong>${escapeHtml(agent.draftVersion)} 曾于 ${formatTime(rolled.at)} 被回退</strong><span>该版本的评估已失效。重新发布前必须重新评估，确认问题已修复。</span></div>`:''}
    <div class="release-evidence"><h3>${published?'当前版本证据':'本次变化与决策证据'}</h3>${changes.map(item=>`<div class="evidence-row">• ${escapeHtml(item)}</div>`).join('')}${type==='b'?`<div class="evidence-row">审批人：${agent.approved?`${escapeHtml(agent.approvalPerson)} · 已审批（${formatTime(agent.approvedAt)}）`:'社区生态政策负责人（模拟） · 待审批'}</div>`:''}</div>
    <div class="release-checks"><div><span class="mini-check ${agent.evaluation==='passed'?'ok':''}">${agent.evaluation==='passed'?'✓':'!'}</span><div><strong>评估结果</strong><small>${evaluationText}</small></div></div>${type==='b'?`<div><span class="mini-check ${agent.approved?'ok':''}">${agent.approved?'✓':'!'}</span><div><strong>政策负责人审批</strong><small>${agent.approved?'已完成':'待完成'}</small></div></div>`:''}<div><span class="mini-check ok">✓</span><div><strong>发布记录</strong><small>版本、操作和时间保留在本地</small></div></div></div>
    ${type==='b'&&agent.evaluation==='passed'&&!agent.approved?`<div class="action-callout"><div><strong>评估已通过，等待人工审批</strong><span>由社区生态政策负责人模拟签核。</span></div><button class="btn btn-outline" data-action="approve">完成审批</button></div>`:''}
    <div class="release-actions">${type==='a'?`<button id="release-primary" class="btn btn-primary" data-action="confirmTrafficRelease" ${!ready||published?'disabled':''}>${trafficActionLabel}</button>`:`<button class="btn btn-primary" data-action="publish" ${!ready||published?'disabled':''}>${published?'当前版本已发布':'发布新版本'}</button>`}<button class="btn btn-outline" data-action="goView" data-view="monitor">进入监控 →</button><span>${published?(type==='a'?'拖动右侧滑块可继续调整当前版本流量':'草稿与生产一致'):ready?'发布条件已满足':type==='b'?'请先完成评估和审批':'请先通过当前草稿评估'}</span></div></section>
    <aside class="panel side-panel"><h2>${type==='a'?'灰度与回退':'异常处置'}</h2>${disposal}</aside></div>
    <section class="panel history-panel"><div class="table-head"><h3>发布与处置记录</h3><span>模拟记录</span></div>${renderHistory(agent)}</section>`;
}

function renderChart(series, withBaseline) {
  const span = series.max - series.min;
  const bar = value => `${Math.max(6, Math.min(100, ((value - series.min) / span) * 100))}%`;
  return `<div class="chart-body"><div class="chart-axis"><span>${series.max}${series.unit}</span><span>${((series.max + series.min) / 2).toFixed(0)}${series.unit}</span><span>${series.min}${series.unit}</span></div>
    <div class="bar-chart">${series.current.map((value, i) => `<div class="bar-pair">${withBaseline?`<span class="bar old" style="height:${bar(series.baseline[i])}" title="${series.baselineName} ${series.baseline[i]}${series.unit}"></span>`:''}<span class="bar new" style="height:${bar(value)}" title="${series.currentName} ${value}${series.unit}"></span><small>${i+1}日</small></div>`).join('')}</div></div>
    <div class="chart-foot">${series.label}（${series.unit}）· 模拟数据</div><details class="chart-data"><summary>查看数据明细</summary><table><caption>${series.label} · 近 7 天模拟结果</caption><thead><tr><th scope="col">日期</th><th scope="col">${escapeHtml(series.currentName)}</th>${withBaseline?`<th scope="col">${escapeHtml(series.baselineName)}</th>`:''}</tr></thead><tbody>${series.current.map((value,i)=>`<tr><th scope="row">${i+1}日</th><td>${value}${series.unit}</td>${withBaseline?`<td>${series.baseline[i]}${series.unit}</td>`:''}</tr>`).join('')}</tbody></table></details>`;
}

function renderExperiment(agent) {
  const read = getExperimentReadout(agent);
  const ci = read.ciLowPt === null ? '对照组已关闭' : `[${signed(read.ciLowPt)}pt, ${signed(read.ciHighPt)}pt]`;
  return `<div class="experiment-card ${read.recommendation.tone}">
    <div class="table-head"><h3>灰度决策读数</h3><span>95% 置信水平 · 模拟计算</span></div>
    <div class="experiment-grid">
      <div><span>新版本曝光</span><b>${formatCount(read.exposureNew)}</b><small>流量 ${read.traffic}%</small></div>
      <div><span>对照组曝光</span><b>${read.exposureOld ? formatCount(read.exposureOld) : '—'}</b><small>${read.exposureOld ? `流量 ${100 - read.traffic}%` : '已全量'}</small></div>
      <div><span>采纳率差值</span><b>${signed(read.diffPt)}pt</b><small>${pct(read.adoptNew)} vs ${pct(read.adoptOld)}</small></div>
      <div><span>95% 置信区间</span><b class="ci">${ci}</b><small>${read.significant ? '差异显著' : read.enoughSample ? '未达显著' : '样本量不足'}</small></div>
    </div>
    <div class="guardrail-row"><span class="guardrail-tag ${read.guardrail.breached ? 'bad' : 'ok'}">护栏指标</span><b>${read.guardrail.name} ${read.guardrail.newValue}s</b><small>旧版本 ${read.guardrail.oldValue}s · 预算 ${read.guardrail.budget}s · ${read.guardrail.breached ? '已突破' : '未突破'}</small></div>
    <div class="recommend-row"><span>建议</span><p>${escapeHtml(read.recommendation.text)}</p></div>
  </div>`;
}

function renderTrace(id, agent) {
  const type = typeFor(id);
  const meta = getRunMeta(id, agent, agent.sampleInput ?? '');
  const rows = type === 'a'
    ? [['R-1024', '旅行穿搭请求', agent.liveConfig?.strategy==='relevance'?'场景优先 · 推荐 #N-102 / #N-208':'速度优先 · 推荐 #N-102', `推荐策略：${agent.liveConfig?.strategy==='relevance'?'优先场景相关性':'优先响应速度'}`]]
    : type === 'b'
      ? [['B-0042', '评论判定', `政策 ${agent.liveConfig?.policyVersion ?? agent.policyVersion} · 人工复核`, `攻击性语言规则：${agent.liveRuleEnabled?'已启用':'未启用'}`]]
      : [['C-0198', '换码咨询', `知识 ${agent.liveKnowledgeVersion} · ${agent.liveKnowledgeVersion==='K-02'?'有引用':'转人工'}`, `售后知识版本：${agent.liveKnowledgeVersion ?? '—'}`]];
  return rows.map(([code, title, detail, resource]) => `<details class="trace-row"><summary><span class="trace-icon">${icon("activity")}</span><div><strong>${title}</strong><small>${code} · ${agent.liveVersion}</small><p>${escapeHtml(detail)}</p></div><span class="trace-arrow">▾</span></summary>
    <div class="trace-detail">
      <div class="info-row"><span>命中版本</span><b>${agent.liveVersion}</b></div>
      <div class="info-row"><span>当时指令</span><b>${escapeHtml(truncate(agent.liveConfig?.prompt ?? agent.prompt, 40))}</b></div>
      <div class="info-row"><span>知识／规则</span><b>${escapeHtml(resource)}</b></div>
      <div class="info-row"><span>对应评估</span><b>${escapeHtml(agent.liveEvaluationRunId ?? '—')}</b></div>
      <div class="info-row"><span>耗时 / tokens</span><b>${meta.latency} ms · ${meta.promptTokens + meta.outputTokens}</b></div>
      <div class="info-row"><span>调用成本</span><b>¥${meta.cost.toFixed(4)} · ${escapeHtml(meta.route)}</b></div>
    </div></details>`).join('');
}

function renderMonitor(id, agent) {
  const type = typeFor(id);
  const mode = getMonitorMode(id, agent);
  const showData = !['unpublished','paused','stable'].includes(mode);
  const hasControl = mode === 'gray-compare';
  const read = type === 'a' && showData ? getExperimentReadout(agent) : null;
  const metrics = !showData ? [] : type==='a'
    ? [[formatCount(read.exposureNew), '新版本模拟曝光', mode==='full'?'全量 100%':`灰度 ${agent.traffic}%`],
       [pct(read.adoptNew), '新版本采纳率', hasControl?`旧版本 ${pct(read.adoptOld)}`:mode==='full'?'对照组已关闭':'首发 · 无旧版基线'],
       [pct(read.clickNew), '新版本笔记点击率', hasControl?`旧版本 ${pct(read.clickOld)}`:mode==='full'?'对照组已关闭':'首发 · 无旧版基线']]
    : type==='b'
      ? [[agent.liveRuleEnabled?'0 / 1':'1 / 1','严重样本漏判','固定样本 · 模拟'],['98.2%','结构化输出率','模拟批次'],['240','待人工复核','演示条目']]
      : [[agent.liveKnowledgeVersion==='K-02'?'100%':'87.5%','有效知识引用','固定样本 · 模拟'],['68.4%','客服采纳率','演示数据'],['12.1%','转人工比例','演示数据']];
  const series = showData ? getMonitorSeries(id, agent) : null;
  const chartTitle = type==='a' ? (hasControl?'灰度效果对比':mode==='full'?'全量后趋势':'首发灰度趋势') : type==='b'?'审核质量趋势':'知识覆盖趋势';
  const withBaseline = type === 'a' ? hasControl : true;
  const emptyText = mode==='unpublished' ? '尚未发布生产版本。先完成评估与发布，才会出现模拟线上结果。'
    : mode==='paused' ? '当前已暂停 Agent 建议，业务转人工处理。运行指标与调用追溯已停止展示；可在「发布」页恢复接管，处置记录见下方。'
    : agent.status==='已回退' ? `已回退到稳定版本 ${agent.liveVersion}，回退记录见下方。`
    : agent.previousVersion ? `新版本流量为 0%，由稳定版本 ${agent.previousVersion} 承接。`
    : '新版本流量为 0%，当前没有请求进入该版本。';
  const main = !showData ? `<div class="monitor-empty">${emptyText}</div>`
    : `<div class="monitor-metrics">${metrics.map(([value,label,trend])=>`<div class="metric-card"><span>${label}</span><strong>${value}</strong><small>${trend}</small></div>`).join('')}</div>
      ${type==='a'?renderExperiment(agent):''}
      <div class="monitor-split"><div class="chart-card"><div class="table-head"><h3>${chartTitle}</h3><span>近 7 天 · 模拟结果</span></div><div class="chart-legend"><span><i class="legend-dot red"></i>${escapeHtml(series.currentName)}</span>${withBaseline?`<span><i class="legend-dot gray"></i>${escapeHtml(series.baselineName)}</span>`:''}</div>${renderChart(series, withBaseline)}</div>
      <div class="trace-card"><div class="table-head"><h3>调用追溯</h3><span>点开查看完整链路</span></div>${renderTrace(id, agent)}<div class="trace-foot">演示中不记录真实用户内容，生产需按权限脱敏查看。</div></div></div>`;
  return `<section class="panel monitor-panel"><div class="panel-heading"><div><h2>运行监控</h2><p>生产 ${agent.liveVersion ?? '未发布'} · ${agent.status} · 模拟结果</p></div><button class="btn btn-outline" data-action="goView" data-view="config">继续迭代 →</button></div>${main}<div class="table-head samples-title"><h3>发布与处置记录</h3><span>时间 · 版本 · 操作</span></div>${renderHistory(agent)}</section>`;
}

function render() {
  const noticeTone = /未通过|被阻断|请先|不能为空/.test(state.notice) ? 'danger' : /失效|回退|暂停|人工/.test(state.notice) ? 'warn' : 'good';
  let content;
  if (state.view === 'overview') content = renderOverview();
  else if (state.view === 'manage') content = renderManage();
  else if (state.view === 'platform') content = renderPlatform();
  else if (state.view === 'templates') content = renderTemplates();
  else if (state.view === 'create') content = renderCreate();
  else if (state.selectedAgent && state.agents[state.selectedAgent]) {
    const id = state.selectedAgent;
    const agent = state.agents[id];
    const page = { creation: renderCreation, config: renderConfig, debug: renderDebug, evaluation: renderEvaluation, release: renderRelease, monitor: renderMonitor }[state.view] ?? renderCreation;
    content = renderWorkspaceHead(id, agent) + page(id, agent);
  } else content = renderManage();
  app.innerHTML = `${renderSidebar()}<div class="main-shell">${renderTopbar()}<main id="main-content" class="main-content" tabindex="-1">${state.notice?`<div class="notice ${noticeTone}" role="status">${icon(noticeTone==='good'?'check':'alert')}${escapeHtml(state.notice)}<button aria-label="关闭提示" data-action="clearNotice">×</button></div>`:''}${content}</main></div>`;
}

function requestConfirmation(title, description, label, action) {
  const returnFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog';
  dialog.setAttribute('aria-labelledby', 'confirm-title');
  dialog.setAttribute('aria-describedby', 'confirm-description');
  dialog.innerHTML = `<span class="confirm-icon">${icon('alert')}</span><h2 id="confirm-title">${escapeHtml(title)}</h2><p id="confirm-description">${escapeHtml(description)}</p><form method="dialog" class="confirm-actions"><button class="btn btn-outline" value="cancel" autofocus>取消</button><button class="btn btn-primary" value="confirm">${escapeHtml(label)}</button></form>`;
  dialog.addEventListener('close', () => {
    const confirmed = dialog.returnValue === 'confirm';
    dialog.remove();
    if (confirmed) update(action);
    else returnFocus?.focus({ preventScroll: true });
  }, { once: true });
  app.append(dialog);
  dialog.showModal();
}

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  const agentId = button.dataset.agent ?? state.selectedAgent;
  if (action === 'toggleUserMenu') {
    const menu = app.querySelector('#profile-menu');
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    if (menu) menu.hidden = !expanded;
    button.setAttribute('aria-expanded', String(expanded));
  }
  else if (action === 'overview') update({ type: 'navigate', view: 'overview' });
  else if (action === 'manage') update({ type: 'navigate', view: 'manage' });
  else if (action === 'platform') update({ type: 'navigate', view: 'platform' });
  else if (action === 'newAgent') update({ type: 'navigate', view: 'templates' });
  else if (action === 'chooseTemplate') update({ type: 'chooseTemplate', templateType: button.dataset.template });
  else if (action === 'reviewB') { update({ type: 'selectAgent', agentId: 'b' }); update({ type: 'navigate', view: 'evaluation' }); }
  else if (action === 'lifeStep') {
    if (button.dataset.view === 'creation' && !state.selectedAgent) update({ type: 'navigate', view: 'templates' });
    else update({ type: 'navigate', view: state.selectedAgent ? button.dataset.view : 'manage' });
  }
  else if (action === 'selectAgent') update({ type: 'selectAgent', agentId });
  else if (action === 'goView') update({ type: 'navigate', view: state.selectedAgent ? button.dataset.view : 'manage' });
  else if (action === 'clearNotice') { state.notice = ''; render(); }
  else if (action === 'reset') {
    requestConfirmation('重置演示？', '所有自建 Agent 和演示进度将被清除，恢复到三个初始示例。', '确认重置', { type: 'reset' });
  }
  else if (action === 'deleteAgent') {
    const name = state.agents[agentId]?.name ?? '该 Agent';
    requestConfirmation('删除此 Agent？', `「${name}」的配置、评估和发布记录将一并移除。`, '确认删除', { type: 'deleteAgent', agentId });
  }
  else if (action === 'confirmTrafficRelease') {
    const input = app.querySelector('#traffic-number');
    if (!input.value.trim() || !input.validity.valid) { input.reportValidity(); return; }
    const agent = state.agents[agentId];
    const traffic = Number(input.value);
    update(agent.liveVersion === agent.draftVersion
      ? { type: 'setTraffic', agentId, traffic }
      : { type: 'publish', agentId, traffic });
  }
  else if (action === 'setStrategy') update({ type: action, agentId, strategy: button.dataset.strategy });
  else if (action === 'runDebug') update({ type: action, agentId,
    input: app.querySelector('#debug-input')?.value,
    systemPrompt: app.querySelector('#debug-system-prompt')?.value,
    preset: app.querySelector('#debug-preset')?.value });
  else update({ type: action, agentId });
});

function syncTrafficControls(source) {
  const slider = app.querySelector('#traffic-slider');
  const number = app.querySelector('#traffic-number');
  const output = app.querySelector('#traffic-value');
  const button = app.querySelector('#release-primary');
  const agent = state.agents[state.selectedAgent];
  if (!slider || !number || !output || !button || !agent) return;
  const valid = source.value.trim() !== '' && source.validity.valid;
  if (!valid) { button.disabled = true; return; }
  const value = Number(source.value);
  if (source === slider) number.value = source.value;
  else slider.value = source.value;
  output.textContent = `${value}%`;
  slider.style.setProperty('--range-progress', `${value}%`);
  const published = agent.liveVersion === agent.draftVersion;
  button.textContent = published
    ? value === 0 ? '流量降至 0%' : value === 100 ? '全量至 100%' : `调整至 ${value}%`
    : value === 100 ? '全量发布' : `发布至 ${value}% 灰度`;
  button.disabled = published ? value === agent.traffic : !canPublish(state.selectedAgent, agent);
}

app.addEventListener('input', event => {
  if (event.target.id === 'agent-search') {
    const query = event.target.value.trim().toLowerCase();
    const rows = [...app.querySelectorAll('.agent-table-row')];
    rows.forEach(row => { row.hidden = !row.dataset.search.includes(query); });
    app.querySelector('.search-empty').hidden = rows.some(row => !row.hidden);
  } else if (event.target.id === 'traffic-slider' || event.target.id === 'traffic-number') {
    syncTrafficControls(event.target);
  } else if (event.target.id === 'debug-system-prompt') {
    const preset = app.querySelector('#debug-preset');
    if (preset) preset.value = 'custom';
  }
});

app.addEventListener('change', event => {
  if (event.target.id === 'debug-preset') {
    const agent = state.agents[state.selectedAgent];
    if (!agent) return;
    const prompt = debugPromptPresets(typeFor(state.selectedAgent), agent).find(item => item.value === event.target.value)?.prompt;
    const editor = app.querySelector('#debug-system-prompt');
    if (prompt && editor) editor.value = prompt;
  }
});

app.addEventListener('keydown', event => {
  if (event.target.id === 'traffic-number' && event.key === 'Enter') {
    event.preventDefault();
    app.querySelector('#release-primary')?.click();
  }
  if (event.target.id === 'debug-input' && event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    app.querySelector('[data-action="runDebug"]')?.click();
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
