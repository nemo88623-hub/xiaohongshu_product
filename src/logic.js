const baseAgent = {
  liveVersion: 'v1.0',
  draftVersion: 'v1.1',
  previousVersion: null,
  evaluation: 'idle',
  approved: false,
  debugStep: 0,
  debugOutput: '',
  debugHistory: [],
  debugInputs: [],
  status: '运行中',
};

export const TEMPLATES = {
  a: { taskDescription: '根据场景生成穿搭灵感并推荐社区同款笔记。', callMode: '实时请求', outputFormat: '穿搭建议 + 笔记卡片', defaultResource: '社区笔记演示索引' },
  b: { taskDescription: '输出类别、理由和规则依据，协助人工判断社区内容。', callMode: '批量任务', outputFormat: '类别 + 理由 + 规则版本', defaultResource: '政策规则 P-2026.09' },
  c: { taskDescription: '根据售后知识辅助客服多轮答疑，缺少依据时转人工。', callMode: '多轮会话', outputFormat: '客服建议 + 知识引用', defaultResource: '售后知识 K-01' },
};

export function templateTypeOf(agentId, agent) {
  return agent?.templateType ?? (TEMPLATES[agentId] ? agentId : null);
}

export function configSnapshot(agent) {
  return { prompt: agent.prompt, taskDescription: agent.taskDescription, strategy: agent.strategy,
    ruleEnabled: agent.ruleEnabled, policyVersion: agent.policyVersion, knowledgeVersion: agent.knowledgeVersion };
}

const fingerprint = agent => JSON.stringify(configSnapshot(agent));

/** Drop the evaluation verdict only; the run log stays as the comparison baseline. */
function invalidateEvaluation(agent) {
  agent.evaluation = agent.evaluation === 'idle' ? 'idle' : 'stale';
  agent.evaluationFingerprint = null;
  agent.evaluationRunId = null;
  agent.evaluationAt = null;
  agent.approved = false;
  agent.approvalPerson = null;
  agent.approvedAt = null;
}

function invalidate(agent) {
  invalidateEvaluation(agent);
  agent.debugStep = 0;
  agent.debugOutput = '';
  agent.debugHistory = [];
  agent.debugInputs = [];
  agent.debugInput = agent.sampleInput;
  agent.debugSystemPrompt = agent.prompt;
  agent.debugPromptPreset = 'current';
}

function record(agent, action, detail, evaluationRunId = agent.liveEvaluationRunId) {
  agent.releaseHistory.push({
    at: new Date().toISOString(), action, detail, version: agent.liveVersion,
    evaluationRunId,
    snapshot: action === '发布' ? structuredClone(agent.liveConfig) : null,
  });
}

export function getMonitorMode(agentId, agent) {
  if (!agent.liveVersion) return 'unpublished';
  if (agent.status === '人工兜底') return 'paused';
  if (templateTypeOf(agentId, agent) !== 'a') return 'live';
  if (agent.traffic === 100) return 'full';
  if (!agent.traffic) return 'stable';
  return agent.previousVersion ? 'gray-compare' : 'gray-first';
}

function advanceDraftIfPublished(agent) {
  if (agent.liveVersion !== agent.draftVersion) return;
  const match = /^v(\d+)\.(\d+)$/.exec(agent.draftVersion);
  if (match) agent.draftVersion = `v${match[1]}.${Number(match[2]) + 1}`;
}

export function createInitialState() {
  const initial = {
    selectedAgent: null,
    selectedTemplate: null,
    view: 'overview',
    notice: '',
    nextAgentNumber: 1,
    nextEvalNumber: 1,
    agents: {
      a: {
        ...baseAgent,
        name: '穿搭灵感 Agent',
        team: '社区体验团队',
        prompt: '根据用户场景给出实用穿搭灵感，并只推荐真实可访问的社区笔记。',
        sampleInput: '周末去上海旅行，可能下雨，想穿得舒服又适合拍照。',
        traffic: 0,
      },
      b: {
        ...baseAgent,
        name: '生态守护 Agent',
        team: '社区生态团队',
        prompt: '识别疑似违规内容，输出类别、理由与适用规则，交由人工复核。',
        sampleInput: '你这个人真蠢，别再发了。',
        ruleEnabled: false,
        liveRuleEnabled: false,
        policyVersion: 'P-2026.09',
      },
      c: {
        ...baseAgent,
        name: '售后答疑 Agent',
        team: '电商服务团队',
        prompt: '根据有效售后知识为客服拟答；缺少依据时转人工，不编造政策。',
        sampleInput: '鞋子尺码不合适，能换吗？',
        knowledgeVersion: 'K-01',
        liveKnowledgeVersion: 'K-01',
      },
    },
  };
  for (const [id, agent] of Object.entries(initial.agents)) {
    Object.assign(agent, TEMPLATES[id], {
      templateType: id, isExample: true, createdAt: null,
      evaluationRunId: null, evaluationFingerprint: null, evaluationAt: null,
      evaluationLog: [],
      liveEvaluationRunId: null, previousEvaluationRunId: null,
      approvalPerson: null, approvedAt: null,
      releaseHistory: [], previousConfig: null, rolledBack: [],
      strategy: 'speed', traffic: 0, ruleEnabled: agent.ruleEnabled ?? false,
      liveRuleEnabled: agent.liveRuleEnabled ?? false,
      policyVersion: agent.policyVersion ?? 'P-2026.09',
      knowledgeVersion: agent.knowledgeVersion ?? 'K-01',
      liveKnowledgeVersion: agent.liveKnowledgeVersion ?? 'K-01',
      debugInput: agent.sampleInput, debugInputs: [],
      debugSystemPrompt: agent.prompt, debugPromptPreset: 'current',
    });
    agent.liveConfig = configSnapshot(agent);
  }
  return initial;
}

