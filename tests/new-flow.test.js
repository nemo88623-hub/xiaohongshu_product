import test from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../src/logic.js';

const { createInitialState, transition, getEvaluation, getSampleResponse, canPublish, restoreState } = logic;

function createB() {
  return transition(createInitialState(), {
    type: 'createAgent', templateType: 'b', name: '新生态守护',
    team: '生态测试组', taskDescription: '协助人工审核评论',
    prompt: '识别风险并输出类别、理由和规则依据。',
  });
}

test('creates a usable template agent and restores it after JSON persistence', () => {
  const state = createB();
  const id = state.selectedAgent;
  assert.ok(id && !['a', 'b', 'c'].includes(id));
  assert.equal(state.agents[id].templateType, 'b');
  assert.equal(state.agents[id].name, '新生态守护');
  assert.equal(state.agents[id].liveVersion, null);
  assert.equal(state.agents[id].draftVersion, 'v1.0');
  const restored = restoreState(JSON.stringify(state));
  assert.equal(restored.agents[id].team, '生态测试组');
  assert.equal(restored.agents[id].templateType, 'b');
  assert.equal(transition(restored, { type: 'reset' }).agents[id], undefined);
});

test('a created B uses the B sample gate and needs approval to publish', () => {
  let state = createB();
  const id = state.selectedAgent;
  assert.match(getSampleResponse(id, state.agents[id]), /未识别/);
  state = transition(state, { type: 'evaluate', agentId: id });
  assert.equal(state.agents[id].evaluation, 'failed');
  assert.equal(getEvaluation(id, state.agents[id]).samples.find(x => !x.passed).input, '你这个人真蠢，别再发了。');
  state = transition(state, { type: 'publish', agentId: id });
  assert.equal(state.agents[id].liveVersion, null);
  state = transition(state, { type: 'enableRule', agentId: id });
  assert.equal(state.agents[id].evaluation, 'stale');
  state = transition(state, { type: 'evaluate', agentId: id });
  assert.equal(state.agents[id].evaluation, 'passed');
  assert.equal(canPublish(id, state.agents[id]), false);
  state = transition(state, { type: 'approve', agentId: id });
  assert.equal(canPublish(id, state.agents[id]), true);
  state = transition(state, { type: 'publish', agentId: id });
  assert.equal(state.agents[id].liveVersion, 'v1.0');
  assert.equal(state.agents[id].releaseHistory.at(-1).action, '发布');
  assert.ok(state.agents[id].releaseHistory.at(-1).evaluationRunId);
});

test('A strategy changes debug response and evaluation, then invalidates old result', () => {
  let state = createInitialState();
  const before = getSampleResponse('a', state.agents.a);
  const oldScore = getEvaluation('a', state.agents.a).score;
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'setStrategy', agentId: 'a', strategy: 'relevance' });
  assert.equal(state.agents.a.evaluation, 'stale');
  assert.notEqual(getSampleResponse('a', state.agents.a), before);
  assert.notEqual(getEvaluation('a', state.agents.a).score, oldScore);
  assert.equal(canPublish('a', state.agents.a), false);
});

test('release and rollback records reflect the active A version', () => {
  let state = createInitialState();
  state = transition(state, { type: 'setStrategy', agentId: 'a', strategy: 'relevance' });
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'publish', agentId: 'a' });
  assert.equal(state.agents.a.liveConfig.strategy, 'relevance');
  assert.equal(state.agents.a.releaseHistory.at(-1).action, '发布');
  state = transition(state, { type: 'setTraffic', agentId: 'a', traffic: 50 });
  assert.equal(state.agents.a.releaseHistory.at(-1).action, '放量');
  state = transition(state, { type: 'rollback', agentId: 'a' });
  assert.equal(state.agents.a.liveVersion, 'v1.0');
  assert.equal(state.agents.a.releaseHistory.at(-1).action, '回退');
});

test('A publishes the evaluated draft at the selected initial gray percentage', () => {
  let state = createInitialState();
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'publish', agentId: 'a', traffic: 37 });
  assert.equal(state.agents.a.liveVersion, 'v1.1');
  assert.equal(state.agents.a.traffic, 37);
  assert.equal(state.agents.a.status, '灰度中');
  assert.match(state.agents.a.releaseHistory.at(-1).detail, /37%/);
});

test('traffic adjustments keep the live version while a new configuration advances it', () => {
  let state = createInitialState();
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'publish', agentId: 'a', traffic: 25 });
  state = transition(state, { type: 'setTraffic', agentId: 'a', traffic: 68 });
  assert.equal(state.agents.a.liveVersion, 'v1.1');
  assert.equal(state.agents.a.traffic, 68);
  assert.equal(state.agents.a.releaseHistory.at(-1).version, 'v1.1');

  state = transition(state, { type: 'editPrompt', agentId: 'a', prompt: '适配更多雨天旅行场景' });
  assert.equal(state.agents.a.draftVersion, 'v1.2');
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'publish', agentId: 'a', traffic: 42 });
  assert.equal(state.agents.a.liveVersion, 'v1.2');
  assert.equal(state.agents.a.traffic, 42);
});

