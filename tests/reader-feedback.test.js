'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../src/renderer/reader-feedback');

function element(tag) {
  return { tagName: tag.toUpperCase(), children: [], attributes: {}, dataset: {}, hidden: false, textContent: '',
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

function harness() {
  const document = { createElement: element };
  const host = element('main'), timers = new Map(), queued = [];
  let now = 0, nextId = 0;
  const feedback = create({ document, host,
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); queued.push(callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { feedback, host, timers, queued, node: host.children[0],
    advance(ms) {
      now += ms;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
  };
}

test('应用把阅读反馈挂在正文区域，使提示跟随工具栏换行后的阅读区域', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  const start = app.indexOf('const readerFeedback =');
  const reader = element('section');
  const readerBody = element('main');
  const document = { createElement: element, defaultView: { setTimeout() {}, clearTimeout() {} } };
  vm.runInNewContext(app.slice(start, app.indexOf(';', start) + 1), {
    document, views: { reader },
    $: (id) => { assert.equal(id, 'reader-body'); return readerBody; },
    window: { GaiaReaderFeedback: { create } },
  });
  assert.equal(reader.children.length, 0, '视图根节点不能成为提示的定位宿主');
  assert.equal(readerBody.children.length, 1);
  assert.equal(readerBody.children[0].id, 'reader-feedback');
});

test('阅读反馈使用可访问的非阻断浮层，显示后2.6秒自动消失', () => {
  const h = harness();
  assert.equal(h.node.hidden, true);
  assert.equal(h.node.attributes.role, 'status');
  assert.equal(h.node.attributes['aria-live'], 'polite');
  h.feedback.show('已添加书签', 'success');
  assert.equal(h.node.hidden, false);
  assert.equal(h.node.dataset.kind, 'success');
  assert.equal(h.node.children.at(-1).textContent, '已添加书签');
  h.advance(2599);
  assert.equal(h.node.hidden, false);
  h.advance(1);
  assert.equal(h.node.hidden, true);
});

test('连续反馈复用浮层并重置显示时间，旧回调不能提前隐藏新提示', () => {
  const h = harness();
  h.feedback.show('已添加书签', 'success');
  const stale = h.queued[0];
  h.advance(2000);
  h.feedback.show('添加书签失败，请重试', 'error');
  stale();
  assert.equal(h.host.children.length, 1);
  assert.equal(h.node.hidden, false);
  assert.equal(h.node.dataset.kind, 'error');
  assert.equal(h.node.children.at(-1).textContent, '添加书签失败，请重试');
  h.advance(2599);
  assert.equal(h.node.hidden, false);
  h.advance(1);
  assert.equal(h.node.hidden, true);
});

test('清除反馈取消计时并防止旧提示复现，之后仍能显示新提示', () => {
  const h = harness();
  h.feedback.show('已添加书签', 'success');
  const stale = h.queued[0];
  h.feedback.clear();
  assert.equal(h.node.hidden, true);
  assert.equal(h.timers.size, 0);
  h.feedback.show('新的书签', 'success');
  stale();
  assert.equal(h.node.hidden, false);
  assert.equal(h.node.children.at(-1).textContent, '新的书签');
});
