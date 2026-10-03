'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { regions, isReadingTarget, clipCanvas, raiseCanvas } = require('../src/shared/mouse-effects-scope');

const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const contains = (boxes, x, y) => boxes.some(box => x >= box.left && x < box.right && y >= box.top && y < box.bottom);

test('reader body including margins stays clear while header, footer and side chrome remain enabled', () => {
  const allowed = regions(1000, 700, [rect(80, 60, 940, 650)]);
  for (const point of [[500, 20], [500, 680], [40, 300], [980, 300]]) assert.ok(contains(allowed, ...point));
  for (const point of [[81, 61], [500, 300], [939, 649]]) assert.ok(!contains(allowed, ...point));
});

test('overlapping tools form a union inside the reader and clip to the viewport', () => {
  const allowed = regions(1000, 700, [rect(-20, 60, 1100, 650)], [rect(600, 200, 1200, 500), rect(650, 250, 850, 350)]);
  assert.ok(contains(allowed, 700, 300), 'a menu overlapping its dialog remains enabled');
  assert.ok(contains(allowed, 999, 300));
  assert.ok(!contains(allowed, 1001, 300));
  assert.ok(!contains(allowed, 500, 300));
  assert.deepEqual(regions(0, 0), []);
});

function domHarness({ hiddenHost = false, overlayStyle, ancestorStyle } = {}) {
  const styles = { display: 'block', visibility: 'visible', opacity: '1' };
  let reads = 0;
  const element = (bounds, style = {}, parentElement = null) => ({ nodeType: 1, parentElement,
    style: { ...styles, ...style }, getClientRects: () => [bounds], getBoundingClientRect() { reads += 1; return bounds; } });
  const host = element(rect(80, 60, 940, 650), hiddenHost ? { display: 'none' } : {});
  const ancestor = element(rect(500, 100, 1000, 600), ancestorStyle);
  const overlay = element(rect(600, 200, 900, 500), overlayStyle, ancestor);
  const queries = [];
  const doc = { getElementById: () => host, defaultView: { getComputedStyle: el => el.style },
    querySelectorAll(selector) { queries.push(selector); assert.ok(!/iframe|pdf-page/.test(selector), 'no per-page DOM walk'); return [overlay]; } };
  const paths = [];
  let clips = 0;
  const context = { beginPath() {}, rect(x, y, w, h) { paths.push(rect(x, y, x + w, y + h)); }, clip(rule) { clips += 1; assert.equal(rule, undefined, 'nonzero union fill'); } };
  return { doc, context, paths, queries, reads: () => reads, clips: () => clips };
}

