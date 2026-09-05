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
  const document = { addEventListener: (type, fn) => listeners.set(type, fn),
    startViewTransition() { throw new Error('Snapshots must never be used'); } };
  const context = vm.createContext({ document, state, els: { readerContent: reader, readerStatus: {} },
    window: { matchMedia: () => ({ matches: reducedMotion }) }, console: { error: (...args) => errors.push(args) },
    views: { reader: { hidden: false } }, isSettingsOpen: () => false, noteReadingActivity() {} });
  vm.runInContext(source + keyboardSource + bindingSource + epubSource, context);
  const h = { context, reader, content, animations, errors, state, pages: [] };
  h.update = (direction) => { h.pages.push(direction); return true; };
  context.nextPage = () => context.queuePageTurn('next', () => h.update('next'));
  context.prevPage = () => context.queuePageTurn('prev', () => h.update('prev'));
  context.bindReaderKeyboard(document);
  h.key = (key, repeat = false, target = {}) => listeners.get('keydown')({ key, repeat, target, preventDefault() {} });
  h.release = (key) => { const handler = listeners.get('keyup'); if (handler) handler({ key }); };
  h.settled = () => vm.runInContext('pageTurnQueue', context);
  return h;
}

test('翻页只等待内容，动画尚未结束时下一次按键立即改变页码', async () => {
  const h = harness();
  h.key('ArrowRight');
  await h.settled();
  assert.equal(h.animations[0].playState, 'running');
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

test('页面已就绪时每次长按重复都能响应，不受 160ms 动画限制', async () => {
  const h = harness();
  h.key('ArrowRight');
  await h.settled();
  for (let i = 0; i < 10; i += 1) { h.key('ArrowRight', true); await h.settled(); }
  h.release('ArrowRight');
  await tick();
  assert.deepEqual(h.pages, Array(11).fill('next'));
  assert.equal(h.animations.length, 1);
  assert.equal(h.animations[0].playState, 'running');
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
    container: { scrollWidth: 1500, scrollHeight: 600 },
    currentLocation: () => [{ pages: [direction === 'next' ? 3 : 1], totalPages: 3 }],
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
