'use strict';

/**
 * 赛博桌宠共享逻辑（纯函数，可单测）：
 * - 表情清单（对应 src/renderer/images/pet/cells/*.png）
 * - 状态机：待机 / 滑过 / 戳一下 / 无聊 / 困倦 / 睡觉 / 唤醒 / 手动情绪
 * - 各状态的表情池与有珠风格台词库
 * - 事件驱动状态迁移、线性无互动时间轴、6~10 秒一次的待机行为
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaPetShared = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PET_STATES = {
    IDLE: 'idle',
    HOVER: 'hover',
    POKE: 'poke',
    BORED: 'bored',
    SLEEPY: 'sleepy',
    SLEEPING: 'sleeping',
    WAKE: 'wake',
    MANUAL: 'manual',
  };

  const EVENTS = {
    HOVER: 'hover',
    LEAVE: 'leave',
    CLICK: 'click',
    INTERACT: 'interact',
  };

  /** 默认三分钟入睡，按统一比例经过无聊和困倦阶段。 */
  const TIMERS = {
    AUTO_MIN: 6 * 1000,
    AUTO_MAX: 10 * 1000,
    SLEEP_AFTER: 3 * 60 * 1000,
    TRANSIENT_AFTER: 1200,
    MANUAL_AFTER: 8 * 1000,
    DREAM_MIN: 6 * 1000,
    DREAM_MAX: 10 * 1000,
    DREAM_CHANCE: 0.8,
  };

  const AUTO_BEHAVIORS = {
    EXPRESSION: 'expression',
    ACTION: 'action',
    SPEECH: 'speech',
  };

  /** 表情清单（顺序与 pet-expressions.json 一致）。 */
  const EXPRESSIONS = [
    '日常表情', '倾听', '思考', '轻视看', '无奈', '接受', '偷看', '害羞', '严肃说话',
    '呆呆', '愣住', '生气', '生气又偷偷笑', '安心', '叹气', '看傻子的表情',
    '不想听不耐烦', '冷脸', '晕', '眼睛微张', '半身照',
  ];

  /** 各状态可用的表情池。 */
  const STATE_EXPRESSIONS = {
    idle: ['日常表情', '眼睛微张', '偷看', '思考'],
    hover: ['偷看', '眼睛微张', '倾听'],
    poke: ['愣住', '害羞', '生气又偷偷笑', '晕'],
    pokeMany: ['生气', '不想听不耐烦', '看傻子的表情', '冷脸'],
    bored: ['呆呆', '叹气', '无奈'],
    sleepy: ['眼睛微张', '呆呆'],
    sleeping: ['安心'],
    wake: ['眼睛微张', '日常表情', '害羞'],
  };

  /** 控制台展示的是情绪，不让主人面对 21 个没有组织的表情按钮。 */
  const CONTROL_EMOTIONS = {
    idle: { label: '待机', expressions: STATE_EXPRESSIONS.idle, line: 'idle' },
    thinking: { label: '思考', expressions: ['思考'], line: 'idle', performance: 'thinking' },
    shy: { label: '害羞', expressions: ['愣住', '害羞'], line: 'hover', performance: 'shy' },
    angry: { label: '生气', expressions: ['冷脸', '生气'], line: 'pokeMany', performance: 'angry' },
    sleepy: { label: '困倦', expressions: ['眼睛微张'], line: 'sleepy', performance: 'drowse' },
    sleeping: { label: '睡觉', expressions: STATE_EXPRESSIONS.sleeping, performance: 'sleeping', hold: true },
    wake: { label: '唤醒', expressions: ['眼睛微张', '日常表情'], line: 'wake', performance: 'wake' },
  };

  /** 有珠风格台词库：贴近原作，以官方语音与设定为底。她怕生、安静，爱红茶与书与夜，说话简短。 */
  const LINES = {
    hover: [
      '别太在意我。',
      '……有什么事吗。',
      '安静。',
      '有事的话，告诉罗宾就行。',
      '……不要靠太近。',
      '……看到了。',
      '……站那，傻。',
      '……别挡我的夜。',
      '……看什么。',
      '……又来了。',
      '……我，再看月亮。',
    ],
    poke: [
      '……',
      '别碰我。',
      '……疼。',
      '请住手。',
      '……不要这样。',
      '……说过了，别碰。',
      '……喂。',
      '……茶的规矩。',
      '……我会记得。',
      '……不要得寸进尺。',
      '……好冷。',
      '……哈。',
    ],
    pokeAgain: [
      '……还有事？',
      '第二次了。',
      '……你很闲吗。',
      '我已经注意到你了。',
      '……别一直戳。',
      '书不看了？',
    ],
    pokeMany: [
      '……吵死了。',
      '够了。',
      '……很烦。',
      '我要回房间了。',
      '……适可而止。',
      '……你真吵。',
      '……住口。',
      '……下次直接关窗。',
      '……你今晚别想喝茶。',
      '……罗宾。',
      '……离我远点。',
    ],
    bored: [
      '……无聊。',
      '茶，喝完了。',
      '书，读完了。',
      '……黑猫，不知去哪了。',
      '……夜，怎么还不来。',
      '……月亮，还没升起来。',
      '……想睡了。',
      '……窗外，好静。',
      '……你在的话，至少不太安静。',
      '……棋，还差一手。',
    ],
    sleepy: [
      '……困了。',
      '……夜，还长。',
      '红茶，明天再泡吧。',
      '……稍微，睡一下。',
      '……眼皮，好重。',
      '……灯，关一下吧。',
      '……再五分钟。',
      '……晚安前，想喝杯茶。',
    ],
    sleeping: [
      'Zzz……',
      '……伦敦桥……又塌了……',
      '……黑猫……',
      '……纸人……夜行……',
      '……红茶的……香气……',
      '……月亮……别走……',
    ],
    sleepTransition: [
      '……那我先睡了。',
      '灯关小一点。晚安。',
      '剩下的，明天再说。',
      '……别吵醒我。',
      '夜还长，稍微休息一下。',
    ],
    wake: [
      '……嗯？',
      '……是你。',
      '……我，睡着了？',
      '……茶，凉了。',
      '……算了。',
      '……醒了。',
      '……几点了。',
      '……你，一直看着？',
      '……梦到伦敦桥了。',
      '……谢谢你。……不，没什么。',
      '……抱枕，去拿了。',
    ],
    yawn: [
      '哈啊——',
      '唔……有点困。',
      '再眯一会儿……',
    ],
    idle: [
      '……红茶，一天七次是理想。',
      '书页的声音，不错。',
      '夜，是我的时间。',
      '……黑猫的铃，还在响。',
      '月亮，很圆。',
      '……伦敦桥，塌了。',
      '你不说话，挺好。',
      '……没什么。',
      '茶要泡了。……你要喝吗。',
      '……要是下雪就好了。',
      '……今晚，没有云。',
      '……纸人，在飞。',
      '……这院子，够安静。',
      '……数到七，茶就好。',
      '……你，不读书吗。',
      '……夜，还长着呢。',
      '……冬，快到了。',
      '……静一静，也好。',
    ],
  };
  /** 创建一份桌宠"大脑"状态。 */
  function createBrain(now) {
    const t = now == null ? Date.now() : now;
    return {
      state: PET_STATES.IDLE,
      lastInteract: t,
      pokeCount: 0,
      lastPokeAt: 0,
    };
  }

  /** 从数组里随机取一项。 */
  function pick(list, rand) {
    if (!list || !list.length) return null;
    const r = typeof rand === 'function' ? rand : Math.random;
    return list[Math.floor(r() * list.length)];
  }

  function pokeLineKey(count) {
    if (count >= 5) return 'pokeMany';
    if (count >= 3) return 'pokeAgain';
    return 'poke';
  }

  /** PointerEvent.buttons 中是否仍包含主按钮，避免丢失 pointerup 后拖拽粘住。 */
  function hasPrimaryPointerButton(buttons) {
    return (Number(buttons) & 1) === 1;
  }

  /** 根据用户透明度和临时显现状态计算最终透明度。 */
  function petOpacityForState(opacity, revealed) {
    const numeric = Number(opacity);
    const configured = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 1;
    return revealed && configured < 1 ? 1 : configured;
  }

  /** Speech stays beside the pet; the console yields when their bounds conflict. */
  function placePetOverlays(viewport, pet, panelSize, bubbleSize) {
    const edge = 8;
    const gap = 12;
    const width = Math.max(edge * 2 + 1, Number(viewport.width) || 0);
    const height = Math.max(edge * 2 + 1, Number(viewport.height) || 0);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const fits = (rect) => rect.left >= edge && rect.top >= edge &&
      rect.left + rect.width <= width - edge && rect.top + rect.height <= height - edge;
    const separate = (a, b) => !b || a.left + a.width + gap <= b.left ||
      b.left + b.width + gap <= a.left || a.top + a.height + gap <= b.top ||
      b.top + b.height + gap <= a.top;
    let panel = null;
    let bubble = null;
    if (bubbleSize) {
      const w = Math.min(bubbleSize.width, width - edge * 2);
      const h = Math.min(bubbleSize.height, height - edge * 2);
      const nearFace = clamp(pet.top + pet.height * .26 - h / 2, edge, height - h - edge);
      const centered = clamp(pet.left + (pet.width - w) / 2, edge, width - w - edge);
      const sides = [[pet.left - w - gap, nearFace], [pet.right + gap, nearFace]];
      if (pet.left < w + gap + edge) sides.reverse();
      const candidates = [...sides, [centered, pet.top - h - gap], [centered, pet.bottom + gap]];
      candidates.push([edge, edge], [width - w - edge, edge], [edge, height - h - edge], [width - w - edge, height - h - edge]);
      bubble = candidates.map(([left, top]) => ({ left, top, width: w, height: h })).find(fits);
    }
    if (panelSize) {
      const w = Math.min(panelSize.width, width - edge * 2);
      const h = Math.min(panelSize.height, height - edge * 2);
      let x = pet.right + gap;
      if (x + w > width - edge) x = pet.left - w - gap;
      const preferred = { left: clamp(x, edge, width - w - edge), top: clamp(pet.top, edge, height - h - edge), width: w, height: h };
      panel = preferred;
      if (!separate(panel, bubble)) {
        const xs = [preferred.left, pet.right + gap, pet.left - w - gap, bubble.left - w - gap, bubble.left + bubble.width + gap, edge, width - w - edge];
        const ys = [preferred.top, pet.top - h - gap, pet.bottom + gap, bubble.top - h - gap, bubble.top + bubble.height + gap, edge, height - h - edge];
        const distance = (rect) => (rect.left - preferred.left) ** 2 + (rect.top - preferred.top) ** 2;
        const candidates = xs.flatMap((left) => ys.map((top) => ({
          left: clamp(left, edge, width - w - edge),
          top: clamp(top, edge, height - h - edge), width: w, height: h,
        }))).filter((rect) => separate(rect, bubble)).sort((a, b) => distance(a) - distance(b));
        panel = candidates.find((rect) => separate(rect, pet)) || candidates[0];
        if (!panel) {
          // A narrow window can scroll the console in the larger free row,
          // without relocating speech or changing its natural attachment point.
          const above = bubble.top - gap - edge;
          const below = height - edge - bubble.top - bubble.height - gap;
          const available = Math.max(1, above, below);
          const panelHeight = Math.min(h, available);
          panel = { ...preferred, height: panelHeight, top: below >= above
            ? bubble.top + bubble.height + gap : bubble.top - gap - panelHeight };
        }
      }
    }
    return { console: panel, bubble };
  }

  /** 事件驱动迁移：返回 { state, expression, ... }，无迁移返回 null。 */
  function decideState(brain, event, now) {
    const t = now == null ? Date.now() : now;
    switch (event) {
      case EVENTS.HOVER:
        return { state: PET_STATES.HOVER, expression: pick(STATE_EXPRESSIONS.hover) };
      case EVENTS.LEAVE:
        return { state: PET_STATES.IDLE, expression: pick(STATE_EXPRESSIONS.idle) };
      case EVENTS.CLICK: {
        const count = t - brain.lastPokeAt < 2500 ? brain.pokeCount + 1 : 1;
        const many = count >= 5;
        return {
          state: PET_STATES.POKE,
          expression: pick(many ? STATE_EXPRESSIONS.pokeMany : STATE_EXPRESSIONS.poke),
          pokeCount: count,
          pokeMany: many,
          pokeLine: pokeLineKey(count),
        };
      }
      case EVENTS.INTERACT:
        return { state: PET_STATES.WAKE, expression: pick(STATE_EXPRESSIONS.wake) };
      default:
        return null;
    }
  }

  /** 根据可配置入睡时间，按 3/7、5/7、7/7 切分无聊、困倦、睡觉。 */
  function autoTimeline(sleepAfter) {
    const sleeping = Number.isFinite(sleepAfter) && sleepAfter >= 7000 ? sleepAfter : TIMERS.SLEEP_AFTER;
    return {
      bored: Math.round(sleeping * 3 / 7),
      sleepy: Math.round(sleeping * 5 / 7),
      sleeping,
    };
  }

  /** 无互动只沿一条时间轴前进，不再随机来回切换情绪。 */
  function inactivityState(lastInteract, now, sleepAfter) {
    const elapsed = Math.max(0, now - lastInteract);
    const timeline = autoTimeline(sleepAfter);
    if (elapsed >= timeline.sleeping) return PET_STATES.SLEEPING;
    if (elapsed >= timeline.sleepy) return PET_STATES.SLEEPY;
    if (elapsed >= timeline.bored) return PET_STATES.BORED;
    return PET_STATES.IDLE;
  }

  function timeoutState(brain, now, sleepAfter, rand) {
    const state = inactivityState(brain.lastInteract, now, sleepAfter);
    if (state === PET_STATES.IDLE || state === brain.state) return null;
    return { state, expression: pick(STATE_EXPRESSIONS[state], rand) };
  }

  /** 从场景桶取一句台词。 */
  function lineFor(key, rand) {
    return pick(LINES[key] || [], rand);
  }

  /** 从待机表情池挑一个，尽量避开当前表情。 */
  function pickIdleExpression(current, rand) {
    let pool = STATE_EXPRESSIONS.idle;
    if (current && pool.length > 1) {
      pool = pool.filter((name) => name !== current);
    }
    return pick(pool, rand);
  }

  function nextAutoDelay(rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    return TIMERS.AUTO_MIN + Math.floor(r() * (TIMERS.AUTO_MAX - TIMERS.AUTO_MIN + 1));
  }

  /** 一轮只做一件事：40% 换脸、30% 小动作、30% 说一句。 */
  function pickAutoBehavior(rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    const p = r();
    if (p < 0.4) return AUTO_BEHAVIORS.EXPRESSION;
    if (p < 0.7) return AUTO_BEHAVIORS.ACTION;
    return AUTO_BEHAVIORS.SPEECH;
  }

  function nextDreamDelay(rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    return TIMERS.DREAM_MIN + Math.floor(r() * (TIMERS.DREAM_MAX - TIMERS.DREAM_MIN + 1));
  }

  function shouldDream(rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    return r() < TIMERS.DREAM_CHANCE;
  }

  return {
    PET_STATES,
    EVENTS,
    TIMERS,
    AUTO_BEHAVIORS,
    EXPRESSIONS,
    STATE_EXPRESSIONS,
    CONTROL_EMOTIONS,
    LINES,
    createBrain,
    pick,
    pokeLineKey,
    hasPrimaryPointerButton,
    petOpacityForState,
    placePetOverlays,
    decideState,
    timeoutState,
    lineFor,
    pickIdleExpression,
    autoTimeline,
    inactivityState,
    nextAutoDelay,
    pickAutoBehavior,
    nextDreamDelay,
    shouldDream,
  };
});
