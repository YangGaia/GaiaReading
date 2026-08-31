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

  /** 有珠风格台词库，按场景分桶。她沉默寡言、怕生、说话极简且带省略号。 */
  const LINES = {
    hover: [
      '……',
      '……什么。',
      '……有事吗。',
      '……在看什么。',
      '……不要靠太近。',
    ],
    poke: [
      '……',
      '……疼。',
      '……别碰。',
      '……为什么。',
      '……请你，住手。',
    ],
    pokeMany: [
      '……',
      '……很烦。',
      '……我要生气了。',
      '……住手。',
      '……真的，会生气的。',
    ],
    bored: [
      '……无聊。',
      '……书，读完了。',
      '……猫在睡觉。',
      '……你也，什么都不做吗。',
      '……安静。……不讨厌。',
    ],
    sleepy: [
      '……困。',
      '……夜，还长。',
      '……眼睛，要闭上了。',
      '……稍微，睡一下。',
    ],
    sleeping: [
      'Zzz……',
      '……猫……',
      'Zzz……',
    ],
    wake: [
      '……嗯？',
      '……是你。',
      '……我，睡着了？',
      '……不要看。',
      '……谢谢。',
    ],
    idle: [
      '……月亮，很漂亮。',
      '……书页的声音，好听。',
      '……猫，又不见了。',
      '……这里，很安静。',
      '……我在等，什么呢。',
      '……夜，是我的时间。',
      '……你不说话，挺好。',
      '……嗯。……没什么。',
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
