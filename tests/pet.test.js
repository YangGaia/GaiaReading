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
  for (const key of ['thinking', 'shy', 'angry', 'sleepy', 'sleeping', 'wake']) {
    assert.ok(pet.CONTROL_EMOTIONS[key].performance, key + ' 缺少专用表演');
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

test('渲染层包含分层专用动画、无黑线眨眼和动作收尾', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'pet.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.ok(renderer.includes("addEventListener('contextmenu', openConsole)"), '桌宠应支持右键打开控制台');
  assert.ok(renderer.includes('whenReady:'), '桌宠初始化应提供可等待的就绪状态');
  assert.ok(renderer.includes("key === 'sleeping'"), '控制台应能手动睡觉');
  assert.ok(renderer.includes('saved.autoSpeech'), '控制台应能关闭自动说话');
  assert.ok(renderer.includes('saved.autoSleep'), '控制台应能关闭自动睡觉');
  assert.ok(renderer.includes("PART_IMG + 'body.png'"), '桌宠身体应使用挖空头部的分层素材');
  assert.ok(renderer.includes("PART_IMG + 'head.png'"), '桌宠应加载独立头部素材');
  assert.ok(renderer.includes('gaia-pet-blink-face'), '眨眼应使用闭眼脸部贴片');
  assert.ok(!renderer.includes("lid.className = 'gaia-pet-lid'"), '不应继续使用会产生黑线的矩形眼皮');
  assert.ok(renderer.includes("playPerformance('thinking'"), '思考应有专用动画');
  assert.ok(renderer.includes("playPerformance('shy'"), '害羞应有专用动画');
  assert.ok(renderer.includes("playPerformance('angry'"), '生气应有专用动画');
  assert.ok(renderer.includes("playPerformance('wake'"), '唤醒应有专用动画');
  assert.ok(renderer.includes("playPerformance('tilt'"), '歪头应使用独立头部动画');
  assert.ok(renderer.includes("applyExpression('倾听')"), '歪头应匹配倾听表情');
  assert.ok(renderer.includes("applyExpression('偷看')"), '自动偷看动作应匹配偷看表情');
  assert.ok(renderer.includes("playPerformance('peek'"), '自动偷看应有专用动画');
  assert.ok(renderer.includes("applyExpression('倾听')"), '自动倾听动作应匹配倾听表情');
  assert.ok(renderer.includes("playPerformance('listen'"), '自动倾听应有专用动画');
  assert.ok(renderer.includes("['stretch', '伸懒腰']"), '应保留原有伸懒腰动作');
  assert.ok(renderer.includes("ui.body.classList.remove(cls, 'no-breathe')"), '动作结束后应恢复呼吸');
  assert.ok(css.includes('.gaia-pet-console'), '缺少桌宠控制台样式');
  assert.ok(css.includes('@keyframes pet-sleep-breathe'), '缺少睡眠呼吸动画');
  assert.ok(css.includes('@keyframes pet-drowse'), '缺少困倦过渡动画');
  assert.ok(css.includes('@keyframes pet-wake'), '缺少唤醒动画');
  assert.ok(css.includes('@keyframes pet-eye-sprite-blink'), '眨眼应使用闭眼贴片动画');
  assert.ok(css.includes('@keyframes pet-head-thinking'), '缺少思考头部动画');
  assert.ok(css.includes('@keyframes pet-head-tilt'), '缺少独立头部歪头动画');
  assert.ok(css.includes('@keyframes pet-body-tilt'), '歪头时身体应进行反向平衡');
  assert.ok(!css.includes('@keyframes pet-tilt'), '旧的整身摇摆歪头动画应移除');
  assert.ok(css.includes('@keyframes pet-head-shy'), '缺少害羞头部动画');
  assert.ok(css.includes('@keyframes pet-head-angry'), '缺少生气头部动画');
  assert.ok(css.includes('@keyframes pet-head-wake'), '缺少分层唤醒动画');
  assert.ok(css.includes('42% { transform: translateY(0) rotate(-0.5deg) scaleY(1.018); }'), '唤醒峰值时头部不应相对衣领继续上移并产生缝隙');
  assert.ok(!css.includes('.gaia-pet-lid'), '矩形眼皮样式应彻底移除');
  assert.ok(app.includes('window.GaiaPet.init().then(updatePetUI)'), '桌宠初始化后应同步设置开关文字');
  assert.ok(main.includes('petStatus.headCutoutClean === true'), '冒烟测试应逐像素验证身体层没有旧头部残影');
});

test('头身分层完整挖空头部活动区，仅在颈部保留窄幅重叠', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'make-pet-head-parts.py'), 'utf8');
  assert.ok(script.includes('HEAD = (88, 0, 268, 235)'), '头部裁切应完整覆盖帽子、头发和颈部');
  assert.ok(script.includes('BOTTOM_OVERLAP = 12'), '颈部只应保留窄幅接缝重叠');
  assert.ok(script.includes('a[y0:min(y1 - BOTTOM_OVERLAP, H), x0:min(x1, W), 3] = 0'), '身体层的头部活动区域必须完全透明');
  assert.ok(!script.includes('d = min('), '不应在旧头部四周保留残影羽化环');
});
