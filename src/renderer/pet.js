'use strict';

/**
 * 赛博桌宠渲染层：
 * - 半身照为底，表情层按脸部标定叠加（FACE 配置，坐标待主人确认后微调）
 * - 交互：滑过 / 点击（连点触发"烦了"彩蛋）/ 拖拽 / 不理超时（无聊→困倦→睡觉）
 * - 台词气泡 + Zzz，状态持久化到 pet 键（开关 / 位置）
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../shared/pet'));
  } else {
    root.GaiaPet = factory(root.GaiaPetShared);
  }
})(typeof self !== 'undefined' ? self : this, function (shared) {
  'use strict';

  const { PET_STATES, EVENTS, createBrain, decideState, timeoutState, lineFor, idleAction } = shared;

  const IMG = 'images/pet/cells/';

  /** 脸部标定（半身照 356x647，表情格约 254x256；坐标为估算，待主人确认）。 */
  const FACE = {
    halfbody: { x: 134, y: 137, w: 89, h: 78 },
    expression: { x: 82, y: 103, w: 89, h: 79 },
  };

  const DEFAULT_STATE = { on: true, x: null, y: null };

  let ui = {};
  let brain = createBrain();
  let saved = Object.assign({}, DEFAULT_STATE);
  let loaded = false;
  let bubbleTimer = null;
  let animTimer = null;
  let dragging = false;
  let downPos = { x: 0, y: 0 };
  let dragOffset = { x: 0, y: 0 };

  function save() {
    window.api.stateSet('pet', {
      on: saved.on,
      x: Number.isFinite(saved.x) ? saved.x : null,
      y: Number.isFinite(saved.y) ? saved.y : null,
    });
  }

  /** 切换表情：短暂淡出后换图淡入。 */
  function applyExpression(name, instant) {
    if (!ui.face || !name) return;
    const file = IMG + encodeURIComponent(name + '.png');
    if (ui.face.dataset.exp === name) return;
    ui.face.dataset.exp = name;
    if (instant) {
      ui.face.src = file;
      ui.face.style.opacity = '1';
      return;
    }
    ui.face.style.opacity = '0';
    window.setTimeout(() => {
      ui.face.src = file;
      ui.face.onload = () => {
        ui.face.style.opacity = '1';
      };
    }, 150);
  }

  /** 表情层布局：把表情格的脸中心对齐到半身照的脸中心，按宽度等比缩放。 */
  function layoutFace() {
    if (!ui.face || !ui.halfbody) return;
    const hb = FACE.halfbody;
    const ex = FACE.expression;
    const scale = hb.w / ex.w;
    const baseW = 254;
    const baseH = 256;
    const hbCx = hb.x + hb.w / 2;
    const hbCy = hb.y + hb.h / 2;
    const exCx = ex.x + ex.w / 2;
    const exCy = ex.y + ex.h / 2;
    ui.face.style.width = Math.round(baseW * scale) + 'px';
    ui.face.style.height = Math.round(baseH * scale) + 'px';
    ui.face.style.left = Math.round(hbCx - exCx * scale) + 'px';
    ui.face.style.top = Math.round(hbCy - exCy * scale) + 'px';
    // 眼皮(眨眼)遮罩: 覆盖表情层眼睛区域, 与脸部中心对齐
    const eyeY = ex.y + ex.h * 0.44;
    const lidW = Math.round(ex.w * 0.72 * scale);
    const lidH = Math.round(10 * scale);
    ui.lid.style.width = lidW + 'px';
    ui.lid.style.height = lidH + 'px';
    ui.lid.style.left = Math.round(hbCx - lidW / 2) + 'px';
    ui.lid.style.top = Math.round(hbCy - (exCy - eyeY) * scale - lidH / 2) + 'px';
  }

  function showBubble(text) {
    if (!ui.bubble) return;
    if (!text) {
      ui.bubble.hidden = true;
      return;
    }
    ui.bubble.textContent = text;
    ui.bubble.hidden = false;
    ui.bubble.classList.remove('show');
    void ui.bubble.offsetWidth;
    ui.bubble.classList.add('show');
    window.clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(() => {
      ui.bubble.classList.remove('show');
    }, 2600);
  }

  function pokeBounce() {
    if (!ui.body) return;
    ui.body.classList.remove('poke');
    void ui.body.offsetWidth;
    ui.body.classList.add('poke');
    window.setTimeout(() => ui.body.classList.remove('poke'), 350);
  }

  function triggerBlink() {
    if (!ui.lid || !saved.on || dragging) return;
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

  function triggerTilt() {
    if (!ui.body) return;
    ui.body.classList.add('no-breathe', 'tilt');
    window.setTimeout(() => {
      ui.body.classList.remove('tilt', 'no-breathe');
    }, 700);
  }

  function wakeUp() {
    const asleep = brain.state === PET_STATES.SLEEPING || brain.state === PET_STATES.SLEEPY;
    if (ui.zzz) ui.zzz.hidden = true;
    if (!asleep && brain.state !== PET_STATES.BORED) return;
    const d = decideState(brain, EVENTS.INTERACT);
    if (d) {
      brain.state = d.state;
      applyExpression(d.expression);
      showBubble(lineFor('wake'));
    }
  }

  function onHover() {
    wakeUp();
    brain.lastInteract = Date.now();
    if (brain.state !== PET_STATES.IDLE && brain.state !== PET_STATES.HOVER) return;
    const d = decideState(brain, EVENTS.HOVER);
    if (d) {
      brain.state = d.state;
      applyExpression(d.expression);
      showBubble(lineFor('hover'));
    }
  }

  function onLeave() {
    if (dragging) return;
    const d = decideState(brain, EVENTS.LEAVE);
    if (d) {
      brain.state = d.state;
      applyExpression(d.expression);
    }
  }

  function onClick(ev) {
    if (Math.abs(ev.clientX - downPos.x) > 4 || Math.abs(ev.clientY - downPos.y) > 4) return;
    wakeUp();
    brain.lastInteract = Date.now();
    if (brain.state !== PET_STATES.IDLE && brain.state !== PET_STATES.HOVER && brain.state !== PET_STATES.POKE) {
      return;
    }
    const d = decideState(brain, EVENTS.CLICK, Date.now());
    if (d) {
      brain.state = d.state;
      brain.pokeCount = d.pokeCount;
      brain.lastPokeAt = Date.now();
      applyExpression(d.expression);
      showBubble(lineFor(d.pokeMany ? 'pokeMany' : 'poke'));
      pokeBounce();
    }
  }

  function tick() {
    if (!saved.on || dragging) return;
    const now = Date.now();
    const prev = brain.state;
    const t = timeoutState(brain, now);
    if (t) {
      brain.state = t.state;
      applyExpression(t.expression);
      if (ui.zzz) ui.zzz.hidden = t.state !== PET_STATES.SLEEPING;
      if (t.state !== prev) {
        const key = t.state === PET_STATES.BORED ? 'bored' : t.state === PET_STATES.SLEEPY ? 'sleepy' : 'sleeping';
        showBubble(lineFor(key));
      }
      return;
    }
    if (brain.state === PET_STATES.IDLE) {
      const act = idleAction();
      if (act) {
        applyExpression(act.expression);
      } else if (Math.random() < 0.12) {
        triggerTilt();
      }
    }
  }

  function bind() {
    ui.root.addEventListener('pointerenter', onHover);
    ui.root.addEventListener('pointerleave', onLeave);
    ui.root.addEventListener('click', onClick);
    ui.root.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const r = ui.root.getBoundingClientRect();
      downPos = { x: ev.clientX, y: ev.clientY };
      dragOffset = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      ui.root.setPointerCapture(ev.pointerId);
    });
    ui.root.addEventListener('pointermove', (ev) => {
      if (Math.abs(ev.clientX - downPos.x) <= 4 && Math.abs(ev.clientY - downPos.y) <= 4) return;
      if (!dragging) {
        dragging = true;
        ui.root.classList.add('dragging');
        ui.body.classList.add('no-breathe');
      }
      const bw = ui.root.offsetWidth;
      const bh = ui.root.offsetHeight;
      saved.x = Math.max(0, Math.min(window.innerWidth - bw, ev.clientX - dragOffset.x));
      saved.y = Math.max(0, Math.min(window.innerHeight - bh, ev.clientY - dragOffset.y));
      ui.root.style.left = saved.x + 'px';
      ui.root.style.top = saved.y + 'px';
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      ui.root.classList.remove('dragging');
      ui.body.classList.remove('no-breathe');
      ui.body.classList.remove('drop');
      void ui.body.offsetWidth;
      ui.body.classList.add('drop');
      save();
    };
    ui.root.addEventListener('pointerup', endDrag);
    ui.root.addEventListener('pointercancel', endDrag);
  }

  function build() {
    const root = document.createElement('div');
    root.id = 'gaia-pet';
    root.className = 'gaia-pet';
    root.title = '久远寺有珠';

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
    face.src = IMG + encodeURIComponent('日常表情.png');
    face.draggable = false;
    face.alt = '';

    const zzz = document.createElement('div');
    zzz.className = 'gaia-pet-zzz';
    zzz.textContent = 'Zzz';
    zzz.hidden = true;

    const lid = document.createElement('div');
    lid.className = 'gaia-pet-lid';

    body.append(halfbody, face, lid);
    root.append(bubble, body, zzz);
    document.body.appendChild(root);
    ui = { root, bubble, body, halfbody, face, zzz, lid };
  }

  async function init() {
    if (loaded) return;
    loaded = true;
    build();
    layoutFace();
    bind();

    const savedState = await window.api.stateGet('pet');
    if (savedState && typeof savedState === 'object') {
      saved.on = savedState.on !== false;
      if (Number.isFinite(savedState.x) && Number.isFinite(savedState.y)) {
        saved.x = savedState.x;
        saved.y = savedState.y;
      }
    }
    if (saved.x != null && saved.y != null) {
      ui.root.style.left = saved.x + 'px';
      ui.root.style.top = saved.y + 'px';
    } else {
      const r = ui.root.getBoundingClientRect();
      saved.x = Math.max(8, window.innerWidth - r.width - 24);
      saved.y = Math.max(8, window.innerHeight - r.height - 24);
      ui.root.style.left = saved.x + 'px';
      ui.root.style.top = saved.y + 'px';
    }
    ui.root.hidden = !saved.on;
    applyExpression('日常表情', true);
    animTimer = window.setInterval(tick, 1000);
    scheduleBlink();
  }

  function setEnabled(on) {
    saved.on = !!on;
    if (ui.root) ui.root.hidden = !saved.on;
    save();
  }

  return {
    init,
    setEnabled,
    getState: () => Object.assign({}, saved),
    getBrain: () => Object.assign({}, brain),
  };
});
