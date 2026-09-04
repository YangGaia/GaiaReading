'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  MODES,
  normalize,
  toggleManual,
  enterEdge,
  leaveHover,
  disableEdge,
  activateItem,
  dismissManual,
} = require('../src/shared/toc-panel');

test('目录按钮在关闭状态打开手动模式，再次切换后关闭', () => {
  assert.strictEqual(toggleManual(MODES.CLOSED), MODES.MANUAL);
  assert.strictEqual(toggleManual(MODES.MANUAL), MODES.CLOSED);
  assert.strictEqual(toggleManual(MODES.HOVER), MODES.MANUAL);
});

test('阅读区左缘只在关闭状态开启悬停模式', () => {
  assert.strictEqual(enterEdge(MODES.CLOSED), MODES.HOVER);
  assert.strictEqual(enterEdge(MODES.MANUAL), MODES.MANUAL);
  assert.strictEqual(enterEdge(MODES.HOVER), MODES.HOVER);
  assert.strictEqual(enterEdge(MODES.CLOSED, true), MODES.CLOSED, '其他阅读工具开启时不得抢占界面');
});

test('鼠标离开只关闭触边展开的目录', () => {
  assert.strictEqual(leaveHover(MODES.HOVER), MODES.CLOSED);
  assert.strictEqual(leaveHover(MODES.MANUAL), MODES.MANUAL);
});

test('关闭左缘功能只收回触边目录，不影响手动目录', () => {
  assert.strictEqual(disableEdge(MODES.HOVER), MODES.CLOSED);
  assert.strictEqual(disableEdge(MODES.MANUAL), MODES.MANUAL);
  assert.strictEqual(disableEdge(MODES.CLOSED), MODES.CLOSED);
});

test('点击章节只关闭按钮打开的目录', () => {
  assert.strictEqual(activateItem(MODES.MANUAL), MODES.CLOSED);
  assert.strictEqual(activateItem(MODES.HOVER), MODES.HOVER);
});

test('点击外部只关闭按钮打开的目录且非法状态安全回退', () => {
  assert.strictEqual(dismissManual(MODES.MANUAL), MODES.CLOSED);
  assert.strictEqual(dismissManual(MODES.HOVER), MODES.HOVER);
  assert.strictEqual(normalize('unexpected'), MODES.CLOSED);
});
