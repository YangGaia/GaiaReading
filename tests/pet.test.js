'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
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
  gazeTargetForPoint,
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

test('鼠标注视方向包含脸部中心静止区与四向幅度限制', () => {
  const rect = { left: 100, top: 100, width: 150, height: 270 };
  assert.deepStrictEqual(gazeTargetForPoint(175, 181, rect), { x: 0, y: 0 });
  assert.deepStrictEqual(gazeTargetForPoint(190, 195, rect), { x: 0, y: 0 });
  assert.deepStrictEqual(gazeTargetForPoint(-300, 181, rect), { x: -1, y: 0 });
  assert.deepStrictEqual(gazeTargetForPoint(650, 181, rect), { x: 1, y: 0 });
  assert.deepStrictEqual(gazeTargetForPoint(175, -200, rect), { x: 0, y: -1 });
  assert.deepStrictEqual(gazeTargetForPoint(175, 600, rect), { x: 0, y: 1 });
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
  assert.ok(renderer.includes('gaia-pet-body-gaze'), '桌宠应有不干扰呼吸动画的身体注视层');
  assert.ok(renderer.includes('gaia-pet-head-gaze'), '桌宠应有不干扰表情动作的头部注视层');
  assert.ok(renderer.includes('window.requestAnimationFrame(animateGaze)'), '鼠标跟随应逐帧平滑更新');
  assert.ok(renderer.includes('perspective(520px) rotateY'), '头部跟随应使用轻微透视扭转，而不是平面位移');
  assert.ok(renderer.includes('springToward(faceMotion, target, 76, 16'), '面部应先于头部看向鼠标');
  assert.ok(renderer.includes('springToward(gazeMotion, target, 38, 11'), '头部应克制地慢半拍跟随面部');
  assert.ok(renderer.includes('ui.face.style.transform = faceTurn'), '面部五官应在头发内部产生视差');
  assert.ok(renderer.includes('x * -0.35'), '肩部应进行极轻微的反向重心补偿');
  assert.ok(!renderer.includes('x * 3.8'), '不应继续把整颗头平移到鼠标方向');
  assert.ok(renderer.includes('brain.state === PET_STATES.SLEEPING'), '睡觉时应暂停鼠标跟随');
  assert.ok(renderer.includes("ui.body.classList.contains('no-breathe')"), '专用动作播放时应暂停鼠标跟随');
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
  assert.ok(renderer.includes("['yawn', '打哈欠']"), '控制台应提供打哈欠动作');
  assert.ok(renderer.includes("playPerformance('yawn'"), '打哈欠应使用头和身体协同的专用动画');
  assert.ok(renderer.includes("{ at: 260, expression: '打哈欠' }"), '打哈欠张嘴表情应与动作阶段同步');
  assert.ok(renderer.includes("hideBubble(true);\n      applyExpression('眼睛微张')"), '打哈欠开始前应清除上一条气泡');
  assert.ok(renderer.includes("showBubble(lineFor('yawn'), 1300)"), '打哈欠张嘴阶段应显示与动作同步收尾的文字');
  assert.ok(renderer.includes("drowse: 2200"), '困倦点头动作应有足够缓慢的节奏');
  assert.ok(renderer.includes("{ at: 620, expression: '安心' }"), '困倦低头阶段应闭眼');
  assert.ok(renderer.includes("{ at: 1650, expression: '眼睛微张' }"), '困倦抬头阶段应恢复半睁眼');
  assert.ok(renderer.includes("resetActivity(now);\n    transientUntil = 0;\n    triggerAction(name, true)"), '手动动作不应被上一段临时状态的收尾计时中断');
  assert.ok(!renderer.includes("['stretch', '伸懒腰']"), '不应保留失败的伸懒腰入口');
  assert.ok(renderer.includes("ui.body.classList.remove(cls, 'no-breathe')"), '动作结束后应恢复呼吸');
  assert.ok(css.includes('.gaia-pet-console'), '缺少桌宠控制台样式');
  assert.ok(css.includes('.gaia-pet-body-gaze'), '缺少身体跟随层样式');
  assert.ok(css.includes('.gaia-pet-head-gaze'), '缺少头部跟随层样式');
  assert.ok(css.includes('@keyframes pet-sleep-breathe'), '缺少睡眠呼吸动画');
  assert.ok(css.includes('@keyframes pet-head-drowse'), '缺少困倦点头的头部动画');
  assert.ok(css.includes('52%, 66% { transform: translateY(7px) rotate(1.8deg) scaleY(0.955); }'), '困倦动作应有明显的缓慢低头停顿');
  assert.ok(css.includes('76% { transform: translateY(-1px) rotate(-0.6deg) scaleY(1.01); }'), '困倦动作应有突然清醒抬头的回弹');
  assert.ok(css.includes('@keyframes pet-wake'), '缺少唤醒动画');
  assert.ok(css.includes('@keyframes pet-eye-sprite-blink'), '眨眼应使用闭眼贴片动画');
  assert.ok(css.includes('@keyframes pet-head-thinking'), '缺少思考头部动画');
  assert.ok(css.includes('@keyframes pet-head-tilt'), '缺少独立头部歪头动画');
  assert.ok(css.includes('@keyframes pet-body-tilt'), '歪头时身体应进行反向平衡');
  assert.ok(!css.includes('@keyframes pet-tilt'), '旧的整身摇摆歪头动画应移除');
  assert.ok(css.includes('@keyframes pet-head-shy'), '缺少害羞头部动画');
  assert.ok(css.includes('@keyframes pet-head-angry'), '缺少生气头部动画');
  assert.ok(css.includes('@keyframes pet-head-wake'), '缺少分层唤醒动画');
  assert.ok(css.includes('@keyframes pet-head-yawn'), '缺少打哈欠头部动画');
  assert.ok(css.includes('@keyframes pet-body-yawn'), '缺少打哈欠身体呼吸动画');
  assert.ok(!css.includes('pet-left-arm-stretch'), '不应保留失败的伸懒腰手臂动画');
  assert.ok(css.includes('42% { transform: translateY(0) rotate(-0.5deg) scaleY(1.018); }'), '唤醒峰值时头部不应相对衣领继续上移并产生缝隙');
  assert.ok(!css.includes('.gaia-pet-lid'), '矩形眼皮样式应彻底移除');
  assert.ok(app.includes('window.GaiaPet.init().then(updatePetUI)'), '桌宠初始化后应同步设置开关文字');
  assert.ok(main.includes('petStatus.headCutoutClean === true'), '冒烟测试应逐像素验证身体层没有旧头部残影');
  assert.ok(main.includes("petRoot.style.pointerEvents = 'none'"), '桌宠冒烟测试应隔离真实鼠标输入');
  assert.ok(!main.includes("new PointerEvent('pointerenter', { clientX: 0, clientY: 0 })"), '睡眠冒烟测试不应受真实鼠标进入事件干扰');
  assert.ok(main.includes('petStatus.yawnStarted === true'), '冒烟测试应验证打哈欠动画已启动');
  assert.ok(main.includes('petStatus.yawnTextVisible === true'), '冒烟测试应验证打哈欠文字已显示');
  assert.ok(main.includes('petStatus.drowseStarted === true'), '冒烟测试应验证困倦低头和闭眼阶段');
  assert.ok(main.includes('petStatus.drowseCleared === true'), '冒烟测试应验证困倦动作恢复半睁眼');
  assert.ok(main.includes('petStatus.gazeDirections === true'), '冒烟测试应验证鼠标上下左右跟随');
});

