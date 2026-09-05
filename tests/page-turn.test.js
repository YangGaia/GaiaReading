'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const source = app.slice(app.indexOf('let pageTurnQueue ='), app.indexOf('function toggleSpread()'));
const keyboardSource = app.slice(app.indexOf('function isReaderTyping('), app.indexOf('function onReaderWheel('));
const bindingSource = app.slice(app.indexOf('function bindReaderKeyboard('), app.indexOf('function bindReaderWheel('));
const epubSource = app.slice(app.indexOf('async function moveEpubPage('), app.indexOf('function isReaderTyping('));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness({ reducedMotion = false } = {}) {
  const animations = [];
  const content = { animate(keyframes, options) {
    const gate = deferred();
    const animation = { keyframes, options, effect: { target: this, getKeyframes: () => keyframes }, startTime: 100, playState: 'running', finished: gate.promise,
      cancel() { this.playState = 'idle'; gate.reject(new Error('cancelled')); },
      finish() { this.playState = 'finished'; gate.resolve(); } };
    animations.push(animation);
    return animation;
  } };
  const reader = { querySelector: () => content };
  const errors = [];
  const state = { current: {} };
  const listeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  let now = 0, timerId = 0, focused = true, settingsOpen = false;
  const window = {
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => { const id = ++timerId; timers.set(id, { fn, at: now + 1000 / 120 }); return id; },
    cancelAnimationFrame: (id) => timers.delete(id),
    addEventListener: (type, fn) => windowListeners.set(type, fn),
  };
  const document = { addEventListener: (type, fn) => listeners.set(type, fn),
    defaultView: window, hasFocus: () => focused,
    startViewTransition() { throw new Error('Snapshots must never be used'); } };
  const context = vm.createContext({ document, state, els: { readerContent: reader, readerStatus: {} },
    window, performance: { now: () => now }, console: { error: (...args) => errors.push(args) },
    views: { reader: { hidden: false } }, isSettingsOpen: () => settingsOpen, noteReadingActivity() {} });
  vm.runInContext(source + keyboardSource + bindingSource + epubSource, context);
  const h = { context, reader, content, animations, errors, state, pages: [] };
  h.update = (direction) => { h.pages.push(direction); return true; };
  context.nextPage = (_, valid) => context.queuePageTurn('next', (current) => h.update('next', current), valid);
  context.prevPage = (_, valid) => context.queuePageTurn('prev', (current) => h.update('prev', current), valid);
  context.bindReaderKeyboard(document);
  h.key = (key, repeat = false, target = {}) => listeners.get('keydown')({ key, repeat, target, preventDefault() {} });
  h.release = (key) => { const handler = listeners.get('keyup'); if (handler) handler({ key }); };
  h.settled = () => vm.runInContext('pageTurnQueue', context);
  h.advance = async (ms) => {
    const end = now + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await tick();
    }
    now = end;
    await tick();
  };
  h.focus = (target) => listeners.get('focusin')({ target });
  h.blur = (outside = true) => { focused = !outside; windowListeners.get('blur')(); };
  h.hide = () => { document.hidden = true; listeners.get('visibilitychange')(); };
  h.settings = () => { settingsOpen = true; context.stopHeldPageKey(); };
  h.timerCount = () => timers.size;
  return h;
}

test('翻页只等待内容，动画尚未结束时下一次按键立即改变页码', async () => {
  const h = harness();
  h.key('ArrowRight');
  await h.settled();
  assert.equal(h.animations[0].playState, 'running');
  h.release('ArrowRight');
  h.key('ArrowRight');
  await h.settled();
  assert.deepEqual(h.pages, ['next', 'next']);
  assert.equal(h.animations.length, 1, '继续当前运动，不跳回起点或重启缓动');
  assert.equal(h.animations[0].playState, 'running');
});