test('A refuses an initial publication with zero gray traffic', () => {
  let state = createInitialState();
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'publish', agentId: 'a', traffic: 0 });
  assert.equal(state.agents.a.liveVersion, 'v1.0');
  assert.equal(state.agents.a.releaseHistory.length, 0);
});

test('new agent requires a nonblank name and template', () => {
  const initial = createInitialState();
  assert.deepEqual(transition(initial, { type: 'createAgent', templateType: 'b', name: ' ' }).agents, initial.agents);
  assert.deepEqual(transition(initial, { type: 'createAgent', templateType: 'other', name: 'X' }).agents, initial.agents);
});

test('an unpublished B cannot enter production incident mode', () => {
  const created = createB();
  const id = created.selectedAgent;
  const after = transition(created, { type: 'pause', agentId: id });
  assert.equal(after.agents[id].status, '草稿');
  assert.equal(after.agents[id].releaseHistory.length, 0);
});

test('created A and C inherit their own template evaluations', () => {
  let a = transition(createInitialState(), { type: 'createAgent', templateType: 'a', name: '新穿搭' });
  const aId = a.selectedAgent;
  assert.match(getSampleResponse(aId, a.agents[aId]), /笔记/);
  assert.equal(getEvaluation(aId, a.agents[aId]).sampleSetVersion, 'OUTFIT-2026.09');
  let c = transition(createInitialState(), { type: 'createAgent', templateType: 'c', name: '新售后' });
  const cId = c.selectedAgent;
  assert.equal(getEvaluation(cId, c.agents[cId]).passed, false);
  c = transition(c, { type: 'updateKnowledge', agentId: cId });
  assert.equal(getEvaluation(cId, c.agents[cId]).passed, true);
  assert.match(getSampleResponse(cId, c.agents[cId], 2), /引用来源：K-02/);
});

test('operations remain linked to the released evaluation after a newer draft is evaluated', () => {
  let state = createInitialState();
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'publish', agentId: 'a' });
  const publishedRun = state.agents.a.evaluationRunId;
  const publishedSnapshot = state.agents.a.releaseHistory.at(-1).snapshot;
  assert.equal(publishedSnapshot.prompt, state.agents.a.prompt);
  state = transition(state, { type: 'editPrompt', agentId: 'a', prompt: '下一版草稿' });
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'rollback', agentId: 'a' });
  assert.equal(state.agents.a.releaseHistory.at(-1).evaluationRunId, publishedRun);
  assert.equal(state.agents.a.releaseHistory[0].snapshot.prompt, publishedSnapshot.prompt);

  let b = createInitialState();
  b = transition(b, { type: 'enableRule', agentId: 'b' });
  b = transition(b, { type: 'evaluate', agentId: 'b' });
  b = transition(b, { type: 'approve', agentId: 'b' });
  b = transition(b, { type: 'publish', agentId: 'b' });
  const bPublishedRun = b.agents.b.evaluationRunId;
  b = transition(b, { type: 'editPrompt', agentId: 'b', prompt: '下一版政策草稿' });
  b = transition(b, { type: 'evaluate', agentId: 'b' });
  b = transition(b, { type: 'pause', agentId: 'b' });
  assert.equal(b.agents.b.releaseHistory.at(-1).evaluationRunId, bPublishedRun);
});

test('first publication of a created A can expand traffic without an imaginary old version', () => {
  let state = transition(createInitialState(), { type: 'createAgent', templateType: 'a', name: '新穿搭' });
  const id = state.selectedAgent;
  state = transition(state, { type: 'evaluate', agentId: id });
  state = transition(state, { type: 'publish', agentId: id });
  assert.equal(state.agents[id].previousVersion, null);
  assert.equal(logic.getMonitorMode(id, state.agents[id]), 'gray-first');
  state = transition(state, { type: 'setTraffic', agentId: id, traffic: 50 });
  assert.equal(state.agents[id].traffic, 50);
  state = transition(state, { type: 'rollback', agentId: id });
  assert.equal(state.agents[id].liveVersion, 'v1.0');
});

test('paused B monitor no longer reports active online operation', () => {
  let state = createInitialState();
  assert.equal(logic.getMonitorMode('b', state.agents.b), 'live');
  state = transition(state, { type: 'pause', agentId: 'b' });
  assert.equal(logic.getMonitorMode('b', state.agents.b), 'paused');
});
