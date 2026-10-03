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
  nextDreamDelay,
  shouldDream,
  lineFor,
  pick,
  pickIdleExpression,
  pokeLineKey,
  hasPrimaryPointerButton,
  petOpacityForState,
  placePetOverlays,
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

test('连续点击台词从普通回应升级为警告和不耐烦', () => {
  assert.strictEqual(pokeLineKey(1), 'poke');
  assert.strictEqual(pokeLineKey(3), 'pokeAgain');
  assert.strictEqual(pokeLineKey(5), 'pokeMany');
  const brain = createBrain(0);
  let result;
  for (let i = 1; i <= 3; i += 1) {
    result = decideState(brain, EVENTS.CLICK, i * 100);
    brain.pokeCount = result.pokeCount;
    brain.lastPokeAt = i * 100;
  }
  assert.strictEqual(result.pokeLine, 'pokeAgain');
  assert.ok(pet.LINES.pokeAgain.length >= 6);
});

test('拖拽仅在主按钮仍按下时继续', () => {
  assert.strictEqual(hasPrimaryPointerButton(1), true);
  assert.strictEqual(hasPrimaryPointerButton(3), true);
  assert.strictEqual(hasPrimaryPointerButton(0), false);
  assert.strictEqual(hasPrimaryPointerButton(2), false);
  assert.strictEqual(hasPrimaryPointerButton(undefined), false);
});

test('透明桌宠悬停时完全显现，离开后恢复设置值', () => {
  assert.strictEqual(petOpacityForState(0.4, false), 0.4);
  assert.strictEqual(petOpacityForState(0.4, true), 1);
  assert.strictEqual(petOpacityForState(1, false), 1);
  assert.strictEqual(petOpacityForState(1, true), 1);
});

test('默认三分钟入睡，三个选项保持同一条线性时间轴', () => {
  assert.strictEqual(TIMERS.SLEEP_AFTER, 180000);
  for (const duration of [60000, 180000, 600000]) {
    const timeline = autoTimeline(duration);
    assert.deepStrictEqual(timeline, { bored: Math.round(duration * 3 / 7), sleepy: Math.round(duration * 5 / 7), sleeping: duration });
    assert.strictEqual(inactivityState(0, timeline.bored - 1, duration), PET_STATES.IDLE);
    assert.strictEqual(inactivityState(0, timeline.bored, duration), PET_STATES.BORED);
    assert.strictEqual(inactivityState(0, timeline.sleepy, duration), PET_STATES.SLEEPY);
    assert.strictEqual(inactivityState(0, timeline.sleeping, duration), PET_STATES.SLEEPING);
  }
});

test('控制台和台词在各窗口边角、尺寸下保持可见且互不遮挡', () => {
  for (const [width, height] of [[800, 600], [1100, 760], [2560, 1080], [320, 480]]) {
    for (const scale of [.75, 1, 1.5]) {
      const petWidth = 150 * scale;
      const petHeight = Math.min(height, 290 * scale);
      for (const left of [0, (width - petWidth) / 2, width - petWidth]) {
        for (const top of [0, (height - petHeight) / 2, height - petHeight]) {
          const rect = { left, top, width: petWidth, height: petHeight, right: left + petWidth, bottom: top + petHeight };
          for (const bubbleWidth of [60, 230]) {
            const layout = placePetOverlays({ width, height }, rect, { width: 240, height: 420 }, { width: bubbleWidth, height: 70 });
            const panel = layout.console;
            const bubble = layout.bubble;
            const natural = placePetOverlays({ width, height }, rect, null, { width: bubbleWidth, height: 70 });
            assert.deepStrictEqual(bubble, natural.bubble, '控制台开关不能改变台词的自然位置');
            for (const r of [panel, bubble]) {
              assert.ok(r.left >= 8 && r.top >= 8 && r.left + r.width <= width - 8 && r.top + r.height <= height - 8, JSON.stringify({ width, height, scale, rect, layout }));
            }
            assert.ok(panel.left + panel.width <= bubble.left || bubble.left + bubble.width <= panel.left || panel.top + panel.height <= bubble.top || bubble.top + bubble.height <= panel.top, JSON.stringify(layout));
          }
        }
      }
    }
  }
});