test('按下再松开保留完整动画，结束后下一次输入仍有动画', async () => {
  const h = harness();
  h.key('ArrowRight');
  await h.settled();
  h.release('ArrowRight');
  const first = h.animations[0];
  assert.equal(first.playState, 'running', 'keyup 不得 finish/cancel 动画');
  assert.equal(first.options.duration, 160);
  first.finish();
  await tick();
  h.key('ArrowLeft');
  await h.settled();
  assert.equal(h.animations.length, 2);
  assert.equal(h.animations[1].keyframes[0].transform, 'translateX(-20px)');
});

test('快速独立按键逐次保留方向，不为动画积压任务', async () => {
  const h = harness();
  const keys = ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', 'ArrowRight'];
  for (const key of keys) { h.key(key); h.release(key); }
  await h.settled();
  assert.deepEqual(h.pages, ['next', 'next', 'prev', 'next', 'prev', 'next']);
  assert.equal(h.animations.length, 1);
});

test('PDF 或跨章替换内容节点时延续当前动画位置，不重新从头滑入', async () => {
  const h = harness();
  await h.context.nextPage();
  const old = h.animations[0];
  const replacement = { animate: h.content.animate };
  h.reader.querySelector = () => replacement;
  await h.context.nextPage();
  const next = h.animations[1];
  assert.equal(old.playState, 'idle');
  assert.equal(next.effect.target, replacement);
  assert.equal(next.startTime, old.startTime);
  assert.deepEqual(next.keyframes, old.keyframes);
});

test('长按加载期间的系统重复事件不积压，松手后不补翻', async () => {
  const h = harness();
  const gate = deferred();
  h.update = async (direction) => { await gate.promise; h.pages.push(direction); return true; };
  h.key('ArrowRight');
  await tick();
  for (let i = 0; i < 100; i += 1) h.key('ArrowRight', true);
  h.release('ArrowRight');
  assert.equal(h.animations.length, 0, '内容未准备好时不播放空页');
  gate.resolve();
  await h.settled();
  await tick();
  assert.deepEqual(h.pages, ['next']);
  assert.equal(h.animations[0].playState, 'running');
});

test('按住 200ms 自动进入约 30 次每秒连翻，系统重复不叠加，动画不阻塞内容', async () => {
  const h = harness();
  h.key('ArrowRight');
  await h.settled();
  await h.advance(199);
  assert.equal(h.pages.length, 1);
  for (let i = 0; i < 10; i += 1) { h.key('ArrowRight', true); await h.settled(); }
  assert.equal(h.pages.length, 1, '系统重复不得提前启动或另行翻页');
  await h.advance(1001);
  assert.ok(h.pages.length >= 31 && h.pages.length <= 32, '无需系统 repeat 事件也持续高速翻页');
  const count = h.pages.length;
  h.release('ArrowRight');
  await h.advance(1000);
  assert.deepEqual(h.pages, Array(count).fill('next'));
  assert.equal(h.timerCount(), 0);
  assert.equal(h.animations.length, 1);
  assert.equal(h.animations[0].playState, 'running');
});

test('长按只允许一个自动加载，松手后过期加载不提交页码，也不追赶漏掉的次数', async () => {
  const h = harness();
  h.key('ArrowRight');
  await h.settled();
  const gate = deferred();
  let calls = 0;
  h.update = async (direction, valid) => {
    calls += 1;
    await gate.promise;
    if (!valid()) return false;
    h.pages.push(direction);
    return true;
  };
  await h.advance(2000);
  assert.equal(calls, 1);
  h.release('ArrowRight');
  gate.resolve();
  await h.settled();
  await h.advance(2000);
  assert.deepEqual(h.pages, ['next']);
  assert.equal(calls, 1);
});

test('按下反向键立即使旧自动请求失效，释放旧键不会打断新方向', async () => {
  const h = harness();
  h.key('ArrowRight');
  await h.settled();
  const gate = deferred();
  h.update = async (direction, valid) => {
    if (direction === 'next') await gate.promise;
    if (!valid()) return false;
    h.pages.push(direction);
    return true;
  };
  await h.advance(200);
  h.key('ArrowLeft');
  h.release('ArrowRight');
  gate.resolve();
  await h.settled();
  assert.deepEqual(h.pages, ['next', 'prev']);
  await h.advance(300);
  assert.ok(h.pages.length > 3);
  assert.ok(h.pages.slice(1).every((direction) => direction === 'prev'));
  h.release('ArrowLeft');
});

