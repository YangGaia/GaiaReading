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

  const IMG = 'images/pet/parts/';
  const FACE_IMG = 'images/pet/faces/';

  /** 脸部标定（半身照 356x647，表情格约 254x256；坐标为估算，待主人确认）。 */
  const FACE = {
    halfbody: { x: 134, y: 137, w: 89, h: 78 },
    expression: { x: 82, y: 103, w: 89, h: 79 },
    tile: { w: 134, h: 118, cx: 67.5, cy: 59.5 },
    sheet: { w: 356, h: 647 }, // 半身照原图尺寸, 用于显示缩放换算
    headOffsetY: 0, // 头层从半身照 y0 开始(完整头顶), 底部羽化融合
    turn: { headRot: 7, headX: 3, headY: 1.2, bodyRot: 1.2, bodyX: 1.5 }, // 头层旋转/位移 + 身体轻微跟随
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
    const file = FACE_IMG + encodeURIComponent(name + '.png');
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
    if (!ui.face || !ui.head) return;
    const hb = FACE.halfbody;
    const ex = FACE.expression;
    const tile = FACE.tile;
    const sheet = FACE.sheet;
    // 显示缩放 = 半身照当前显示宽度 / 原图宽度
    const s = (ui.body.clientWidth || 150) / sheet.w;
    const hbCx = hb.x + hb.w / 2;
    const hbCy = hb.y + hb.h / 2;
    const headTop = FACE.headOffsetY;
    ui.face.style.width = Math.round(tile.w * s) + 'px';
    ui.face.style.height = Math.round(tile.h * s) + 'px';
    ui.face.style.left = Math.round((hbCx - tile.cx) * s) + 'px';
    ui.face.style.top = Math.round((hbCy - tile.cy - headTop) * s) + 'px';
    // 眼皮(眨眼)遮罩: 覆盖表情层眼睛区域, 与脸部中心对齐
    const exCy = ex.y + ex.h / 2;
    const eyeY = ex.y + ex.h * 0.44;
    const lidW = Math.round(ex.w * 0.72 * s);
    const lidH = Math.round(10 * s);
    ui.lid.style.width = lidW + 'px';
    ui.lid.style.height = lidH + 'px';
    ui.lid.style.left = Math.round((hbCx - ex.w * 0.36) * s) + 'px';
    ui.lid.style.top = Math.round((hbCy - (exCy - eyeY) - headTop) * s - lidH / 2) + 'px';
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
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    });
    function onDragMove(ev) {
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
    }
    function endDrag() {
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      if (!dragging) return;
      dragging = false;
      ui.root.classList.remove('dragging');
      ui.body.classList.remove('no-breathe');
      ui.body.classList.remove('drop');
      void ui.body.offsetWidth;
      ui.body.classList.add('drop');
      updateFollowRect();
      save();
    }

    // 转头跟随鼠标: 头层以脖子为轴旋转, 身体轻微跟随, 脖子垫片固定遮缝
    const followTarget = { x: 0, y: 0 };
    const followCurrent = { x: 0, y: 0 };
    let followRect = null;
    function updateFollowRect() {
      if (!ui.root) return;
      const r = ui.root.getBoundingClientRect();
      followRect = { left: r.left, top: r.top, w: r.width, h: r.height };
    }
    window.addEventListener('pointermove', (ev) => {
      if (!saved.on || dragging || !ui.head) return;
      if (!followRect) updateFollowRect();
      if (!followRect) return;
      const cx = followRect.left + followRect.w / 2;
      const cy = followRect.top + followRect.h / 2;
      let dx = Math.max(-1, Math.min(1, (ev.clientX - cx) / (followRect.w / 2 || 1)));
      let dy = Math.max(-1, Math.min(1, (ev.clientY - cy) / (followRect.h / 2 || 1)));
      // 非线性曲线: 中心附近几乎不动, 远离时才缓慢加大
      dx = Math.sign(dx) * Math.pow(Math.abs(dx), 1.5);
      dy = Math.sign(dy) * Math.pow(Math.abs(dy), 1.5);
      followTarget.x = dx;
      followTarget.y = dy;
    });
    function followLoop() {
      if (saved.on && ui.head && !dragging) {
        followCurrent.x += (followTarget.x - followCurrent.x) * 0.2;
        followCurrent.y += (followTarget.y - followCurrent.y) * 0.2;
        const x = followCurrent.x;
        const y = followCurrent.y;
        const t = FACE.turn;
        // 头层转头(含头发), 以脖子底部为轴; 身体轻微同向跟随
        ui.head.style.transform = 'rotate(' + (x * t.headRot).toFixed(2) + 'deg) translateX(' + (x * t.headX).toFixed(2) + 'px) translateY(' + (y * t.headY).toFixed(2) + 'px)';
        if (ui.bodypart) ui.bodypart.style.transform = 'rotate(' + (x * t.bodyRot).toFixed(2) + 'deg) translateX(' + (x * t.bodyX).toFixed(2) + 'px)';
      }
      requestAnimationFrame(followLoop);
    }
    requestAnimationFrame(followLoop);
    window.addEventListener('resize', updateFollowRect);
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

    // 纸娃娃三层: 身体(肩以下) / 脖子垫片(固定遮缝) / 头层(可旋转, 头发跟着头走)
    const bodypart = document.createElement('img');
    bodypart.className = 'gaia-pet-bodypart';
    bodypart.src = IMG + 'full.png';
    bodypart.draggable = false;
    bodypart.alt = '';

    const head = document.createElement('div');
    head.className = 'gaia-pet-head';

    const headimg = document.createElement('img');
    headimg.className = 'gaia-pet-headimg';
    headimg.src = IMG + 'head.png';
    headimg.draggable = false;
    headimg.alt = '';

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

    head.append(headimg, face, lid);
    body.append(bodypart, head);
    root.append(bubble, body, zzz);
    document.body.appendChild(root);
    ui = { root, bubble, body, bodypart, head, headimg, face, lid, zzz };
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
