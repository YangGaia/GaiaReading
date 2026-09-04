'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  PAIRINGS,
  ZOOM_MODES,
  normalizePairing,
  normalizeZoomMode,
  pdfLayoutForPage,
  calculatePdfScale,
  pdfPageLabel,
} = require('../src/shared/pdf-layout');

test('PDF 单页布局只返回目标页', () => {
  assert.deepStrictEqual(pdfLayoutForPage(3, 8, false, PAIRINGS.ODD), { start: 3, slots: [3], pages: [3] });
});

test('PDF 1–2 排列按奇数页起始并保留末页空位', () => {
  assert.deepStrictEqual(pdfLayoutForPage(2, 5, true, PAIRINGS.ODD), { start: 1, slots: [1, 2], pages: [1, 2] });
  assert.deepStrictEqual(pdfLayoutForPage(5, 5, true, PAIRINGS.ODD), { start: 5, slots: [5, null], pages: [5] });
});

test('PDF 2–3 排列让第 1 页位于右侧并从偶数页配对', () => {
  assert.deepStrictEqual(pdfLayoutForPage(1, 6, true, PAIRINGS.EVEN), { start: 1, slots: [null, 1], pages: [1] });
  assert.deepStrictEqual(pdfLayoutForPage(3, 6, true, PAIRINGS.EVEN), { start: 2, slots: [2, 3], pages: [2, 3] });
  assert.deepStrictEqual(pdfLayoutForPage(6, 6, true, PAIRINGS.EVEN), { start: 6, slots: [6, null], pages: [6] });
});

test('PDF 排列与缩放模式会安全归一化', () => {
  assert.strictEqual(normalizePairing('bad'), PAIRINGS.ODD);
  assert.strictEqual(normalizeZoomMode('bad'), ZOOM_MODES.FIT_PAGE);
});

test('适合页面同时受可用宽度和高度约束', () => {
  const result = calculatePdfScale({
    viewportWidth: 1000,
    viewportHeight: 700,
    pageSizes: [{ width: 600, height: 900 }],
    padding: 20,
    mode: ZOOM_MODES.FIT_PAGE,
  });
  assert.ok(Math.abs(result.scale - (660 / 900)) < 0.0001);
  const oversizedScan = calculatePdfScale({ viewportWidth: 1000, viewportHeight: 700, pageSizes: [{ width: 50000, height: 70000 }], mode: ZOOM_MODES.FIT_PAGE });
  assert.ok(oversizedScan.scale < 0.02, '超大扫描页也必须完整缩入阅读区');
});

test('双页适合宽度计入两页宽度和中缝', () => {
  const result = calculatePdfScale({
    viewportWidth: 1260,
    viewportHeight: 900,
    pageSizes: [{ width: 600, height: 800 }, { width: 600, height: 800 }],
    gap: 20,
    padding: 20,
    mode: ZOOM_MODES.FIT_WIDTH,
  });
  assert.strictEqual(result.scale, 1);
});

test('PDF 手动缩放支持 10% 到 400%', () => {
  assert.strictEqual(calculatePdfScale({ pageSizes: [{ width: 1, height: 1 }], mode: ZOOM_MODES.MANUAL, zoom: 0.01 }).scale, 0.1);
  assert.strictEqual(calculatePdfScale({ pageSizes: [{ width: 1, height: 1 }], mode: ZOOM_MODES.MANUAL, zoom: 8 }).scale, 4);
});

test('PDF 页码状态能显示单页和跨页', () => {
  assert.strictEqual(pdfPageLabel([1], 10), '第 1 / 10 页');
  assert.strictEqual(pdfPageLabel([2, 3], 10), '第 2–3 / 10 页');
});