export function restoreState(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed?.agents?.a || !parsed?.agents?.b || !parsed?.agents?.c) return createInitialState();
    const initial = createInitialState();
    const agents = {};
    for (const [id, saved] of Object.entries(parsed.agents)) {
      const type = templateTypeOf(id, saved);
      if (!TEMPLATES[type] || !saved || typeof saved !== 'object') continue;
      agents[id] = {
        ...structuredClone(initial.agents[type]), ...saved, templateType: type,
        debugHistory: Array.isArray(saved.debugHistory) ? saved.debugHistory : [],
        debugInputs: Array.isArray(saved.debugInputs) ? saved.debugInputs : [],
        debugInput: saved.debugInput ?? saved.sampleInput ?? initial.agents[type].sampleInput,
        debugSystemPrompt: saved.debugSystemPrompt ?? saved.prompt ?? initial.agents[type].prompt,
        debugPromptPreset: saved.debugPromptPreset ?? 'current',
        releaseHistory: Array.isArray(saved.releaseHistory) ? saved.releaseHistory : [],
        evaluationLog: Array.isArray(saved.evaluationLog) ? saved.evaluationLog : [],
        rolledBack: Array.isArray(saved.rolledBack) ? saved.rolledBack : [],
        liveConfig: saved.liveConfig ?? (saved.liveVersion ? configSnapshot(saved) : null),
        liveEvaluationRunId: saved.liveEvaluationRunId ?? null,
        previousEvaluationRunId: saved.previousEvaluationRunId ?? null,
      };
    }
    const highest = Math.max(0, ...Object.keys(agents).map(id => Number(/^custom-(\d+)$/.exec(id)?.[1] ?? 0)));
    return { ...initial, ...parsed, agents,
      nextAgentNumber: Math.max(Number(parsed.nextAgentNumber) || 1, highest + 1),
      nextEvalNumber: Number(parsed.nextEvalNumber) || 1,
      selectedAgent: agents[parsed.selectedAgent] ? parsed.selectedAgent : null,
      selectedTemplate: TEMPLATES[parsed.selectedTemplate] ? parsed.selectedTemplate : null };
  } catch { return createInitialState(); }
}

export function getSampleResponse(agentId, agent, step = 1, input = agent.sampleInput, systemPrompt = agent.prompt) {
  const type = templateTypeOf(agentId, agent);
  const text = String(input ?? '').trim();
  const concise = /简洁|精简|一句话/.test(systemPrompt);
  if (type === 'a') {
    const answer = agent.strategy === 'relevance'
      ? `场景优先：根据“${text}”推荐轻薄防水外套、舒适长裤和防滑鞋，兼顾场景适配与实用性。\n相关笔记：#N-102「雨天城市漫游穿搭」；#N-208「轻便旅行叠穿」。`
      : `速度优先：根据“${text}”快速推荐防水外套、舒适长裤和防滑鞋。\n相关笔记：#N-102「雨天城市漫游穿搭」。`;
    return `${concise ? answer.split('\n')[0] : answer}\n以上为模拟回答和演示笔记。`;
  }
  if (type === 'b') {
    const severe = /蠢|滚|辱骂|侮辱|攻击|去死|垃圾/.test(text);
    if (!severe) return `类别：正常内容\n理由：未发现演示红线词。\n依据：政策 ${agent.policyVersion}\n建议：${concise ? '通过' : '按正常流程处理。'}`;
    if (concise && agent.ruleEnabled) return '疑似人身攻击 · 转人工复核。';
    return agent.ruleEnabled
      ? `类别：疑似人身攻击\n理由：评论针对用户使用侮辱性措辞。\n依据：演示规则 ${agent.policyVersion}\n建议：人工复核，不自动作最终判定。`
      : '类别：未识别\n理由：当前草稿未启用演示攻击性语言规则。\n建议：人工复核。';
  }
  if (/特殊售后|未收录|保修|保险|特殊政策/.test(text)) {
    return '当前演示知识未覆盖该问题，建议转人工核实，不提供无依据答复。';
  }
  if (step < 2) {
    return '请先核对签收时间，以及商品是否穿着或影响二次销售。';
  }
  if (concise && agent.knowledgeVersion === 'K-02') return '符合条件可在订单页申请换码。引用：K-02（演示）';
  return agent.knowledgeVersion === 'K-02'
    ? '客服建议：根据演示知识《店铺换货规则》K-02，若签收时间和商品状态符合条件，可引导用户在订单页申请换码；请先核对订单。\n引用来源：K-02 · 换码条件（演示）'
    : '当前知识版本缺少可引用的换码条件，建议转人工核实，避免给出无依据的承诺。';
}

