'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const geometryCode = app.slice(app.indexOf('let aiPanelAppliedGeometry ='), app.indexOf('function closeAiAssistantPanel('));
const copy = value => JSON.parse(JSON.stringify(value));

function setup(saved, { width = 1100, height = 760, bodyLeft = 0, bodyTop = 68, bodyRight = 0, bodyBottom = 56 } = {}) {
  const listeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  const writes = [];
  let timerId = 0;
  let observer;
  const observed = new Set();
  const window = {
    innerWidth: width, innerHeight: height,
    addEventListener: (name, callback) => windowListeners.set(name, callback),
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    api: { stateSet: (key, value) => writes.push({ key, value: copy(value) }) },
  };
  const number = (value, fallback) => Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback;
  const panel = {
    hidden: false, style: {}, parentNode: null,
    getBoundingClientRect() {
      if (this.hidden || readerView.hidden) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
      const minimumWidth = number(this.style.minWidth, Math.min(window.innerWidth, window.innerWidth <= 760 ? 280 : 340));
      const minimumHeight = number(this.style.minHeight, Math.min(window.innerHeight, 360));
      const left = number(this.style.left, 0), top = number(this.style.top, 0);
      const width = Math.max(minimumWidth, Math.min(number(this.style.width, 440), number(this.style.maxWidth, window.innerWidth)));
      const height = Math.max(minimumHeight, Math.min(number(this.style.height, 680), number(this.style.maxHeight, window.innerHeight)));
      return { left, top, width, height, right: left + width, bottom: top + height };
    },
  };
  const readerView = { hidden: false, appendChild: child => { child.parentNode = readerView; } };
  const body = {
    left: bodyLeft, top: bodyTop, right: bodyRight, bottom: bodyBottom, translationX: 0, translationY: 0,
    getBoundingClientRect() {
      if (readerView.hidden) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
      const left = this.left + this.translationX, top = this.top + this.translationY;
      const width = window.innerWidth - this.left - this.right, height = window.innerHeight - this.top - this.bottom;
      return { left, top, width, height, right: left + width, bottom: top + height };
    },
  };
  const handle = { addEventListener: (name, callback) => listeners.set(name, callback), setPointerCapture() {} };
  const state = { prefs: { aiWindow: saved == null ? null : copy(saved) } };
  const context = vm.createContext({
    window, state, els: { aiSummaryPanel: panel, aiPanelDragHandle: handle },
    $: id => id === 'reader-body' ? body : readerView,
    getComputedStyle: target => target === body
      ? { transform: `matrix(1, 0, 0, 1, ${body.translationX}, ${body.translationY})` }
      : { getPropertyValue: name => name === '--ai-min-width' ? (window.innerWidth <= 760 ? '280px' : '340px') : '360px' },
    DOMMatrixReadOnly: class {
      constructor(transform) {
        const values = transform.slice(7, -1).split(',').map(Number);
        this.m41 = values[4]; this.m42 = values[5];
      }
    },
    ResizeObserver: class { constructor(callback) { observer = callback; } observe(target) { observed.add(target); } },
    clearTimeout: id => timers.delete(id), resizeAiChatInput() {},
  });
  vm.runInContext(geometryCode, context);
  const pointer = (name, x, y) => listeners.get(name)({ button: 0, clientX: x, clientY: y, pointerId: 1, target: { closest: () => null }, preventDefault() {} });
  return {
    context, panel, body, observed, state, window, readerView, writes, pointer,
    initialize() { context.initAiPanelInteractions(); context.restoreAiPanelGeometry(); observer(); },
    observe: () => observer(),
    resize(width, height) { window.innerWidth = width; window.innerHeight = height; windowListeners.get('resize')(); observer(); },
    flush() { for (const callback of timers.values()) callback(); timers.clear(); },
  };
}

test('AI 默认位置和尺寸沿用阅读区域，并脱离正文裁切容器', () => {
  const fixture = setup();
  fixture.initialize();
  assert.deepEqual(fixture.panel.getBoundingClientRect(), { left: 636, top: 90, width: 440, height: 592, right: 1076, bottom: 682 });
  assert.equal(fixture.panel.parentNode, fixture.readerView);
  assert.equal(fixture.writes.length, 0, '程序恢复和初次 ResizeObserver 通知不应保存几何');
});

test('AI 旧阅读区相对坐标只迁移一次，尺寸和屏幕位置保持不变', () => {
  const fixture = setup({ left: 100, top: 30, width: 500, height: 400 }, { bodyLeft: 24, bodyTop: 80 });
  fixture.initialize();
  const expected = { coordinateSpace: 'viewport', left: 124, top: 110, width: 500, height: 400 };
  assert.deepEqual(copy(fixture.state.prefs.aiWindow), expected);
  assert.equal(fixture.writes.length, 1);
  fixture.context.restoreAiPanelGeometry();
  fixture.observe();
  assert.deepEqual(copy(fixture.state.prefs.aiWindow), expected);
  assert.equal(fixture.panel.getBoundingClientRect().top, 110);
  assert.equal(fixture.writes.length, 1);
});

test('AI 可拖动至阅读区域四边，不能遮挡上下工具栏，关开保留完整窗框', () => {
  const fixture = setup({ coordinateSpace: 'viewport', left: 200, top: 120, width: 440, height: 480 }, { bodyLeft: 24, bodyRight: 32 });
  fixture.initialize();
  fixture.pointer('pointerdown', 220, 140);
  fixture.pointer('pointermove', 5000, 5000);
  fixture.pointer('pointerup', 5000, 5000);
  assert.deepEqual(copy(fixture.state.prefs.aiWindow), { coordinateSpace: 'viewport', left: 628, top: 224, width: 440, height: 480 });
  let rect = fixture.panel.getBoundingClientRect();
  assert.equal(rect.right, 1068);
  assert.equal(rect.bottom, 704, '完整窗框必须位于底部工具栏上方');
  fixture.panel.hidden = true;
  fixture.panel.hidden = false;
  fixture.context.restoreAiPanelGeometry();
  assert.deepEqual(fixture.panel.getBoundingClientRect(), rect);
  fixture.pointer('pointerdown', 680, 300);
  fixture.pointer('pointermove', -5000, -5000);
  fixture.pointer('pointerup', -5000, -5000);
  rect = fixture.panel.getBoundingClientRect();
  assert.equal(rect.left, 24);
  assert.equal(rect.top, 68);
});

test('AI 右下角缩放受阅读区边缘限制，不产生工具栏上的按钮', () => {
  const fixture = setup({ coordinateSpace: 'viewport', left: 660, top: 224, width: 440, height: 480 });
  fixture.initialize();
  fixture.panel.style.width = '900px';
  fixture.panel.style.height = '900px';
  fixture.observe();
  assert.equal(fixture.panel.getBoundingClientRect().right, 1100);
  assert.equal(fixture.panel.getBoundingClientRect().bottom, 704);
});

test('AI 手动缩放记忆不会被主窗口缩小和恢复覆盖', () => {
  const fixture = setup({ coordinateSpace: 'viewport', left: 500, top: 100, width: 580, height: 620 }, { width: 1200, height: 820 });
  fixture.initialize();
  fixture.panel.style.width = '620px';
  fixture.panel.style.height = '650px';
  fixture.observe();
  const intended = { coordinateSpace: 'viewport', left: 500, top: 100, width: 620, height: 650 };
  assert.deepEqual(copy(fixture.state.prefs.aiWindow), intended);
  fixture.resize(800, 600);
  const clamped = fixture.panel.getBoundingClientRect();
  assert.ok(clamped.right <= 800 && clamped.top >= 68 && clamped.bottom <= 544);
  assert.deepEqual(copy(fixture.state.prefs.aiWindow), intended);
  fixture.flush();
  assert.deepEqual(fixture.writes.at(-1).value.aiWindow, intended, '缩放保存计时器也应保存用户意图而非临时夹紧的窗框');
  fixture.resize(1200, 820);
  const restored = fixture.panel.getBoundingClientRect();
  assert.equal(restored.left, 500);
  assert.equal(restored.top, 100);
  assert.equal(restored.width, 620);
  assert.equal(restored.height, 650);
  assert.deepEqual(copy(fixture.state.prefs.aiWindow), intended);
});

test('AI 尺寸遵守宽窄屏 CSS 最小值，阅读区比最小高度矮时仍保持完整', () => {
  const fixture = setup({ coordinateSpace: 'viewport', left: 1000, top: 700, width: 200, height: 200 });
  fixture.initialize();
  assert.equal(fixture.panel.getBoundingClientRect().width, 340);
  assert.equal(fixture.panel.getBoundingClientRect().height, 360);
  fixture.resize(700, 600);
  assert.equal(fixture.panel.getBoundingClientRect().width, 280);
  fixture.resize(260, 440);
  assert.deepEqual(fixture.panel.getBoundingClientRect(), { left: 0, top: 68, width: 260, height: 316, right: 260, bottom: 384 });
});

test('工具栏换行改变阅读区时自动限位，但不覆盖原有位置和尺寸', () => {
  const intended = { coordinateSpace: 'viewport', left: 500, top: 68, width: 440, height: 620 };
  const fixture = setup(intended);
  fixture.initialize();
  assert.ok(fixture.observed.has(fixture.body), '阅读区自身必须受观察，不仅监听 window resize');
  fixture.body.top = 120;
  fixture.body.bottom = 80;
  fixture.observe();
  assert.deepEqual(fixture.panel.getBoundingClientRect(), { left: 500, top: 120, width: 440, height: 560, right: 940, bottom: 680 });
  fixture.observe();
  assert.deepEqual(copy(fixture.state.prefs.aiWindow), intended);
  assert.equal(fixture.writes.length, 0);
  fixture.body.top = 68;
  fixture.body.bottom = 56;
  fixture.observe();
  assert.equal(fixture.panel.getBoundingClientRect().height, 620);
  assert.equal(fixture.panel.getBoundingClientRect().top, 68);
});

test('阅读区仅原点变化也会重新限位，进入动画不会造成边界漂移', () => {
  const fixture = setup({ coordinateSpace: 'viewport', left: 0, top: 68, width: 440, height: 400 });
  fixture.body.translationY = 8;
  fixture.initialize();
  assert.equal(fixture.panel.getBoundingClientRect().top, 68);
  fixture.body.translationY = 0;
  fixture.body.top += 20;
  fixture.body.bottom -= 20;
  fixture.observe();
  assert.equal(fixture.panel.getBoundingClientRect().top, 88);
  assert.equal(fixture.writes.length, 0);
});

test('旧版全窗口边缘的记录恢复时夹紧到阅读区，不覆盖记忆', () => {
  const intended = { coordinateSpace: 'viewport', left: 660, top: 280, width: 440, height: 480 };
  const fixture = setup(intended);
  fixture.initialize();
  assert.equal(fixture.panel.getBoundingClientRect().bottom, 704);
  assert.deepEqual(copy(fixture.state.prefs.aiWindow), intended);
  assert.equal(fixture.writes.length, 0);
});

test('从 AI 对话打开 AI 中心时，隐藏的阅读页不会把记忆窗框清零', () => {
  const intended = { coordinateSpace: 'viewport', left: 500, top: 100, width: 440, height: 480 };
  const fixture = setup(intended);
  fixture.initialize();
  fixture.readerView.hidden = true;
  fixture.observe();
  fixture.context.saveAiPanelGeometry();
  fixture.flush();
  assert.deepEqual(copy(fixture.state.prefs.aiWindow), intended);
  assert.equal(fixture.writes.length, 0);
  fixture.readerView.hidden = false;
  fixture.observe();
  assert.equal(fixture.panel.getBoundingClientRect().left, 500);
  assert.equal(fixture.panel.getBoundingClientRect().top, 100);
});
