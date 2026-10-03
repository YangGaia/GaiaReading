'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../src/renderer/ai-provider-control');

class FakeEvent {
  constructor(type, fields = {}) { this.type = type; Object.assign(this, fields); this.defaultPrevented = false; }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}
class Node {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.textContent = '';
    this.classList = { toggle: (name, on) => { const items = new Set((this.className || '').split(' ').filter(Boolean)); if (on) items.add(name); else items.delete(name); this.className = [...items].join(' '); } };
  }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  after(node) { const list = this.parentElement.children; list.splice(list.indexOf(this) + 1, 0, node); node.parentElement = this.parentElement; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(event) { event.target ||= this; for (const fn of this.listeners[event.type] || []) fn(event); return !event.defaultPrevented; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  closest() { return null; }
  getBoundingClientRect() { return { top: 100, bottom: 140, left: 20, right: 300, height: 40 }; }
}
function fixture() {
  const doc = new Node('document'); doc.ownerDocument = doc;
  doc.defaultView = { Event: FakeEvent, innerHeight: 760, addEventListener() {} };
  doc.createElement = tag => new Node(tag, doc);
  const host = doc.createElement('div'); doc.appendChild(host);
  const select = doc.createElement('select'); select.id = 'ai-provider'; select.value = 'deepseek';
  select.options = [['deepseek','DeepSeek'],['openai','OpenAI'],['ollama','Ollama（本地）'],['custom','自定义兼容接口']].map(([value, text]) => ({ value, textContent: text, label: text, disabled: false, hidden: false }));
  const label = doc.createElement('label'); label.textContent = '服务商'; label.htmlFor = select.id; select.labels = [label];
  host.append(label, select);
  const control = create(select);
  const key = (value, fields = {}) => { const event = new FakeEvent('keydown', { key: value, ...fields }); control.button.dispatchEvent(event); return event; };
  const click = node => node.dispatchEvent(new FakeEvent('click'));
  return { doc, select, control, key, click };
}

test('enhancement preserves source options and announces the selected provider', () => {
  const { select, control } = fixture();
  assert.equal(select.hidden, true);
  assert.equal(control.button.getAttribute('role'), 'combobox');
  assert.equal(control.button.getAttribute('aria-expanded'), 'false');
  assert.equal(control.label.textContent, 'DeepSeek');
  assert.deepEqual(control.list.children.map(row => row.textContent), select.options.map(option => option.textContent));
});

test('arrows and Home/End navigate without committing; Enter commits one change', () => {
  const { select, control, key } = fixture(); let changes = 0;
  select.addEventListener('change', () => { changes++; });
  key('ArrowDown'); key('End'); key('ArrowUp');
  assert.equal(select.value, 'deepseek');
  assert.equal(control.button.getAttribute('aria-activedescendant'), 'ai-provider-option-2');
  key('Home'); key('ArrowDown'); key('Enter');
  assert.equal(select.value, 'openai'); assert.equal(changes, 1);
  assert.equal(control.list.hidden, true); assert.equal(control.label.textContent, 'OpenAI');
});

test('Space opens and commits, while Escape cancels and returns focus', () => {
  const { doc, select, control, key } = fixture();
  key(' '); key('End'); const escape = key('Escape');
  assert.equal(select.value, 'deepseek'); assert.equal(control.list.hidden, true);
  assert.equal(doc.activeElement, control.button); assert.equal(escape.defaultPrevented, true);
  key(' '); key('End'); key(' ');
  assert.equal(select.value, 'custom'); assert.equal(control.list.hidden, true);
});

test('mouse selection uses the original change event and restores trigger focus', () => {
  const { doc, select, control, click } = fixture(); let observed;
  select.addEventListener('change', () => { observed = select.value; });
  click(control.button); click(control.list.children[2]);
  assert.equal(observed, 'ollama'); assert.equal(control.label.textContent, 'Ollama（本地）');
  assert.equal(doc.activeElement, control.button); assert.equal(control.list.hidden, true);
});

test('Tab and outside pointer close without preventing normal focus navigation', () => {
  const { doc, control, key } = fixture(); key('ArrowDown');
  const tab = key('Tab'); assert.equal(tab.defaultPrevented, false); assert.equal(control.list.hidden, true);
  key('ArrowDown'); const elsewhere = doc.createElement('button'); elsewhere.focus();
  doc.dispatchEvent(new FakeEvent('pointerdown', { target: elsewhere }));
  assert.equal(control.list.hidden, true); assert.equal(doc.activeElement, elsewhere);
});

test('form-render sync and external change reflect programmatic provider changes', () => {
  const { select, control, key } = fixture(); key('ArrowDown');
  select.value = 'custom'; control.sync();
  assert.equal(control.label.textContent, '自定义兼容接口'); assert.equal(control.list.hidden, true);
  select.value = 'openai'; select.dispatchEvent(new FakeEvent('change'));
  assert.equal(control.label.textContent, 'OpenAI');
  assert.equal(control.list.children[1].getAttribute('aria-selected'), 'true');
});

test('disabled options are skipped and disabled source prevents opening', () => {
  const { select, control, key } = fixture(); select.options[1].disabled = true; control.sync();
  key('ArrowDown'); key('ArrowDown'); key('Enter'); assert.equal(select.value, 'ollama');
  select.disabled = true; control.sync(); key('ArrowDown');
  assert.equal(control.button.disabled, true); assert.equal(control.list.hidden, true);
});

test('type-ahead locates a provider and does not dispatch change before confirmation', () => {
  const { select, control, key } = fixture(); key('c');
  assert.equal(control.list.hidden, false);
  key('Escape'); key('o'); key('Enter'); assert.equal(select.value, 'openai');
});
