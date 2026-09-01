'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pet = require('../src/shared/pet');

const { PET_STATES, EVENTS, TIMERS, createBrain, decideState, timeoutState, lineFor, pick, idleExpressionDue, pickIdleExpression, speechDue, nextMood } = pet;

test('初始大脑为待机状态', () => {
  const now = 1000000;
  const brain = createBrain(now);
  assert.strictEqual(brain.state, PET_STATES.IDLE);
  assert.strictEqual(brain.lastInteract, now);
  assert.strictEqual(brain.pokeCount, 0);
  assert.strictEqual(brain.moodAt, 0);
  assert.deepStrictEqual(brain.moodCycle, []);
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

test('15秒无互动触发情绪状态, 未满15秒不触发', () => {
  const brain = createBrain(0);
  const moods = [PET_STATES.BORED, PET_STATES.SLEEPY, PET_STATES.SLEEPING];
  assert.strictEqual(timeoutState(brain, TIMERS.MOOD_AFTER - 1), null);
  const d1 = timeoutState(brain, TIMERS.MOOD_AFTER, () => 0);
  assert.ok(moods.includes(d1.state));
  assert.strictEqual(d1.expression, pet.STATE_EXPRESSIONS[d1.state][0]);
  assert.strictEqual(timeoutState(brain, TIMERS.MOOD_AFTER + 5000), null);
  const d2 = timeoutState(brain, TIMERS.MOOD_AFTER * 2, () => 0.99);
  assert.ok(moods.includes(d2.state));
  assert.notStrictEqual(d2.state, d1.state);
});

test('情绪状态第一次等概率随机, 之后上次状态降至15%其余对半分', () => {
  const brain = createBrain(0);
  assert.strictEqual(nextMood(brain, () => 0), PET_STATES.BORED);
  assert.strictEqual(nextMood(brain, () => 0.05), PET_STATES.BORED);
  const other = nextMood(brain, () => 0.99);
  assert.notStrictEqual(other, PET_STATES.BORED);
  assert.ok([PET_STATES.SLEEPY, PET_STATES.SLEEPING].includes(other));
});

test('三个情绪状态轮完一圈后重置为等概率随机', () => {
  const brain = createBrain(0);
  assert.strictEqual(nextMood(brain, () => 0), PET_STATES.BORED);
  assert.strictEqual(nextMood(brain, () => 0.999), PET_STATES.SLEEPING);
  assert.strictEqual(nextMood(brain, () => 0.99), PET_STATES.SLEEPY);
  assert.strictEqual(brain.moodCycle.length, 3);
  assert.strictEqual(nextMood(brain, () => 0), PET_STATES.BORED);
  assert.strictEqual(brain.moodCycle.length, 1);
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

test('第一句 3 秒内必说', () => {
  assert.strictEqual(speechDue(0, 2999, () => 0, 0), false);
  assert.strictEqual(speechDue(0, 3000, () => 0.99, 0), true);
});

test('第二句 2 秒后每轮 80%, 没说保持 80%', () => {
  assert.strictEqual(speechDue(0, 1999, () => 0, 1), false);
  assert.strictEqual(speechDue(0, 2000, () => 0.79, 1), true);
  assert.strictEqual(speechDue(0, 2000, () => 0.8, 1), false);
  assert.strictEqual(speechDue(0, 4000, () => 0.8, 1), false);
  assert.strictEqual(speechDue(0, 4000, () => 0.79, 1), true);
});

test('pickIdleExpression 避开当前表情且来自待机池', () => {
  const current = pet.STATE_EXPRESSIONS.idle[0];
  const exp = pickIdleExpression(current, () => 0.99);
  assert.notStrictEqual(exp, current);
  assert.ok(pet.STATE_EXPRESSIONS.idle.includes(exp));
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

test('表情池引用的每个表情都有对应贴片文件', () => {
  const facesDir = path.join(__dirname, '..', 'src', 'renderer', 'images', 'pet', 'faces');
  for (const pool of Object.values(pet.STATE_EXPRESSIONS)) {
    for (const name of pool) {
      assert.ok(fs.existsSync(path.join(facesDir, name + '.png')), '缺少贴片: ' + name);
    }
  }
});

test('表情清单覆盖映射表中的全部表情', () => {
  const mapping = require('../src/renderer/images/pet/pet-expressions.json');
  const files = Object.values(mapping.cells).map((f) => f.replace(/\.png$/, ''));
  for (const name of files) {
    assert.ok(pet.EXPRESSIONS.includes(name), '表情清单缺少 ' + name);
  }
});

test('互动场景台词充足', () => {
  for (const key of ['hover', 'poke', 'pokeMany', 'wake']) {
    assert.ok(pet.LINES[key] && pet.LINES[key].length >= 10, key + ' 互动台词不足 10 条');
  }
  assert.ok(pet.LINES.idle.length >= 15, '待机碎碎念台词不足 15 条');
});
