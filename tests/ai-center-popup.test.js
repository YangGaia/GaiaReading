'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const controls = require('../src/renderer/ai-provider-control');
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');

class FakeEvent {
  constructor(type, fields = {}) { this.type = type; this.bubbles = true; Object.assign(this, fields); }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}
class Node {
  constructor(doc, id = '') {
    this.ownerDocument = doc; this.id = id; this.children = []; this.listeners = {}; this.attributes = {}; this.style = {}; this.dataset = {}; this.hidden = false; this.value = ''; this.className = '';
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      toggle: (name, on) => { const values = new Set(this.className.split(' ').filter(Boolean)); if (on) values.add(name); else values.delete(name); this.className = [...values].join(' '); },
    };
  }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners[event.type] || []) listener(event);
    if (event.bubbles && !event.stopped && this.parentElement) this.parentElement.dispatchEvent(event);
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  closest(selector) {
    if (selector === '#' + this.id || (selector[0] === '.' && this.classList.contains(selector.slice(1))) || (selector === '[data-model-id]' && this.dataset.modelId)) return this;
    return this.parentElement?.closest(selector) || null;
  }
  querySelector(selector) { return this.children.find(child => child.closest(selector) === child) || null; }
  getBoundingClientRect() { return this.box; }
  focus() { this.ownerDocument.activeElement = this; this.ownerDocument.dispatchEvent(new FakeEvent('focusin', { target: this })); }
}

function fixture() {
  const doc = new Node(); doc.ownerDocument = doc; doc.createElement = () => new Node(doc);
  const win = new Node(doc); win.innerHeight = 760; win.GaiaAiProviderControl = controls; doc.defaultView = win;
  const scroller = doc.appendChild(new Node(doc)); scroller.className = 'ai-center-scroll'; scroller.box = { top: 80, bottom: 740 };
  const picker = scroller.appendChild(new Node(doc, 'ai-model-picker')); picker.box = { top: 200, bottom: 240 };
  const input = picker.appendChild(new Node(doc, 'ai-model'));
  const button = picker.appendChild(new Node(doc, 'btn-ai-model-menu'));
  const refresh = picker.appendChild(new Node(doc, 'btn-ai-model-refresh'));
  const list = picker.appendChild(new Node(doc, 'ai-model-options')); list.hidden = true;
  const byId = Object.fromEntries([picker, input, button, refresh, list].map(node => [node.id, node]));
  const context = vm.createContext({ window: win, document: doc, $: id => byId[id],
    els: { aiModel: input, aiModelOptions: list, aiModelHint: new Node(doc) }, refreshAiModels() {},
    aiModelChoices: () => ({ providerId: 'custom', discovered: [], presets: [{ id: 'model-a' }], labels: new Map(), ids: ['model-a', 'model-b', 'model-c'] }),
  });
  vm.runInContext(app.slice(app.indexOf('function setAiModelMenuOpen('), app.indexOf('function updateAiConfigForm(')), context);
  vm.runInContext(app.slice(app.indexOf("  $('btn-ai-model-refresh').addEventListener"), app.indexOf("  $('btn-ai-key-clear').addEventListener")), context);
  const key = (node, key) => { const event = new FakeEvent('keydown', { key }); node.dispatchEvent(event); return event; };
  const click = node => { doc.dispatchEvent(new FakeEvent('pointerdown', { target: node })); node.dispatchEvent(new FakeEvent('click')); };
  return { doc, win, scroller, picker, input, button, list, context, key, click };
}

test('model popup opens below with a bounded height and synchronizes both expanded states', () => {
  const { picker, list, input, button, click } = fixture();
  click(button);
  assert.equal(list.hidden, false);
  assert.equal(picker.classList.contains('opens-up'), false);
  assert.equal(list.style.maxHeight, '216px');
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  click(button);
  assert.equal(list.hidden, true);
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('model popup flips above at the scroll boundary and recalculates when reopened', () => {
  const { picker, scroller, list, button, click } = fixture();
  scroller.box = { top: 100, bottom: 480 };
  picker.box = { top: 400, bottom: 440 };
  click(button);
  assert.equal(picker.classList.contains('opens-up'), true);
  assert.equal(list.style.maxHeight, '216px');
  click(button);
  picker.box = { top: 120, bottom: 160 };
  click(button);
  assert.equal(picker.classList.contains('opens-up'), false);
  assert.equal(list.style.maxHeight, '216px');
});

test('shared popup geometry respects the visible intersection of viewport and scroller', () => {
  const { picker, scroller, list, win } = fixture();
  scroller.box = { top: 300, bottom: 900 }; win.innerHeight = 620;
  picker.box = { top: 500, bottom: 540 };
  controls.placeMenu(picker, list);
  assert.equal(picker.classList.contains('opens-up'), true);
  assert.equal(list.style.maxHeight, '188px');
  picker.box = { top: 330, bottom: 370 };
  controls.placeMenu(picker, list);
  assert.equal(picker.classList.contains('opens-up'), false);
  assert.equal(list.style.maxHeight, '216px');
});

test('typing, ArrowDown, Escape and mouse selection retain the editable model value', () => {
  const { doc, input, button, list, key, click } = fixture();
  input.value = 'model-b'; input.dispatchEvent(new FakeEvent('input'));
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].dataset.modelId, 'model-b');
  key(input, 'ArrowDown'); assert.equal(doc.activeElement, list.children[0]);
  const escape = key(list.children[0], 'Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(list.hidden, true); assert.equal(doc.activeElement, input); assert.equal(input.value, 'model-b');
  click(button); click(list.children[2]);
  assert.equal(input.value, 'model-c'); assert.equal(list.hidden, true); assert.equal(doc.activeElement, input);
  key(input, 'ArrowDown'); assert.equal(list.hidden, false); assert.equal(doc.activeElement, list.children[0]);
});

test('scrolling within options keeps the popup, while outside scrolling, focus, pointer and resize dismiss it', () => {
  const { doc, win, scroller, input, button, list, click } = fixture();
  click(button);
  doc.dispatchEvent(new FakeEvent('scroll', { target: list })); assert.equal(list.hidden, false);
  doc.dispatchEvent(new FakeEvent('scroll', { target: scroller })); assert.equal(list.hidden, true);
  click(button); input.focus(); assert.equal(list.hidden, false);
  const outside = new Node(doc); outside.focus();
  assert.equal(list.hidden, true); assert.equal(doc.activeElement, outside);
  click(button); doc.dispatchEvent(new FakeEvent('pointerdown', { target: outside })); assert.equal(list.hidden, true);
  click(button); win.dispatchEvent(new FakeEvent('resize')); assert.equal(list.hidden, true);
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
});
