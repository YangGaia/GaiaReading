'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const source = app.slice(app.indexOf('let pageTurnQueue ='), app.indexOf('function toggleSpread()'));
const keyboardSource = app.slice(app.indexOf('function isReaderTyping('), app.indexOf('function onReaderWheel('));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness({ fallback = false, skip = false } = {}) {
  const classes = () => {
    const values = new Set();
    return { values, add: (...names) => names.forEach((name) => values.add(name)), remove: (...names) => names.forEach((name) => values.delete(name)) };
  };
  const root = { classList: classes(), style: { setProperty() {}, removeProperty() {} } };
  const reader = { classList: classes(), offsetWidth: 800, getAnimations: () => [] };
  const errors = [];
  const state = { current: {} };
  const document = { documentElement: root };
  if (!fallback) document.startViewTransition = (update) => {
    const updateCallbackDone = Promise.resolve().then(update);
    return { updateCallbackDone, ready: skip ? Promise.reject(new Error('capture skipped')) : updateCallbackDone,
      finished: updateCallbackDone.then(() => tick()), skipTransition() {} };
  };
  const context = vm.createContext({ document, state, els: { readerContent: reader, readerStatus: {} }, console: { error: (...args) => errors.push(args) } });
  vm.runInContext(source, context);
  return { context, reader, root, errors, state };
}

test('快速翻页按输入顺序等待渲染完成，不并发覆盖页码', async () => {
  const { context } = harness();
  const gate = deferred();
  const calls = [];
  let page = 0;
  const first = context.queuePageTurn('next', async () => { calls.push('begin'); await gate.promise; page += 1; calls.push('end'); });
  const second = context.queuePageTurn('next', () => { calls.push('next'); page += 1; });
  const third = context.queuePageTurn('prev', () => { calls.push('prev'); page -= 1; });
  await tick();
  assert.deepEqual(calls, ['begin']);
  gate.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(calls, ['begin', 'end', 'next', 'prev']);
  assert.equal(page, 1);
});

test('返回书架或换书后，排队的翻页不会操作新书', async () => {
  const { context, state, root } = harness();
  const gate = deferred();
  let queuedCalls = 0;
  const first = context.queuePageTurn('next', () => gate.promise);
  const second = context.queuePageTurn('next', () => { queuedCalls += 1; });
  await tick();
  context.cancelPageTurns();
  state.current = {};
  await context.queuePageTurn('next', () => { queuedCalls += 1; });
  assert.equal(queuedCalls, 1, '新书无需等待旧书的加载任务');
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(queuedCalls, 1);
  assert.equal(root.classList.values.size, 0);
  await context.queuePageTurn('next', () => { queuedCalls += 1; });
  assert.equal(queuedCalls, 2);
});

test('页面加载失败后清理动画状态，下一次翻页仍可执行', async () => {
  const { context, errors, root } = harness();
  const failed = await context.queuePageTurn('next', async () => { throw new Error('load failed'); });
  assert.equal(failed, false);
  assert.equal(errors.length, 1);
  assert.equal(root.classList.values.size, 0);
  assert.equal(await context.queuePageTurn('prev', () => true), true);
});

test('浏览器跳过动画截图时只更新一次，不重复翻页', async () => {
  const { context, errors, reader } = harness({ skip: true });
  let pages = 0;
  await context.queuePageTurn('next', () => { pages += 1; });
  assert.equal(pages, 1);
  assert.equal(errors.length, 0);
  assert.ok(reader.classList.values.has('paging-fallback'), '截图被跳过时仍须有可见的备用动画');
});

test('动画接口同步失败时仍更新一次并显示备用动画', async () => {
  const { context, reader, errors } = harness();
  context.document.startViewTransition = () => { throw new Error('unavailable'); };
  let pages = 0;
  await context.queuePageTurn('prev', () => { pages += 1; });
  assert.equal(pages, 1);
  assert.equal(errors.length, 0);
  assert.ok(reader.classList.values.has('paging-fallback'));
  assert.ok(reader.classList.values.has('paging-prev'));
});

