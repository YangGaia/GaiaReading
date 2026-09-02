'use strict';

/**
 * 赛博桌宠渲染层：
 * - 线性自动时间轴：待机 -> 无聊 -> 困倦 -> 睡觉
 * - 鼠标互动、拖拽和右键控制台
 * - 状态与位置持久化到 pet 键
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../shared/pet'));
  } else {
    root.GaiaPet = factory(root.GaiaPetShared);
  }
})(typeof self !== 'undefined' ? self : this, function (shared) {
  'use strict';

  const {
    PET_STATES,
    EVENTS,
    TIMERS,
    AUTO_BEHAVIORS,
    STATE_EXPRESSIONS,
    CONTROL_EMOTIONS,
    createBrain,
    decideState,
    timeoutState,
    lineFor,
    pick,
    pickIdleExpression,
    nextAutoDelay,
    pickAutoBehavior,
    nextDreamDelay,
    shouldDream,
    formatReadingDuration,
  } = shared;

  const FACE_IMG = 'images/pet/faces/';
  const PART_IMG = 'images/pet/parts/';
  const DEFAULT_STATE = {
    on: true,
    x: null,
    y: null,
    xRatio: null,
    yRatio: null,
    auto: true,
    autoSpeech: true,
    autoSleep: true,
    sleepAfter: TIMERS.SLEEP_AFTER,
    readerCare: true,
    readerCareAfter: TIMERS.READER_CARE_AFTER,
    showFps: true,
    lockedMood: null,
    scale: 1,
    opacity: 1,
    readerMode: 'normal',
  };
  const FACE = {
    halfbody: { x: 134, y: 137, w: 89, h: 78 },
    tile: { w: 134, h: 118, cx: 67.5, cy: 59.5 },
    sheet: { w: 356, h: 647 },
  };
  const HEAD = { x: 88, y: 0, w: 180, h: 235 };
  const ACTION_CLASSES = ['poke', 'drop', 'perk', 'recoil', 'shiver', 'lean', 'drowse', 'wake'];
  const PERFORMANCE_CLASSES = ['performance-tilt', 'performance-thinking', 'performance-peek', 'performance-listen', 'performance-shy', 'performance-angry', 'performance-bored', 'performance-drowse', 'performance-wake', 'performance-yawn'];
  const ACTION_MS = { poke: 350, tilt: 1100, drop: 400, perk: 500, recoil: 360, shiver: 420, yawn: 1700, lean: 600, drowse: 2200, wake: 900 };
  const READER_CARE_INTERVALS = [60 * 1000, 30 * 60 * 1000, 45 * 60 * 1000, 60 * 60 * 1000];
  const STATE_LABELS = {
    idle: '待机', hover: '注视', poke: '被戳', bored: '无聊', sleepy: '困倦',
    sleeping: '睡觉', wake: '唤醒', manual: '手动',
  };
  const LOCKABLE_EMOTIONS = ['thinking', 'shy', 'angry', 'sleepy'];
  const FINAL_EMOTIONS = {
    thinking: { state: PET_STATES.MANUAL, expression: '思考' },
    shy: { state: PET_STATES.MANUAL, expression: '害羞' },
    angry: { state: PET_STATES.MANUAL, expression: '生气' },
    sleepy: { state: PET_STATES.MANUAL, expression: '眼睛微张' },
  };

  let ui = {};
  let brain = createBrain();
  let saved = Object.assign({}, DEFAULT_STATE);
  let initPromise = null;
  let bubbleTimer = null;
  let blinkTimer = null;
  let blinkCleanupTimer = null;
  let nextAutoAt = 0;
  let nextDreamAt = 0;
  let transientUntil = 0;
  let manualHeld = false;
  let lockedEmotion = null;
  let manualEmotionKey = null;
  let manualLabel = '';
  let pointerInside = false;
  let consoleOpen = false;
  let dragging = false;
  let currentView = 'home';
  let speechHistory = [];
  let effectVersion = 0;
  let activePerformance = null;
  let readingStartedAt = 0;
  let fpsRafId = 0;
  let fpsSampleStarted = 0;
  let fpsFrameCount = 0;
  let fpsSamples = [];
  let fpsValue = null;
  let displayFrequency = null;
  let downPos = { x: 0, y: 0 };
  let dragOffset = { x: 0, y: 0 };

  function save() {
    saved.lockedMood = lockedEmotion;
    window.api.stateSet('pet', {
      on: saved.on,
      x: Number.isFinite(saved.x) ? saved.x : null,
      y: Number.isFinite(saved.y) ? saved.y : null,
      xRatio: Number.isFinite(saved.xRatio) ? saved.xRatio : null,
      yRatio: Number.isFinite(saved.yRatio) ? saved.yRatio : null,
      auto: saved.auto,
      autoSpeech: saved.autoSpeech,
      autoSleep: saved.autoSleep,
      sleepAfter: saved.sleepAfter,
      readerCare: saved.readerCare,
      readerCareAfter: saved.readerCareAfter,
      showFps: saved.showFps,
      lockedMood: lockedEmotion,
      scale: saved.scale,
      opacity: saved.opacity,
      readerMode: saved.readerMode,
    });
  }

  function updateVisibility() {
    if (!ui.root) return;
    const hiddenInReader = currentView === 'reader' && saved.readerMode === 'hidden';
    ui.root.hidden = !saved.on || hiddenInReader;
    ui.root.classList.toggle('reader-dim', currentView === 'reader' && saved.readerMode === 'dim');
    ui.root.style.opacity = String(saved.opacity * (ui.root.classList.contains('reader-dim') ? 0.55 : 1));
    syncFpsMeter();
  }

  function resetFpsSampling(markUnavailable) {
    fpsSampleStarted = 0;
    fpsFrameCount = 0;
    fpsSamples = [];
    if (markUnavailable && ui.fps) {
      fpsValue = null;
      ui.fps.dataset.level = 'idle';
      renderFpsLabel();
    }
  }

  function renderFpsLabel() {
    if (!ui.fps) return;
    const fpsText = fpsValue == null ? '--' : String(fpsValue);
    const frequencyText = displayFrequency == null ? '--Hz' : displayFrequency + 'Hz';
    ui.fps.textContent = 'FPS ' + fpsText + ' / ' + frequencyText;
    ui.fps.title = displayFrequency == null ? '系统未报告当前显示器刷新率' : '当前显示器刷新率：' + frequencyText;
  }

  async function refreshDisplayFrequency() {
    try {
      const frequency = await window.api.displayFrequency();
      displayFrequency = Number.isFinite(frequency) && frequency > 0 ? Math.round(frequency) : null;
    } catch {
      displayFrequency = null;
    }
    renderFpsLabel();
  }

  function renderFps(value) {
    if (!ui.fps) return;
    const fps = Math.max(0, Math.round(value));
    fpsValue = fps;
    renderFpsLabel();
    ui.fps.dataset.level = fps >= 50 ? 'good' : fps >= 30 ? 'warn' : 'bad';
  }

  function sampleFps(now) {
    fpsRafId = window.requestAnimationFrame(sampleFps);
    if (document.hidden || !document.hasFocus()) {
      resetFpsSampling(true);
      return;
    }
    if (!fpsSampleStarted) {
      fpsSampleStarted = now;
      fpsFrameCount = 0;
      return;
    }
    fpsFrameCount += 1;
    const elapsed = now - fpsSampleStarted;
    if (elapsed < 1000) return;
    fpsSamples.push(fpsFrameCount * 1000 / elapsed);
    fpsSamples = fpsSamples.slice(-3);
    renderFps(fpsSamples.reduce((sum, fps) => sum + fps, 0) / fpsSamples.length);
    fpsSampleStarted = now;
    fpsFrameCount = 0;
  }

  function startFpsMeter() {
    if (!ui.fps || fpsRafId) return;
    ui.fps.hidden = false;
    ui.root.classList.remove('fps-hidden');
    resetFpsSampling(true);
    fpsRafId = window.requestAnimationFrame(sampleFps);
  }

  function stopFpsMeter() {
    if (fpsRafId) window.cancelAnimationFrame(fpsRafId);
    fpsRafId = 0;
    resetFpsSampling(true);
    if (ui.fps) ui.fps.hidden = true;
    if (ui.root) ui.root.classList.add('fps-hidden');
  }

  function syncFpsMeter() {
    if (!ui.root || !ui.fps) return;
    if (saved.showFps && saved.on && !ui.root.hidden) startFpsMeter();
    else stopFpsMeter();
  }

  function updatePositionRatios() {
    if (!ui.root) return;
    const maxX = Math.max(0, window.innerWidth - ui.root.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - ui.root.offsetHeight);
    saved.xRatio = maxX ? saved.x / maxX : 0;
    saved.yRatio = maxY ? saved.y / maxY : 0;
  }

  function restorePositionFromRatios() {
    if (!ui.root || !Number.isFinite(saved.xRatio) || !Number.isFinite(saved.yRatio)) return false;
    saved.x = saved.xRatio * Math.max(0, window.innerWidth - ui.root.offsetWidth);
    saved.y = saved.yRatio * Math.max(0, window.innerHeight - ui.root.offsetHeight);
    return true;
  }

  function applyAppearance(restorePosition) {
    if (!ui.root) return;
    ui.root.style.width = Math.round(150 * saved.scale) + 'px';
    layoutFace();
    if (restorePosition) restorePositionFromRatios();
    clampPosition();
    updateVisibility();
  }

  function applyExpression(name) {
    if (!ui.face || !name || ui.face.dataset.exp === name) return;
    const file = FACE_IMG + encodeURIComponent(name + '.png');
    ui.face.dataset.exp = name;
    const img = new Image();
    img.onload = () => {
      if (ui.face.dataset.exp !== name) return;
      ui.face.src = file;
      ui.face.style.opacity = '1';
    };
    img.src = file;
  }

  function layoutFace() {
    if (!ui.face || !ui.halfbody || !ui.headRig || !ui.head) return;
    const hb = FACE.halfbody;
    const tile = FACE.tile;
    const s = (ui.body.clientWidth || 150) / FACE.sheet.w;
    const hbCx = hb.x + hb.w / 2;
    const hbCy = hb.y + hb.h / 2;
    const faceLeft = (hbCx - tile.cx) * s;
    const faceTop = (hbCy - tile.cy) * s;
    const faceW = tile.w * s;
    const faceH = tile.h * s;
    ui.headRig.style.height = Math.round(HEAD.h * s) + 'px';
    ui.head.style.width = Math.round(HEAD.w * s) + 'px';
    ui.head.style.left = Math.round(HEAD.x * s) + 'px';
    ui.head.style.top = Math.round(HEAD.y * s) + 'px';
    for (const layer of [ui.face, ui.blinkFace]) {
      layer.style.width = Math.round(faceW) + 'px';
      layer.style.height = Math.round(faceH) + 'px';
      layer.style.left = Math.round(faceLeft) + 'px';
      layer.style.top = Math.round(faceTop) + 'px';
    }
  }

  function updateBubbleSide() {
    if (!ui.bubble) return;
    ui.bubble.classList.toggle('flip', saved.x < 260);
  }

  function hideBubble(immediate) {
    if (!ui.bubble) return;
    window.clearTimeout(bubbleTimer);
    ui.bubble.classList.remove('show');
    if (immediate) {
      ui.bubble.hidden = true;
      return;
    }
    bubbleTimer = window.setTimeout(() => {
      if (!ui.bubble.classList.contains('show')) ui.bubble.hidden = true;
    }, 180);
  }

  function showBubble(text, duration) {
    if (!ui.bubble || !text) return;
    window.clearTimeout(bubbleTimer);
    ui.bubble.textContent = text;
    ui.bubble.title = text;
    speechHistory = [text, ...speechHistory.filter((line) => line !== text)].slice(0, 10);
    renderSpeechHistory();
    ui.bubble.hidden = false;
    ui.bubble.classList.remove('show');
    void ui.bubble.offsetWidth;
    ui.bubble.classList.add('show');
    bubbleTimer = window.setTimeout(() => hideBubble(false), duration || 2600);
  }

  function renderSpeechHistory() {
    if (!ui.speechHistory) return;
    ui.speechHistory.replaceChildren();
    if (!speechHistory.length) {
      const empty = document.createElement('span');
      empty.className = 'gaia-pet-console-empty';
      empty.textContent = '还没有台词';
      ui.speechHistory.appendChild(empty);
      return;
    }
    for (const line of speechHistory) {
      const item = document.createElement('div');
      item.textContent = line;
      ui.speechHistory.appendChild(item);
    }
  }

  function clearActions() {
    if (!ui.body) return;
    for (const cls of ACTION_CLASSES) ui.body.classList.remove(cls);
    if (ui.headRig) {
      for (const cls of PERFORMANCE_CLASSES) ui.headRig.classList.remove(cls);
    }
    for (const cls of PERFORMANCE_CLASSES) ui.body.classList.remove(cls);
    ui.body.classList.remove('no-breathe');
  }

  function clearBlink() {
    window.clearTimeout(blinkCleanupTimer);
    blinkCleanupTimer = null;
    if (ui.blinkFace) ui.blinkFace.classList.remove('blink');
  }

  function interruptEffects() {
    ++effectVersion;
    const restoreExpression = activePerformance && activePerformance.restoreExpression;
    activePerformance = null;
    clearActions();
    clearBlink();
    if (restoreExpression) applyExpression(restoreExpression);
  }

  function playEffect(cls, duration) {
    if (!ui.body) return;
    const startExpression = ui.face && ui.face.dataset.exp;
    interruptEffects();
    applyExpression(startExpression);
    const token = ++effectVersion;
    void ui.body.offsetWidth;
    ui.body.classList.add('no-breathe', cls);
    window.setTimeout(() => {
      if (token !== effectVersion) return;
      ui.body.classList.remove(cls, 'no-breathe');
    }, duration || ACTION_MS[cls] || 600);
    return token;
  }

  function playPerformance(name, duration, stages, restoreExpression) {
    if (!ui.body || !ui.headRig) return null;
    const startExpression = ui.face && ui.face.dataset.exp;
    interruptEffects();
    applyExpression(startExpression);
    const token = ++effectVersion;
    const cls = 'performance-' + name;
    const timeline = stages || [];
    const finalExpression = restoreExpression || (timeline.length && timeline[timeline.length - 1].expression) || startExpression;
    activePerformance = { token, restoreExpression: finalExpression };
    void ui.body.offsetWidth;
    void ui.headRig.offsetWidth;
    ui.body.classList.add('no-breathe', cls);
    ui.headRig.classList.add(cls);
    for (const stage of timeline) {
      window.setTimeout(() => {
        if (token === effectVersion) applyExpression(stage.expression);
      }, stage.at);
    }
    window.setTimeout(() => {
      if (token !== effectVersion || !activePerformance || activePerformance.token !== token) return;
      activePerformance = null;
      clearActions();
      applyExpression(finalExpression);
    }, duration);
    return token;
  }

  function triggerBlink(interrupt) {
    if (!ui.blinkFace || !saved.on || dragging || brain.state === PET_STATES.SLEEPING) return;
    if (interrupt) interruptEffects();
    clearBlink();
    void ui.blinkFace.offsetWidth;
    ui.blinkFace.classList.add('blink');
    blinkCleanupTimer = window.setTimeout(clearBlink, 300);
  }

  function scheduleBlink() {
    window.clearTimeout(blinkTimer);
    blinkTimer = window.setTimeout(() => {
      triggerBlink();
      scheduleBlink();
    }, 2600 + Math.random() * 2600);
  }

  function triggerAction(name, manual, restoreExpression) {
    if (name === 'blink') {
      triggerBlink(!!manual);
      return null;
    }
    if (name === 'tilt') {
      applyExpression('倾听');
      return playPerformance('tilt', ACTION_MS.tilt, null, restoreExpression);
    }
    if (name === 'yawn') {
      hideBubble(true);
      applyExpression('眼睛微张');
      const token = playPerformance('yawn', ACTION_MS.yawn, [
        { at: 260, expression: '打哈欠' },
        { at: 1180, expression: '安心' },
        { at: 1480, expression: '日常表情' },
      ], restoreExpression);
      window.setTimeout(() => {
        if (token === effectVersion && (manual || saved.autoSpeech)) showBubble(lineFor('yawn'), 1300);
      }, 280);
      return token;
    }
    if (name === 'sleep') return null;
    return playEffect(name, ACTION_MS[name]);
  }

  function idlePerformance() {
    const performance = pick(['thinking', 'peek', 'listen', 'yawn']);
    if (performance === 'thinking') {
      applyExpression('思考');
      playPerformance('thinking', 1200);
    } else if (performance === 'peek') {
      applyExpression('偷看');
      playPerformance('peek', 850);
    } else if (performance === 'listen') {
      applyExpression('倾听');
      playPerformance('listen', 700);
    } else {
      triggerAction('yawn', false);
    }
  }

  function playDrowsePerformance() {
    applyExpression('眼睛微张');
    return playPerformance('drowse', ACTION_MS.drowse, [
      { at: 620, expression: '安心' },
      { at: 1650, expression: '眼睛微张' },
    ]);
  }

  function canTrackReading() {
    return saved.on && saved.readerCare && currentView === 'reader' && !document.hidden && document.hasFocus();
  }

  function readingElapsed(now) {
    return readingStartedAt ? Math.max(0, now - readingStartedAt) : 0;
  }

  function updateReadingCareStatus(now) {
    if (!ui.readingCareStatus) return;
    if (!saved.readerCare) {
      ui.readingCareStatus.textContent = '阅读关怀已关闭';
      return;
    }
    if (currentView !== 'reader') {
      ui.readingCareStatus.textContent = '未在阅读 · 进入阅读页后开始计时';
      return;
    }
    ui.readingCareStatus.textContent = '连续阅读 ' + formatReadingDuration(readingElapsed(now == null ? Date.now() : now)) +
      ' / ' + formatReadingDuration(saved.readerCareAfter);
  }

  function resetReadingSession() {
    readingStartedAt = 0;
    updateReadingCareStatus(Date.now());
  }

  function startReadingSession(now) {
    if (!canTrackReading()) return false;
    if (!readingStartedAt) readingStartedAt = now == null ? Date.now() : now;
    updateReadingCareStatus(now);
    return true;
  }

  function showReadingCareReminder(resetTimer) {
    showBubble(lineFor('readingCare'), 4200);
    if (resetTimer) readingStartedAt = Date.now();
    if (brain.state === PET_STATES.SLEEPING) nextDreamAt = Date.now() + nextDreamDelay();
    updateReadingCareStatus(Date.now());
  }

  function updateReadingCare(now) {
    if (!canTrackReading()) {
      if (readingStartedAt) resetReadingSession();
      return false;
    }
    if (!readingStartedAt) readingStartedAt = now;
    if (readingElapsed(now) >= saved.readerCareAfter) {
      showReadingCareReminder(true);
      return true;
    }
    updateReadingCareStatus(now);
    return false;
  }

  function currentStateLabel() {
    if (brain.state === PET_STATES.MANUAL && manualLabel) return manualLabel;
    return STATE_LABELS[brain.state] || '待机';
  }

  function updateConsole() {
    if (!ui.console) return;
    if (ui.consoleState) ui.consoleState.textContent = '当前：' + currentStateLabel();
    if (ui.autoToggle) ui.autoToggle.checked = saved.auto;
    if (ui.speechToggle) {
      ui.speechToggle.checked = saved.autoSpeech;
      ui.speechToggle.disabled = !saved.auto;
    }
    if (ui.sleepToggle) {
      ui.sleepToggle.checked = saved.autoSleep;
      ui.sleepToggle.disabled = !saved.auto;
    }
    if (ui.sleepSelect) {
      ui.sleepSelect.value = String(saved.sleepAfter);
      ui.sleepSelect.disabled = !saved.auto || !saved.autoSleep;
    }
    if (ui.readingCareToggle) ui.readingCareToggle.checked = saved.readerCare;
    if (ui.readingCareSelect) {
      ui.readingCareSelect.value = String(saved.readerCareAfter);
      ui.readingCareSelect.disabled = !saved.readerCare;
    }
    if (ui.readingCareTest) ui.readingCareTest.disabled = !saved.readerCare;
    if (ui.fpsToggle) ui.fpsToggle.checked = saved.showFps;
    updateReadingCareStatus(Date.now());
    if (ui.scaleSelect) ui.scaleSelect.value = String(saved.scale);
    if (ui.opacitySelect) ui.opacitySelect.value = String(saved.opacity);
    if (ui.readerModeSelect) ui.readerModeSelect.value = saved.readerMode;
    if (ui.lockButton) {
      const canLock = LOCKABLE_EMOTIONS.includes(manualEmotionKey);
      ui.lockButton.disabled = !canLock;
      ui.lockButton.classList.toggle('active', !!lockedEmotion);
      ui.lockButton.textContent = lockedEmotion ? `解除锁定 · ${CONTROL_EMOTIONS[lockedEmotion].label}` : '锁定当前情绪';
    }
    if (ui.emotionButtons) {
      for (const button of ui.emotionButtons) {
        button.classList.toggle('active', button.dataset.emotion === manualEmotionKey);
        button.classList.toggle('locked', button.dataset.emotion === lockedEmotion);
      }
    }
  }

  function setState(state, expression) {
    const wasSleeping = brain.state === PET_STATES.SLEEPING;
    brain.state = state;
    if (ui.root) ui.root.dataset.state = state;
    const sleeping = state === PET_STATES.SLEEPING;
    if (ui.body) {
      if (sleeping) {
        interruptEffects();
      }
      ui.body.classList.toggle('sleeping', sleeping);
    }
    if (ui.headRig) ui.headRig.classList.toggle('sleeping', sleeping);
    if (ui.zzz) ui.zzz.hidden = !sleeping;
    if (sleeping && !wasSleeping) nextDreamAt = Date.now() + nextDreamDelay();
    if (!sleeping) nextDreamAt = 0;
    applyExpression(expression);
    updateConsole();
  }

  function resetActivity(now) {
    const t = now == null ? Date.now() : now;
    brain.lastInteract = t;
    nextAutoAt = t + nextAutoDelay();
  }

  function returnToIdle(now) {
    interruptEffects();
    manualHeld = false;
    lockedEmotion = null;
    manualEmotionKey = null;
    manualLabel = '';
    transientUntil = 0;
    setState(PET_STATES.IDLE, pickIdleExpression(ui.face && ui.face.dataset.exp));
    resetActivity(now);
  }

  function wakeUp(now) {
    const canWake = brain.state === PET_STATES.SLEEPING || brain.state === PET_STATES.SLEEPY || brain.state === PET_STATES.BORED || manualHeld;
    if (!canWake) return false;
    manualHeld = false;
    lockedEmotion = null;
    manualEmotionKey = null;
    manualLabel = '';
    const d = decideState(brain, EVENTS.INTERACT, now);
    setState(d.state, '眼睛微张');
    showBubble(lineFor('wake'));
    playPerformance('wake', ACTION_MS.wake, [{ at: 360, expression: '日常表情' }]);
    transientUntil = now + TIMERS.TRANSIENT_AFTER;
    resetActivity(now);
    return true;
  }

  function enterAutoState(change) {
    if (change.state === PET_STATES.BORED) {
      setState(change.state, change.expression);
      if (saved.autoSpeech) showBubble(lineFor('bored'));
      playPerformance('bored', 900);
    } else if (change.state === PET_STATES.SLEEPY) {
      setState(change.state, '眼睛微张');
      if (saved.autoSpeech) showBubble(lineFor('sleepy'));
      playDrowsePerformance();
    } else if (change.state === PET_STATES.SLEEPING) {
      setState(change.state, '安心');
      if (saved.autoSpeech) showBubble(lineFor('sleepTransition'), 2600);
      else hideBubble(false);
    }
  }

  function maybeDream(now) {
    if (!nextDreamAt) nextDreamAt = now + nextDreamDelay();
    if (now < nextDreamAt) return;
    nextDreamAt = now + nextDreamDelay();
    if (saved.auto && saved.autoSpeech && shouldDream()) showBubble(lineFor('sleeping'), 3200);
  }

  function runIdleBehavior() {
    const behavior = pickAutoBehavior();
    if (behavior === AUTO_BEHAVIORS.EXPRESSION) {
      applyExpression(pickIdleExpression(ui.face && ui.face.dataset.exp));
    } else if (behavior === AUTO_BEHAVIORS.ACTION) {
      idlePerformance();
    } else if (behavior === AUTO_BEHAVIORS.SPEECH) {
      applyExpression(pickIdleExpression(ui.face && ui.face.dataset.exp));
      if (saved.autoSpeech) showBubble(lineFor('idle'));
      else idlePerformance();
    }
  }

  function finishTransient(now) {
    if (!transientUntil || now < transientUntil || lockedEmotion || manualHeld) return;
    transientUntil = 0;
    manualLabel = '';
    if (pointerInside) {
      setState(PET_STATES.HOVER, pick(STATE_EXPRESSIONS.hover));
    } else {
      returnToIdle(now);
    }
  }

  function tick() {
    const now = Date.now();
    const careTriggered = updateReadingCare(now);
    if (!saved.on || dragging || careTriggered) return;
    finishTransient(now);
    if (brain.state === PET_STATES.SLEEPING) {
      maybeDream(now);
      return;
    }
    if (pointerInside || lockedEmotion || manualHeld) return;
    if (!saved.auto) return;
    if (saved.autoSleep) {
      const change = timeoutState(brain, now, saved.sleepAfter);
      if (change) {
        enterAutoState(change);
        return;
      }
    }
    if (consoleOpen) return;
    if (brain.state !== PET_STATES.IDLE || now < nextAutoAt) return;
    runIdleBehavior();
    nextAutoAt = now + nextAutoDelay();
  }

  function onHover() {
    pointerInside = true;
    const now = Date.now();
    if (lockedEmotion) return;
    if (brain.state === PET_STATES.SLEEPING || manualHeld) return;
    if (wakeUp(now)) return;
    resetActivity(now);
    const d = decideState(brain, EVENTS.HOVER, now);
    setState(d.state, d.expression);
    showBubble(lineFor('hover'));
    triggerAction('perk');
  }

  function onLeave() {
    pointerInside = false;
    if (dragging || consoleOpen || lockedEmotion || manualHeld) return;
    returnToIdle(Date.now());
  }

  function onClick(ev) {
    if (Math.abs(ev.clientX - downPos.x) > 4 || Math.abs(ev.clientY - downPos.y) > 4) return;
    interact(Date.now());
  }

  function interact(now) {
    if (wakeUp(now)) return;
    resetActivity(now);
    if (lockedEmotion) {
      showBubble(lineFor('poke'));
      triggerAction('poke');
      return;
    }
    const d = decideState(brain, EVENTS.CLICK, now);
    brain.pokeCount = d.pokeCount;
    brain.lastPokeAt = now;
    setState(d.state, d.expression);
    showBubble(lineFor(d.pokeLine));
    triggerAction(d.pokeMany ? 'shiver' : 'poke');
    transientUntil = now + TIMERS.TRANSIENT_AFTER;
  }

  function positionConsole() {
    if (!ui.console || !ui.root || ui.console.hidden) return;
    const r = ui.root.getBoundingClientRect();
    const w = ui.console.offsetWidth || 260;
    const h = ui.console.offsetHeight || 360;
    let left = r.right + 12;
    if (left + w > window.innerWidth - 8) left = r.left - w - 12;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    const top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top));
    ui.console.style.left = left + 'px';
    ui.console.style.top = top + 'px';
  }

  function openConsole(ev) {
    ev.preventDefault();
    consoleOpen = true;
    resetActivity(Date.now());
    ui.console.hidden = false;
    updateConsole();
    positionConsole();
  }

  function closeConsole(reset) {
    if (!ui.console || ui.console.hidden) return;
    ui.console.hidden = true;
    consoleOpen = false;
  }

  function runEmotion(key) {
    if (key === 'random') key = pick(['thinking', 'shy', 'angry', 'sleepy']);
    const config = CONTROL_EMOTIONS[key];
    if (!config) return;
    const now = Date.now();
    resetActivity(now);
    hideBubble(true);
    manualLabel = config.label;

    if (key === 'idle') {
      returnToIdle(now);
      save();
      return;
    }
    if (key === 'wake') {
      manualHeld = false;
      lockedEmotion = null;
      manualEmotionKey = null;
      setState(PET_STATES.WAKE, '眼睛微张');
      showBubble(lineFor(config.line));
      playPerformance('wake', ACTION_MS.wake, [{ at: 360, expression: '日常表情' }]);
      transientUntil = now + TIMERS.TRANSIENT_AFTER;
      save();
      return;
    }
    if (key === 'sleeping') {
      manualHeld = true;
      lockedEmotion = null;
      manualEmotionKey = null;
      transientUntil = 0;
      setState(PET_STATES.SLEEPING, pick(config.expressions));
      showBubble(lineFor('sleepTransition'), 2600);
      save();
      return;
    }

    manualHeld = false;
    manualEmotionKey = key;
    if (lockedEmotion) lockedEmotion = key;
    if (key === 'thinking') {
      setState(PET_STATES.MANUAL, '思考');
      playPerformance('thinking', 1200);
    } else if (key === 'shy') {
      setState(PET_STATES.MANUAL, '愣住');
      playPerformance('shy', 900, [{ at: 180, expression: '害羞' }]);
    } else if (key === 'angry') {
      setState(PET_STATES.MANUAL, '冷脸');
      playPerformance('angry', 820, [{ at: 180, expression: '生气' }]);
    } else if (key === 'sleepy') {
      setState(PET_STATES.MANUAL, '眼睛微张');
      playDrowsePerformance();
    }
    if (config.line) showBubble(lineFor(config.line));
    transientUntil = lockedEmotion ? 0 : now + TIMERS.MANUAL_AFTER;
    save();
  }

  function runManualAction(name) {
    const now = Date.now();
    if (!['yawn', 'tilt', 'blink'].includes(name)) return;
    if (brain.state === PET_STATES.SLEEPING) {
      if (wakeUp(now)) window.setTimeout(() => runManualAction(name), ACTION_MS.wake + 40);
      return;
    }
    const previous = {
      state: brain.state,
      expression: (activePerformance && activePerformance.restoreExpression) || (ui.face && ui.face.dataset.exp),
      label: manualLabel,
      emotion: manualEmotionKey,
      held: manualHeld,
    };
    resetActivity(now);
    const duration = name === 'blink' ? 220 : ACTION_MS[name];
    if (transientUntil) transientUntil = Math.max(transientUntil, now + duration + 40);
    const token = triggerAction(name, true, previous.expression);
    if (name === 'blink') return;
    window.setTimeout(() => {
      if (token !== effectVersion || brain.state !== previous.state) return;
      manualLabel = previous.label;
      manualEmotionKey = previous.emotion;
      manualHeld = previous.held;
      applyExpression(previous.expression);
      updateConsole();
    }, duration + 20);
  }

  function toggleEmotionLock() {
    if (!LOCKABLE_EMOTIONS.includes(manualEmotionKey)) return;
    if (lockedEmotion === manualEmotionKey) {
      lockedEmotion = null;
      returnToIdle(Date.now());
    } else {
      lockedEmotion = manualEmotionKey;
      transientUntil = 0;
    }
    save();
    updateConsole();
  }

  function clampPosition() {
    if (!ui.root) return;
    const bw = ui.root.offsetWidth;
    const bh = ui.root.offsetHeight;
    saved.x = Math.max(0, Math.min(Math.max(0, window.innerWidth - bw), saved.x));
    saved.y = Math.max(0, Math.min(Math.max(0, window.innerHeight - bh), saved.y));
    ui.root.style.left = saved.x + 'px';
    ui.root.style.top = saved.y + 'px';
    updateBubbleSide();
  }

  function bind() {
    const target = ui.hitbox;
    target.addEventListener('pointerenter', onHover);
    target.addEventListener('pointerleave', onLeave);
    target.addEventListener('click', onClick);
    target.addEventListener('contextmenu', openConsole);
    ui.blinkFace.addEventListener('animationend', (ev) => {
      if (ev.animationName === 'pet-eye-sprite-blink') clearBlink();
    });
    target.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        ev.stopPropagation();
        interact(Date.now());
        return;
      }
      if (ev.key === 'F10' && ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        openConsole(ev);
        return;
      }
      const movement = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[ev.key];
      if (!movement) return;
      ev.preventDefault();
      ev.stopPropagation();
      saved.x += movement[0];
      saved.y += movement[1];
      clampPosition();
      updatePositionRatios();
      save();
    });
    target.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const r = ui.root.getBoundingClientRect();
      downPos = { x: ev.clientX, y: ev.clientY };
      dragOffset = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    });

    document.addEventListener('pointerdown', (ev) => {
      if (!consoleOpen || ui.console.contains(ev.target) || ui.root.contains(ev.target)) return;
      closeConsole(true);
    });
    document.addEventListener('keydown', (ev) => {
      if (!consoleOpen || ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      closeConsole(true);
    }, true);
    window.addEventListener('blur', () => {
      resetReadingSession();
      resetFpsSampling(true);
    });
    window.addEventListener('focus', () => {
      startReadingSession(Date.now());
      resetFpsSampling(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        resetReadingSession();
        resetFpsSampling(true);
      } else {
        startReadingSession(Date.now());
        resetFpsSampling(true);
      }
    });
    window.addEventListener('resize', () => {
      restorePositionFromRatios();
      clampPosition();
      positionConsole();
      save();
    });

    function onDragMove(ev) {
      if (Math.abs(ev.clientX - downPos.x) <= 4 && Math.abs(ev.clientY - downPos.y) <= 4) return;
      if (!dragging) {
        dragging = true;
        transientUntil = 0;
        closeConsole(false);
        ui.root.classList.add('dragging');
        ui.body.classList.add('no-breathe');
      }
      const bw = ui.root.offsetWidth;
      const bh = ui.root.offsetHeight;
      saved.x = Math.max(0, Math.min(Math.max(0, window.innerWidth - bw), ev.clientX - dragOffset.x));
      saved.y = Math.max(0, Math.min(Math.max(0, window.innerHeight - bh), ev.clientY - dragOffset.y));
      ui.root.style.left = saved.x + 'px';
      ui.root.style.top = saved.y + 'px';
      updateBubbleSide();
    }

    function endDrag() {
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      if (!dragging) return;
      dragging = false;
      ui.root.classList.remove('dragging');
      returnToIdle(Date.now());
      triggerAction('drop');
      updatePositionRatios();
      save();
    }
  }

  function makeButton(label, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className || 'gaia-pet-console-button';
    button.textContent = label;
    return button;
  }

  function makeToggle(label, onChange) {
    const row = document.createElement('label');
    row.className = 'gaia-pet-console-toggle';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => onChange(input.checked));
    row.append(text, input);
    return { row, input };
  }

  function buildConsole() {
    const panel = document.createElement('section');
    panel.className = 'gaia-pet-console';
    panel.hidden = true;
    panel.setAttribute('aria-label', '有珠控制台');

    const header = document.createElement('div');
    header.className = 'gaia-pet-console-header';
    const title = document.createElement('strong');
    title.textContent = '有珠控制台';
    const close = makeButton('×', 'gaia-pet-console-close');
    close.setAttribute('aria-label', '关闭控制台');
    close.addEventListener('click', () => closeConsole(true));
    header.append(title, close);
    const state = document.createElement('div');
    state.className = 'gaia-pet-console-state';
    const consoleTop = document.createElement('div');
    consoleTop.className = 'gaia-pet-console-top';
    consoleTop.append(header, state);

    const emotionTitle = document.createElement('div');
    emotionTitle.className = 'gaia-pet-console-label';
    emotionTitle.textContent = '快速情绪';
    const emotions = document.createElement('div');
    emotions.className = 'gaia-pet-console-grid';
    const emotionButtons = [];
    for (const key of ['idle', 'thinking', 'shy', 'angry', 'sleepy', 'sleeping', 'wake', 'random']) {
      const label = key === 'random' ? '随机' : CONTROL_EMOTIONS[key].label;
      const button = makeButton(label);
      button.dataset.emotion = key;
      button.addEventListener('click', () => runEmotion(key));
      emotions.appendChild(button);
      emotionButtons.push(button);
    }

    const actionTitle = document.createElement('div');
    actionTitle.className = 'gaia-pet-console-label';
    actionTitle.textContent = '单独动作';
    const actions = document.createElement('div');
    actions.className = 'gaia-pet-console-grid actions';
    for (const item of [['yawn', '打哈欠'], ['tilt', '歪头'], ['blink', '眨眼']]) {
      const button = makeButton(item[1]);
      button.dataset.action = item[0];
      button.addEventListener('click', () => runManualAction(item[0]));
      actions.appendChild(button);
    }

    const autoTitle = document.createElement('div');
    autoTitle.className = 'gaia-pet-console-label';
    autoTitle.textContent = '自动行为';
    const autoToggle = makeToggle('自主活动总开关', (checked) => {
      saved.auto = checked;
      if (!checked && !manualHeld && !lockedEmotion) returnToIdle(Date.now());
      else resetActivity(Date.now());
      save();
      updateConsole();
    });
    const speechToggle = makeToggle('自主台词', (checked) => {
      saved.autoSpeech = checked;
      if (!checked) hideBubble(false);
      save();
    });
    const sleepToggle = makeToggle('自动休息', (checked) => {
      saved.autoSleep = checked;
      if (!checked && !manualHeld && !lockedEmotion && [PET_STATES.BORED, PET_STATES.SLEEPY, PET_STATES.SLEEPING].includes(brain.state)) returnToIdle(Date.now());
      save();
      updateConsole();
    });

    const sleepRow = document.createElement('label');
    sleepRow.className = 'gaia-pet-console-select-row';
    const sleepLabel = document.createElement('span');
    sleepLabel.textContent = '入睡速度';
    const sleepSelect = document.createElement('select');
    for (const item of [[20000, '快速 · 20秒'], [35000, '标准 · 35秒'], [60000, '舒缓 · 60秒']]) {
      const option = document.createElement('option');
      option.value = String(item[0]);
      option.textContent = item[1];
      sleepSelect.appendChild(option);
    }
    sleepSelect.addEventListener('change', () => {
      saved.sleepAfter = Number(sleepSelect.value) || TIMERS.SLEEP_AFTER;
      resetActivity(Date.now());
      save();
    });
    sleepRow.append(sleepLabel, sleepSelect);

    const careTitle = document.createElement('div');
    careTitle.className = 'gaia-pet-console-label';
    careTitle.textContent = '阅读关怀';
    const careToggle = makeToggle('连续阅读提醒', (checked) => {
      saved.readerCare = checked;
      resetReadingSession();
      if (checked) startReadingSession(Date.now());
      save();
      updateConsole();
    });
    careToggle.input.dataset.readingCareToggle = 'true';
    const careStatus = document.createElement('div');
    careStatus.className = 'gaia-pet-console-care-status';
    const careRow = document.createElement('label');
    careRow.className = 'gaia-pet-console-select-row';
    const careLabel = document.createElement('span');
    careLabel.textContent = '提醒间隔';
    const careSelect = document.createElement('select');
    careSelect.dataset.readingCareInterval = 'true';
    for (const item of [[60000, '测试 · 1分钟'], [1800000, '30分钟'], [2700000, '45分钟'], [3600000, '60分钟']]) {
      const option = document.createElement('option');
      option.value = String(item[0]);
      option.textContent = item[1];
      careSelect.appendChild(option);
    }
    careSelect.addEventListener('change', () => {
      saved.readerCareAfter = Number(careSelect.value) || TIMERS.READER_CARE_AFTER;
      resetReadingSession();
      startReadingSession(Date.now());
      save();
      updateConsole();
    });
    careRow.append(careLabel, careSelect);
    const careTest = makeButton('立即测试提醒', 'gaia-pet-console-button gaia-pet-console-care-test');
    careTest.dataset.readingCareTest = 'true';
    careTest.addEventListener('click', () => showReadingCareReminder(false));

    const displayTitle = document.createElement('div');
    displayTitle.className = 'gaia-pet-console-label';
    displayTitle.textContent = '显示设置';
    const fpsToggle = makeToggle('显示界面帧率', (checked) => {
      saved.showFps = checked;
      syncFpsMeter();
      clampPosition();
      updatePositionRatios();
      save();
      updateConsole();
    });
    fpsToggle.input.dataset.fpsToggle = 'true';
    const makeSelectRow = (label, options, onChange) => {
      const row = document.createElement('label');
      row.className = 'gaia-pet-console-select-row';
      const text = document.createElement('span');
      text.textContent = label;
      const select = document.createElement('select');
      for (const [value, name] of options) {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = name;
        select.appendChild(option);
      }
      select.addEventListener('change', () => onChange(select.value));
      row.append(text, select);
      return { row, select };
    };
    const scale = makeSelectRow('尺寸', [[0.75, '75%'], [1, '100%'], [1.25, '125%'], [1.5, '150%']], (value) => {
      updatePositionRatios();
      saved.scale = Number(value) || 1;
      applyAppearance(true);
      save();
      positionConsole();
    });
    const opacity = makeSelectRow('透明度', [[0.4, '40%'], [0.6, '60%'], [0.8, '80%'], [1, '100%']], (value) => {
      saved.opacity = Number(value) || 1;
      updateVisibility();
      save();
    });
    const readerMode = makeSelectRow('阅读页', [['normal', '正常显示'], ['dim', '半透明'], ['hidden', '自动隐藏']], (value) => {
      saved.readerMode = ['normal', 'dim', 'hidden'].includes(value) ? value : 'normal';
      updateVisibility();
      save();
    });

    const historyTitle = document.createElement('div');
    historyTitle.className = 'gaia-pet-console-label gaia-pet-console-history-title';
    const historyLabel = document.createElement('span');
    historyLabel.textContent = '最近台词';
    const clearHistory = makeButton('清空', 'gaia-pet-console-history-clear');
    clearHistory.addEventListener('click', () => {
      speechHistory = [];
      renderSpeechHistory();
    });
    historyTitle.append(historyLabel, clearHistory);
    const history = document.createElement('div');
    history.className = 'gaia-pet-console-history';

    const lock = makeButton('锁定当前情绪', 'gaia-pet-console-lock');
    lock.addEventListener('click', toggleEmotionLock);
    panel.append(consoleTop, emotionTitle, emotions, actionTitle, actions, autoTitle,
      autoToggle.row, speechToggle.row, sleepToggle.row, sleepRow, careTitle, careToggle.row,
      careStatus, careRow, careTest, lock, displayTitle,
      fpsToggle.row, scale.row, opacity.row, readerMode.row, historyTitle, history);
    panel.addEventListener('wheel', (ev) => ev.stopPropagation(), { passive: true });
    document.body.appendChild(panel);
    ui.console = panel;
    ui.consoleState = state;
    ui.emotionButtons = emotionButtons;
    ui.autoToggle = autoToggle.input;
    ui.speechToggle = speechToggle.input;
    ui.sleepToggle = sleepToggle.input;
    ui.sleepSelect = sleepSelect;
    ui.readingCareToggle = careToggle.input;
    ui.readingCareStatus = careStatus;
    ui.readingCareSelect = careSelect;
    ui.readingCareTest = careTest;
    ui.fpsToggle = fpsToggle.input;
    ui.lockButton = lock;
    ui.scaleSelect = scale.select;
    ui.opacitySelect = opacity.select;
    ui.readerModeSelect = readerMode.select;
    ui.speechHistory = history;
    renderSpeechHistory();
  }

  function build() {
    const root = document.createElement('div');
    root.id = 'gaia-pet';
    root.className = 'gaia-pet';
    root.title = '久远寺有珠 · 右键打开控制台';
    const hitbox = document.createElement('div');
    hitbox.className = 'gaia-pet-hitbox';
    hitbox.tabIndex = 0;
    hitbox.setAttribute('role', 'button');
    hitbox.setAttribute('aria-label', '久远寺有珠桌宠。按回车互动，按 Shift+F10 打开控制台。');
    hitbox.title = root.title;
    const bubble = document.createElement('div');
    bubble.className = 'gaia-pet-bubble';
    bubble.hidden = true;
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');
    bubble.addEventListener('click', () => hideBubble(false));
    const body = document.createElement('div');
    body.className = 'gaia-pet-body';
    const halfbody = document.createElement('img');
    halfbody.className = 'gaia-pet-halfbody';
    halfbody.draggable = false;
    halfbody.alt = '';
    halfbody.addEventListener('load', () => {
      layoutFace();
      clampPosition();
    });
    halfbody.src = PART_IMG + 'body.png';
    const headRig = document.createElement('div');
    headRig.className = 'gaia-pet-head-rig';
    const head = document.createElement('img');
    head.className = 'gaia-pet-head';
    head.src = PART_IMG + 'head.png';
    head.draggable = false;
    head.alt = '';
    const face = document.createElement('img');
    face.className = 'gaia-pet-face';
    face.src = FACE_IMG + encodeURIComponent('日常表情.png');
    face.draggable = false;
    face.alt = '';
    const blinkFace = document.createElement('img');
    blinkFace.className = 'gaia-pet-face gaia-pet-blink-face';
    blinkFace.src = FACE_IMG + encodeURIComponent('安心.png');
    blinkFace.draggable = false;
    blinkFace.alt = '';
    const zzz = document.createElement('div');
    zzz.className = 'gaia-pet-zzz';
    zzz.textContent = 'Zzz';
    zzz.hidden = true;
    const fps = document.createElement('div');
    fps.className = 'gaia-pet-fps';
    fps.textContent = 'FPS -- / --Hz';
    fps.dataset.level = 'idle';
    fps.setAttribute('aria-label', '界面帧率');
    headRig.append(head, face, blinkFace);
    body.append(halfbody, headRig);
    root.append(bubble, body, zzz, fps, hitbox);
    document.body.appendChild(root);
    ui = { root, hitbox, bubble, body, halfbody, headRig, head, face, blinkFace, zzz, fps };
    buildConsole();
  }

  async function initialize() {
    const savedState = await window.api.stateGet('pet');
    if (savedState && typeof savedState === 'object') {
      saved.on = savedState.on !== false;
      saved.auto = savedState.auto !== false;
      saved.autoSpeech = savedState.autoSpeech !== false;
      saved.autoSleep = savedState.autoSleep !== false;
      saved.readerCare = savedState.readerCare !== false;
      saved.showFps = savedState.showFps !== false;
      if (LOCKABLE_EMOTIONS.includes(savedState.lockedMood)) saved.lockedMood = savedState.lockedMood;
      if ([20000, 35000, 60000].includes(savedState.sleepAfter)) saved.sleepAfter = savedState.sleepAfter;
      if (READER_CARE_INTERVALS.includes(savedState.readerCareAfter)) saved.readerCareAfter = savedState.readerCareAfter;
      if ([0.75, 1, 1.25, 1.5].includes(savedState.scale)) saved.scale = savedState.scale;
      if ([0.4, 0.6, 0.8, 1].includes(savedState.opacity)) saved.opacity = savedState.opacity;
      if (['normal', 'dim', 'hidden'].includes(savedState.readerMode)) saved.readerMode = savedState.readerMode;
      if (Number.isFinite(savedState.xRatio) && Number.isFinite(savedState.yRatio)) {
        saved.xRatio = Math.max(0, Math.min(1, savedState.xRatio));
        saved.yRatio = Math.max(0, Math.min(1, savedState.yRatio));
      }
      if (Number.isFinite(savedState.x) && Number.isFinite(savedState.y)) {
        saved.x = savedState.x;
        saved.y = savedState.y;
      }
    }
    build();
    ui.root.style.width = Math.round(150 * saved.scale) + 'px';
    layoutFace();
    bind();
    if (!restorePositionFromRatios() && (saved.x == null || saved.y == null)) {
      const r = ui.root.getBoundingClientRect();
      saved.x = Math.max(8, window.innerWidth - r.width - 24);
      saved.y = Math.max(8, window.innerHeight - r.height - 24);
    }
    clampPosition();
    updatePositionRatios();
    updateVisibility();
    manualLabel = '';
    if (saved.lockedMood) {
      lockedEmotion = saved.lockedMood;
      manualEmotionKey = saved.lockedMood;
      manualLabel = CONTROL_EMOTIONS[saved.lockedMood].label;
      const restored = FINAL_EMOTIONS[saved.lockedMood];
      setState(restored.state, restored.expression);
    } else {
      setState(PET_STATES.IDLE, '日常表情');
    }
    resetActivity(Date.now());
    updateConsole();
    refreshDisplayFrequency();
    window.api.onDisplayFrequencyChanged((frequency) => {
      displayFrequency = Number.isFinite(frequency) && frequency > 0 ? Math.round(frequency) : null;
      renderFpsLabel();
      resetFpsSampling(true);
    });
    window.setInterval(tick, 500);
    scheduleBlink();
    save();
  }

  function init() {
    if (!initPromise) initPromise = initialize();
    return initPromise;
  }

  function setEnabled(on) {
    saved.on = !!on;
    updateVisibility();
    if (!saved.on) {
      resetReadingSession();
      closeConsole(false);
      hideBubble(true);
    } else if (ui.root) {
      manualHeld = false;
      lockedEmotion = null;
      manualEmotionKey = null;
      returnToIdle(Date.now());
      startReadingSession(Date.now());
    }
    save();
  }

  function setView(view) {
    const nextView = view || 'home';
    if (nextView !== currentView) resetReadingSession();
    currentView = nextView;
    updateVisibility();
    startReadingSession(Date.now());
    updateReadingCareStatus(Date.now());
  }

  return {
    init,
    whenReady: () => initPromise || Promise.resolve(),
    setEnabled,
    setView,
    getState: () => Object.assign({}, saved),
    getBrain: () => Object.assign({}, brain),
    openConsole: () => openConsole({ preventDefault() {} }),
    closeConsole: () => closeConsole(true),
    runEmotion,
    runAction: runManualAction,
  };
});
