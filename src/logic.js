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

function invalidate(agent) {
  agent.evaluation = agent.evaluation === 'idle' ? 'idle' : 'stale';
  agent.evaluationFingerprint = null;
  agent.approved = false;
  agent.approvalPerson = null;
  agent.approvedAt = null;
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
      liveEvaluationRunId: null, previousEvaluationRunId: null,
      approvalPerson: null, approvedAt: null,
      releaseHistory: [], previousConfig: null,
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

function getCoreEvaluation(agentId, agent) {
  const type = templateTypeOf(agentId, agent);
  if (!agent.prompt.trim()) {
    return {
      passed: false,
      score: '0 / 1',
      title: '配置完整性检查',
      detail: 'Agent 指令为空，无法运行样本评估。',
      checks: [['Agent 指令', '未通过', '请先在配置页填写任务与边界']],
    };
  }
  if (type === 'a') {
    return {
      passed: true,
      score: agent.strategy === 'relevance' ? '11 / 12' : '10 / 12',
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
      score: agent.ruleEnabled ? '20 / 20' : '19 / 20',
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
    score: agent.knowledgeVersion === 'K-02' ? '8 / 8' : '7 / 8',
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
  const result = getCoreEvaluation(agentId, agent);
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

export function canPublish(agentId, agent) {
  return agent.evaluation === 'passed' && agent.evaluationFingerprint === fingerprint(agent)
    && (templateTypeOf(agentId, agent) !== 'b' || agent.approved);
}

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
    case 'editPrompt':
      if (!agent) return current;
      if (agent.prompt === String(action.prompt ?? '').trim()) return current;
      advanceDraftIfPublished(agent);
      agent.prompt = String(action.prompt ?? '').trim();
      invalidate(agent);
      next.notice = '配置已保存，旧评估失效，请重新评估草稿。';
      break;
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
    case 'runDebug':
      if (!agent) return current;
      {
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
    case 'evaluate':
      if (!agent) return current;
      agent.evaluation = getEvaluation(action.agentId, agent).passed ? 'passed' : 'failed';
      agent.evaluationFingerprint = fingerprint(agent);
      agent.evaluationRunId = `E-${String(next.nextEvalNumber).padStart(4, '0')}`;
      agent.evaluationAt = new Date().toISOString();
      next.nextEvalNumber += 1;
      agent.approved = false;
      agent.approvalPerson = null;
      agent.approvedAt = null;
      next.notice = agent.evaluation === 'passed' ? '评估通过，可以进入发布检查。' : '评估未通过，发布已阻断。';
      break;
    case 'approve':
      if (type !== 'b' || agent.evaluation !== 'passed' || agent.evaluationFingerprint !== fingerprint(agent)) return current;
      agent.approved = true;
      agent.approvalPerson = '社区生态政策负责人（模拟）';
      agent.approvedAt = new Date().toISOString();
      next.notice = '模拟政策负责人审批已完成。';
      break;
    case 'publish':
      if (!agent || !canPublish(action.agentId, agent) || agent.liveVersion === agent.draftVersion) {
        next.notice = '发布条件未满足，请先完成评估和必要审批。';
        break;
      }
      agent.previousVersion = agent.liveVersion;
      agent.previousConfig = agent.liveConfig;
      agent.previousEvaluationRunId = agent.liveEvaluationRunId;
      agent.liveVersion = agent.draftVersion;
      agent.liveConfig = configSnapshot(agent);
      agent.liveEvaluationRunId = agent.evaluationRunId;
      if (type === 'b') agent.liveRuleEnabled = agent.ruleEnabled;
      if (type === 'c') agent.liveKnowledgeVersion = agent.knowledgeVersion;
      agent.status = type === 'a' ? '灰度中' : '运行中';
      if (type === 'a') agent.traffic = 10;
      record(agent, '发布', type === 'a' ? '发布至 10% 模拟流量' : '切换生产版本');
      next.notice = type === 'a' ? `${agent.liveVersion} 已发布到 10% 模拟流量。` : `${agent.liveVersion} 已发布，记录已保存。`;
      break;
    case 'setTraffic':
      if (type !== 'a' || !agent.liveVersion || !Number.isInteger(action.traffic) || action.traffic < 0 || action.traffic > 100) return current;
      if (agent.traffic === action.traffic) return current;
      agent.traffic = action.traffic;
      agent.status = action.traffic === 100 ? '运行中' : action.traffic === 0 ? '稳定版本' : '灰度中';
      record(agent, '放量', `新版本模拟流量 ${action.traffic}%`);
      next.notice = action.traffic === 0 ? '新版本流量已降至 0%，由稳定版本承接。' : `新版本流量已调整为 ${action.traffic}%。`;
      break;
    case 'rollback':
      if (type !== 'a' || !agent.previousVersion) return current;
      {
      const rolledBackEvaluationRunId = agent.liveEvaluationRunId;
      agent.liveVersion = agent.previousVersion;
      agent.liveConfig = agent.previousConfig;
      agent.liveEvaluationRunId = agent.previousEvaluationRunId;
      agent.previousVersion = null;
      agent.previousConfig = null;
      agent.previousEvaluationRunId = null;
      agent.traffic = 0;
      agent.status = '已回退';
      record(agent, '回退', `模拟流量已切回 ${agent.liveVersion}`, rolledBackEvaluationRunId);
      next.notice = `已将演示流量切回 ${agent.liveVersion}，回退记录已保存。`;
      break;
      }
    case 'pause':
      if (!agent || type === 'a' || !agent.liveVersion || agent.status === '人工兜底') return current;
      agent.status = '人工兜底';
      record(agent, '转人工', 'Agent 建议暂停，业务转人工处理');
      next.notice = 'Agent 建议已暂停，业务转人工处理。';
      break;
    default:
      return current;
  }
  return next;
}