test('新输入立即收尾备用动画，取消后不会阻塞新书', async () => {
  const { context, reader, state } = harness({ fallback: true });
  const animation = deferred();
  let cancelled = 0;
  let finished = 0;
  reader.getAnimations = () => [{ animationName: 'pageSlideNext', finished: animation.promise,
    finish: () => { finished += 1; animation.resolve(); }, cancel: () => { cancelled += 1; animation.resolve(); } }];
  const pages = [];
  const first = context.queuePageTurn('next', () => { pages.push(1); });
  await tick();
  const second = context.queuePageTurn('next', () => { pages.push(2); });
  await Promise.all([first, second]);
  assert.equal(finished, 1, '新输入不等待 160ms 备用动画播完');
  assert.deepEqual(pages, [1, 2]);
  const blocked = deferred();
  reader.getAnimations = () => [{ animationName: 'pageSlideNext', finished: blocked.promise,
    finish: () => blocked.resolve(), cancel: () => { cancelled += 1; blocked.resolve(); } }];
  const third = context.queuePageTurn('next', () => { pages.push(3); });
  await tick();
  context.cancelPageTurns();
  state.current = {};
  reader.getAnimations = () => [];
  await context.queuePageTurn('prev', () => { pages.push(4); });
  await third;
  assert.equal(cancelled, 1);
  assert.deepEqual(pages, [1, 2, 3, 4]);
});

function keyboardHarness(options) {
  const h = harness(options);
  h.context.views = { reader: { hidden: false } };
  h.context.isSettingsOpen = () => false;
  h.context.noteReadingActivity = () => {};
  h.pages = [];
  h.update = (direction) => { h.pages.push(direction); return true; };
  h.context.nextPage = () => h.context.queuePageTurn('next', () => h.update('next'));
  h.context.prevPage = () => h.context.queuePageTurn('prev', () => h.update('prev'));
  vm.runInContext(keyboardSource, h.context);
  h.key = (key, repeat = false, target = {}) => h.context.onReaderKey({ key, repeat, target, preventDefault() {} });
  h.release = (key) => h.context.onReaderKeyUp({ key });
  h.settled = () => vm.runInContext('pageTurnQueue', h.context);
  return h;
}

test('快速独立按键逐次生效，不等待前一次动画结束，也不丢失反向输入', async () => {
  const h = keyboardHarness();
  const motions = [];
  h.context.document.startViewTransition = (update) => {
    const motion = deferred();
    motions.push(motion);
    const done = Promise.resolve().then(update);
    return { ready: done, updateCallbackDone: done, finished: done.then(() => motion.promise), skipTransition: () => motion.resolve() };
  };
  const keys = ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'ArrowRight', 'ArrowRight'];
  for (const key of keys) {
    h.key(key);
    await tick();
    // Each new key must advance even though no mock animation ends by itself.
  }
  assert.deepEqual(h.pages, ['next', 'next', 'prev', 'next', 'next', 'prev', 'next', 'next']);
  h.release(keys.at(-1));
  await h.settled();
});

test('长按在加载期间产生的重复事件不积压，松手后不会补翻', async () => {
  const h = keyboardHarness();
  const gate = deferred();
  h.update = async (direction) => { await gate.promise; h.pages.push(direction); return true; };
  h.key('ArrowRight');
  await tick();
  for (let i = 0; i < 100; i += 1) h.key('ArrowRight', true);
  h.release('ArrowRight');
  gate.resolve();
  await h.settled();
  await tick();
  assert.deepEqual(h.pages, ['next'], '仅完成已经开始的那一页，不补播 100 次重复输入');
  h.key('ArrowLeft');
  await h.settled();
  assert.deepEqual(h.pages, ['next', 'prev']);
});

test('长按在页面就绪后继续响应；停止发送按键后不自动翻页', async () => {
  const h = keyboardHarness();
  h.key('PageDown');
  await h.settled();
  for (let i = 0; i < 5; i += 1) {
    h.key('PageDown', true);
    await h.settled();
  }
  h.release('PageDown');
  await tick();
  await tick();
  assert.deepEqual(h.pages, Array(6).fill('next'));
});