/** Deterministic per-run metadata so the debug view can show latency / token / cost. */
export function getRunMeta(agentId, agent, input = '') {
  const type = templateTypeOf(agentId, agent);
  const length = String(input).length;
  if (type === 'a') {
    const latency = agent.strategy === 'relevance' ? 1180 : 860;
    return { latency: latency + length * 4, promptTokens: 420 + length * 2, outputTokens: 168, cost: 0.0041, route: '模型网关 · 快速通道' };
  }
  if (type === 'b') {
    return { latency: 1420 + length * 3, promptTokens: 610 + length * 2, outputTokens: 96, cost: 0.0053, route: '模型网关 · 批量队列' };
  }
  return { latency: 1240 + length * 3, promptTokens: 540 + length * 2, outputTokens: 132, cost: 0.0047, route: '模型网关 · 会话通道' };
}

function getCoreEvaluation(agentId, agent) {
  const type = templateTypeOf(agentId, agent);
  if (!agent.prompt.trim()) {
    return {
      passed: false,
      passedCount: 0,
      total: 1,
      title: '配置完整性检查',
      detail: 'Agent 指令为空，无法运行样本评估。',
      checks: [['Agent 指令', '未通过', '请先在配置页填写任务与边界']],
    };
  }
  if (type === 'a') {
    return {
      passed: true,
      passedCount: agent.strategy === 'relevance' ? 11 : 10,
      total: 12,
      title: '穿搭相关性与笔记有效性',
      detail: agent.strategy === 'relevance' ? '场景相关性更高；模拟 p95 从 0.9 秒升至 1.2 秒，仍在预算内。' : '响应更快；部分复杂场景相关性低于场景优先策略。',
      checks: [
        ['场景匹配', '通过', agent.strategy === 'relevance' ? '11/12 · 细化雨天旅行场景' : '10/12 · 快速生成通用建议'],
        ['笔记 ID 有效', '通过', '演示索引均可返回笔记 ID'],
        ['响应预算', '通过', agent.strategy === 'relevance' ? '模拟 p95：1.2 秒' : '模拟 p95：0.9 秒'],
      ],
    };
  }
  if (type === 'b') {
    return {
      passed: agent.ruleEnabled,
      passedCount: agent.ruleEnabled ? 20 : 19,
      total: 20,
      title: '政策红线样本回归',
      detail: agent.ruleEnabled
        ? '演示红线样本全部通过，仍须政策负责人审批。'
        : '严重样本漏判 1 条，发布被阻断。请启用演示攻击性语言规则后重评。',
      checks: [
        ['输出格式', '通过', '类别、理由、规则版本齐全'],
        ['一般样本', '通过', '19 条演示样本通过'],
        ['严重样本', agent.ruleEnabled ? '通过' : '未通过', agent.ruleEnabled ? '人身攻击样本已识别' : '人身攻击样本未识别'],
      ],
    };
  }
  return {
    passed: agent.knowledgeVersion === 'K-02',
    passedCount: agent.knowledgeVersion === 'K-02' ? 8 : 7,
    total: 8,
    title: '售后知识与引用回归',
    detail: agent.knowledgeVersion === 'K-02'
      ? '换码条件已更新，演示样本均有有效引用或转人工提示。'
      : '换码案例缺少可引用的有效知识，发布被阻断。',
    checks: [
      ['多轮信息补齐', '通过', '先追问签收时间和商品状态'],
      ['知识引用', agent.knowledgeVersion === 'K-02' ? '通过' : '未通过', agent.knowledgeVersion === 'K-02' ? '引用 K-02' : '缺少换码条件'],
      ['未知问题兜底', '通过', '缺少依据时转人工'],
    ],
  };
}

