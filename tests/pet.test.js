'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pet = require('../src/shared/pet');

const {
  PET_STATES,
  EVENTS,
  TIMERS,
  AUTO_BEHAVIORS,
  createBrain,
  decideState,
  timeoutState,
  inactivityState,
  autoTimeline,
  nextAutoDelay,
  pickAutoBehavior,
  lineFor,
  pick,
  pickIdleExpression,
} = pet;

test('初始大脑为待机状态', () => {
  const brain = createBrain(1000);
  assert.deepStrictEqual(brain, {
    state: PET_STATES.IDLE,
    lastInteract: 1000,
    pokeCount: 0,
    lastPokeAt: 0,
  });
});

test('滑过、离开和唤醒使用各自的表情池', () => {
  const brain = createBrain(0);
  const hover = decideState(brain, EVENTS.HOVER, 10);
  const leave = decideState(brain, EVENTS.LEAVE, 20);
  const wake = decideState(brain, EVENTS.INTERACT, 30);
  assert.strictEqual(hover.state, PET_STATES.HOVER);
  assert.ok(pet.STATE_EXPRESSIONS.hover.includes(hover.expression));
  assert.strictEqual(leave.state, PET_STATES.IDLE);
  assert.ok(pet.STATE_EXPRESSIONS.idle.includes(leave.expression));
  assert.strictEqual(wake.state, PET_STATES.WAKE);
  assert.ok(pet.STATE_EXPRESSIONS.wake.includes(wake.expression));
});

test('连续点击 5 次触发生气表情，2.5 秒后重置', () => {
  const brain = createBrain(0);
  let result;
  for (let i = 1; i <= 5; i += 1) {
    result = decideState(brain, EVENTS.CLICK, i * 100);
    brain.pokeCount = result.pokeCount;
    brain.lastPokeAt = i * 100;
  }
  assert.strictEqual(result.pokeMany, true);
  assert.ok(pet.STATE_EXPRESSIONS.pokeMany.includes(result.expression));
  const reset = decideState(brain, EVENTS.CLICK, 3000);
  assert.strictEqual(reset.pokeCount, 1);
  assert.strictEqual(reset.pokeMany, false);
});

test('默认自动时间轴为 15 秒无聊、25 秒困倦、35 秒睡觉', () => {
  assert.deepStrictEqual(autoTimeline(TIMERS.SLEEP_AFTER), {
    bored: 15000,
    sleepy: 25000,
    sleeping: 35000,
  });
  assert.strictEqual(inactivityState(0, 14999), PET_STATES.IDLE);
  assert.strictEqual(inactivityState(0, 15000), PET_STATES.BORED);
  assert.strictEqual(inactivityState(0, 25000), PET_STATES.SLEEPY);
  assert.strictEqual(inactivityState(0, 35000), PET_STATES.SLEEPING);
});

test('快速和舒缓入睡选项保持同一条线性时间轴', () => {
  assert.deepStrictEqual(autoTimeline(20000), { bored: 8571, sleepy: 14286, sleeping: 20000 });
  assert.deepStrictEqual(autoTimeline(60000), { bored: 25714, sleepy: 42857, sleeping: 60000 });
});

test('超时迁移只沿时间轴向前并为每个阶段提供表情', () => {
  const brain = createBrain(0);
  assert.strictEqual(timeoutState(brain, 14999, 35000, () => 0), null);
  const bored = timeoutState(brain, 15000, 35000, () => 0);
  assert.strictEqual(bored.state, PET_STATES.BORED);
  assert.strictEqual(bored.expression, pet.STATE_EXPRESSIONS.bored[0]);
  brain.state = bored.state;
  assert.strictEqual(timeoutState(brain, 20000, 35000, () => 0), null);
  const sleepy = timeoutState(brain, 25000, 35000, () => 0);
  assert.strictEqual(sleepy.state, PET_STATES.SLEEPY);
  brain.state = sleepy.state;
  const sleeping = timeoutState(brain, 35000, 35000, () => 0);
  assert.strictEqual(sleeping.state, PET_STATES.SLEEPING);
});

test('睡觉使用闭眼表情，不再把半身照当表情', () => {
  assert.deepStrictEqual(pet.STATE_EXPRESSIONS.sleeping, ['安心']);
  assert.ok(!pet.STATE_EXPRESSIONS.sleeping.includes('半身照'));
  assert.strictEqual(pet.STATE_EXPRESSIONS.wake[0], '眼睛微张');
});

