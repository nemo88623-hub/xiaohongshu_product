import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, transition, getSampleResponse, getEvaluation } from '../src/logic.js';

test('A must pass evaluation before gray release, then can roll back', () => {
  let state = createInitialState();
  state = transition(state, { type: 'publish', agentId: 'a' });
  assert.equal(state.agents.a.liveVersion, 'v1.0');
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  assert.equal(state.agents.a.evaluation, 'passed');
  state = transition(state, { type: 'publish', agentId: 'a' });
  assert.equal(state.agents.a.liveVersion, 'v1.1');
  assert.equal(state.agents.a.traffic, 10);
  state = transition(state, { type: 'setTraffic', agentId: 'a', traffic: 50 });
  assert.equal(state.agents.a.traffic, 50);
  state = transition(state, { type: 'rollback', agentId: 'a' });
  assert.equal(state.agents.a.liveVersion, 'v1.0');
  assert.equal(state.agents.a.traffic, 0);
});

test('B failed gate blocks release; rule and human approval unlock it', () => {
  let state = createInitialState();
  state = transition(state, { type: 'evaluate', agentId: 'b' });
  assert.equal(state.agents.b.evaluation, 'failed');
  state = transition(state, { type: 'publish', agentId: 'b' });
  assert.equal(state.agents.b.liveVersion, 'v1.0');
  state = transition(state, { type: 'enableRule', agentId: 'b' });
  assert.equal(state.agents.b.evaluation, 'stale');
  state = transition(state, { type: 'evaluate', agentId: 'b' });
  assert.equal(state.agents.b.evaluation, 'passed');
  state = transition(state, { type: 'publish', agentId: 'b' });
  assert.equal(state.agents.b.liveVersion, 'v1.0');
  state = transition(state, { type: 'approve', agentId: 'b' });
  state = transition(state, { type: 'publish', agentId: 'b' });
  assert.equal(state.agents.b.liveVersion, 'v1.1');
});

test('C knowledge update enables grounded answer and release', () => {
  let state = createInitialState();
  assert.match(getSampleResponse('c', state.agents.c, 2), /转人工/);
  state = transition(state, { type: 'updateKnowledge', agentId: 'c' });
  assert.equal(state.agents.c.knowledgeVersion, 'K-02');
  assert.match(getSampleResponse('c', state.agents.c, 2), /K-02/);
  state = transition(state, { type: 'evaluate', agentId: 'c' });
  assert.equal(state.agents.c.evaluation, 'passed');
  state = transition(state, { type: 'publish', agentId: 'c' });
  assert.equal(state.agents.c.liveVersion, 'v1.1');
});

test('draft rule and knowledge changes do not alter live deployment', () => {
  let state = createInitialState();
  state = transition(state, { type: 'enableRule', agentId: 'b' });
  state = transition(state, { type: 'updateKnowledge', agentId: 'c' });
  assert.equal(state.agents.b.liveRuleEnabled, false);
  assert.equal(state.agents.c.liveKnowledgeVersion, 'K-01');
  state = transition(state, { type: 'evaluate', agentId: 'b' });
  state = transition(state, { type: 'approve', agentId: 'b' });
  state = transition(state, { type: 'publish', agentId: 'b' });
  state = transition(state, { type: 'evaluate', agentId: 'c' });
  state = transition(state, { type: 'publish', agentId: 'c' });
  assert.equal(state.agents.b.liveRuleEnabled, true);
  assert.equal(state.agents.c.liveKnowledgeVersion, 'K-02');
});

test('changing knowledge clears the old debug conversation', () => {
  let state = createInitialState();
  state = transition(state, { type: 'runDebug', agentId: 'c' });
  state = transition(state, { type: 'runDebug', agentId: 'c' });
  assert.match(state.agents.c.debugOutput, /转人工/);
  state = transition(state, { type: 'updateKnowledge', agentId: 'c' });
  assert.equal(state.agents.c.debugStep, 0);
  assert.equal(state.agents.c.debugOutput, '');
});