test('clipping reads one body rectangle regardless of PDF page count and restores visible tools', () => {
  const h = domHarness();
  clipCanvas(h.context, 1000, 700, h.doc);
  assert.equal(h.reads(), 2, 'only body and visible overlay geometry are read');
  assert.equal(h.queries.length, 1);
  assert.match(h.queries[0], /:popover-open:not\(#fx-canvas\)/, 'top-layer menus are included without reopening the entire effects canvas');
  assert.equal(h.clips(), 1);
  assert.ok(contains(h.paths, 700, 300));
  assert.ok(!contains(h.paths, 300, 300));
});

test('invisible overlays and transparent ancestors cannot reopen holes above book text', () => {
  for (const options of [{ overlayStyle: { opacity: '0' } }, { ancestorStyle: { opacity: '0' } },
    { overlayStyle: { visibility: 'hidden' } }, { ancestorStyle: { display: 'none' } }]) {
    const h = domHarness(options);
    clipCanvas(h.context, 1000, 700, h.doc);
    assert.ok(!contains(h.paths, 700, 300));
  }
});

test('a hidden reader does not clip home, library, statistics or AI center effects', () => {
  const h = domHarness({ hiddenHost: true });
  clipCanvas(h.context, 1000, 700, h.doc);
  assert.equal(h.clips(), 0);
  assert.equal(h.queries.length, 0);
});

test('reading targets include the host and text nodes while nested application tools remain enabled', () => {
  const target = (book, overlay = false) => ({ closest: selector => selector === '#reader-content' ? book : overlay });
  assert.equal(isReadingTarget(target(true)), true);
  assert.equal(isReadingTarget({ nodeType: 3, parentElement: target(true) }), true);
  assert.equal(isReadingTarget(target(true, true)), false);
  assert.equal(isReadingTarget(target(false)), false);
  assert.equal(isReadingTarget(null), false);
});

test('the transparent canvas can move above a newly opened popover without taking focus', () => {
  const actions = [];
  const canvas = { hidden: false, open: false,
    setAttribute(name, value) { assert.equal(name, 'popover'); assert.equal(value, 'manual'); },
    matches() { return this.open; },
    showPopover() { this.open = true; actions.push('show'); },
    hidePopover() { this.open = false; actions.push('hide'); },
    focus() { throw new Error('mouse effects must not steal focus'); } };
  raiseCanvas(canvas);
  raiseCanvas(canvas);
  assert.deepEqual(actions, ['show'], 'switching views leaves the existing canvas in the top layer');
  raiseCanvas(canvas, true);
  assert.deepEqual(actions, ['show', 'hide', 'show']);
  canvas.hidden = true;
  raiseCanvas(canvas);
  assert.equal(actions.length, 3, 'splash remains hidden');
  assert.doesNotThrow(() => raiseCanvas({ hidden: false }), 'z-index fallback for runtimes without popover');
});

function routingHarness() {
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  const source = app.slice(app.indexOf('const fx = {'), app.indexOf('/* ===== 阅读配色'));
  const binding = app.slice(app.indexOf('function bindReaderKeyboard('), app.indexOf('function bindReaderWheel('));
  const listeners = new Map();
  const calls = { clear: 0, reset: 0, click: 0, move: 0, hitTest: 0 };
  let raised = 0;
  const canvas = { hidden: false };
  const document = { hidden: false, hit: null, elementFromPoint() { calls.hitTest += 1; return this.hit; }, addEventListener(type, fn, options) { listeners.set(type, { fn, options }); } };
  const window = { addEventListener() {}, GaiaMouseEffectsScope: { isReadingTarget: target => !!target?.reading, raiseCanvas() { raised += 1; } },
    MouseEffects: { create: () => ({ clear() { calls.clear += 1; }, resetTrail() { calls.reset += 1; }, click() { calls.click += 1; }, move() { calls.move += 1; } }) } };
  const context = vm.createContext({ document, window, $: () => canvas, onReaderKey() {}, onReaderKeyUp() {}, onReaderFocus() {}, onReaderVisibility() {}, onReaderBlur() {} });
  vm.runInContext(source + binding, context);
  context.initFx();
  const event = (type, extra = {}) => listeners.get(type).fn({ isPrimary: true, button: 0, clientX: 100, clientY: 100, target: document.hit || {}, ...extra });
  return { calls, canvas, context, document, listeners, event, raised: () => raised };
}

test('passive primary routing preserves UI stars on book entry and avoids repeated native hit tests', () => {
  const h = routingHarness();
  h.event('pointermove'); h.event('pointerdown');
  assert.deepEqual(h.calls, { clear: 0, reset: 0, click: 1, move: 1, hitTest: 0 });
  h.document.hit = { reading: true };
  h.event('pointermove'); h.event('pointerdown'); h.event('pointermove');
  assert.deepEqual(h.calls, { clear: 0, reset: 1, click: 1, move: 1, hitTest: 0 });
  h.document.hit = null;
  h.event('pointermove'); h.event('pointerdown', { button: 2 }); h.event('pointerdown', { isPrimary: false });
  assert.deepEqual(h.calls, { clear: 0, reset: 1, click: 1, move: 2, hitTest: 0 });
  for (const type of ['pointermove', 'pointerdown']) {
    assert.equal(h.listeners.get(type).options.passive, true);
    assert.equal(h.listeners.get(type).options.capture, true);
  }
  h.document.hidden = true;
  h.event('visibilitychange'); h.event('pointermove'); h.event('pointerdown');
  assert.deepEqual(h.calls, { clear: 1, reset: 1, click: 1, move: 2, hitTest: 0 });
});

test('book iframe listeners reset trail sampling without erasing stars or intercepting input', () => {
  const h = routingHarness();
  const listeners = new Map();
  const inner = { addEventListener(type, fn, options) { listeners.set(type, { fn, options }); } };
  h.context.bindReaderKeyboard(inner);
  h.event('pointermove');
  listeners.get('pointermove').fn();
  listeners.get('pointerdown').fn();
  assert.equal(h.calls.clear, 0);
  assert.equal(h.calls.reset, 1);
  assert.equal(listeners.get('pointerdown').options.passive, true);
  assert.equal(listeners.get('pointermove').options.passive, true);
  assert.ok(listeners.has('keydown'));
  assert.ok(listeners.has('keyup'));
});

test('programmatic effects without an event target still exclude the reader via a hit test', () => {
  const h = routingHarness();
  h.document.hit = { reading: true };
  h.context.spawnBurst(100, 100);
  assert.equal(h.calls.click, 0);
  assert.equal(h.calls.hitTest, 1);
});

test('opening a top-layer menu raises mouse effects once without a toggle feedback loop', () => {
  const h = routingHarness();
  h.event('toggle', { target: {}, newState: 'open' });
  assert.equal(h.raised(), 1);
  h.event('toggle', { target: h.canvas, newState: 'open' });
  h.event('toggle', { target: {}, newState: 'closed' });
  assert.equal(h.raised(), 1);
});
