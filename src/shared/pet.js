'use strict';

/**
 * 赛博桌宠共享逻辑（纯函数，可单测）：
 * - 表情清单（对应 src/renderer/images/pet/cells/*.png）
 * - 状态机：待机 / 滑过 / 戳一下 / 无聊 / 困倦 / 睡觉 / 唤醒
 * - 各状态的表情池与有珠风格台词库
 * - 事件驱动状态迁移、超时迁移、随机选择
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
  };

  const EVENTS = {
    HOVER: 'hover',
    LEAVE: 'leave',
    CLICK: 'click',
    INTERACT: 'interact',
  };

  /** 不理她的超时阈值（毫秒）：3 分钟无聊，6 分钟困倦，10 分钟睡觉。 */
  const TIMERS = {
    BORED_AFTER: 3 * 60 * 1000,
    SLEEPY_AFTER: 6 * 60 * 1000,
    SLEEPING_AFTER: 10 * 60 * 1000,
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
    bored: ['发呆', '叹气', '无奈'],
    sleepy: ['眼睛微张', '呆呆'],
    sleeping: ['半身照'],
    wake: ['日常表情', '害羞', '安心'],
  };

  /** 有珠风格台词库，按场景分桶。 */
  const LINES = {
    hover: [
      '……你靠得太近了。',
      '有什么事？没事就请走开。',
      '盯……我脸上有什么吗？',
      '不要像看橱窗里的玩偶一样看我。',
      '在看什么？书比我有意思多了。',
    ],
    poke: [
      '呀！',
      '别戳。',
      '好痛……你是故意的吧。',
      '再碰我，我可要念咒了。',
      '我可不是你的猫咪。',
    ],
    pokeMany: [
      '够了。',
      '看来你是想尝尝魔法的滋味。',
      '你比草十郎还迟钝。',
      '我已经记住你了。',
      '今晚的夜，会格外漫长哦。',
    ],
    bored: [
      '好无聊……',
      '没有书读的日子，真难熬。',
      '把时间浪费在这里，还不如去喂猫。',
      '你在发呆的时候，我已经读完三本书了。',
      '夜还长，你却连书都不看吗。',
    ],
    sleepy: [
      '哈啊……夜还长，我却困了。',
      '魔女也是会困的……',
      '再不睡，明天就没精神看书了。',
      '闭一下眼……就一下。',
    ],
    sleeping: [
      'Zzz……',
      '……（梦里也在翻书页）',
      'Zzz……猫……别跑……',
    ],
    wake: [
      '……谁。',
      '吵醒我的人，最好有要紧事。',
      '梦到一半被你打断，书里都没写这种情节。',
      '算了……原谅你。',
      '你的手，比猫爪子还烦人。',
    ],
    idle: [
      '今晚的月色，适合读书。',
      '书页的味道……还不错。',
      '你身上有猫的味道。……不，没事。',
      '我不是装饰品。',
      '再盯着我看，就让你帮忙找魔道书。',
      '哼。',
      '晚上才是我活动的时间。',
      '你终于想起我了。',
      '这个房间，安静得刚刚好。',
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
        };
      }
      case EVENTS.INTERACT:
        return { state: PET_STATES.WAKE, expression: pick(STATE_EXPRESSIONS.wake) };
      default:
        return null;
    }
  }

  /** 超时迁移：长时间不互动，依次进入无聊 / 困倦 / 睡觉。 */
  function timeoutState(brain, now) {
    const t = now == null ? Date.now() : now;
    const idle = t - brain.lastInteract;
    if (idle >= TIMERS.SLEEPING_AFTER) {
      return { state: PET_STATES.SLEEPING, expression: '半身照' };
    }
    if (idle >= TIMERS.SLEEPY_AFTER) {
      return { state: PET_STATES.SLEEPY, expression: pick(STATE_EXPRESSIONS.sleepy) };
    }
    if (idle >= TIMERS.BORED_AFTER) {
      return { state: PET_STATES.BORED, expression: pick(STATE_EXPRESSIONS.bored) };
    }
    return null;
  }

  /** 从场景桶取一句台词。 */
  function lineFor(key, rand) {
    return pick(LINES[key] || [], rand);
  }

  /** 待机小动作：随机返回一个表情（约 12% 概率触发一次），否则 null。 */
  function idleAction(rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    if (r() < 0.12) {
      return { expression: pick(STATE_EXPRESSIONS.idle, rand) };
    }
    return null;
  }

  return {
    PET_STATES,
    EVENTS,
    TIMERS,
    EXPRESSIONS,
    STATE_EXPRESSIONS,
    LINES,
    createBrain,
    pick,
    decideState,
    timeoutState,
    lineFor,
    idleAction,
  };
});
