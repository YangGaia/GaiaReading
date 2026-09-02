'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeWheelDelta,
  createWheelGate,
  clampPdfZoom,
  nextPdfZoom,
  shouldScrollPdfPage,
} = require('../src/shared/reader-input');

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

test('PDF Ctrl+滚轮按方向缩放并限制安全倍率', () => {
  assert.strictEqual(nextPdfZoom(1, -120), 1.1, '向上滚应放大');
  assert.strictEqual(nextPdfZoom(1, 120), 0.9, '向下滚应缩小');
  assert.strictEqual(nextPdfZoom(1, -12), 1.02, '触控板的小位移应细腻缩放');
  assert.strictEqual(nextPdfZoom(2, -120), 2, '放大不得超过 200%');
  assert.strictEqual(nextPdfZoom(0.6, 120), 0.6, '缩小不得低于 60%');
  assert.strictEqual(clampPdfZoom(Number.NaN), 1, '非法倍率应恢复为 100%');
});

test('PDF 普通滚轮优先滚动页内内容，到边缘后才允许翻页', () => {
  const viewport = { scrollTop: 300, scrollHeight: 1600, clientHeight: 800 };
  assert.strictEqual(shouldScrollPdfPage(viewport, 120), true);
  assert.strictEqual(shouldScrollPdfPage(viewport, -120), true);
  assert.strictEqual(shouldScrollPdfPage({ ...viewport, scrollTop: 800 }, 120), false, '页底向下应交给翻页');
  assert.strictEqual(shouldScrollPdfPage({ ...viewport, scrollTop: 0 }, -120), false, '页首向上应交给翻页');
});
