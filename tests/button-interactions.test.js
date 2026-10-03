'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/button-interactions.js'), 'utf8');

function harness() {
  const events = {};
  const windowEvents = {};
  const frames = new Map();
  const media = { matches: false, addEventListener(type, fn) { this.change = fn; } };
  const document = { hidden: false, addEventListener(type, fn) { events[type] = fn; } };
  let nextFrame = 0;
  vm.runInNewContext(source, {
    document, window: { addEventListener(type, fn) { windowEvents[type] = fn; } },
    matchMedia: () => media,
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  function button(options = {}) {
    const values = new Map();
    return {
      disabled: false, isConnected: true, excluded: false, hidden: false, ...options,
      values,
      style: { setProperty: (name, value) => values.set(name, value), removeProperty: (name) => values.delete(name) },
      closest(selector) {
        if (selector === 'button') return this;
        return this.hidden || (selector.includes('#reader-content') && this.excluded) ? {} : null;
      },
      contains(target) { return target === this || target?.parentButton === this; },
      getBoundingClientRect() { return { left: 10, top: 20, width: 100, height: 40 }; },
    };
  }
  function move(target, overrides = {}) {
    events.pointermove({ target, pointerType: 'mouse', buttons: 0, clientX: 35, clientY: 30, ...overrides });
  }
  function flush() {
    for (const [id, fn] of [...frames]) { frames.delete(id); fn(); }
  }
  return { events, windowEvents, frames, media, document, button, move, flush };
}

test('late-created buttons and nested icons share one coalesced pointer light', () => {
  const h = harness();
  const b = h.button();
  const icon = { parentButton: b, closest: () => b };
  h.move(icon);
  h.move(icon, { clientX: 90, clientY: 52 });
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.equal(b.values.get('--hover-x'), '80.00%');
  assert.equal(b.values.get('--hover-y'), '80.00%');
  h.events.pointerout({ relatedTarget: icon });
  assert.equal(b.values.size, 2, 'moving between icon and label keeps the light');
  const next = h.button();
  h.move(next, { clientX: -30, clientY: 500 });
  h.flush();
  assert.equal(b.values.size, 0);
  assert.equal(next.values.get('--hover-x'), '0.00%');
  assert.equal(next.values.get('--hover-y'), '100.00%');
  h.events.pointerout({ relatedTarget: null });
  assert.equal(next.values.size, 0);
});

test('book content, disabled controls, touch and dragging never acquire the light', () => {
  const h = harness();
  for (const options of [{ excluded: true }, { disabled: true }, { hidden: true }]) {
    const b = h.button(options);
    h.move(b); h.flush();
    assert.equal(b.values.size, 0);
  }
  for (const event of [{ pointerType: 'touch' }, { buttons: 1 }]) {
    const b = h.button();
    h.move(b, event); h.flush();
    assert.equal(b.values.size, 0);
  }
  assert.equal(h.events.click, undefined, 'native activation is never intercepted');
});

test('removed or hidden buttons are skipped even if a frame was already queued', () => {
  for (const flag of ['isConnected', 'disabled', 'hidden']) {
    const h = harness();
    const b = h.button();
    h.move(b);
    b[flag] = flag !== 'isConnected';
    h.flush();
    assert.equal(b.values.size, 0);
  }
});

test('focus, pointer cancellation, visibility and reduced-motion changes cancel pending light', () => {
  for (const exit of ['focusout', 'pointercancel', 'visibilitychange', 'blur', 'motion']) {
    const h = harness();
    const b = h.button();
    h.move(b); h.flush();
    h.move(b);
    if (exit === 'blur') h.windowEvents.blur();
    else if (exit === 'motion') { h.media.matches = true; h.media.change(); }
    else h.events[exit]();
    assert.equal(h.frames.size, 0, exit);
    assert.equal(b.values.size, 0, exit);
    h.flush();
    assert.equal(b.values.size, 0, exit);
  }
  const h = harness();
  const b = h.button();
  h.media.matches = true;
  h.move(b); h.flush();
  assert.equal(b.values.size, 0);
});