export function getEvaluation(agentId, agent) {
  const core = getCoreEvaluation(agentId, agent);
  const result = { ...core, score: `${core.passedCount} / ${core.total}` };
  const type = templateTypeOf(agentId, agent);
  const sample = (input, expected, actual, passed, basis) => ({ input, expected, actual, passed, basis });
  if (!agent.prompt.trim()) return { ...result, sampleSetVersion: 'CFG-1', samples: [sample('当前 Agent 指令', '任务与边界不为空', '空指令', false, '配置完整性门槛')] };
  if (type === 'a') {
    const relevant = agent.strategy === 'relevance';
    return { ...result, sampleSetVersion: 'OUTFIT-2026.09', samples: [
      sample('上海雨天旅行穿搭', '兼顾雨天、步行和拍照', relevant ? '防水风衣＋直筒裤，贴合雨天拍照' : '防水外套＋长裤，快速生成通用建议', true, '场景匹配'),
      sample('关联社区同款笔记', '返回可用笔记 ID', relevant ? '#N-102、#N-208' : '#N-102', true, '演示笔记索引'),
      sample('高峰响应预算', 'p95 < 1.5 秒', relevant ? '模拟 p95 1.2 秒' : '模拟 p95 0.9 秒', true, '固定延迟预算'),
    ] };
  }
  if (type === 'b') return { ...result, sampleSetVersion: 'POLICY-2026.09', samples: [
    sample('这篇笔记很有帮助', '正常内容', '正常内容 · 无违规理由', true, '政策 P-2026.09'),
    sample('请文明讨论', '正常内容', '正常内容 · 无违规理由', true, '政策 P-2026.09'),
    sample('你这个人真蠢，别再发了。', '疑似人身攻击，交人工复核', agent.ruleEnabled ? '疑似人身攻击 · 侮辱性措辞 · 人工复核' : '未识别 · 缺少攻击性语言规则', agent.ruleEnabled, agent.ruleEnabled ? '攻击性语言演示规则 · P-2026.09' : '缺少攻击性语言规则；严重漏判'),
  ] };
  const known = agent.knowledgeVersion === 'K-02';
  return { ...result, sampleSetVersion: 'AFTERSALE-2026.09', samples: [
    sample('鞋子尺码不合适，能换吗？', '先补齐签收和商品状态', '追问签收时间、是否穿着', true, '多轮信息补齐'),
    sample('昨天签收，还没穿。', '有依据答复并引用；否则转人工', known ? '建议订单页申请换码 · 引用 K-02 换码条件' : '缺少可引用条件 · 转人工', known, known ? '售后知识 K-02 · 换码条件' : 'K-01 无换码条件'),
    sample('未收录的特殊售后政策', '不得编造，转人工', '转人工核实', true, '未知问题兜底'),
  ] };
}

/** The run before the newest one, used to show "上一次 19/20 → 本次 20/20". */
export function getEvaluationBaseline(agent) {
  const log = agent.evaluationLog ?? [];
  return log.length >= 2 ? log[log.length - 2] : null;
}

export function canPublish(agentId, agent) {
  return agent.evaluation === 'passed' && agent.evaluationFingerprint === fingerprint(agent)
    && (templateTypeOf(agentId, agent) !== 'b' || agent.approved);
}

/* ---------- 运行监控：实验读数与趋势 ---------- */

const EXPERIMENT = {
  dailyCalls: 1000000,
  minExposure: 20000,
  p95Budget: 1.5,
  base: { adopt: 0.680, click: 0.161, p95: 0.9 },
  speed: { adopt: 0.708, click: 0.176, p95: 0.9 },
  relevance: { adopt: 0.734, click: 0.192, p95: 1.2 },
};

/**
 * Proportion test on the simulated adoption rate, so "放量还是回退" rests on
 * sample size and a confidence interval rather than two bare numbers.
 */
export function getExperimentReadout(agent) {
  const traffic = agent.traffic ?? 0;
  const strategy = agent.liveConfig?.strategy === 'relevance' ? 'relevance' : 'speed';
  const variant = EXPERIMENT[strategy];
  const base = EXPERIMENT.base;
  const exposureNew = Math.round(EXPERIMENT.dailyCalls * traffic / 100);
  const exposureOld = EXPERIMENT.dailyCalls - exposureNew;
  const diff = variant.adopt - base.adopt;
  const se = exposureNew > 0 && exposureOld > 0
    ? Math.sqrt(variant.adopt * (1 - variant.adopt) / exposureNew + base.adopt * (1 - base.adopt) / exposureOld)
    : null;
  const z = se ? diff / se : null;
  const margin = se ? 1.96 * se : null;
  const enoughSample = exposureNew >= EXPERIMENT.minExposure;
  const significant = Boolean(z && enoughSample && Math.abs(z) >= 1.96);

  let recommendation;
  if (traffic === 0) recommendation = { tone: 'neutral', text: '新版本无流量，暂无可判断的线上效果。' };
  else if (traffic === 100) recommendation = { tone: 'good', text: '已全量，对照组已关闭；后续以版本间环比观察。' };
  else if (!enoughSample) recommendation = { tone: 'neutral', text: `曝光不足 ${EXPERIMENT.minExposure / 10000} 万，样本量不够，建议继续观察或小幅放量。` };
  else if (!significant) recommendation = { tone: 'neutral', text: '差异未达到 95% 置信水平，建议继续观察。' };
  else if (diff <= 0) recommendation = { tone: 'bad', text: '新版本显著劣于旧版本，建议立即回退。' };
  else if (traffic < 50) recommendation = { tone: 'good', text: '正向且显著，建议放量至 50% 继续验证。' };
  else recommendation = { tone: 'good', text: '正向且显著，建议全量。' };

  return {
    strategy, traffic, exposureNew, exposureOld,
    adoptNew: variant.adopt, adoptOld: base.adopt,
    clickNew: variant.click, clickOld: base.click,
    diffPt: diff * 100,
    ciLowPt: margin === null ? null : (diff - margin) * 100,
    ciHighPt: margin === null ? null : (diff + margin) * 100,
    z, significant, enoughSample,
    guardrail: {
      name: 'p95 响应时间',
      newValue: variant.p95, oldValue: base.p95, budget: EXPERIMENT.p95Budget,
      breached: variant.p95 > EXPERIMENT.p95Budget,
    },
    recommendation,
  };
}