test('同一轮快速按下及松开保留每个独立输入，输入框和非阅读页面不翻页', async () => {
  const h = keyboardHarness();
  for (let i = 0; i < 12; i += 1) { h.key('ArrowRight'); h.release('ArrowRight'); }
  await h.settled();
  assert.deepEqual(h.pages, Array(12).fill('next'));
  h.key('ArrowRight', false, { tagName: 'INPUT' });
  h.context.views.reader.hidden = true;
  h.key('ArrowLeft');
  await h.settled();
  assert.equal(h.pages.length, 12);
});

test('主动结束快照动画不会被误判成失败而补播第二段动画', async () => {
  const h = keyboardHarness();
  const captured = deferred();
  const motion = deferred();
  let skips = 0;
  h.context.document.startViewTransition = (update) => {
    const done = Promise.resolve().then(update);
    return { ready: captured.promise, updateCallbackDone: done, finished: done.then(() => motion.promise),
      skipTransition() { skips += 1; motion.resolve(); } };
  };
  h.key('ArrowRight');
  await tick();
  h.release('ArrowRight');
  assert.equal(skips, 0, '准备期间保留旧页快照');
  captured.resolve();
  await h.settled();
  assert.equal(skips, 1);
  assert.ok(!h.reader.classList.values.has('paging-fallback'));
});

test('到达边界或取消后不会补播被跳过的动画', async () => {
  const { context, reader } = harness({ skip: true });
  await context.queuePageTurn('next', () => false);
  assert.ok(!reader.classList.values.has('paging-fallback'));
  const gate = deferred();
  const pending = context.queuePageTurn('next', () => gate.promise);
  await tick();
  context.cancelPageTurns();
  gate.resolve(true);
  await pending;
  assert.equal(reader.classList.values.size, 0);
});

test('备用动画等页面就绪后才开始，到书籍边界不重复动画', async () => {
  const { context, reader } = harness({ fallback: true });
  const gate = deferred();
  const page = context.queuePageTurn('next', () => gate.promise);
  await tick();
  assert.equal(reader.classList.values.size, 0);
  gate.resolve(true);
  await page;
  assert.deepEqual([...reader.classList.values], ['paging-fallback', 'paging-next']);
  await context.queuePageTurn('prev', () => false);
  assert.ok(reader.classList.values.has('paging-next'));
});

test('取消发生在截图准备阶段时，不执行已过期的页面更新', async () => {
  const { context } = harness();
  const gate = deferred();
  context.document.startViewTransition = (update) => {
    const done = gate.promise.then(update);
    return { ready: done, updateCallbackDone: done, finished: done, skipTransition() {} };
  };
  let calls = 0;
  const turning = context.queuePageTurn('next', () => { calls += 1; });
  await tick();
  context.cancelPageTurns();
  gate.resolve();
  await turning;
  assert.equal(calls, 0);
});

test('PDF 先完成绘制，再对同步替换的页面播放动画，避免冻结绘制', async () => {
  const { context, state, root } = harness();
  state.current.format = 'pdf';
  const start = context.document.startViewTransition;
  let prepared = false;
  let snapshots = 0;
  let swaps = 0;
  context.document.startViewTransition = (swap) => {
    assert.ok(prepared, 'PDF 必须先完成依赖 rAF 的绘制');
    snapshots += 1;
    return start(swap);
  };
  const gate = deferred();
  const turning = context.queuePageTurn('next', async (present) => {
    await gate.promise;
    prepared = true;
    return present(() => { swaps += 1; return true; });
  });
  await tick();
  assert.equal(snapshots, 0);
  assert.equal(root.classList.values.size, 0);
  gate.resolve(true);
  assert.equal(await turning, true);
  assert.equal(snapshots, 1);
  assert.equal(swaps, 1);
});

test('PDF 准备期间换书，旧页不能再提交或启动动画', async () => {
  const { context, state, root } = harness();
  state.current.format = 'pdf';
  const gate = deferred();
  let swaps = 0;
  const turning = context.queuePageTurn('next', async (present) => {
    await gate.promise;
    return present(() => { swaps += 1; return true; });
  });
  await tick();
  context.cancelPageTurns();
  state.current = {};
  gate.resolve();
  assert.equal(await turning, false);
  assert.equal(swaps, 0);
  assert.equal(root.classList.values.size, 0);
});
