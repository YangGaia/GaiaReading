'use strict';

const test = require('node:test');
const assert = require('node:assert');
const pet = require('../src/shared/pet');

const { PET_STATES, EVENTS, TIMERS, createBrain, decideState, timeoutState, lineFor, pick, idleAction, idleExpressionDue } = pet;

test('初始大脑为待机状态', () => {
  const now = 1000000;
  const brain = createBrain(now);
  assert.strictEqual(brain.state, PET_STATES.IDLE);
  assert.strictEqual(brain.lastInteract, now);
  assert.strictEqual(brain.pokeCount, 0);
});

test('滑过进入 hover 并使用 hover 表情池', () => {
  const brain = createBrain(0);
  const d = decideState(brain, EVENTS.HOVER, 10);
  assert.strictEqual(d.state, PET_STATES.HOVER);
  assert.ok(pet.STATE_EXPRESSIONS.hover.includes(d.expression));
});

test('离开回到待机', () => {
  const brain = createBrain(0);
  const d = decideState(brain, EVENTS.LEAVE, 10);
  assert.strictEqual(d.state, PET_STATES.IDLE);
});

test('连续点击 5 次触发 pokeMany 表情池', () => {
  const brain = createBrain(0);
  let d = null;
  for (let i = 1; i <= 5; i++) {
    d = decideState(brain, EVENTS.CLICK, i * 100);
    brain.pokeCount = d.pokeCount;
    brain.lastPokeAt = i * 100;
  }
  assert.ok(d.pokeMany);
  assert.ok(pet.STATE_EXPRESSIONS.pokeMany.includes(d.expression));
});

test('点击间隔超过 2.5 秒后连击计数重置', () => {
  const brain = createBrain(0);
  const d1 = decideState(brain, EVENTS.CLICK, 100);
  brain.pokeCount = d1.pokeCount;
  brain.lastPokeAt = 100;
  const d2 = decideState(brain, EVENTS.CLICK, 5000);
  assert.strictEqual(d2.pokeCount, 1);
  assert.strictEqual(d2.pokeMany, false);
});

test('超时迁移：无聊 -> 困倦 -> 睡觉', () => {
  const brain = createBrain(0);
  assert.strictEqual(timeoutState(brain, TIMERS.BORED_AFTER - 1), null);
  const bored = timeoutState(brain, TIMERS.BORED_AFTER);
  assert.strictEqual(bored.state, PET_STATES.BORED);
  const sleepy = timeoutState(brain, TIMERS.SLEEPY_AFTER);
  assert.strictEqual(sleepy.state, PET_STATES.SLEEPY);
  const sleeping = timeoutState(brain, TIMERS.SLEEPING_AFTER);
  assert.strictEqual(sleeping.state, PET_STATES.SLEEPING);
  assert.strictEqual(sleeping.expression, '半身照');
});

test('互动可唤醒睡眠中的桌宠', () => {
  const brain = createBrain(0);
  brain.state = PET_STATES.SLEEPING;
  const d = decideState(brain, EVENTS.INTERACT, 100);
  assert.strictEqual(d.state, PET_STATES.WAKE);
  assert.ok(pet.STATE_EXPRESSIONS.wake.includes(d.expression));
});

test('台词库各场景均有非空台词', () => {
  for (const key of Object.keys(pet.LINES)) {
    const line = lineFor(key, () => 0);
    assert.ok(typeof line === 'string' && line.length > 0, key + ' 台词为空');
  }
});

test('待机碎碎念台词库充足且每条非空', () => {
  assert.ok(pet.LINES.idle.length >= 8, '待机碎碎念台词不足 8 条');
  for (const line of pet.LINES.idle) {
    assert.ok(typeof line === 'string' && line.length > 0, '存在空台词');
  }
});

test('pick 从列表取项并尊重随机源', () => {
  assert.strictEqual(pick(['a', 'b'], () => 0), 'a');
  assert.strictEqual(pick(['a', 'b'], () => 0.99), 'b');
  assert.strictEqual(pick([], () => 0), null);
  assert.strictEqual(pick(null), null);
});

test('待机小动作按概率触发且表情合法', () => {
  const yes = idleAction(() => 0.01);
  assert.ok(yes === null || pet.STATE_EXPRESSIONS.idle.includes(yes.expression));
  const no = idleAction(() => 0.99);
  assert.strictEqual(no, null);
});

test('待机表情满 5 秒到期换一次, 未到期不换', () => {
  assert.strictEqual(idleExpressionDue(0, 4999, () => 0), null);
  const due = idleExpressionDue(0, 5000, () => 0);
  assert.ok(pet.STATE_EXPRESSIONS.idle.includes(due.expression));
});

test('待机表情到期时避开当前表情', () => {
  const current = pet.STATE_EXPRESSIONS.idle[0];
  const due = idleExpressionDue(0, 5000, () => 0, current);
  assert.notStrictEqual(due.expression, current);
  assert.ok(pet.STATE_EXPRESSIONS.idle.includes(due.expression));
});

test('表情清单覆盖映射表中的全部表情', () => {
  const mapping = require('../src/renderer/images/pet/pet-expressions.json');
  const files = Object.values(mapping.cells).map((f) => f.replace(/\.png$/, ''));
  for (const name of files) {
    assert.ok(pet.EXPRESSIONS.includes(name), '表情清单缺少 ' + name);
  }
});
