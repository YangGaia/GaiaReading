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

  /** 默认自动时间轴：15 秒无聊、25 秒困倦、35 秒睡觉。 */
  const TIMERS = {
    AUTO_MIN: 6 * 1000,
    AUTO_MAX: 10 * 1000,
    BORED_AFTER: 15 * 1000,
    SLEEPY_AFTER: 25 * 1000,
    SLEEP_AFTER: 35 * 1000,
    TRANSIENT_AFTER: 1200,
    MANUAL_AFTER: 8 * 1000,
    DREAM_MIN: 6 * 1000,
    DREAM_MAX: 10 * 1000,
    DREAM_CHANCE: 0.8,
    READER_CARE_AFTER: 45 * 60 * 1000,
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
    readingCare: [
      '已经看很久了。看看远处吧。',
      '先喝点水，书又不会逃走。',
      '坐姿变差了吧。起来活动一下。',
      '眼睛也需要休息。几分钟就好。',
      '先合上书吧。我可以等你。',
      '休息一下再继续，效率反而会更高。',
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

  function formatReadingDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  /** PointerEvent.buttons 中是否仍包含主按钮，避免丢失 pointerup 后拖拽粘住。 */
  function hasPrimaryPointerButton(buttons) {
    return (Number(buttons) & 1) === 1;
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
    formatReadingDuration,
    hasPrimaryPointerButton,
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