/** Seven-day trend per scenario, so B and C stop borrowing A's curve. */
export function getMonitorSeries(agentId, agent) {
  const type = templateTypeOf(agentId, agent);
  if (type === 'a') {
    const relevance = agent.liveConfig?.strategy === 'relevance';
    return {
      label: '采纳率', unit: '%', min: 60, max: 80,
      currentName: `新版本 ${agent.liveVersion}`, baselineName: `旧版本 ${agent.previousVersion ?? '—'}`,
      current: relevance ? [70.1, 71.4, 72.0, 72.8, 73.1, 73.6, 73.4] : [68.9, 69.5, 70.1, 70.4, 70.9, 71.2, 70.8],
      baseline: [67.6, 68.1, 67.9, 68.3, 68.0, 68.2, 68.0],
    };
  }
  if (type === 'b') {
    return {
      label: '严重样本召回率', unit: '%', min: 90, max: 100,
      currentName: `当前版本 ${agent.liveVersion}`, baselineName: '目标线 99%',
      current: agent.liveRuleEnabled ? [99.1, 99.3, 99.5, 99.4, 99.6, 99.5, 99.7] : [94.6, 94.1, 95.0, 94.4, 94.8, 94.2, 94.7],
      baseline: [99, 99, 99, 99, 99, 99, 99],
    };
  }
  return {
    label: '有效知识引用率', unit: '%', min: 80, max: 100,
    currentName: `当前版本 ${agent.liveVersion}`, baselineName: '目标线 95%',
    current: agent.liveKnowledgeVersion === 'K-02' ? [97.2, 98.0, 98.6, 99.1, 99.4, 99.6, 100] : [87.1, 86.8, 87.5, 87.2, 87.9, 87.4, 87.5],
    baseline: [95, 95, 95, 95, 95, 95, 95],
  };
}

/* ---------- 平台能力地图（对应笔试第 1、2 题） ---------- */

export const SKELETON = [
  { id: 'identity', step: '01', name: '身份与准入', purpose: '解决“谁能建、建出来归谁、能用多少资源”。多团队共用平台的前提，也是“零启动成本”的入口。' },
  { id: 'config', step: '02', name: '配置与编排', purpose: '把“这个 Agent 是什么”沉淀成可版本化的配置——指令、模型、知识、规则、工具——而不是散落在各业务代码里。' },
  { id: 'debug', step: '03', name: '调试与试跑', purpose: '上线前看到真实输出。实时、批量、多轮三种形态共用同一套试跑入口，业务方不必自建。' },
  { id: 'evaluation', step: '04', name: '评估与质量门槛', purpose: '把“能不能上线”从主观判断变成可复现的门槛。三个团队差异最大，却最不能省——这是平台相对“各自搭”最大的增量价值。' },
  { id: 'release', step: '05', name: '发布与流量控制', purpose: '让上线和下线都变成一分钟内可完成的低风险操作：版本快照、灰度、放量、回退、审批留痕。' },
  { id: 'monitor', step: '06', name: '运行监控与追溯', purpose: '上线之后才真正开始的部分。业务指标、护栏指标、调用追溯、成本与配额，决定这个 Agent 能否持续迭代。' },
];

