'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/mouse-effects.js'), 'utf8');

function harness(options = {}) {
  let now = 100, nextFrame = 1, resizeCallback;
  let bounds = { width: 1440, height: 900 };
  const frames = new Map(), listeners = new Map();
  const calls = { images: [], clears: [], mainFills: 0, textureFills: 0, dimensionWrites: 0, textures: [], bitmaps: [], textureContexts: [], clips: 0 };
  const context = (texture = false) => new Proxy({
    drawImage(...args) { calls.images.push(args); },
    clearRect(...args) { if (!texture) calls.clears.push(args); },
    fill() { if (texture) calls.textureFills += 1; else calls.mainFills += 1; },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const main = context();
  let backingWidth = 300, backingHeight = 150;
  const canvas = { getContext: () => main, parentElement: { getBoundingClientRect: () => bounds },
    get width() { return backingWidth; }, set width(value) { backingWidth = value; calls.dimensionWrites += 1; },
    get height() { return backingHeight; }, set height(value) { backingHeight = value; calls.dimensionWrites += 1; } };
  class Texture {
    constructor(width, height) { this.width = width; this.height = height; calls.textures.push(this); }
    getContext(kind, attributes) { calls.textureContexts.push({ kind, attributes }); return context(true); }
  }
  class OffscreenTexture extends Texture {
    transferToImageBitmap() {
      const bitmap = { width: this.width, height: this.height, closed: false,
        close() { assert.equal(this.closed, false, 'each bitmap is released once'); this.closed = true; } };
      calls.bitmaps.push(bitmap);
      return bitmap;
    }
  }
  class Observer {
    constructor(callback) { resizeCallback = callback; }
    observe() {}
    disconnect() { calls.disconnected = true; }
  }
  const window = { devicePixelRatio: options.dpr || 1,
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); } };
  const realm = vm.createContext({ window, ResizeObserver: Observer,
    ...(options.noSprites ? {} : options.domCanvas ? { document: { createElement: () => new Texture(0, 0) } } : { OffscreenCanvas: OffscreenTexture }),
    performance: { now: () => now }, Math: Object.create(Math),
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); } });
  // Stable particle sizes make sprite-reuse assertions independent of randomness.
  realm.Math.random = () => .5;
  vm.runInContext(source, realm);
  const effect = window.MouseEffects.create(canvas, { id: 2, intensity: 1, scale: 1.5,
    clip() { calls.clips += 1; }, ...options.effect });
  const step = (elapsed = 1000 / 60) => {
    now += elapsed;
    const queued = [...frames.values()]; frames.clear();
    for (const callback of queued) callback(now);
  };
  const resize = (width = bounds.width, height = bounds.height, dpr = window.devicePixelRatio) => {
    bounds = { width, height }; window.devicePixelRatio = dpr; resizeCallback();
  };
  return { effect, calls, canvas, frames, listeners, step, resize, advance(ms) { now += ms; } };
}

test('selected silver stars retain the full click burst while reusing prepainted glow', () => {
  const h = harness();
  assert.equal(h.frames.size, 0, 'an idle surface schedules no frames');
  h.effect.click(350, 240);
  assert.equal(h.effect.getState().particles, 17, 'all 16 radial stars and the center star remain');
  assert.equal(h.effect.getState().intensity, 1);
  assert.equal(h.effect.getState().scale, 1.5);
  h.step();
  assert.equal(h.calls.images.length, 17);
  assert.equal(h.calls.textureFills, 2, 'one reusable radial texture plus the large center texture');
  assert.equal(h.calls.bitmaps.length, 2);
  assert.ok(h.calls.images.every(args => h.calls.bitmaps.includes(args[0])), 'the live canvas draws immutable bitmap sources');
  assert.ok(h.calls.textureContexts.every(({ attributes }) => attributes.willReadFrequently === true), 'small sources use a software backing without forcing the main canvas to software');
  assert.equal(h.calls.mainFills, 0, 'no per-particle shadow blur or vector fill on the onscreen canvas');
  h.step();
  assert.equal(h.calls.images.length, 34);
  assert.equal(h.calls.textureFills, 2, 'subsequent animation frames do not recreate the glow');
  assert.equal(h.calls.clips, 2, 'reading-surface clipping still wraps every frame');
});

test('silver-star frames clear only their previous painted area, including final expiry', () => {
  const h = harness();
  h.effect.click(350, 240); h.step(); h.step();
  const [x, y, width, height] = h.calls.clears.at(-1);
  assert.ok(x < 350 && y < 240 && x + width > 350 && y + height > 240);
  assert.ok(width * height < 1440 * 900 / 20, 'a local burst does not invalidate the full-window canvas');
  for (let i = 0; i < 90; i += 1) h.step();
  assert.equal(h.effect.getState().particles, 0);
  assert.equal(h.effect.getState().active, false);
  assert.equal(h.frames.size, 0);
  const cleared = h.calls.clears.length;
  h.step();
  assert.equal(h.calls.clears.length, cleared, 'no drawing work remains when the effect is idle');
});

test('same-size observer callbacks preserve the canvas and ongoing click animation', () => {
  const h = harness();
  h.effect.click(350, 240); h.step();
  const writes = h.calls.dimensionWrites, clears = h.calls.clears.length;
  h.resize(); h.resize();
  assert.equal(h.calls.dimensionWrites, writes);
  assert.equal(h.calls.clears.length, clears);
  assert.equal(h.effect.getState().particles, 17);
  assert.equal(h.frames.size, 1);
  h.step();
  assert.equal(h.calls.images.length, 34);
});

