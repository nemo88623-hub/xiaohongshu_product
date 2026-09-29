import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, transition, canPublish, getMonitorMode,
  getExperimentReadout, getMonitorSeries, getEvaluationBaseline, MODULES, SKELETON,
} from '../src/logic.js';

const run = (state, ...actions) => actions.reduce((acc, action) => transition(acc, action), state);

function publishedA() {
  return run(createInitialState(),
    { type: 'evaluate', agentId: 'a' },
    { type: 'publish', agentId: 'a' });
}

function publishedC() {
  return run(createInitialState(),
    { type: 'updateKnowledge', agentId: 'c' },
    { type: 'evaluate', agentId: 'c' },
    { type: 'publish', agentId: 'c' });
}

test('a paused agent can be handed back to the Agent instead of dead-ending', () => {
  const paused = run(publishedC(), { type: 'pause', agentId: 'c' });
  assert.equal(paused.agents.c.status, '人工兜底');
  assert.equal(getMonitorMode('c', paused.agents.c), 'paused');

  const resumed = transition(paused, { type: 'resume', agentId: 'c' });
  assert.equal(resumed.agents.c.status, '运行中');
  assert.equal(getMonitorMode('c', resumed.agents.c), 'live');
  assert.equal(resumed.agents.c.releaseHistory.at(-1).action, '恢复');
});

test('resume only applies to a paused non-gray agent', () => {
  const live = publishedC();
  assert.equal(transition(live, { type: 'resume', agentId: 'c' }), live, '未暂停时恢复应无操作');

  const grayA = publishedA();
  assert.equal(transition(grayA, { type: 'resume', agentId: 'a' }), grayA, 'A 用回退而不是恢复');
});

test('rolling back invalidates the evaluation so the same version cannot go straight back out', () => {
  const rolled = run(publishedA(), { type: 'rollback', agentId: 'a' });
  const agent = rolled.agents.a;

  assert.equal(agent.liveVersion, 'v1.0');
  assert.equal(agent.evaluation, 'stale');
  assert.equal(agent.evaluationRunId, null);
  assert.equal(canPublish('a', agent), false, '回退后必须重新评估才能再次发布');

  const blocked = transition(rolled, { type: 'publish', agentId: 'a' });
  assert.equal(blocked.agents.a.liveVersion, 'v1.0');

  const reEvaluated = run(rolled, { type: 'evaluate', agentId: 'a' }, { type: 'publish', agentId: 'a' });
  assert.equal(reEvaluated.agents.a.liveVersion, 'v1.1', '重新评估后仍可发布');
});

test('a rolled back version is flagged until it is published again', () => {
  const rolled = run(publishedA(), { type: 'rollback', agentId: 'a' });
  assert.deepEqual(rolled.agents.a.rolledBack.map(item => item.version), ['v1.1']);

  const republished = run(rolled, { type: 'evaluate', agentId: 'a' }, { type: 'publish', agentId: 'a' });
  assert.deepEqual(republished.agents.a.rolledBack, [], '重新发布后警示应清除');
});

test('full traffic ends the gray comparison instead of claiming a 100% gray release', () => {
  const gray = publishedA();
  assert.equal(getMonitorMode('a', gray.agents.a), 'gray-compare');

  const full = transition(gray, { type: 'setTraffic', agentId: 'a', traffic: 100 });
  assert.equal(full.agents.a.status, '全量运行');
  assert.equal(getMonitorMode('a', full.agents.a), 'full');
  assert.equal(full.agents.a.releaseHistory.at(-1).action, '全量');

  const readout = getExperimentReadout(full.agents.a);
  assert.equal(readout.exposureOld, 0);
  assert.equal(readout.ciLowPt, null, '没有对照组就不该给出置信区间');
});

test('the gray readout gates放量 on sample size and significance', () => {
  const gray = publishedA();

  const tiny = transition(gray, { type: 'setTraffic', agentId: 'a', traffic: 1 });
  const tinyRead = getExperimentReadout(tiny.agents.a);
  assert.equal(tinyRead.enoughSample, false);
  assert.equal(tinyRead.significant, false);
  assert.match(tinyRead.recommendation.text, /样本量不够/);

  const tenRead = getExperimentReadout(gray.agents.a);
  assert.equal(tenRead.exposureNew, 100000);
  assert.equal(tenRead.significant, true);
  assert.ok(tenRead.ciLowPt > 0 && tenRead.ciHighPt > tenRead.ciLowPt);
  assert.match(tenRead.recommendation.text, /放量至 50%/);

  const half = transition(gray, { type: 'setTraffic', agentId: 'a', traffic: 50 });
  assert.match(getExperimentReadout(half.agents.a).recommendation.text, /全量/);
});