export const MODULES = [
  { layer: 'identity', name: 'Agent 注册与模板创建', phase: 'mvp', inDemo: true, reason: '“零启动成本”的落点。没有模板，业务方第一步就要问平台要文档。' },
  { layer: 'identity', name: '团队归属与基础权限', phase: 'mvp', inDemo: true, reason: '多团队共用的最低要求：知道每个 Agent 归谁、出事找谁。' },
  { layer: 'identity', name: '多租户资源隔离与 SLA 分级', phase: 'next', inDemo: false, reason: '一期三个团队量级可控，隔离可以先靠流程约束；租户变多后再做。' },
  { layer: 'config', name: '指令与提示词编辑', phase: 'mvp', inDemo: true, reason: '三个 Agent 的核心能力都在这里，不可省。' },
  { layer: 'config', name: '配置版本与草稿', phase: 'mvp', inDemo: true, reason: '没有版本就没有回退、没有追溯、没有 A/B。是整个骨架的地基。' },
  { layer: 'config', name: '知识与规则挂载（引用既有源）', phase: 'mvp', inDemo: true, reason: 'B 靠政策规则、C 靠售后知识，一期只做“引用 + 版本号”，不自建库。' },
  { layer: 'config', name: '统一模型网关与鉴权', phase: 'mvp', inDemo: true, reason: '业务方不该各自申请 key、各自接模型。这是“基建”二字最实的部分。' },
  { layer: 'config', name: '知识库自建与切片管理', phase: 'next', inDemo: false, reason: '一期引用现有知识源即可满足 C；自建库是另一个产品，不应拖慢一期。' },
  { layer: 'config', name: '工具 / MCP 注册中心与编排画布', phase: 'next', inDemo: false, reason: '三个需求都是单 Agent 单任务，多工具编排不是一期矛盾。' },
  { layer: 'debug', name: '在线调试（单条会话）', phase: 'mvp', inDemo: true, reason: '上线前唯一的自检手段，A 和 C 每周都要用。' },
  { layer: 'debug', name: '批量跑批调试', phase: 'mvp', inDemo: true, reason: 'B 是批量任务，单条对话无法反映它的真实形态。' },
  { layer: 'debug', name: '提示词多版本并排对比', phase: 'next', inDemo: false, reason: '一期靠切换预设＋重跑已能判断；并排对比是效率优化，不是能力缺口。' },
  { layer: 'evaluation', name: '评估样本集管理', phase: 'mvp', inDemo: true, reason: '没有固定样本集，“效果变好了”就无法被证明。' },
  { layer: 'evaluation', name: '离线评估与场景化门槛', phase: 'mvp', inDemo: true, reason: '三个团队门槛不同（相关性 / 红线召回 / 引用有效），但机制必须统一。' },
  { layer: 'evaluation', name: '不通过即阻断发布', phase: 'mvp', inDemo: true, reason: 'B 团队不可让步的一条。评估不阻断发布，等于没有评估。' },
  { layer: 'evaluation', name: '人工审批流（可配置开关）', phase: 'mvp', inDemo: true, reason: 'B 的政策场景必须签核；对 A、C 可关闭，用开关而不是分叉代码。' },
  { layer: 'evaluation', name: '评估结果版本间对比', phase: 'mvp', inDemo: true, reason: '“改完到底变好还是变坏”是每周迭代的必答题，成本很低。' },
  { layer: 'evaluation', name: '自动化回归与定时评估', phase: 'next', inDemo: false, reason: '一期手动触发已能卡住风险；定时回归是规模化之后的效率问题。' },
  { layer: 'evaluation', name: '评估集标注协作与众包', phase: 'next', inDemo: false, reason: '一期样本由业务方自己维护，协作平台投入大、收益滞后。' },
  { layer: 'release', name: '版本发布与配置快照', phase: 'mvp', inDemo: true, reason: '快照是可回溯的最小实现：事后能复原“当时到底跑的什么”。' },
  { layer: 'release', name: '灰度发布与流量调整', phase: 'mvp', inDemo: true, reason: 'A 团队每周上新都要灰度放量，缺了它一期对 A 不成立。' },
  { layer: 'release', name: '一键回退', phase: 'mvp', inDemo: true, reason: '出事时的止血阀。实现成本极低、价值极高，典型的必须进一期。' },
  { layer: 'release', name: '操作留痕与审批记录', phase: 'mvp', inDemo: true, reason: 'B 要求可回溯可回退，留痕是“可回溯”的载体。' },
  { layer: 'release', name: '定时发布与发布窗口管控', phase: 'next', inDemo: false, reason: '一期人工点发布即可；窗口管控是团队变多之后的协同问题。' },
  { layer: 'monitor', name: '基础运行监控（调用量 / 成功率 / 延迟）', phase: 'mvp', inDemo: true, reason: '上线后没有指标，等于把 Agent 扔进黑箱。' },
  { layer: 'monitor', name: '调用追溯（版本 + 配置 + 评估编号）', phase: 'mvp', inDemo: true, reason: 'B 的硬约束。追溯链断在哪一环，可回溯就不成立。' },
  { layer: 'monitor', name: '异常兜底：暂停 Agent、转人工', phase: 'mvp', inDemo: true, reason: 'B、C 的止血阀。政策或知识过期时，宁可不答也不能答错。' },
  { layer: 'monitor', name: '灰度效果对比与显著性判断', phase: 'mvp', inDemo: true, reason: 'A 团队“好则放量、差则回退”的决策依据。一期做简化版即可，但不能没有。' },
  { layer: 'monitor', name: '成本核算与配额治理', phase: 'next', inDemo: false, reason: '一期先让成本“可见”，强管控需要和财务口径对齐，放二期。' },
  { layer: 'monitor', name: '智能告警与自动回退', phase: 'next', inDemo: false, reason: '一期人工盯盘 + 手动回退已可止血；自动回退误触发的代价更高。' },
  { layer: 'monitor', name: '效果归因与长期留存分析', phase: 'next', inDemo: false, reason: '需要接入更长周期的数据体系，不是上线闭环的必要条件。' },
];

/* ---------- 状态迁移 ---------- */