test('resetting pointer history across views preserves the burst without connecting distant controls', () => {
  const h = harness();
  h.effect.move(10, 20); h.effect.click(10, 20); h.step();
  const before = h.effect.getState().particles;
  h.effect.resetTrail();
  assert.equal(h.effect.getState().particles, before);
  assert.equal(h.frames.size, 1);
  h.effect.move(1000, 700);
  assert.equal(h.effect.getState().particles, before + 1, 'a new view starts a fresh trail, not a line from the previous view');
  assert.equal(h.frames.size, 1, 'new input shares the running animation loop');
});

test('DPR changes rebuild sharp star textures and retain all live particles', () => {
  const h = harness();
  h.effect.click(350, 240); h.step();
  const originalSize = h.calls.textures[0].width;
  h.resize(1440, 900, 2); h.step();
  assert.equal(h.canvas.width, 2880);
  assert.equal(h.canvas.height, 1800);
  assert.equal(h.effect.getState().particles, 17);
  assert.equal(h.calls.textures.length, 4);
  assert.ok(h.calls.bitmaps.slice(0, 2).every(bitmap => bitmap.closed), 'old-DPR bitmap resources are released');
  assert.ok(h.calls.textures[2].width > originalSize);
  h.resize(720, 450, 4); h.step();
  assert.equal(h.canvas.width, 1440, 'backing DPR remains bounded at two');
});

test('a scale change with unchanged backing dimensions cannot leave old star pixels behind', () => {
  const h = harness();
  h.effect.click(350, 240); h.step();
  const writes = h.calls.dimensionWrites;
  h.resize(720, 450, 2);
  assert.equal(h.calls.dimensionWrites, writes, 'CSS size and DPR can change with the same backing dimensions');
  assert.deepEqual(h.calls.clears.at(-1), [0, 0, 1440, 900]);
  assert.equal(h.effect.getState().particles, 17);
});

test('HTML canvas fallback keeps cached star rendering available without OffscreenCanvas', () => {
  const h = harness({ domCanvas: true });
  h.effect.click(100, 100); h.step(); h.step();
  assert.equal(h.calls.textureFills, 2);
  assert.equal(h.calls.images.length, 34);
  assert.equal(h.calls.bitmaps.length, 0);
  assert.ok(h.calls.textureContexts.every(({ attributes }) => attributes.willReadFrequently === true));
});

test('software rendering preserves the original star paths and full burst without bitmap sampling', () => {
  const h = harness({ effect: { softwareRendering: true } });
  h.effect.click(350, 240); h.step();
  assert.equal(h.effect.getState().particles, 17);
  assert.equal(h.effect.getState().intensity, 1);
  assert.equal(h.effect.getState().scale, 1.5);
  assert.equal(h.calls.mainFills, 17);
  assert.equal(h.calls.images.length, 0);
  assert.equal(h.calls.textures.length, 0);
  assert.equal(h.calls.bitmaps.length, 0);
  h.step();
  assert.equal(h.calls.mainFills, 34, 'all original vector stars remain on subsequent frames');
  const [x, y, width, height] = h.calls.clears.at(-1);
  assert.ok(x < 350 && y < 240 && x + width > 350 && y + height > 240);
  assert.ok(width * height < 1440 * 900 / 20, 'the original path renderer also keeps local damage bounds');
  assert.equal(h.calls.clips, 2);
});

test('changing scale/preset and destroying the engine release immutable cached bitmaps', () => {
  const h = harness();
  h.effect.click(100, 100); h.step();
  h.effect.setOptions({ scale: 1 });
  assert.ok(h.calls.bitmaps.every(bitmap => bitmap.closed));
  h.step();
  assert.ok(h.calls.bitmaps.some(bitmap => !bitmap.closed));
  h.effect.setPreset(2);
  assert.ok(h.calls.bitmaps.every(bitmap => bitmap.closed));
  h.effect.click(100, 100); h.step(); h.effect.destroy(); h.effect.destroy();
  assert.ok(h.calls.bitmaps.every(bitmap => bitmap.closed));
});

test('other presets and a missing texture backend retain their original vector rendering', () => {
  for (let id = 1; id <= 20; id += 1) {
    const h = harness({ effect: { id }, noSprites: id === 2 });
    h.effect.move(100, 100); h.effect.click(100, 100); h.step(); h.step();
    assert.ok(h.effect.getState().particles > 0, `preset ${id} still animates`);
    if (id === 2) {
      assert.ok(h.calls.mainFills > 0);
      const [, , width, height] = h.calls.clears.at(-1);
      assert.ok(width * height < 1440 * 900 / 20, 'the path fallback also limits canvas clearing to its stars');
    }
    h.effect.destroy();
    assert.equal(h.frames.size, 0);
  }
});

test('rapid input stays bounded, and clear/destroy release all active work', () => {
  const h = harness();
  for (let i = 0; i < 1000; i += 1) {
    h.effect.move(10 + i, 100); h.effect.click(100, 100); h.advance(1);
  }
  assert.equal(h.effect.getState().particles, 500);
  assert.equal(h.frames.size, 1);
  h.step(); h.effect.clear();
  assert.equal(h.effect.getState().particles, 0);
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.calls.clears.at(-1), [0, 0, 1440, 900]);
  h.effect.destroy(); h.effect.move(5, 5); h.effect.click(5, 5); h.resize();
  assert.equal(h.effect.getState().destroyed, true);
  assert.equal(h.frames.size, 0);
  assert.equal(h.listeners.has('resize'), false);
  assert.equal(h.calls.disconnected, true);
});