test('头身分层完整挖空头部活动区，仅在颈部保留窄幅重叠', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'make-pet-head-parts.py'), 'utf8');
  assert.ok(script.includes('HEAD = (88, 0, 268, 235)'), '头部裁切应完整覆盖帽子、头发和颈部');
  assert.ok(script.includes('BOTTOM_OVERLAP = 12'), '颈部只应保留窄幅接缝重叠');
  assert.ok(script.includes('a[y0:min(y1 - BOTTOM_OVERLAP, H), x0:min(x1, W), 3] = 0'), '身体层的头部活动区域必须完全透明');
  assert.ok(!script.includes('d = min('), '不应在旧头部四周保留残影羽化环');
});

test('打哈欠专用表情只替换闭眼脸部的嘴型区域', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'make-pet-yawn-face.py'), 'utf8');
  assert.ok(script.includes('叹气.png'), '打哈欠表情应以闭眼脸部为基础');
  assert.ok(script.includes('严肃说话.png'), '打哈欠表情应采用清晰的圆口嘴型');
  assert.ok(script.includes('ellipse((55, 70, 79, 99)'), '嘴型合成范围应限制在脸部下半区');
});

test('鼠标转向试验帧采用局部语义变形并保留透明边缘', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'make-pet-look-pilot.py'), 'utf8');
  assert.ok(script.includes('add_face_yaw'), '脸部应使用独立的轻微偏转透视');
  assert.ok(script.includes('for eye_x in (151.0, 204.0)'), '双眼应拥有比头部更早的视线偏移');
  assert.ok(script.includes('desired_shift = 4.6 * horizontal'), '脸部偏转必须达到肉眼可辨识的幅度');
  assert.ok(script.includes('move_x=1.75 * horizontal'), '眼神应明显领先脸部转向');
  assert.ok(script.includes('add_face_pitch'), '上下方向应使用独立的脸部俯仰透视');
  assert.ok(script.includes('add_body_yaw'), '身体应使用绕竖轴的局部透视，而不是整体倾斜');
  assert.ok(script.includes('right_move = 0.9 * horizontal - 0.55 * abs(horizontal)'), '远侧肩线应有可辨识的透视内收');
  assert.ok(!script.includes('left_shoulder, move_y=') && !script.includes('right_shoulder, move_y='), '身体转向不应制造高低肩');
  assert.ok(script.includes('left_shoulder') && script.includes('right_shoulder'), '身体转向应包含两侧肩线配合');
  assert.ok(script.includes('premultiplied'), '透明素材重采样必须使用预乘 Alpha，避免黑边');
  assert.ok(!script.includes('Image.AFFINE'), '试验帧不应使用整图仿射变形');
});

