'use strict';

/**
 * 赛博桌宠共享逻辑（纯函数，可单测）：
 * - 表情清单（对应 src/renderer/images/pet/cells/*.png）
 * - 状态机：待机 / 滑过 / 戳一下 / 无聊 / 困倦 / 睡觉 / 唤醒
 * - 各状态的表情池与有珠风格台词库
 * - 事件驱动状态迁移、15秒无互动加权轮换（无聊/困倦/睡觉）、表情内说话节奏（第一句3s内必说/第二句2s后每轮80%）
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

  /** 不理她的超时阈值（毫秒）：无聊/困倦/睡觉统一为 15 秒无互动触发。 */
  const TIMERS = {
    MOOD_AFTER: 15 * 1000,
  };

  /** 被打扰后回到待机、满 5 秒换一次表情。 */
  const IDLE_EXPRESSION_INTERVAL = 5000;

  /** 表情内说话节奏：第一句在 3 秒内必说；第二句距上一句 2 秒后每轮 80%，没触发则保持 80%。 */
  const FIRST_SPEECH_AFTER = 3000;
  const SECOND_SPEECH_AFTER = 2000;
  const SECOND_SPEECH_CHANCE = 0.8;

  /** 一个表情内说满两句后换表情。 */
  const SPEECH_PER_EXPRESSION = 2;

  /** 无聊/困倦/睡觉加权轮换：上一次状态概率降至 15%，其余两个对半分。 */
  const MOOD_STATES = [PET_STATES.BORED, PET_STATES.SLEEPY, PET_STATES.SLEEPING];
  const MOOD_REPEAT_CHANCE = 0.15;

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
    sleeping: ['半身照'],
    wake: ['日常表情', '害羞', '安心'],
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
      moodAt: 0,
      moodCycle: [],
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

  /** 超时迁移：15 秒无互动时按加权轮换抽无聊/困倦/睡觉，每满 15 秒抽一次。 */
  function timeoutState(brain, now, rand) {
    const t = now == null ? Date.now() : now;
    const idle = t - brain.lastInteract;
    if (idle < TIMERS.MOOD_AFTER) return null;
    const sinceMood = t - (brain.moodAt || 0);
    if (sinceMood < TIMERS.MOOD_AFTER) return null;
    const mood = nextMood(brain, rand);
    brain.moodAt = t;
    return { state: mood, expression: pick(STATE_EXPRESSIONS[mood], rand) };
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

  /** 被打扰后满 5 秒到期换一次表情；未到期返回 null。 */
  function idleExpressionDue(lastChange, now, rand, current) {
    if (now - lastChange < IDLE_EXPRESSION_INTERVAL) return null;
    return { expression: pickIdleExpression(current, rand) };
  }

  /** 表情内说话判定：第一句（spokenCount=0）3 秒内必说；第二句距上一句 2 秒后每轮 80%，没触发则保持 80%。 */
  function speechDue(since, now, rand, spokenCount) {
    const r = typeof rand === 'function' ? rand : Math.random;
    const elapsed = now - since;
    if (spokenCount === 0) {
      return elapsed >= FIRST_SPEECH_AFTER;
    }
    if (elapsed < SECOND_SPEECH_AFTER) return false;
    return r() < SECOND_SPEECH_CHANCE;
  }

  /** 无聊/困倦/睡觉加权轮换：第一次等概率随机；之后上一次状态降至 15%、其余两个对半分；三个轮完一圈后重置。 */
  function nextMood(brain, rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    let used = Array.isArray(brain.moodCycle) ? brain.moodCycle.slice() : [];
    const hasAll = MOOD_STATES.every((s) => used.includes(s));
    if (hasAll) used = [];
    let chosen;
    if (used.length === 0) {
      chosen = MOOD_STATES[Math.floor(r() * MOOD_STATES.length)];
    } else {
      const last = used[used.length - 1];
      const p = r();
      if (p < MOOD_REPEAT_CHANCE) {
        chosen = last;
      } else {
        const rest = MOOD_STATES.filter((s) => s !== last);
        const t = (p - MOOD_REPEAT_CHANCE) / (1 - MOOD_REPEAT_CHANCE);
        chosen = rest[Math.floor(t * rest.length)];
      }
    }
    brain.moodCycle = used.concat(chosen);
    return chosen;
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
    IDLE_EXPRESSION_INTERVAL,
    idleExpressionDue,
    pickIdleExpression,
    speechDue,
    nextMood,
    SPEECH_PER_EXPRESSION,
  };
});