export function transition(current, action) {
  if (action.type === 'reset') return createInitialState();
  const next = structuredClone(current);
  const agent = action.agentId ? next.agents[action.agentId] : null;
  const type = templateTypeOf(action.agentId, agent);

  switch (action.type) {
    case 'selectAgent':
      if (!agent) return current;
      next.selectedAgent = action.agentId;
      next.view = 'creation';
      next.notice = '';
      break;
    case 'navigate':
      next.view = action.view;
      next.notice = '';
      break;
    case 'chooseTemplate':
      if (!TEMPLATES[action.templateType]) return current;
      next.selectedTemplate = action.templateType;
      next.view = 'create';
      next.notice = '';
      break;
    case 'createAgent': {
      const name = String(action.name ?? '').trim();
      if (!TEMPLATES[action.templateType] || !name) {
        next.notice = '请先选择模板并填写 Agent 名称。';
        break;
      }
      const template = structuredClone(createInitialState().agents[action.templateType]);
      const id = `custom-${next.nextAgentNumber}`;
      next.nextAgentNumber += 1;
      Object.assign(template, {
        name,
        team: String(action.team ?? '').trim() || template.team,
        taskDescription: String(action.taskDescription ?? '').trim() || template.taskDescription,
        prompt: String(action.prompt ?? '').trim() || template.prompt,
        isExample: false, createdAt: new Date().toISOString(),
        liveVersion: null, draftVersion: 'v1.0', liveConfig: null,
        liveKnowledgeVersion: null, status: '草稿',
        debugInput: template.sampleInput, debugInputs: [],
        debugSystemPrompt: String(action.prompt ?? '').trim() || template.prompt,
        debugPromptPreset: 'current',
      });
      next.agents[id] = template;
      next.selectedAgent = id;
      next.selectedTemplate = null;
      next.view = 'manage';
      next.notice = `已创建 ${name}，可进入配置并沿生命周期继续。`;
      break;
    }
    case 'deleteAgent':
      if (!agent || agent.isExample) return current;
      delete next.agents[action.agentId];
      if (next.selectedAgent === action.agentId) next.selectedAgent = null;
      next.view = 'manage';
      next.notice = `已删除 ${agent.name}。示例 Agent 不可删除。`;
      break;
    case 'editPrompt': {
      if (!agent) return current;
      const prompt = String(action.prompt ?? '').trim();
      if (agent.prompt === prompt) {
        next.notice = '草稿内容无变化，未生成新版本。';
        break;
      }
      advanceDraftIfPublished(agent);
      agent.prompt = prompt;
      invalidate(agent);
      next.notice = '配置已保存，旧评估失效，请重新评估草稿。';
      break;
    }
    case 'setStrategy':
      if (type !== 'a' || !['speed', 'relevance'].includes(action.strategy) || agent.strategy === action.strategy) return current;
      advanceDraftIfPublished(agent);
      agent.strategy = action.strategy;
      invalidate(agent);
      next.notice = '推荐策略已更新；模拟回答和评估结果将随之变化。';
      break;
    case 'enableRule':
      if (type !== 'b' || agent.ruleEnabled) return current;
      advanceDraftIfPublished(agent);
      agent.ruleEnabled = true;
      invalidate(agent);
      next.notice = '演示规则已启用，旧评估失效，请重新评估。';
      break;
    case 'updateKnowledge':
      if (type !== 'c' || agent.knowledgeVersion === 'K-02') return current;
      advanceDraftIfPublished(agent);
      agent.knowledgeVersion = 'K-02';
      invalidate(agent);
      next.notice = '演示知识已更新为 K-02，旧评估失效。';
      break;
    case 'runDebug': {
      if (!agent) return current;
      const input = String(action.input ?? agent.debugInput ?? agent.sampleInput).trim();
      const systemPrompt = String(action.systemPrompt ?? agent.debugSystemPrompt ?? agent.prompt).trim();
      if (!input || !systemPrompt) {
        next.notice = '请输入本轮内容和系统提示词。';
        break;
      }
      if (type === 'c' && agent.debugStep >= 2) {
        agent.debugStep = 0;
        agent.debugHistory = [];
        agent.debugInputs = [];
      }
      agent.debugStep = type === 'c' ? Math.min(agent.debugStep + 1, 2) : 1;
      agent.debugOutput = getSampleResponse(action.agentId, agent, agent.debugStep, input, systemPrompt);
      if (type !== 'c') { agent.debugHistory = []; agent.debugInputs = []; }
      agent.debugHistory.push(agent.debugOutput);
      agent.debugInputs.push(input);
      agent.debugSystemPrompt = systemPrompt;
      agent.debugPromptPreset = action.preset ?? 'custom';
      agent.debugInput = type === 'c' ? (agent.debugStep === 1 ? '昨天签收，还没穿。' : agent.sampleInput) : input;
      next.notice = '已生成模拟回答。';
      break;
    }
    case 'resetDebug':
      if (!agent) return current;
      agent.debugStep = 0;
      agent.debugOutput = '';
      agent.debugHistory = [];
      agent.debugInputs = [];
      agent.debugInput = agent.sampleInput;
      agent.debugSystemPrompt = agent.prompt;
      agent.debugPromptPreset = 'current';
      next.notice = '';
      break;
    case 'evaluate': {
      if (!agent) return current;
      const result = getEvaluation(action.agentId, agent);
      agent.evaluation = result.passed ? 'passed' : 'failed';
      agent.evaluationFingerprint = fingerprint(agent);
      agent.evaluationRunId = `E-${String(next.nextEvalNumber).padStart(4, '0')}`;
      agent.evaluationAt = new Date().toISOString();
      next.nextEvalNumber += 1;
      agent.approved = false;
      agent.approvalPerson = null;
      agent.approvedAt = null;
      agent.evaluationLog = [...(agent.evaluationLog ?? []), {
        runId: agent.evaluationRunId, at: agent.evaluationAt, passed: result.passed,
        passedCount: result.passedCount, total: result.total, score: result.score,
        version: agent.draftVersion, sampleSetVersion: result.sampleSetVersion,
      }];
      next.notice = agent.evaluation === 'passed' ? '评估通过，可以进入发布检查。' : '评估未通过，发布已阻断。';
      break;
    }
    case 'approve':
      if (type !== 'b' || agent.evaluation !== 'passed' || agent.evaluationFingerprint !== fingerprint(agent)) return current;
      agent.approved = true;
      agent.approvalPerson = '社区生态政策负责人（模拟）';
      agent.approvedAt = new Date().toISOString();
      next.notice = '模拟政策负责人审批已完成。';
      break;
    case 'publish': {
      const releaseTraffic = type === 'a' ? Number(action.traffic ?? 10) : null;
      const invalidTraffic = type === 'a'
        && (!Number.isInteger(releaseTraffic) || releaseTraffic < 1 || releaseTraffic > 100);
      if (!agent || !canPublish(action.agentId, agent) || agent.liveVersion === agent.draftVersion) {
        next.notice = '发布条件未满足，请先完成评估和必要审批。';
        break;
      }
      if (invalidTraffic) {
        next.notice = '首次发布请选择 1% 至 100% 的流量。';
        break;
      }
      agent.previousVersion = agent.liveVersion;
      agent.previousConfig = agent.liveConfig;
      agent.previousEvaluationRunId = agent.liveEvaluationRunId;
      agent.liveVersion = agent.draftVersion;
      agent.liveConfig = configSnapshot(agent);
      agent.liveEvaluationRunId = agent.evaluationRunId;
      agent.rolledBack = (agent.rolledBack ?? []).filter(item => item.version !== agent.liveVersion);
      if (type === 'b') agent.liveRuleEnabled = agent.ruleEnabled;
      if (type === 'c') agent.liveKnowledgeVersion = agent.knowledgeVersion;
      agent.status = type === 'a' ? (releaseTraffic === 100 ? '全量运行' : '灰度中') : '运行中';
      if (type === 'a') agent.traffic = releaseTraffic;
      record(agent, '发布', type === 'a' ? `发布至 ${releaseTraffic}% 模拟流量` : '切换生产版本');
      next.notice = type === 'a' ? `${agent.liveVersion} 已发布到 ${releaseTraffic}% 模拟流量。` : `${agent.liveVersion} 已发布，记录已保存。`;
      break;
    }
    case 'setTraffic':
      if (type !== 'a' || !agent.liveVersion || !Number.isInteger(action.traffic) || action.traffic < 0 || action.traffic > 100) return current;
      if (agent.traffic === action.traffic) return current;
      agent.traffic = action.traffic;
      if (action.traffic === 100) {
        agent.status = '全量运行';
        record(agent, '全量', '新版本承接 100% 模拟流量，对照组关闭');
        next.notice = `${agent.liveVersion} 已全量承接流量，灰度对比结束。`;
      } else {
        agent.status = action.traffic === 0 ? '稳定版本' : '灰度中';
        record(agent, '放量', `新版本模拟流量 ${action.traffic}%`);
        next.notice = action.traffic === 0 ? '新版本流量已降至 0%，由稳定版本承接。' : `新版本流量已调整为 ${action.traffic}%。`;
      }
      break;
    case 'rollback': {
      if (type !== 'a' || !agent.previousVersion) return current;
      const rolledBackVersion = agent.liveVersion;
      const rolledBackEvaluationRunId = agent.liveEvaluationRunId;
      agent.liveVersion = agent.previousVersion;
      agent.liveConfig = agent.previousConfig;
      agent.liveEvaluationRunId = agent.previousEvaluationRunId;
      agent.previousVersion = null;
      agent.previousConfig = null;
      agent.previousEvaluationRunId = null;
      agent.traffic = 0;
      agent.status = '已回退';
      // A rolled-back version must not go back out untouched: force a fresh evaluation.
      agent.rolledBack = [...(agent.rolledBack ?? []), { version: rolledBackVersion, at: new Date().toISOString(), evaluationRunId: rolledBackEvaluationRunId }];
      invalidateEvaluation(agent);
      record(agent, '回退', `模拟流量已切回 ${agent.liveVersion}`, rolledBackEvaluationRunId);
      next.notice = `已将演示流量切回 ${agent.liveVersion}；${rolledBackVersion} 的评估已失效，重新发布前需重新评估。`;
      break;
    }
    case 'pause':
      if (!agent || type === 'a' || !agent.liveVersion || agent.status === '人工兜底') return current;
      agent.status = '人工兜底';
      record(agent, '转人工', 'Agent 建议暂停，业务转人工处理');
      next.notice = 'Agent 建议已暂停，业务转人工处理。';
      break;
    case 'resume':
      if (!agent || type === 'a' || agent.status !== '人工兜底') return current;
      agent.status = '运行中';
      record(agent, '恢复', `解除人工兜底，${agent.liveVersion} 重新接管`);
      next.notice = `${agent.liveVersion} 已恢复接管，处置记录已保存。`;
      break;
    default:
      return current;
  }
  return next;
}