for (const reason of ['blur', 'hide', 'settings', 'typing', 'close']) test(`${reason} 停止连翻；框架内焦点切换不误停`, async () => {
  const h = harness();
  h.key('ArrowRight');
  await h.settled();
  h.blur(false);
  await h.advance(250);
  assert.ok(h.pages.length > 1);
  const count = h.pages.length;
  if (reason === 'typing') h.focus({ tagName: 'TEXTAREA' });
  else if (reason === 'close') h.context.cancelPageTurns();
  else h[reason]();
  await h.advance(1000);
  assert.equal(h.pages.length, count);
  h.key('ArrowRight', true);
  await h.advance(1000);
  assert.equal(h.pages.length, count, '失焦后的旧 repeat 不得重启连翻');
});

test('书尾自动停止，不持续调用翻页；PageUp/PageDown 保持原系统重复操作', async () => {
  const h = harness();
  h.key('ArrowRight');
  await h.settled();
  let calls = 0;
  h.update = () => { calls += 1; return false; };
  await h.advance(1000);
  assert.equal(calls, 1);
  assert.equal(h.timerCount(), 0);
  h.key('PageUp');
  await h.settled();
  h.key('PageUp', true);
  await h.settled();
  assert.equal(calls, 3);
});

test('异步准备仍按独立输入顺序执行，不并发覆盖页码', async () => {
  const h = harness();
  const gate = deferred();
  const calls = [];
  const first = h.context.queuePageTurn('next', async () => { calls.push('begin'); await gate.promise; calls.push('end'); });
  const second = h.context.queuePageTurn('prev', () => calls.push('prev'));
  await tick();
  assert.deepEqual(calls, ['begin']);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['begin', 'end', 'prev']);
});

test('取消、换书与加载失败清理任务，旧书不能启动新书的动画', async () => {
  const h = harness();
  const gate = deferred();
  let staleCalls = 0;
  const loading = h.context.queuePageTurn('next', () => gate.promise);
  const queued = h.context.queuePageTurn('next', () => { staleCalls += 1; });
  await tick();
  h.context.cancelPageTurns();
  h.state.current = {};
  await h.context.queuePageTurn('prev', () => true);
  const currentAnimation = h.animations[0];
  gate.resolve(true);
  await Promise.all([loading, queued]);
  assert.equal(staleCalls, 0);
  assert.equal(h.animations.length, 1);
  assert.equal(currentAnimation.playState, 'running');
  h.context.cancelPageTurns();
  assert.equal(currentAnimation.playState, 'idle');
  assert.equal(await h.context.queuePageTurn('next', () => { throw new Error('load failed'); }), false);
  assert.equal(h.errors.length, 1);
  assert.equal(await h.context.queuePageTurn('next', () => true), true);
});

test('减少动态效果、后台和边界不产生动画，输入框和非阅读界面不翻页', async () => {
  const reduced = harness({ reducedMotion: true });
  await reduced.context.nextPage();
  assert.equal(reduced.animations.length, 0);
  const h = harness();
  await h.context.queuePageTurn('prev', () => false);
  assert.equal(h.animations.length, 0);
  h.context.document.hidden = true;
  await h.context.nextPage();
  assert.equal(h.animations.length, 0);
  h.key('ArrowRight', false, { tagName: 'INPUT' });
  h.context.views.reader.hidden = true;
  h.key('ArrowRight');
  await h.settled();
  assert.deepEqual(h.pages, ['next']);
});

