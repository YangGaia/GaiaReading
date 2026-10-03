'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const highlightSource = app.slice(app.indexOf('function restoreBookSearchHighlight()'), app.indexOf('function renderBookSearchResults()'));
const navigationSource = app.slice(app.indexOf('async function activateBookSearchResult('), app.indexOf('function stepBookSearch('));
const highlightHelpers = app.slice(app.indexOf('function clearBookSearchHighlightsFrom('), app.indexOf('function clearBookSearchHighlights()')) +
  app.slice(app.indexOf('function applyBookSearchHighlight('), app.indexOf('function matchForSearchResult('));
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const root = { revision: 0, highlighted: false, section: 0 };
  const errors = [];
  const displays = [];
  const highlights = [];
  const c = {
    format: 'epub',
    bookSearchQuery: '测试内容',
    bookSearchResults: [0, 1, 2].map((index) => ({
      ordinal: index, locator: { href: 'chapter-' + index + '.xhtml', section: index },
    })),
  };
  const state = { current: c };
  const panel = { hidden: false };
  const clear = (body) => {
    if (body && body.highlighted) {
      body.revision += 1;
      body.highlighted = false;
    }
  };
  const h = { c, state, root, errors, displays, highlights, panel, beforeDisplay: async () => {}, maxConcurrent: 0 };
  let concurrent = 0;
  const context = vm.createContext({
    state,
    els: { bookSearchPanel: panel, bookSearchResults: { querySelector: () => null } },
    window: { setTimeout },
    console: { error: (...args) => errors.push(args) },
    clearBookSearchHighlightsFrom: clear,
    clearBookSearchHighlights: () => clear(root),
    matchForSearchResult: (_, result) => ({ start: result.ordinal * 10, end: result.ordinal * 10 + 4 }),
    rangeFromTextOffsets: (_, start, end) => ({ start, end, revision: root.revision }),
    applyBookSearchHighlight: (body, match) => {
      body.revision += 1;
      body.highlighted = true;
      highlights.push(match.start);
      return true;
    },
    renderBookSearchResults() {},
    waitForReaderLayoutRefresh: async () => {},
    assertCurrentSearchBook: () => assert.equal(state.current, c),
    setBookSearchStatus() {},
    noteReadingActivity() {},
  });
  vm.runInContext(highlightSource + navigationSource, context);
  c.rendition = {
    getContents: () => [{
      section: { index: root.section }, document: { body: root },
      cfiFromRange: (range) => ({ cfi: true, revision: range.revision, section: root.section, start: range.start }),
    }],
    display: async (target) => {
      displays.push(target);
      concurrent += 1;
      h.maxConcurrent = Math.max(h.maxConcurrent, concurrent);
      try {
        await h.beforeDisplay(target);
        if (typeof target === 'string') root.section = Number(target.match(/chapter-(\d+)/)[1]);
        // epub.js emits rendered while display is still resolving the CFI.
        // Inserting/removing a search mark changes the referenced text nodes.
        context.restoreBookSearchHighlight();
        await tick();
        if (target.cfi) {
          assert.equal(root.revision, target.revision, 'CFI text nodes changed before display completed');
          h.position = target.start;
        }
      } finally {
        concurrent -= 1;
      }
    },
  };
  h.activate = (index) => context.activateBookSearchResult(index);
  h.restore = () => context.restoreBookSearchHighlight();
  return h;
}

test('EPUB 结果跳转期间的 rendered 回调不会让高亮改变 CFI 文本节点', async () => {
  const h = harness();
  await h.activate(0);
  assert.deepEqual(h.errors, []);
  assert.equal(h.position, 0);
  assert.equal(h.root.highlighted, true, '完成定位后恢复可见高亮');
  assert.deepEqual(h.highlights, [0], '只在定位完成后插入一次高亮');
});

