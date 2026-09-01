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
  } = shared;

  const IMG = 'images/pet/cells/';
  const FACE_IMG = 'images/pet/faces/';
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
  const ACTION_CLASSES = ['poke', 'tilt', 'drop', 'perk', 'recoil', 'shiver', 'stretch', 'lean', 'drowse', 'wake'];
  const ACTION_MS = { poke: 350, tilt: 700, drop: 400, perk: 500, recoil: 360, shiver: 420, stretch: 820, lean: 600, drowse: 1100, wake: 900 };
  const IDLE_ACTIONS = ['perk', 'lean', 'tilt', 'stretch'];
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
    if (!ui.face || !ui.halfbody) return;
    const hb = FACE.halfbody;
    const tile = FACE.tile;
    const s = (ui.body.clientWidth || 150) / FACE.sheet.w;
    const hbCx = hb.x + hb.w / 2;
    const hbCy = hb.y + hb.h / 2;
    const faceLeft = (hbCx - tile.cx) * s;
    const faceTop = (hbCy - tile.cy) * s;
    const faceW = tile.w * s;
    const faceH = tile.h * s;
    const lidW = Math.round(faceW * 0.46);
    const lidH = Math.max(2, Math.round(5 * s));
    ui.face.style.width = Math.round(faceW) + 'px';
    ui.face.style.height = Math.round(faceH) + 'px';
    ui.face.style.left = Math.round(faceLeft) + 'px';
    ui.face.style.top = Math.round(faceTop) + 'px';
    ui.lid.style.width = lidW + 'px';
    ui.lid.style.height = lidH + 'px';
    ui.lid.style.left = Math.round(faceLeft + (faceW - lidW) / 2) + 'px';
    ui.lid.style.top = Math.round(faceTop + faceH * 0.33 - lidH / 2) + 'px';
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

  function showBubble(text) {
    if (!ui.bubble || !text) return;
    window.clearTimeout(bubbleTimer);
    ui.bubble.textContent = text;
    ui.bubble.hidden = false;
    ui.bubble.classList.remove('show');
    void ui.bubble.offsetWidth;
    ui.bubble.classList.add('show');
    bubbleTimer = window.setTimeout(() => hideBubble(false), 2600);
  }

  function clearActions() {
    if (!ui.body) return;
    for (const cls of ACTION_CLASSES) ui.body.classList.remove(cls);
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

  function triggerBlink() {
    if (!ui.lid || !saved.on || dragging || brain.state === PET_STATES.SLEEPING) return;
    ui.lid.classList.remove('blink');
    void ui.lid.offsetWidth;
    ui.lid.classList.add('blink');
  }

  function scheduleBlink() {
    window.clearTimeout(blinkTimer);
    blinkTimer = window.setTimeout(() => {
      triggerBlink();
      scheduleBlink();
    }, 2600 + Math.random() * 2600);
  }

  function triggerAction(name) {
    if (name === 'blink') {
      triggerBlink();
      return;
    }
    if (name === 'sleep') return;
    playEffect(name, ACTION_MS[name]);
  }

  function idleAction() {
    triggerAction(pick(IDLE_ACTIONS));
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
    setState(d.state, d.expression);
    showBubble(lineFor('wake'));
    playEffect('wake', ACTION_MS.wake);
    transientUntil = now + TIMERS.TRANSIENT_AFTER;
    resetActivity(now);
    return true;
  }

  function enterAutoState(change) {
    setState(change.state, change.expression);
    if (change.state === PET_STATES.BORED) {
      if (saved.autoSpeech) showBubble(lineFor('bored'));
      triggerAction('lean');
    } else if (change.state === PET_STATES.SLEEPY) {
      if (saved.autoSpeech) showBubble(lineFor('sleepy'));
      triggerAction('drowse');
    } else if (change.state === PET_STATES.SLEEPING) {
      hideBubble(false);
    }
  }

  function runIdleBehavior() {
    const behavior = pickAutoBehavior();
    applyExpression(pickIdleExpression(ui.face && ui.face.dataset.exp));
    if (behavior === AUTO_BEHAVIORS.ACTION) {
      idleAction();
    } else if (behavior === AUTO_BEHAVIORS.SPEECH) {
      if (saved.autoSpeech) showBubble(lineFor('idle'));
      else idleAction();
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
      setState(PET_STATES.WAKE, pick(config.expressions));
      showBubble(lineFor(config.line));
      triggerAction(config.action);
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
    setState(key === 'sleepy' ? PET_STATES.SLEEPY : PET_STATES.MANUAL, pick(config.expressions));
    if (config.line) showBubble(lineFor(config.line));
    if (config.action) triggerAction(config.action);
    transientUntil = manualLocked ? 0 : now + TIMERS.MANUAL_AFTER;
  }

  function runManualAction(name) {
    const now = Date.now();
    if (brain.state === PET_STATES.SLEEPING) wakeUp(now);
    resetActivity(now);
    triggerAction(name);
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
    for (const item of [['tilt', '歪头'], ['perk', '一怔'], ['recoil', '回弹'], ['shiver', '发抖'], ['stretch', '伸懒腰'], ['blink', '眨眼']]) {
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
    const halfbody = document.createElement('img');
    halfbody.className = 'gaia-pet-halfbody';
    halfbody.src = IMG + encodeURIComponent('半身照.png');
    halfbody.draggable = false;
    halfbody.alt = '';
    const face = document.createElement('img');
    face.className = 'gaia-pet-face';
    face.src = FACE_IMG + encodeURIComponent('日常表情.png');
    face.draggable = false;
    face.alt = '';
    const lid = document.createElement('div');
    lid.className = 'gaia-pet-lid';
    const zzz = document.createElement('div');
    zzz.className = 'gaia-pet-zzz';
    zzz.textContent = 'Zzz';
    zzz.hidden = true;
    body.append(halfbody, face, lid);
    root.append(bubble, body, zzz);
    document.body.appendChild(root);
    ui = { root, bubble, body, halfbody, face, lid, zzz };
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