test('鼠标九方向试验输出齐全、尺寸正确且均非原图副本', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'images', 'pet', 'parts', 'full.png'));
  const center = fs.readFileSync(path.join(__dirname, '..', 'docs', 'pet-direction-pilot', 'pilot-center.png'));
  const pngSize = (buffer) => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });
  const directions = ['up-left', 'up', 'up-right', 'left', 'right', 'down-left', 'down', 'down-right'];
  const hashes = new Set();
  assert.deepStrictEqual(center, source, '正中帧必须保持原始立绘不变');
  for (const direction of directions) {
    const pilot = fs.readFileSync(path.join(__dirname, '..', 'docs', 'pet-direction-pilot', `pilot-look-${direction}.png`));
    assert.deepStrictEqual(pngSize(pilot), pngSize(source), `${direction} 帧尺寸应与原图一致`);
    assert.notDeepStrictEqual(pilot, source, `${direction} 帧不能只是原始帧的副本`);
    hashes.add(crypto.createHash('sha256').update(pilot).digest('hex'));
  }
  assert.strictEqual(hashes.size, directions.length, '八个转向帧必须各自拥有独立画面');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'docs', 'pet-direction-pilot', 'pilot-directions-grid.png')), '缺少九宫格全身预览');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'docs', 'pet-direction-pilot', 'pilot-directions-detail.png')), '缺少九宫格局部预览');
});
