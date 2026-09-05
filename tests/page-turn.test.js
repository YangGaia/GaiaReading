'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const source = app.slice(app.indexOf('let pageTurnQueue ='), app.indexOf('function toggleSpread()'));
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

test('备用动画播完后才执行下一次翻页，取消后不会阻塞新书', async () => {
  const { context, reader, state } = harness({ fallback: true });
  const animation = deferred();
  let cancelled = 0;
  reader.getAnimations = () => [{ animationName: 'pageSlideNext', finished: animation.promise, cancel: () => { cancelled += 1; animation.resolve(); } }];
  const pages = [];
  const first = context.queuePageTurn('next', () => { pages.push(1); });
  const second = context.queuePageTurn('next', () => { pages.push(2); });
  await tick();
  assert.deepEqual(pages, [1], '备用动画不能被连续输入立刻覆盖');
  context.cancelPageTurns();
  state.current = {};
  reader.getAnimations = () => [];
  await context.queuePageTurn('prev', () => { pages.push(3); });
  await Promise.all([first, second]);
  assert.equal(cancelled, 1);
  assert.deepEqual(pages, [1, 3]);
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