test('the readout follows the released strategy, not the draft', () => {
  const gray = publishedA();
  const draftChanged = transition(gray, { type: 'setStrategy', agentId: 'a', strategy: 'relevance' });

  assert.equal(getExperimentReadout(draftChanged.agents.a).strategy, 'speed', '线上读数只反映已发布配置');
  assert.equal(draftChanged.agents.a.strategy, 'relevance');
});

test('each scenario gets its own trend series', () => {
  const a = getMonitorSeries('a', publishedA().agents.a);
  const c = getMonitorSeries('c', publishedC().agents.c);
  const b = getMonitorSeries('b', createInitialState().agents.b);

  assert.equal(a.label, '采纳率');
  assert.equal(b.label, '严重样本召回率');
  assert.equal(c.label, '有效知识引用率');
  assert.notDeepEqual(a.current, b.current);
  assert.notDeepEqual(b.current, c.current);
  for (const series of [a, b, c]) {
    assert.equal(series.current.length, 7);
    assert.equal(series.baseline.length, 7);
    assert.ok(series.current.every(value => value >= series.min && value <= series.max));
  }
});

test('B trend reflects the released rule, not the draft toggle', () => {
  const draftOnly = transition(createInitialState(), { type: 'enableRule', agentId: 'b' });
  const before = getMonitorSeries('b', draftOnly.agents.b);
  assert.ok(before.current.every(value => value < 96), '草稿开关不应改变线上召回');

  const released = run(draftOnly,
    { type: 'evaluate', agentId: 'b' },
    { type: 'approve', agentId: 'b' },
    { type: 'publish', agentId: 'b' });
  assert.ok(getMonitorSeries('b', released.agents.b).current.every(value => value > 99));
});

test('evaluation runs are logged so a rerun can be compared with the previous one', () => {
  const first = transition(createInitialState(), { type: 'evaluate', agentId: 'b' });
  assert.equal(first.agents.b.evaluationLog.length, 1);
  assert.equal(getEvaluationBaseline(first.agents.b), null, '首次评估没有基线');

  const second = run(first, { type: 'enableRule', agentId: 'b' }, { type: 'evaluate', agentId: 'b' });
  const log = second.agents.b.evaluationLog;
  assert.equal(log.length, 2);
  assert.deepEqual([log[0].passedCount, log[1].passedCount], [19, 20]);
  assert.equal(getEvaluationBaseline(second.agents.b).runId, log[0].runId);
});

test('an invalidated evaluation stops advertising its old run id', () => {
  const evaluated = transition(createInitialState(), { type: 'evaluate', agentId: 'c' });
  assert.equal(evaluated.agents.c.evaluationRunId, 'E-0001');

  const changed = transition(evaluated, { type: 'updateKnowledge', agentId: 'c' });
  assert.equal(changed.agents.c.evaluation, 'stale');
  assert.equal(changed.agents.c.evaluationRunId, null);
  assert.equal(changed.agents.c.evaluationLog.length, 1, '历史记录保留，用于对比');
});

test('self-built agents can be deleted, examples cannot', () => {
  const created = transition(createInitialState(), { type: 'createAgent', templateType: 'b', name: '评论初筛' });
  const id = Object.keys(created.agents).find(key => key.startsWith('custom-'));
  assert.ok(id);

  const deleted = transition(created, { type: 'deleteAgent', agentId: id });
  assert.equal(deleted.agents[id], undefined);
  assert.equal(deleted.selectedAgent, null);
  assert.equal(deleted.view, 'manage');

  const keepExample = transition(createInitialState(), { type: 'deleteAgent', agentId: 'b' });
  assert.ok(keepExample.agents.b, '示例 Agent 不可删除');
});

test('saving an unchanged draft reports back instead of silently doing nothing', () => {
  const state = createInitialState();
  const same = transition(state, { type: 'editPrompt', agentId: 'a', prompt: state.agents.a.prompt });

  assert.equal(same.agents.a.draftVersion, 'v1.1', '内容没变就不该产生新版本');
  assert.equal(same.agents.a.evaluation, 'idle');
  assert.match(same.notice, /无变化/);
});

test('the module map covers every skeleton layer and splits both phases', () => {
  const layers = new Set(MODULES.map(item => item.layer));
  for (const layer of SKELETON) assert.ok(layers.has(layer.id), `${layer.id} 缺少模块`);

  const mvp = MODULES.filter(item => item.phase === 'mvp');
  const next = MODULES.filter(item => item.phase === 'next');
  assert.ok(mvp.length > 0 && next.length > 0);
  assert.ok(MODULES.every(item => item.reason.trim().length > 0), '每个模块都要有划分理由');
  assert.ok(next.every(item => item.inDemo === false), '二期模块不应标为 Demo 已走通');
});
