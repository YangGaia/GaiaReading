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
  const reader = { classList: classes(), offsetWidth: 800 };
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
  const { context, errors } = harness({ skip: true });
  let pages = 0;
  await context.queuePageTurn('next', () => { pages += 1; });
  assert.equal(pages, 1);
  assert.equal(errors.length, 0);
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

test('PDF 绘制保留动画帧调度，避免截图冻结导致渲染超时', async () => {
  const { context, state, reader } = harness();
  state.current.format = 'pdf';
  context.document.startViewTransition = () => { throw new Error('PDF must be allowed to render'); };
  const gate = deferred();
  const turning = context.queuePageTurn('next', () => gate.promise);
  await tick();
  assert.equal(reader.classList.values.size, 0);
  gate.resolve(true);
  assert.equal(await turning, true);
  assert.ok(reader.classList.values.has('paging-fallback'));
});
