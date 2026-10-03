'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/paginator.js'), 'utf8');

function harness() {
  const frames = new Map();
  let sequence = 0;
  const window = {
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    removeEventListener() {},
  };
  vm.runInNewContext(source, { window });
  const paginator = new window.GaiaPaginator({}, {});
  const makeImage = (complete = false) => {
    const handlers = new Map();
    return { complete, handlers,
      addEventListener(type, fn) { handlers.set(type, fn); },
      removeEventListener(type, fn) { if (handlers.get(type) === fn) handlers.delete(type); },
      emit(type) { if (handlers.has(type)) handlers.get(type)(); },
    };
  };
  const images = [makeImage(), makeImage(), makeImage(true)];
  paginator.doc = { querySelectorAll: () => images };
  const positions = [];
  paginator.applyLayout = (position) => positions.push(position);
  const flush = () => {
    const work = Array.from(frames.values());
    frames.clear();
    for (const callback of work) callback();
  };
  return { paginator, images, positions, frames, flush };
}

test('迟到图片分别完成时持续重排，使用加载前记录的文字或插图位置', () => {
  const h = harness();
  h.paginator.waitImages();
  assert.equal(h.images[2].handlers.size, 0, '已完成的图片无需等待');
  const text = { text: { off: 123 }, page: 4 };
  h.paginator._readingPosition = text;
  h.images[0].emit('load');
  h.flush();
  assert.equal(h.positions[0], text);
  assert.equal(h.images[0].handlers.size, 0, '成功完成后同时移除错误监听');
  assert.equal(h.images[1].handlers.size, 2, '第一张完成不停止等待后续图片');
  const illustration = { image: {}, page: 6 };
  h.paginator._readingPosition = illustration;
  h.images[1].emit('error');
  h.flush();
  assert.equal(h.positions[1], illustration, '用户已翻页时不能恢复到旧位置');
  assert.equal(h.images[1].handlers.size, 0);
});

test('同一帧的多个图片事件只重排一次', () => {
  const h = harness();
  h.paginator.waitImages();
  h.images[0].emit('load');
  h.images[1].emit('load');
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.equal(h.positions.length, 1);
});

for (const method of ['clearImageListeners', 'destroy']) {
  test(`${method} 清理监听和待执行重排，旧章节事件不能影响当前章节`, () => {
    const h = harness();
    h.paginator.waitImages();
    const lateCallback = h.images[1].handlers.get('load');
    h.images[0].emit('load');
    h.paginator[method]();
    assert.equal(h.frames.size, 0);
    assert.ok(h.images.every((image) => image.handlers.size === 0));
    lateCallback();
    h.flush();
    assert.equal(h.positions.length, 0);
  });
}

test('重复绑定图片监听不会累积回调', () => {
  const h = harness();
  h.paginator.waitImages();
  h.paginator.waitImages();
  h.images[0].emit('load');
  h.flush();
  assert.equal(h.positions.length, 1);
  h.paginator.clearImageListeners();
  assert.ok(h.images.every((image) => image.handlers.size === 0));
});

test('放弃尚未提交的换章后，仍显示的旧章节继续响应迟到图片', () => {
  const h = harness();
  h.paginator.waitImages();
  h.paginator.cancelPendingRender();
  h.images[0].emit('load');
  h.flush();
  assert.equal(h.positions.length, 1);
  h.paginator.destroy();
  assert.ok(h.images.every((image) => image.handlers.size === 0));
});