test('气泡出现时控制台主动移开，优先保留完整高度', () => {
  const viewport = { width: 800, height: 600 };
  const rect = { left: 0, top: 0, width: 150, height: 290, right: 150, bottom: 290 };
  const size = { width: 240, height: 420 };
  const initial = placePetOverlays(viewport, rect, size, null).console;
  const withSpeech = placePetOverlays(viewport, rect, size, { width: 230, height: 70 });
  assert.notDeepStrictEqual(withSpeech.console, initial);
  assert.strictEqual(withSpeech.console.height, size.height);
  assert.strictEqual(withSpeech.bubble.left, 162);
  assert.ok(Math.abs(withSpeech.bubble.top - 40.4) < .001, '台词应保持在有珠脸侧');
  assert.ok(withSpeech.console.top >= withSpeech.bubble.top + withSpeech.bubble.height + 12);
});

test('窄窗口只缩短控制台，气泡继续保持原位置', () => {
  const viewport = { width: 320, height: 480 };
  const rect = { left: 0, top: 0, width: 150, height: 290, right: 150, bottom: 290 };
  const bubbleSize = { width: 230, height: 70 };
  const layout = placePetOverlays(viewport, rect, { width: 240, height: 420 }, bubbleSize);
  assert.deepStrictEqual(layout.bubble, placePetOverlays(viewport, rect, null, bubbleSize).bubble);
  assert.ok(layout.console.height < 420 && layout.console.height >= 100);
  assert.strictEqual(layout.console.width, 240);
  assert.ok(layout.console.top + layout.console.height + 12 <= layout.bubble.top || layout.console.top >= layout.bubble.top + layout.bubble.height + 12);
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

test('梦话每 6 到 10 秒以 80% 高概率尝试触发', () => {
  assert.strictEqual(nextDreamDelay(() => 0), TIMERS.DREAM_MIN);
  assert.strictEqual(nextDreamDelay(() => 0.999999), TIMERS.DREAM_MAX);
  assert.strictEqual(shouldDream(() => 0), true);
  assert.strictEqual(shouldDream(() => 0.7999), true);
  assert.strictEqual(shouldDream(() => 0.8), false);
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
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'pet-console.css'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  assert.ok(renderer.includes("addEventListener('contextmenu', openConsole)"), '桌宠应支持右键打开控制台');
  assert.ok(renderer.includes("hitbox.setAttribute('role', 'button')"), '桌宠应提供键盘可聚焦的交互区域');
  assert.ok(renderer.includes("ev.key === 'F10' && ev.shiftKey"), '桌宠应支持 Shift+F10 打开控制台');
  assert.ok(renderer.includes('updatePositionRatios()'), '桌宠位置应使用窗口比例保存');
  assert.ok(renderer.includes("readerMode: 'normal'"), '桌宠应支持阅读页显示策略');
  assert.ok(renderer.includes("['hidden', '自动隐藏']"), '桌宠应支持阅读时自动隐藏');
  assert.ok(renderer.includes("scale = makeSelectRow('尺寸'"), '控制台应提供尺寸设置');
  assert.ok(renderer.includes("opacity = makeSelectRow('透明度'"), '控制台应提供透明度设置');
  assert.ok(renderer.includes("speechHistory = [text"), '控制台应记录最近台词');
  assert.ok(renderer.includes('whenReady:'), '桌宠初始化应提供可等待的就绪状态');
  assert.ok(renderer.includes("key === 'sleeping'"), '控制台应能手动睡觉');
  assert.ok(renderer.includes('saved.autoSleep'), '控制台应能关闭自动睡觉');
  assert.ok(!renderer.includes('saved.autoSpeech') && !renderer.includes('saved.auto ='), '自主活动与台词始终开启，不读取旧开关');
  assert.ok(!renderer.includes('readerCare') && !renderer.includes('ReadingCare'), '完整移除阅读关怀功能');
  assert.ok(!renderer.includes("['dim', '半透明']"), '阅读页不再提供半透明选项');
  assert.ok(renderer.includes("makeToggle('自主休息'"), '自主行为只保留自主休息选项');
  assert.ok(renderer.includes("if (ev.stopPropagation) ev.stopPropagation()"), '有珠右键不能传给阅读页书签处理');
  assert.ok(css.includes('--surface: #20262e;') && css.includes('--accent: #d6deeb;'), '控制台使用统一石墨银灰配色');
  assert.ok(renderer.includes("makeToggle('显示界面帧率'"), '控制台应提供帧率显示开关');
  assert.ok(renderer.includes('showFps: true'), '帧率显示应默认开启');
  assert.ok(renderer.includes('showFps: saved.showFps'), '帧率显示开关应持久化');
  assert.ok(renderer.includes('window.requestAnimationFrame(sampleFps)'), '帧率应通过逐帧回调进行采样');
  assert.ok(renderer.includes('if (elapsed < 1000) return'), '帧率数字最多每秒更新一次');
  assert.ok(renderer.includes('fpsSamples = fpsSamples.slice(-3)'), '帧率应使用最近三秒平滑值');
  assert.ok(renderer.includes("fps >= 50 ? 'good' : fps >= 30 ? 'warn' : 'bad'"), '帧率应按流畅程度分级着色');
  assert.ok(renderer.includes("const frequencyText = displayFrequency == null ? '--Hz'"), '系统刷新率读取失败时应明确显示未知');
  assert.ok(renderer.includes("ui.fps.textContent = 'FPS ' + fpsText + ' / ' + frequencyText"), '帧率标签应同时显示实测FPS与显示器刷新率');
  assert.ok(main.includes('screen.getDisplayMatching(win.getBounds())'), '主进程应读取当前窗口所在显示器');
  assert.ok(main.includes('display.displayFrequency'), '刷新率目标值必须来自系统显示器信息');
  assert.ok(main.includes("mainWindow.on('move', scheduleDisplayFrequency)"), '窗口跨屏移动后应刷新目标值');
  assert.ok(main.includes("screen.on('display-metrics-changed', scheduleDisplayFrequency)"), '显示器配置变化后应刷新目标值');
  assert.ok(preload.includes("ipcRenderer.invoke('display:frequency')"), '预加载层应安全提供刷新率读取接口');
  assert.ok(preload.includes("ipcRenderer.on('display:frequency-changed'"), '预加载层应转发刷新率变化');
  assert.ok(main.includes("mainWindow.webContents.send('window:focus-changed', !!focused)"), '主进程应报告应用窗口的真实焦点状态');
  assert.ok(preload.includes("ipcRenderer.invoke('window:is-focused')") && preload.includes("ipcRenderer.on('window:focus-changed'"), '预加载层应安全转发应用窗口焦点');
  assert.ok(renderer.includes('window.api.onWindowFocusChanged(handleAppWindowFocus)'), '帧率与拖拽状态应监听应用窗口焦点');
  assert.ok(!renderer.includes("window.addEventListener('blur'"), '不能把主页面到正文 iframe 的焦点切换误判为切出程序');
  assert.ok(main.includes('GaiaPet.setWindowFocusedForTest(false)'), '冒烟测试应验证应用窗口真正失焦后的状态');
  assert.ok(renderer.includes("document.addEventListener('visibilitychange'"), '最小化窗口时应重置帧率和拖拽状态');
  assert.ok(renderer.includes("showBubble(lineFor('sleepTransition'), 2600)"), '进入睡眠时应显示状态过渡台词');
  assert.ok(renderer.includes('showBubble(lineFor(d.pokeLine))'), '连续点击应使用逐级变化的台词');
  assert.ok(renderer.includes("PART_IMG + 'body.png'"), '桌宠身体应使用挖空头部的分层素材');
  assert.ok(renderer.includes("PART_IMG + 'head.png'"), '桌宠应加载独立头部素材');
  assert.ok(!renderer.includes('GAZE_IMG'), '桌宠不应再加载鼠标跟随方向帧');
  assert.ok(!renderer.includes('requestAnimationFrame(animateGaze)'), '桌宠不应再运行鼠标跟随动画');
  assert.ok(renderer.includes('target.setPointerCapture(ev.pointerId)'), '桌宠拖拽应捕获当前指针，避免窗口边缘丢失释放事件');
  assert.ok(renderer.includes('!hasPrimaryPointerButton(ev.buttons)'), '移动时发现主按钮已松开应立即结束拖拽');
  assert.ok(renderer.includes('cancelActiveDrag();'), '应用失焦或隐藏时应清理残留拖拽状态');
  assert.ok(renderer.includes('petOpacityForState(saved.opacity, pointerInside || dragging)'), '透明桌宠悬停或拖动时应完全显现');
  assert.ok(renderer.includes('wasTranslucent && wakeUp(now)'), '碰到透明且休眠的桌宠时应复用既有唤醒流程');
  assert.ok(!css.includes('.gaia-pet-gaze-frame'), '桌宠不应保留鼠标跟随图层');
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
  assert.ok(renderer.includes("['tilt', '歪头']") && renderer.includes("['blink', '眨眼']"), '控制台应保留歪头和眨眼动作');
  assert.ok(!renderer.includes("['recoil', '回弹']") && !renderer.includes("['shiver', '发抖']"), '控制台不应保留回弹和发抖按钮');
  assert.ok(renderer.includes("triggerAction('perk')"), '鼠标移入时的一怔动作应保留');
  assert.ok(renderer.includes("playPerformance('yawn'"), '打哈欠应使用头和身体协同的专用动画');
  assert.ok(renderer.includes("{ at: 260, expression: '打哈欠' }"), '打哈欠张嘴表情应与动作阶段同步');
  assert.match(renderer, /hideBubble\(true\);\r?\n {6}applyExpression\('眼睛微张'\)/, '打哈欠开始前应清除上一条气泡');
  assert.ok(renderer.includes("showBubble(lineFor('yawn'), 1300)"), '打哈欠张嘴阶段应显示与动作同步收尾的文字');
  assert.ok(renderer.includes("drowse: 2200"), '困倦点头动作应有足够缓慢的节奏');
  assert.ok(renderer.includes("{ at: 620, expression: '安心' }"), '困倦低头阶段应闭眼');
  assert.ok(renderer.includes("{ at: 1650, expression: '眼睛微张' }"), '困倦抬头阶段应恢复半睁眼');
  assert.ok(renderer.includes('const previous = {'), '手动动作应记录并恢复动作前情绪');
  assert.ok(renderer.includes('(activePerformance && activePerformance.restoreExpression)'), '打断动作时应继承前一动作的基础表情，而不是中途闭眼表情');
  assert.ok(renderer.includes('applyExpression(previous.expression)'), '手动动作结束后应恢复原表情');
  assert.ok(renderer.includes('function interruptEffects()'), '动作切换应经过统一的可打断收尾');
  assert.ok(renderer.includes('if (interrupt) interruptEffects()'), '手动眨眼应立即打断上一动作');
  assert.ok(renderer.includes('activePerformance = { token, restoreExpression: finalExpression }'), '表演应记录被打断时的正确落点表情');
  assert.ok(renderer.includes("ev.animationName === 'pet-eye-sprite-blink'"), '眨眼动画结束时应主动移除闭眼贴片');
  assert.ok(renderer.includes('blinkCleanupTimer = window.setTimeout(clearBlink, 300)'), '眨眼应有超时清理兜底');
  assert.ok(renderer.includes("if (brain.state === PET_STATES.SLEEPING || manualHeld) return"), '睡着后鼠标移入不应自动唤醒');
  assert.ok(renderer.includes("showBubble(lineFor('sleeping'), 3200)"), '睡眠期间应显示梦话');
  assert.ok(renderer.includes('lockedMood: lockedEmotion'), '情绪锁定应保存明确的情绪键');
  assert.match(renderer, /if \(key === 'idle'\) \{\s+returnToIdle\(now\);\s+save\(\);/, '手动回到待机时应持久化解除锁定');
  assert.ok(renderer.includes("const LOCKABLE_EMOTIONS = ['thinking', 'shy', 'angry', 'sleepy']"), '只能锁定稳定手动情绪');
  assert.match(renderer, /if \(saved\.autoSleep\) \{[\s\S]*?timeoutState\(brain, now, saved\.sleepAfter\)[\s\S]*?\}\s+if \(consoleOpen\) return;/, '控制台打开时仍应先执行自动休息和入睡时间轴');
  assert.ok(!renderer.includes("['stretch', '伸懒腰']"), '不应保留失败的伸懒腰入口');
  assert.ok(renderer.includes("ui.body.classList.remove(cls, 'no-breathe')"), '动作结束后应恢复呼吸');
  assert.ok(css.includes('.gaia-pet-console'), '缺少桌宠控制台样式');
  assert.ok(css.includes('.gaia-pet-fps') && css.includes('font-variant-numeric: tabular-nums'), '有珠下方应显示稳定宽度的帧率标签');
  assert.ok(css.includes('.gaia-pet-fps[data-level="good"]') && css.includes('.gaia-pet-fps[data-level="bad"]'), '帧率标签应提供绿黄红状态色');
  assert.ok(css.includes('pointer-events: none;'), '帧率标签不应影响桌宠交互');
  assert.ok(css.includes('width: 240px;') && css.includes('height: 420px;'), '控制台应使用紧凑的固定尺寸');
  assert.ok(css.includes('overscroll-behavior: contain;'), '控制台滚动到边缘时不应穿透到底层页面');
  assert.ok(css.includes('.gaia-pet-console-top') && css.includes('position: sticky;'), '控制台标题和状态应在滚动时固定');
  assert.ok(css.includes('.gaia-pet-console::-webkit-scrollbar'), '控制台应使用紧凑滚动条');
  assert.ok(renderer.includes("panel.addEventListener('wheel', (ev) => ev.stopPropagation()"), '控制台滚轮事件不应触发阅读器翻页');
  assert.ok(css.includes('.gaia-pet-hitbox'), '缺少桌宠轮廓交互区域');
  assert.ok(css.includes('pointer-events: none;'), '桌宠透明根区域应允许点击穿透');
  assert.ok(css.includes('-webkit-line-clamp: 3'), '桌宠台词应允许最多三行显示');
  assert.ok(css.includes('@keyframes pet-sleep-breathe'), '缺少睡眠呼吸动画');
  assert.ok(css.includes('animation: statsAliceBreathe 4s ease-in-out infinite;'), '统计页有珠待机状态应保留呼吸动画');
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
  assert.ok(app.includes('window.GaiaPet.setView(name)'), '桌宠初始化后应同步当前页面与显示状态');
  assert.ok(renderer.includes("const embeddedInStats = currentView === 'stats'"), '统计页展示完整单图有珠时应隐藏分层悬浮桌宠');
  assert.ok(main.includes('statsUsesWholeImage') && main.includes('statsBlinkStarted') && main.includes('statsYawnStarted') && main.includes('statsSleepStarted') && main.includes('statsHasNoDialogue'), '冒烟测试应验证统计页完整单图的眨眼、哈欠、睡觉与无对话互动');
  assert.ok(main.includes('parseFloat(getComputedStyle(statsAlice).height)'), '统计页立绘固定尺寸应读取布局高度，避免呼吸缩放动画造成冒烟误报');
  assert.ok(main.includes('petStatus.headCutoutClean === true'), '冒烟测试应逐像素验证身体层没有旧头部残影');
  assert.ok(main.includes("petRoot.style.pointerEvents = 'none'"), '桌宠冒烟测试应隔离真实鼠标输入');
  assert.ok(main.includes('petStatus.yawnStarted === true'), '冒烟测试应验证打哈欠动画已启动');
  assert.ok(main.includes('petStatus.hoverKeepsSleeping === true'), '冒烟测试应验证鼠标移入不会唤醒睡眠');
  assert.ok(main.includes('petStatus.translucentHoverWakes === true'), '冒烟测试应验证透明状态下鼠标移入会唤醒并完全显现');
  assert.ok(main.includes('petStatus.translucentLeaveRestores === true'), '冒烟测试应验证鼠标离开后恢复用户透明度且不会重新睡眠');
  assert.ok(main.includes('petStatus.actionStateRestored === true'), '冒烟测试应验证单独动作恢复原状态');
  assert.ok(main.includes('petStatus.autoRestWhileConsoleOpen === true'), '冒烟测试应验证控制台打开时仍会自动休息');
  assert.ok(main.includes('petStatus.autoSleepWhileConsoleOpen === true'), '冒烟测试应验证控制台打开时仍会自动入睡');
  assert.ok(main.includes('petStatus.panelCompact === true'), '冒烟测试应验证控制台尺寸已经缩小');
  assert.ok(main.includes('petStatus.panelScrollable === true'), '冒烟测试应验证控制台内容可以滚动');
  assert.ok(main.includes('petStatus.panelWheelIsolated === true'), '冒烟测试应验证控制台滚轮不会穿透');
  assert.ok(main.includes('petStatus.fpsToggleHides === true'), '冒烟测试应验证帧率显示可以关闭');
  assert.ok(main.includes('petStatus.fpsMeasured === true'), '冒烟测试应验证帧率能够实际测量');
  assert.ok(main.includes('petStatus.fpsTargetMatchesDisplay === true'), '冒烟测试应验证目标刷新率与系统报告值一致');
  assert.ok(main.includes('petStatus.fpsUnavailableOnBlur === true'), '冒烟测试应验证失焦时不显示错误低帧率');
  assert.ok(main.includes('petStatus.blinkInterruptedYawn === true'), '冒烟测试应验证眨眼可打断打哈欠闭眼阶段');
  assert.ok(main.includes('petStatus.blinkInterruptedDrowse === true'), '冒烟测试应验证眨眼可打断困倦闭眼阶段');
  assert.ok(main.includes('petStatus.repeatedBlinkCleaned === true'), '冒烟测试应验证连续眨眼可以正常清理');
  assert.ok(main.includes('petStatus.yawnTextVisible === true'), '冒烟测试应验证打哈欠文字已显示');
  assert.ok(main.includes('petStatus.drowseStarted === true'), '冒烟测试应验证困倦低头和闭眼阶段');
  assert.ok(main.includes('petStatus.drowseCleared === true'), '冒烟测试应验证困倦动作恢复半睁眼');
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