test('C keeps both assistant turns in its simulated conversation', () => {
  let state = createInitialState();
  state = transition(state, { type: 'runDebug', agentId: 'c' });
  state = transition(state, { type: 'runDebug', agentId: 'c' });
  assert.equal(state.agents.c.debugHistory.length, 2);
  assert.match(state.agents.c.debugHistory[0], /请先核对签收时间/);
  assert.match(state.agents.c.debugHistory[1], /转人工/);
  state = transition(state, { type: 'runDebug', agentId: 'c' });
  assert.equal(state.agents.c.debugHistory.length, 1);
  assert.match(state.agents.c.debugHistory[0], /请先核对签收时间/);
});

test('changing a prompt or rule clears stale simulated output', () => {
  let state = createInitialState();
  state = transition(state, { type: 'runDebug', agentId: 'a' });
  state = transition(state, { type: 'editPrompt', agentId: 'a', prompt: '新版' });
  assert.equal(state.agents.a.debugOutput, '');
  state = transition(state, { type: 'runDebug', agentId: 'b' });
  state = transition(state, { type: 'enableRule', agentId: 'b' });
  assert.equal(state.agents.b.debugOutput, '');
});

test('editing a released agent creates a draft requiring a new evaluation', () => {
  let state = createInitialState();
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'editPrompt', agentId: 'a', prompt: '新版本提示词' });
  assert.equal(state.agents.a.evaluation, 'stale');
  assert.equal(state.agents.a.prompt, '新版本提示词');
});

test('editing after publication creates a distinct next version', () => {
  let state = createInitialState();
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'publish', agentId: 'a' });
  state = transition(state, { type: 'editPrompt', agentId: 'a', prompt: '继续优化的提示词' });
  assert.equal(state.agents.a.liveVersion, 'v1.1');
  assert.equal(state.agents.a.draftVersion, 'v1.2');
  assert.equal(state.agents.a.evaluation, 'stale');
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'publish', agentId: 'a' });
  assert.equal(state.agents.a.liveVersion, 'v1.2');
  state = transition(state, { type: 'rollback', agentId: 'a' });
  assert.equal(state.agents.a.liveVersion, 'v1.1');
});

test('editing a new draft does not disable recovery of the live gray release', () => {
  let state = createInitialState();
  state = transition(state, { type: 'evaluate', agentId: 'a' });
  state = transition(state, { type: 'publish', agentId: 'a' });
  state = transition(state, { type: 'editPrompt', agentId: 'a', prompt: '下一版草稿' });
  assert.equal(state.agents.a.draftVersion, 'v1.2');
  state = transition(state, { type: 'setTraffic', agentId: 'a', traffic: 50 });
  assert.equal(state.agents.a.traffic, 50);
  state = transition(state, { type: 'rollback', agentId: 'a' });
  assert.equal(state.agents.a.liveVersion, 'v1.0');
});

test('an empty instruction fails every scenario evaluation consistently', () => {
  for (const agentId of ['a', 'b', 'c']) {
    let state = createInitialState();
    state = transition(state, { type: 'editPrompt', agentId, prompt: '   ' });
    if (agentId === 'b') state = transition(state, { type: 'enableRule', agentId });
    if (agentId === 'c') state = transition(state, { type: 'updateKnowledge', agentId });
    state = transition(state, { type: 'evaluate', agentId });
    assert.equal(state.agents[agentId].evaluation, 'failed');
    const result = getEvaluation(agentId, state.agents[agentId]);
    assert.equal(result.checks[0][1], '未通过');
    assert.match(result.detail, /指令为空/);
  }
});

test('reset restores all demo state', () => {
  let state = createInitialState();
  state = transition(state, { type: 'updateKnowledge', agentId: 'c' });
  state = transition(state, { type: 'reset' });
  assert.deepEqual(state, createInitialState());
});
