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

test('PDF 左右和上下留白独立影响页面适配', () => {
  const base = { viewportWidth: 1000, viewportHeight: 800, pageSizes: [{ width: 1000, height: 800 }], paddingX: 100, paddingY: 0 };
  assert.strictEqual(calculatePdfScale({ ...base, mode: ZOOM_MODES.FIT_WIDTH }).scale, 0.8);
  assert.strictEqual(calculatePdfScale({ ...base, paddingY: 160, mode: ZOOM_MODES.FIT_PAGE }).scale, 0.6);
  assert.strictEqual(calculatePdfScale({ ...base, paddingX: 0, mode: ZOOM_MODES.FIT_PAGE }).scale, 1);
});

test('PDF 页码状态能显示单页和跨页', () => {
  assert.strictEqual(pdfPageLabel([1], 10), '第 1 / 10 页');
  assert.strictEqual(pdfPageLabel([2, 3], 10), '第 2–3 / 10 页');
});

test('PDF 打开入口禁用字体代码动态求值，并保留原阅读位置和缩放', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  const source = app.slice(app.indexOf('async function openPdf('), app.indexOf('function currentSpreadGap('));
  assert.strictEqual((app.match(/pdfjsLib\.getDocument\(/g) || []).length, 1, '所有书籍必须走同一个受保护的 PDF 加载入口');
  const file = 'F:\\fixture.pdf';
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const document = { numPages: 6 };
  let options;
  let rendered = 0;
  const state = { current: {}, progress: { [file]: { page: 3, settings: { zoom: 1.4, pdfZoomMode: ZOOM_MODES.FIT_WIDTH, pdfPairing: PAIRINGS.EVEN } } } };
  const context = vm.createContext({
    state, toUint8Array: value => value,
    clampPdfZoom: value => Math.max(.1, Math.min(4, value)),
    normalizePdfZoomMode: normalizeZoomMode,
    normalizePdfPairing: normalizePairing,
    renderPdfPage: async () => { rendered += 1; },
    window: {
      api: { readBook: async target => { assert.strictEqual(target, file); return { data: bytes }; } },
      pdfjsLib: { getDocument: value => { options = value; return { promise: Promise.resolve(document) }; } },
    },
  });
  vm.runInContext(source, context);
  await context.openPdf({ path: file });
  assert.strictEqual(options.isEvalSupported, false);
  assert.strictEqual(options.data, bytes);
  assert.strictEqual(state.current.pdf, document);
  assert.strictEqual(state.current.page, 3);
  assert.strictEqual(state.current.zoom, 1.4);
  assert.strictEqual(state.current.pdfZoomMode, ZOOM_MODES.FIT_WIDTH);
  assert.strictEqual(state.current.pdfPairing, PAIRINGS.EVEN);
  assert.strictEqual(rendered, 1);
});
