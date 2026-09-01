'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizeWheelDelta, createWheelGate } = require('../src/shared/reader-input');

test('normalizeWheelDelta: 像素模式原样返回', () => {
  assert.strictEqual(normalizeWheelDelta({ deltaY: 120, deltaMode: 0 }), 120);
});

test('normalizeWheelDelta: 行模式放大', () => {
  assert.strictEqual(normalizeWheelDelta({ deltaY: 3, deltaMode: 1 }), 48);
});

test('normalizeWheelDelta: 页模式放大', () => {
  assert.strictEqual(normalizeWheelDelta({ deltaY: 1, deltaMode: 2 }), 100);
});

test('normalizeWheelDelta: 缺省/非法返回 0', () => {
  assert.strictEqual(normalizeWheelDelta({}), 0);
  assert.strictEqual(normalizeWheelDelta(null), 0);
});

test('滚轮门控: 低于阈值不翻页', () => {
  const gate = createWheelGate({ threshold: 60, cooldown: 1000 });
  assert.strictEqual(gate.feed(30, 0), null);
  assert.strictEqual(gate.feed(20, 10), null);
});

test('滚轮门控: 向下滚(正值)下一翻页', () => {
  const gate = createWheelGate({ threshold: 60, cooldown: 100 });
  assert.strictEqual(gate.feed(70, 0), 'next');
});

test('滚轮门控: 向上滚(负值)上一翻页', () => {
  const gate = createWheelGate({ threshold: 60, cooldown: 100 });
  assert.strictEqual(gate.feed(-70, 0), 'prev');
});

test('滚轮门控: 方向反转清零后需重新累计', () => {
  const gate = createWheelGate({ threshold: 100, cooldown: 50 });
  assert.strictEqual(gate.feed(60, 0), null);
  assert.strictEqual(gate.feed(-60, 1), null);
  assert.strictEqual(gate.feed(-40, 2), 'prev');
});

test('滚轮门控: 冷却期内不重复翻页, 冷却后继续翻', () => {
  const gate = createWheelGate({ threshold: 60, cooldown: 200 });
  assert.strictEqual(gate.feed(120, 0), 'next');
  assert.strictEqual(gate.feed(120, 50), null);
  assert.strictEqual(gate.feed(120, 199), null);
  assert.strictEqual(gate.feed(120, 201), 'next');
});

test('滚轮门控: reset 清空累计与冷却', () => {
  const gate = createWheelGate({ threshold: 60, cooldown: 500 });
  gate.feed(120, 0);
  gate.reset();
  assert.strictEqual(gate.feed(120, 0), 'next');
});