function epubHarness(direction = 'next') {
  const h = harness();
  const gate = deferred();
  const events = new Map();
  const sections = Array.from({ length: 3 }, (_, index) => ({ index, properties: [] }));
  sections.forEach((section, index) => { section.next = () => sections[index + 1]; section.prev = () => sections[index - 1]; });
  const view = (section) => ({ section, element: { classList: { add() {}, remove() {} } } });
  const old = view(sections[1]);
  const all = [old];
  let reported = 0;
  const manager = {
    layout: { name: 'reflowable', divisor: 1, delta: 500, height: 600 }, settings: { axis: 'horizontal', direction: 'ltr' },
    container: { scrollWidth: 1500, offsetWidth: 500, scrollHeight: 600, offsetHeight: 600, scrollLeft: direction === 'next' ? 1000 : 0, scrollTop: 0 },
    currentLocation: () => { throw new Error('Animated rectangles must not decide chapter boundaries'); },
    views: { all: () => all, last: () => all.at(-1), indexOf: (v) => all.indexOf(v), remove: (v) => all.splice(all.indexOf(v), 1), show() {} },
    append(section) { const next = view(section); all.push(next); return gate.promise.then(() => { events.get('rendered')(section); return next; }); },
    updateLayout() {}, scrollTo(x, y) { this.position = [x, y]; },
  };
  h.state.current.rendition = { manager, q: {}, on: (name, handler) => events.set(name, handler), off: (name) => events.delete(name), reportLocation: () => { reported += 1; } };
  return { ...h, gate, manager, old, all, reported: () => reported };
}

for (const direction of ['next', 'prev']) test(`EPUB ${direction} 跨章保留旧页直到内容和主题就绪，再同步替换`, async () => {
  const h = epubHarness(direction);
  const turning = h.context.moveEpubPage(h.state.current, direction);
  await tick();
  assert.ok(h.all.includes(h.old));
  assert.equal(h.all.length, 2);
  h.gate.resolve();
  assert.equal(await turning, true);
  assert.equal(h.all.length, 1);
  assert.equal(h.all[0].section.index, direction === 'next' ? 2 : 0);
  assert.deepEqual(h.manager.position, direction === 'next' ? [0, 0] : [1000, 0]);
  assert.equal(h.reported(), 1);
});

for (const rtl of [false, 'negative', 'default']) test(`EPUB ${rtl || 'LTR'} 在章内反向连按使用滚动位置，不受动画小数位影响`, async () => {
  const h = epubHarness();
  const manager = h.manager;
  if (rtl) { manager.settings.direction = 'rtl'; manager.settings.rtlScrollType = rtl; }
  manager.container.scrollLeft = rtl === 'negative' ? -500 : 500;
  let turns = 0;
  manager.prev = () => { turns += 1; };
  manager.next = () => { turns += 1; };
  assert.equal(await h.context.moveEpubPage(h.state.current, 'prev'), true);
  assert.equal(await h.context.moveEpubPage(h.state.current, 'next'), true);
  assert.equal(turns, 2);
  assert.deepEqual(h.all, [h.old]);
});

for (const direction of ['next', 'prev']) test(`EPUB ${direction} 跨章等待期间松手，保留旧章节且不改变进度`, async () => {
  const h = epubHarness(direction);
  let held = true;
  const turning = h.context.moveEpubPage(h.state.current, direction, () => held);
  await tick();
  held = false;
  h.gate.resolve();
  assert.equal(await turning, false);
  assert.deepEqual(h.all, [h.old]);
  assert.equal(h.reported(), 0);
});

test('EPUB 章节加载失败保留旧页，换书后不提交过期章节', async () => {
  const h = epubHarness();
  const failed = h.context.moveEpubPage(h.state.current, 'next');
  h.gate.reject(new Error('chapter failed'));
  await assert.rejects(failed, /chapter failed/);
  assert.deepEqual(h.all, [h.old]);
  const closed = epubHarness();
  const pending = closed.context.moveEpubPage(closed.state.current, 'next');
  closed.state.current = {};
  closed.gate.resolve();
  assert.equal(await pending, false);
  assert.equal(closed.reported(), 0);
});