test('自动行为间隔限制在 6 到 10 秒', () => {
  assert.strictEqual(nextAutoDelay(() => 0), TIMERS.AUTO_MIN);
  assert.strictEqual(nextAutoDelay(() => 0.999999), TIMERS.AUTO_MAX);
});

test('自动行为按 40% 换脸、30% 动作、30% 说话分配', () => {
  assert.strictEqual(pickAutoBehavior(() => 0), AUTO_BEHAVIORS.EXPRESSION);
  assert.strictEqual(pickAutoBehavior(() => 0.3999), AUTO_BEHAVIORS.EXPRESSION);
  assert.strictEqual(pickAutoBehavior(() => 0.4), AUTO_BEHAVIORS.ACTION);
  assert.strictEqual(pickAutoBehavior(() => 0.6999), AUTO_BEHAVIORS.ACTION);
  assert.strictEqual(pickAutoBehavior(() => 0.7), AUTO_BEHAVIORS.SPEECH);
  assert.strictEqual(pickAutoBehavior(() => 0.9999), AUTO_BEHAVIORS.SPEECH);
});

test('控制台情绪均有名称和可用表情', () => {
  for (const key of ['idle', 'thinking', 'shy', 'angry', 'sleepy', 'sleeping', 'wake']) {
    const config = pet.CONTROL_EMOTIONS[key];
    assert.ok(config && config.label, key + ' 缺少名称');
    assert.ok(Array.isArray(config.expressions) && config.expressions.length > 0, key + ' 缺少表情');
  }
  assert.strictEqual(pet.CONTROL_EMOTIONS.sleeping.hold, true);
});

test('台词库各场景均有非空台词', () => {
  for (const key of Object.keys(pet.LINES)) {
    const line = lineFor(key, () => 0);
    assert.ok(typeof line === 'string' && line.length > 0, key + ' 台词为空');
  }
});

test('pick 和待机表情选择尊重随机源并避开当前表情', () => {
  assert.strictEqual(pick(['a', 'b'], () => 0), 'a');
  assert.strictEqual(pick(['a', 'b'], () => 0.99), 'b');
  assert.strictEqual(pick([], () => 0), null);
  const current = pet.STATE_EXPRESSIONS.idle[0];
  const expression = pickIdleExpression(current, () => 0.99);
  assert.notStrictEqual(expression, current);
  assert.ok(pet.STATE_EXPRESSIONS.idle.includes(expression));
});

test('所有状态与控制台表情都有对应贴片文件', () => {
  const facesDir = path.join(__dirname, '..', 'src', 'renderer', 'images', 'pet', 'faces');
  const names = new Set();
  for (const pool of Object.values(pet.STATE_EXPRESSIONS)) pool.forEach((name) => names.add(name));
  for (const config of Object.values(pet.CONTROL_EMOTIONS)) config.expressions.forEach((name) => names.add(name));
  for (const name of names) {
    assert.ok(fs.existsSync(path.join(facesDir, name + '.png')), '缺少贴片: ' + name);
  }
});

test('表情清单覆盖映射表中的全部表情', () => {
  const mapping = require('../src/renderer/images/pet/pet-expressions.json');
  const files = Object.values(mapping.cells).map((file) => file.replace(/\.png$/, ''));
  for (const name of files) assert.ok(pet.EXPRESSIONS.includes(name), '表情清单缺少 ' + name);
});

test('渲染层包含自动控制台、睡眠循环和动作收尾', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'pet.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert.ok(renderer.includes("addEventListener('contextmenu', openConsole)"), '桌宠应支持右键打开控制台');
  assert.ok(renderer.includes('whenReady:'), '桌宠初始化应提供可等待的就绪状态');
  assert.ok(renderer.includes("key === 'sleeping'"), '控制台应能手动睡觉');
  assert.ok(renderer.includes('saved.autoSpeech'), '控制台应能关闭自动说话');
  assert.ok(renderer.includes('saved.autoSleep'), '控制台应能关闭自动睡觉');
  assert.ok(renderer.includes("ui.body.classList.remove(cls, 'no-breathe')"), '动作结束后应恢复呼吸');
  assert.ok(css.includes('.gaia-pet-console'), '缺少桌宠控制台样式');
  assert.ok(css.includes('@keyframes pet-sleep-breathe'), '缺少睡眠呼吸动画');
  assert.ok(css.includes('@keyframes pet-drowse'), '缺少困倦过渡动画');
  assert.ok(css.includes('@keyframes pet-wake'), '缺少唤醒动画');
  assert.ok(app.includes('window.GaiaPet.init().then(updatePetUI)'), '桌宠初始化后应同步设置开关文字');
});
