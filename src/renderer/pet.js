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
    gazeTargetForPoint,
  } = shared;

  const FACE_IMG = 'images/pet/faces/';
  const PART_IMG = 'images/pet/parts/';
  const GAZE_IMG = 'images/pet/gaze/';
  const GAZE_FRAMES = [
    'look-m100.png', 'look-m075.png', 'look-m050.png', 'look-m025.png', 'look-center.png',
    'look-p025.png', 'look-p050.png', 'look-p075.png', 'look-p100.png',
  ];
  const DEFAULT_STATE = {
    on: true,
    x: null,
    y: null,
    auto: true,
    autoSpeech: true,
    autoSleep: true,
    sleepAfter: TIMERS.SLEEP_AFTER,
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
  const STATE_LABELS = {
    idle: '待机', hover: '注视', poke: '被戳', bored: '无聊', sleepy: '困倦',
    sleeping: '睡觉', wake: '唤醒', manual: '手动',
  };

  let ui = {};
  let brain = createBrain();
  let saved = Object.assign({}, DEFAULT_STATE);
  let initPromise = null;
  let bubbleTimer = null;
  let blinkTimer = null;
  let nextAutoAt = 0;
  let transientUntil = 0;
  let manualHeld = false;
  let manualLocked = false;
  let manualLabel = '';
  let pointerInside = false;
  let consoleOpen = false;
  let dragging = false;
  let effectVersion = 0;
  let downPos = { x: 0, y: 0 };
  let dragOffset = { x: 0, y: 0 };
  let gazePointer = null;
  let gazeFrame = 0;
  let displayedGazeFrame = 4;
  const gazeMotion = { x: 0, y: 0, vx: 0, vy: 0, lastAt: 0 };

  function save() {
    window.api.stateSet('pet', {
      on: saved.on,
      x: Number.isFinite(saved.x) ? saved.x : null,
      y: Number.isFinite(saved.y) ? saved.y : null,
      auto: saved.auto,
      autoSpeech: saved.autoSpeech,
      autoSleep: saved.autoSleep,
      sleepAfter: saved.sleepAfter,
    });
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

  function gazeIsSuppressed() {
    return !saved.on || dragging || brain.state === PET_STATES.SLEEPING ||
      !ui.body || ui.body.classList.contains('no-breathe');
  }

  function renderGaze() {
    if (!ui.headGaze || !ui.halfbody || !ui.head || !ui.face || !ui.blinkFace || !ui.root) return;
    const framesReady = ui.gazeFrames && ui.gazeFrames.every((frame) => frame.complete && frame.naturalWidth);
    const active = framesReady && !gazeIsSuppressed();
    const x = active ? Math.max(-1, Math.min(1, gazeMotion.x)) : 0;
    const framePosition = (x + 1) * 4;
    if (!active) displayedGazeFrame = 4;
    while (displayedGazeFrame < 8 && framePosition >= displayedGazeFrame + 0.6) displayedGazeFrame += 1;
    while (displayedGazeFrame > 0 && framePosition <= displayedGazeFrame - 0.6) displayedGazeFrame -= 1;
    ui.gazeFrames.forEach((frame, index) => {
      frame.style.opacity = active && index === displayedGazeFrame ? '1' : '0';
    });
    const baseOpacity = active ? '0' : '1';
    ui.halfbody.style.opacity = baseOpacity;
    ui.head.style.opacity = baseOpacity;
    const faceX = active ? (displayedGazeFrame - 4) / 4 : 0;
    const faceScaleX = 1 - Math.abs(faceX) * 0.045;
    const faceTurn = `translate3d(${(faceX * 1.9).toFixed(2)}px, 0, 0) scaleX(${faceScaleX.toFixed(4)}) skewY(${(faceX * -0.28).toFixed(2)}deg)`;
    ui.face.style.transformOrigin = `${(50 - faceX * 6).toFixed(2)}% 50%`;
    ui.blinkFace.style.transformOrigin = ui.face.style.transformOrigin;
    ui.face.style.transform = faceTurn;
    ui.blinkFace.style.transform = faceTurn;
    ui.root.dataset.gazeX = x.toFixed(3);
    ui.root.dataset.gazeY = '0.000';
    ui.root.dataset.gazeFrame = String(displayedGazeFrame);
  }

  function springToward(motion, target, stiffness, damping, elapsed) {
    const drag = Math.exp(-damping * elapsed);
    motion.vx = (motion.vx + (target.x - motion.x) * stiffness * elapsed) * drag;
    motion.vy = (motion.vy + (target.y - motion.y) * stiffness * elapsed) * drag;
    motion.x += motion.vx * elapsed;
    motion.y += motion.vy * elapsed;
    if (Math.abs(target.x - motion.x) < 0.0005 && Math.abs(motion.vx) < 0.002) {
      motion.x = target.x;
      motion.vx = 0;
    }
    if (Math.abs(target.y - motion.y) < 0.0005 && Math.abs(motion.vy) < 0.002) {
      motion.y = target.y;
      motion.vy = 0;
    }
  }

  function animateGaze(at) {
    if (!ui.root) return;
    const elapsed = gazeMotion.lastAt ? Math.min(0.04, Math.max(0.001, (at - gazeMotion.lastAt) / 1000)) : 0.016;
    gazeMotion.lastAt = at;
    let target = { x: 0, y: 0 };
    if (gazePointer && !gazeIsSuppressed()) {
      target = gazeTargetForPoint(gazePointer.x, gazePointer.y, ui.root.getBoundingClientRect());
    }
    springToward(gazeMotion, target, 38, 11, elapsed);
    renderGaze();
    gazeFrame = window.requestAnimationFrame(animateGaze);
  }

  function startGazeTracking() {
    if (gazeFrame) return;
    gazeMotion.lastAt = 0;
    gazeFrame = window.requestAnimationFrame(animateGaze);
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
    ui.bubble.hidden = false;
    ui.bubble.classList.remove('show');
    void ui.bubble.offsetWidth;
    ui.bubble.classList.add('show');
    bubbleTimer = window.setTimeout(() => hideBubble(false), duration || 2600);
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

  function playEffect(cls, duration) {
    if (!ui.body) return;
    const token = ++effectVersion;
    clearActions();
    void ui.body.offsetWidth;
    ui.body.classList.add('no-breathe', cls);
    window.setTimeout(() => {
      if (token !== effectVersion) return;
      ui.body.classList.remove(cls, 'no-breathe');
    }, duration || ACTION_MS[cls] || 600);
  }

  function playPerformance(name, duration, stages) {
    if (!ui.body || !ui.headRig) return null;
    const token = ++effectVersion;
    const cls = 'performance-' + name;
    clearActions();
    void ui.body.offsetWidth;
    void ui.headRig.offsetWidth;
    ui.body.classList.add('no-breathe', cls);
    ui.headRig.classList.add(cls);
    for (const stage of stages || []) {
      window.setTimeout(() => {
        if (token === effectVersion) applyExpression(stage.expression);
      }, stage.at);
    }
    window.setTimeout(() => {
      if (token !== effectVersion) return;
      ui.body.classList.remove(cls, 'no-breathe');
      ui.headRig.classList.remove(cls);
    }, duration);
    return token;
  }

  function triggerBlink() {
    if (!ui.blinkFace || !saved.on || dragging || brain.state === PET_STATES.SLEEPING) return;
    ui.blinkFace.classList.remove('blink');
    void ui.blinkFace.offsetWidth;
    ui.blinkFace.classList.add('blink');
  }

  function scheduleBlink() {
    window.clearTimeout(blinkTimer);
    blinkTimer = window.setTimeout(() => {
      triggerBlink();
      scheduleBlink();
    }, 2600 + Math.random() * 2600);
  }

  function triggerAction(name, manual) {
    if (name === 'blink') {
      triggerBlink();
      return;
    }
    if (name === 'tilt') {
      applyExpression('倾听');
      playPerformance('tilt', ACTION_MS.tilt);
      return;
    }
    if (name === 'yawn') {
      hideBubble(true);
      applyExpression('眼睛微张');
      const token = playPerformance('yawn', ACTION_MS.yawn, [
        { at: 260, expression: '打哈欠' },
        { at: 1180, expression: '安心' },
        { at: 1480, expression: '日常表情' },
      ]);
      window.setTimeout(() => {
        if (token === effectVersion && (manual || saved.autoSpeech)) showBubble(lineFor('yawn'), 1300);
      }, 280);
      return;
    }
    if (name === 'sleep') return;
    playEffect(name, ACTION_MS[name]);
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

  function currentStateLabel() {
    if (brain.state === PET_STATES.MANUAL && manualLabel) return manualLabel;
    return STATE_LABELS[brain.state] || '待机';
  }

  function updateConsole() {
    if (!ui.console) return;
    if (ui.consoleState) ui.consoleState.textContent = '当前：' + currentStateLabel();
    if (ui.autoToggle) ui.autoToggle.checked = saved.auto;
    if (ui.speechToggle) ui.speechToggle.checked = saved.autoSpeech;
    if (ui.sleepToggle) ui.sleepToggle.checked = saved.autoSleep;
    if (ui.sleepSelect) {
      ui.sleepSelect.value = String(saved.sleepAfter);
      ui.sleepSelect.disabled = !saved.autoSleep;
    }
    if (ui.lockButton) {
      ui.lockButton.classList.toggle('active', manualLocked);
      ui.lockButton.textContent = manualLocked ? '解除锁定' : '锁定当前情绪';
    }
  }

  function setState(state, expression) {
    brain.state = state;
    if (ui.root) ui.root.dataset.state = state;
    const sleeping = state === PET_STATES.SLEEPING;
    if (ui.body) {
      if (sleeping) {
        ++effectVersion;
        clearActions();
      }
      ui.body.classList.toggle('sleeping', sleeping);
    }
    if (ui.headRig) ui.headRig.classList.toggle('sleeping', sleeping);
    if (ui.zzz) ui.zzz.hidden = !sleeping;
    applyExpression(expression);
    updateConsole();
  }

  function resetActivity(now) {
    const t = now == null ? Date.now() : now;
    brain.lastInteract = t;
    nextAutoAt = t + nextAutoDelay();
  }

  function returnToIdle(now) {
    ++effectVersion;
    clearActions();
    manualHeld = false;
    manualLabel = '';
    transientUntil = 0;
    setState(PET_STATES.IDLE, pickIdleExpression(ui.face && ui.face.dataset.exp));
    resetActivity(now);
  }

  function wakeUp(now) {
    const canWake = brain.state === PET_STATES.SLEEPING || brain.state === PET_STATES.SLEEPY || brain.state === PET_STATES.BORED || manualHeld;
    if (!canWake) return false;
    manualHeld = false;
    manualLocked = false;
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
      hideBubble(false);
    }
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
    if (!transientUntil || now < transientUntil || manualLocked || manualHeld) return;
    transientUntil = 0;
    manualLabel = '';
    if (pointerInside) {
      setState(PET_STATES.HOVER, pick(STATE_EXPRESSIONS.hover));
    } else {
      returnToIdle(now);
    }
  }

  function tick() {
    if (!saved.on || dragging) return;
    const now = Date.now();
    finishTransient(now);
    if (pointerInside || consoleOpen || manualLocked || manualHeld) return;
    if (!saved.auto) return;
    if (saved.autoSleep) {
      const change = timeoutState(brain, now, saved.sleepAfter);
      if (change) {
        enterAutoState(change);
        return;
      }
    }
    if (brain.state !== PET_STATES.IDLE || now < nextAutoAt) return;
    runIdleBehavior();
    nextAutoAt = now + nextAutoDelay();
  }

  function onHover() {
    pointerInside = true;
    const now = Date.now();
    if (manualLocked) return;
    if (wakeUp(now)) return;
    resetActivity(now);
    const d = decideState(brain, EVENTS.HOVER, now);
    setState(d.state, d.expression);
    showBubble(lineFor('hover'));
    triggerAction('perk');
  }

  function onLeave() {
    pointerInside = false;
    if (dragging || consoleOpen || manualLocked || manualHeld) return;
    returnToIdle(Date.now());
  }

  function onClick(ev) {
    if (Math.abs(ev.clientX - downPos.x) > 4 || Math.abs(ev.clientY - downPos.y) > 4) return;
    const now = Date.now();
    if (wakeUp(now)) return;
    if (brain.state === PET_STATES.WAKE && transientUntil > now) {
      resetActivity(now);
      return;
    }
    resetActivity(now);
    if (manualLocked) {
      showBubble(lineFor('poke'));
      triggerAction('poke');
      return;
    }
    const d = decideState(brain, EVENTS.CLICK, now);
    brain.pokeCount = d.pokeCount;
    brain.lastPokeAt = now;
    setState(d.state, d.expression);
    showBubble(lineFor(d.pokeMany ? 'pokeMany' : 'poke'));
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
    if (reset === false || manualLocked || manualHeld) return;
    if (brain.state === PET_STATES.MANUAL || brain.state === PET_STATES.SLEEPY || brain.state === PET_STATES.WAKE) {
      resetActivity(Date.now());
    } else {
      returnToIdle(Date.now());
    }
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
      return;
    }
    if (key === 'wake') {
      manualHeld = false;
      setState(PET_STATES.WAKE, '眼睛微张');
      showBubble(lineFor(config.line));
      playPerformance('wake', ACTION_MS.wake, [{ at: 360, expression: '日常表情' }]);
      transientUntil = now + TIMERS.TRANSIENT_AFTER;
      return;
    }
    if (key === 'sleeping') {
      manualHeld = true;
      transientUntil = 0;
      setState(PET_STATES.SLEEPING, pick(config.expressions));
      return;
    }

    manualHeld = false;
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
      setState(PET_STATES.SLEEPY, '眼睛微张');
      playDrowsePerformance();
    }
    if (config.line) showBubble(lineFor(config.line));
    transientUntil = manualLocked ? 0 : now + TIMERS.MANUAL_AFTER;
  }

  function runManualAction(name) {
    const now = Date.now();
    if (brain.state === PET_STATES.SLEEPING) wakeUp(now);
    resetActivity(now);
    transientUntil = 0;
    triggerAction(name, true);
  }

  function toggleEmotionLock() {
    manualLocked = !manualLocked;
    if (manualLocked) {
      transientUntil = 0;
    } else if (!manualHeld) {
      returnToIdle(Date.now());
    }
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
    ui.root.addEventListener('pointerenter', onHover);
    ui.root.addEventListener('pointerleave', onLeave);
    ui.root.addEventListener('click', onClick);
    ui.root.addEventListener('contextmenu', openConsole);
    document.addEventListener('pointermove', (ev) => {
      gazePointer = { x: ev.clientX, y: ev.clientY };
    }, { passive: true });
    document.addEventListener('pointerout', (ev) => {
      if (!ev.relatedTarget) gazePointer = null;
    });
    window.addEventListener('blur', () => { gazePointer = null; });
    ui.root.addEventListener('pointerdown', (ev) => {
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
    window.addEventListener('resize', () => {
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

    const emotionTitle = document.createElement('div');
    emotionTitle.className = 'gaia-pet-console-label';
    emotionTitle.textContent = '快速情绪';
    const emotions = document.createElement('div');
    emotions.className = 'gaia-pet-console-grid';
    for (const key of ['idle', 'thinking', 'shy', 'angry', 'sleepy', 'sleeping', 'wake', 'random']) {
      const label = key === 'random' ? '随机' : CONTROL_EMOTIONS[key].label;
      const button = makeButton(label);
      button.dataset.emotion = key;
      button.addEventListener('click', () => runEmotion(key));
      emotions.appendChild(button);
    }

    const actionTitle = document.createElement('div');
    actionTitle.className = 'gaia-pet-console-label';
    actionTitle.textContent = '单独动作';
    const actions = document.createElement('div');
    actions.className = 'gaia-pet-console-grid actions';
    for (const item of [['tilt', '歪头'], ['perk', '一怔'], ['recoil', '回弹'], ['shiver', '发抖'], ['yawn', '打哈欠'], ['blink', '眨眼']]) {
      const button = makeButton(item[1]);
      button.dataset.action = item[0];
      button.addEventListener('click', () => runManualAction(item[0]));
      actions.appendChild(button);
    }

    const autoTitle = document.createElement('div');
    autoTitle.className = 'gaia-pet-console-label';
    autoTitle.textContent = '自动行为';
    const autoToggle = makeToggle('自动模式', (checked) => {
      saved.auto = checked;
      resetActivity(Date.now());
      save();
      updateConsole();
    });
    const speechToggle = makeToggle('自动说话', (checked) => {
      saved.autoSpeech = checked;
      if (!checked) hideBubble(false);
      save();
    });
    const sleepToggle = makeToggle('自动睡觉', (checked) => {
      saved.autoSleep = checked;
      if (!checked && !manualHeld && brain.state !== PET_STATES.IDLE) returnToIdle(Date.now());
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

    const lock = makeButton('锁定当前情绪', 'gaia-pet-console-lock');
    lock.addEventListener('click', toggleEmotionLock);
    panel.append(header, state, emotionTitle, emotions, actionTitle, actions, autoTitle,
      autoToggle.row, speechToggle.row, sleepToggle.row, sleepRow, lock);
    document.body.appendChild(panel);
    ui.console = panel;
    ui.consoleState = state;
    ui.autoToggle = autoToggle.input;
    ui.speechToggle = speechToggle.input;
    ui.sleepToggle = sleepToggle.input;
    ui.sleepSelect = sleepSelect;
    ui.lockButton = lock;
  }

  function build() {
    const root = document.createElement('div');
    root.id = 'gaia-pet';
    root.className = 'gaia-pet';
    root.title = '久远寺有珠 · 右键打开控制台';
    const bubble = document.createElement('div');
    bubble.className = 'gaia-pet-bubble';
    bubble.hidden = true;
    const body = document.createElement('div');
    body.className = 'gaia-pet-body';
    const bodyGaze = document.createElement('div');
    bodyGaze.className = 'gaia-pet-body-gaze';
    const halfbody = document.createElement('img');
    halfbody.className = 'gaia-pet-halfbody';
    halfbody.draggable = false;
    halfbody.alt = '';
    halfbody.addEventListener('load', () => {
      layoutFace();
      clampPosition();
    });
    halfbody.src = PART_IMG + 'body.png';
    const gazeSprites = document.createElement('div');
    gazeSprites.className = 'gaia-pet-gaze-sprites';
    const gazeFrames = GAZE_FRAMES.map((filename, index) => {
      const frame = document.createElement('img');
      frame.className = 'gaia-pet-gaze-frame';
      frame.dataset.gazeFrame = String(index);
      frame.src = GAZE_IMG + filename;
      frame.draggable = false;
      frame.alt = '';
      frame.addEventListener('load', renderGaze);
      gazeSprites.appendChild(frame);
      return frame;
    });
    const headRig = document.createElement('div');
    headRig.className = 'gaia-pet-head-rig';
    const headGaze = document.createElement('div');
    headGaze.className = 'gaia-pet-head-gaze';
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
    headRig.append(head, face, blinkFace);
    headGaze.append(headRig);
    body.append(halfbody, gazeSprites, headGaze);
    bodyGaze.append(body);
    root.append(bubble, bodyGaze, zzz);
    document.body.appendChild(root);
    ui = { root, bubble, bodyGaze, body, halfbody, gazeSprites, gazeFrames, headGaze, headRig, head, face, blinkFace, zzz };
    buildConsole();
  }

  async function initialize() {
    const savedState = await window.api.stateGet('pet');
    if (savedState && typeof savedState === 'object') {
      saved.on = savedState.on !== false;
      saved.auto = savedState.auto !== false;
      saved.autoSpeech = savedState.autoSpeech !== false;
      saved.autoSleep = savedState.autoSleep !== false;
      if ([20000, 35000, 60000].includes(savedState.sleepAfter)) saved.sleepAfter = savedState.sleepAfter;
      if (Number.isFinite(savedState.x) && Number.isFinite(savedState.y)) {
        saved.x = savedState.x;
        saved.y = savedState.y;
      }
    }
    build();
    layoutFace();
    bind();
    if (saved.x == null || saved.y == null) {
      const r = ui.root.getBoundingClientRect();
      saved.x = Math.max(8, window.innerWidth - r.width - 24);
      saved.y = Math.max(8, window.innerHeight - r.height - 24);
    }
    clampPosition();
    ui.root.hidden = !saved.on;
    manualLabel = '';
    setState(PET_STATES.IDLE, '日常表情');
    resetActivity(Date.now());
    updateConsole();
    window.setInterval(tick, 500);
    scheduleBlink();
    startGazeTracking();
  }

  function init() {
    if (!initPromise) initPromise = initialize();
    return initPromise;
  }

  function setEnabled(on) {
    saved.on = !!on;
    if (ui.root) ui.root.hidden = !saved.on;
    if (!saved.on) {
      closeConsole(false);
      hideBubble(true);
    } else if (ui.root) {
      manualHeld = false;
      manualLocked = false;
      returnToIdle(Date.now());
    }
    save();
  }

  return {
    init,
    whenReady: () => initPromise || Promise.resolve(),
    setEnabled,
    getState: () => Object.assign({}, saved),
    getBrain: () => Object.assign({}, brain),
    openConsole: () => openConsole({ preventDefault() {} }),
    closeConsole: () => closeConsole(true),
    runEmotion,
    runAction: runManualAction,
  };
});