test('快速点击多个搜索结果时完成当前显示，仅跳转到最后一次选择', async () => {
  const h = harness();
  const firstDisplay = deferred();
  h.beforeDisplay = (target) => target === 'chapter-0.xhtml' ? firstDisplay.promise : Promise.resolve();
  const first = h.activate(0);
  await tick();
  const second = h.activate(1);
  const third = h.activate(2);
  firstDisplay.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(h.errors, []);
  assert.equal(h.maxConcurrent, 1, 'EPUB display 不应交错执行');
  assert.deepEqual(h.displays.filter((target) => typeof target === 'string'), ['chapter-0.xhtml', 'chapter-2.xhtml']);
  assert.equal(h.position, 20);
  assert.equal(h.c.bookSearchActiveIndex, 2);
  assert.deepEqual(h.highlights, [20], '旧请求不应恢复已过期的高亮');
});

test('关闭搜索面板或切换图书后，旧跳转不再定位或恢复高亮', async () => {
  for (const leave of [
    (h) => { h.panel.hidden = true; },
    (h) => { h.state.current = { format: 'txt' }; },
    (h) => { h.c.bookSearchActiveResult = null; h.c.bookSearchQuery = '新查询'; },
  ]) {
    const h = harness();
    const pending = deferred();
    h.beforeDisplay = () => pending.promise;
    const jump = h.activate(0);
    await tick();
    leave(h);
    pending.resolve();
    await jump;
    assert.equal(h.displays.length, 1, '取消后的章节显示不应继续 CFI 定位');
    assert.equal(h.root.highlighted, false);
    assert.deepEqual(h.errors, []);
  }
});

test('一次显示失败不会阻塞下一次搜索结果跳转', async () => {
  const h = harness();
  h.beforeDisplay = async (target) => {
    if (target === 'chapter-0.xhtml') throw new Error('章节暂时不可用');
  };
  await h.activate(0);
  assert.equal(h.errors.length, 1);
  assert.equal(h.root.highlighted, false, '失败的定位不应在错误章节显示命中高亮');
  await h.activate(1);
  assert.equal(h.position, 10);
  assert.equal(h.c.bookSearchJumping, false);
});

test('EPUB 搜索高亮保留原始文本节点，清除后阅读进度和选区锚点不变', () => {
  const highlights = new Map();
  const styles = new Map();
  const textNode = { textContent: '这里是测试内容，阅读位置必须保持。' };
  const view = { CSS: { highlights }, Highlight: class extends Set { constructor(range) { super([range]); } } };
  const doc = {
    defaultView: view,
    getElementById: (id) => styles.get(id),
    createElement: (tag) => ({ tagName: tag }),
    head: { appendChild: (style) => styles.set(style.id, style) },
  };
  let normalized = 0;
  const root = { ownerDocument: doc, childNodes: [textNode], querySelectorAll: () => [], normalize: () => { normalized += 1; } };
  const match = { start: 3, end: 7 };
  const range = { startContainer: textNode, startOffset: 3, endContainer: textNode, endOffset: 7 };
  const context = vm.createContext({
    state: { current: { format: 'epub' } },
    rangeFromTextOffsets: (body, start, end) => {
      assert.equal(body, root);
      assert.equal(start, 3);
      assert.equal(end, 7);
      return range;
    },
    textNodes: () => [textNode],
  });
  vm.runInContext(highlightHelpers, context);
  assert.equal(context.applyBookSearchHighlight(root, match), true);
  assert.equal(highlights.get('gaia-book-search').has(range), true);
  assert.equal(context.applyBookSearchHighlight(root, match), true);
  assert.equal(styles.size, 1, '重新显示命中时复用样式');
  assert.match(styles.get('gaia-book-search-highlight-style').textContent, /::highlight\(gaia-book-search\)/);
  context.clearBookSearchHighlightsFrom(root);
  assert.equal(highlights.has('gaia-book-search'), false);
  assert.equal(root.childNodes.length, 1);
  assert.equal(root.childNodes[0], textNode);
  assert.equal(range.startContainer, textNode);
  assert.equal(normalized, 0, 'CSS 高亮没有拆分文本，不应 normalize 改写正文');
});
