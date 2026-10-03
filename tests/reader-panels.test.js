'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { searchSections } = require('../src/shared/book-search');

const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
const source = section('function appendCollectionHeader(', 'function showBookmarkFeedback(') +
  section('function renderBookmarksPanel()', 'function makeBookmarkNameEditable(') +
  section('function renderAnnotationsPanel()', 'async function prepareAnnotationJumpLayout(') +
  section('function setBookSearchStatus(', 'async function buildBookSearchIndex(') +
  section('function renderBookSearchResults()', 'function scheduleBookSearch(') +
  section('function openBookSearch()', 'function toggleBookSearch(');

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {};
    this.hidden = false; this.className = ''; this.value = ''; this._text = ''; this.listeners = {}; this.scrollTop = 0;
    this.style = { setProperty() {} };
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const add = force === undefined ? !names.has(name) : force;
        if (add) names.add(name); else names.delete(name);
        this.className = [...names].join(' '); return add;
      },
      add: name => this.classList.toggle(name, true),
      remove: name => this.classList.toggle(name, false),
    };
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  set innerHTML(value) { assert.equal(value, ''); this._text = ''; this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  querySelectorAll(selector) {
    const matches = child => selector.startsWith('.') ? child.classList.contains(selector.slice(1)) : child.tagName === selector.toUpperCase();
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}

function harness() {
  const state = { current: { path: 'fixture.epub', format: 'epub', bookSearchQuery: '', bookSearchResults: [] }, bookmarks: {}, annotations: {} };
  const els = Object.fromEntries(['bookmarksPanel', 'annotationsPanel', 'bookSearchPanel', 'bookSearchInput', 'bookSearchStatus', 'bookSearchCount', 'bookSearchResults', 'bookSearchPrev', 'bookSearchNext', 'aiSummaryPanel'].map(name => [name, new Element('div')]));
  const buttons = new Map();
  const h = { state, els, errors: [], activated: [], index: async () => [{ title: '第一章', text: '星星出现，星星消失。', locator: { section: 0 } }] };
  const context = vm.createContext({
    state, els, document: { createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag) }, views: { reader: { hidden: false } },
    $: id => { if (!buttons.has(id)) buttons.set(id, new Element('button')); return buttons.get(id); },
    window: { setTimeout: fn => fn(), clearTimeout() {} }, bookSearchTimer: 0,
    console: { error: (...args) => h.errors.push(args) },
    currentAnnotations: () => state.annotations[state.current?.path] || [],
    bookmarkChapterLabel: bookmark => bookmark.chapter || '第一章', bookmarkPercentLabel: () => '进度 10.0%',
    annotationChapterLabel: annotation => annotation.chapter || '第一章',
    ANNOTATION_COLORS: { yellow: '#f4d35e' }, normalizeColor: () => 'yellow',
    searchBookSections: searchSections, buildBookSearchIndex: () => h.index(),
    activateBookSearchResult: index => h.activated.push(index),
    clearBookSearchHighlights() {}, stopHeldPageKey() {}, closeSettings() {}, hideSelectionToolbar() {},
    captureReaderLayoutAnchor: () => ({}), scheduleReaderLayoutRefresh() {}, updateTocEdgeAvailability() {},
    setTocMode() {}, TOC_MODES: { CLOSED: 'closed' }, togglePanel() {},
  });
  vm.runInContext(source, context);
  h.context = context;
  return h;
}

test('书签和笔记都显示名称与实时条数，空态只保留一份下方引导', () => {
  const h = harness();
  for (const [name, render, label] of [['bookmarksPanel', 'renderBookmarksPanel', '书签'], ['annotationsPanel', 'renderAnnotationsPanel', '笔记']]) {
    h.context[render]();
    const panel = h.els[name];
    const summary = panel.querySelector('.collection-summary');
    assert.ok(summary, label + '缺少名称与条数行');
    assert.deepEqual(summary.children.map(child => child.textContent), [label, '0 条']);
    assert.equal(panel.querySelectorAll('.collection-hint').length, 0);
    assert.equal(panel.querySelectorAll('.annotation-empty').length, 1);
    const content = panel.querySelector('.collection-list');
    assert.ok(content, label + '的内容需要独立滚动区域');
    assert.ok(content.children.includes(panel.querySelector('.annotation-empty')));
    assert.ok(panel.children.indexOf(summary) < panel.children.indexOf(content));
  }
  h.state.bookmarks['fixture.epub'] = [{ name: '书签 A' }, { name: '书签 B' }];
  h.state.annotations['fixture.epub'] = [{ id: 'n1', text: '摘录', createdAt: 1 }];
  h.context.renderBookmarksPanel(); h.context.renderAnnotationsPanel();
  assert.equal(h.els.bookmarksPanel.querySelector('.collection-summary').textContent, '书签2 条');
  assert.equal(h.els.annotationsPanel.querySelector('.collection-summary').textContent, '笔记1 条');
  assert.equal(h.els.bookmarksPanel.querySelectorAll('.annotation-empty').length, 0);
  assert.equal(h.els.annotationsPanel.querySelectorAll('.annotation-empty').length, 0);
  h.state.bookmarks['fixture.epub'].pop();
  h.context.renderBookmarksPanel();
  assert.equal(h.els.bookmarksPanel.querySelector('.collection-summary').textContent, '书签1 条');
});

test('收藏标题、页签和计数留在列表滚动区外，重绘条目保持阅读位置', () => {
  const h = harness();
  h.state.bookmarks['fixture.epub'] = Array.from({ length: 30 }, (_, index) => ({ name: '书签 ' + index }));
  h.state.annotations['fixture.epub'] = Array.from({ length: 30 }, (_, index) => ({ id: 'n' + index, text: '摘录 ' + index, createdAt: index + 1 }));
  for (const [name, render, item] of [['bookmarksPanel', 'renderBookmarksPanel', '.bookmark-row'], ['annotationsPanel', 'renderAnnotationsPanel', '.annotation-card']]) {
    h.context[render]();
    const panel = h.els[name];
    let content = panel.querySelector('.collection-list');
    assert.ok(content, '长列表应拥有独立滚动区域');
    assert.equal(content.querySelectorAll(item).length, 30);
    for (const selector of ['.collection-head', '.collection-tabs', '.collection-summary']) {
      assert.ok(panel.children.includes(panel.querySelector(selector)), selector + '应是固定区域');
      assert.equal(content.querySelector(selector), null);
    }
    content.scrollTop = 420;
    h.context[render]();
    content = panel.querySelector('.collection-list');
    assert.equal(content.scrollTop, 420, '编辑或改色触发重绘时，不应把长列表跳回顶部');
    assert.equal(content.querySelectorAll(item).length, 30);
  }
});

test('搜索初始打开、清空和重置后上方无提示占位，下方指导与零条计数仍在', async () => {
  const h = harness();
  h.context.openBookSearch();
  assert.equal(h.els.bookSearchStatus.textContent, '');
  assert.equal(h.els.bookSearchStatus.hidden, true);
  assert.equal(h.els.bookSearchCount.textContent, '0 条');
  assert.match(h.els.bookSearchResults.textContent, /输入关键词后/);
  h.els.bookSearchInput.value = '星星';
  await h.context.runBookSearch();
  h.els.bookSearchInput.value = '';
  await h.context.runBookSearch();
  assert.equal(h.els.bookSearchStatus.textContent, '');
  assert.equal(h.els.bookSearchStatus.hidden, true);
  assert.equal(h.els.bookSearchCount.textContent, '0 条');
  assert.equal(h.els.bookSearchPrev.disabled, true);
  assert.equal(h.els.bookSearchNext.disabled, true);
  h.context.closeBookSearch({ reset: true });
  h.context.openBookSearch();
  assert.equal(h.els.bookSearchStatus.hidden, true);
  assert.equal(h.els.bookSearchCount.textContent, '0 条');
  assert.equal(h.els.bookSearchResults.querySelectorAll('.book-search-empty').length, 1);
});

test('搜索结果数量更新且选择结果仍走原入口，活动项重绘不丢失反馈', async () => {
  const h = harness();
  h.els.bookSearchInput.value = '星星';
  await h.context.runBookSearch();
  assert.equal(h.els.bookSearchCount.textContent, '2 条');
  assert.equal(h.els.bookSearchStatus.hidden, false);
  assert.match(h.els.bookSearchStatus.textContent, /2 处结果/);
  assert.equal(h.els.bookSearchPrev.disabled, false);
  h.els.bookSearchResults.children[1].listeners.click();
  assert.deepEqual(h.activated, [1]);
  h.state.current.bookSearchActiveIndex = 1;
  h.context.renderBookSearchResults();
  assert.equal(h.els.bookSearchResults.children[1].classList.contains('active'), true);
  assert.match(h.els.bookSearchStatus.textContent, /2 处结果/);
});

test('正在搜索、无匹配和扫描PDF的状态保持可见，不叠加重复空态', async () => {
  const h = harness();
  h.context.openBookSearch();
  let resolve;
  h.index = () => new Promise(done => { resolve = done; });
  h.els.bookSearchInput.value = '不存在';
  const pending = h.context.runBookSearch();
  assert.equal(h.els.bookSearchStatus.hidden, false);
  assert.match(h.els.bookSearchStatus.textContent, /正在/);
  assert.equal(h.els.bookSearchResults.querySelector('.book-search-empty')?.hidden, true);
  resolve([{ title: '第一章', text: '星星' }]);
  await pending;
  assert.equal(h.els.bookSearchCount.textContent, '0 条');
  assert.match(h.els.bookSearchStatus.textContent, /没有找到/);
  assert.equal(h.els.bookSearchResults.querySelectorAll('.book-search-empty').length, 0);
  h.state.current.format = 'pdf';
  h.index = async () => [{ title: '第 1 页', text: '' }];
  await h.context.runBookSearch();
  assert.match(h.els.bookSearchStatus.textContent, /扫描版需要 OCR/);
  assert.equal(h.els.bookSearchStatus.classList.contains('error'), true);
  assert.equal(h.els.bookSearchStatus.hidden, false);
  assert.equal(h.els.bookSearchResults.querySelectorAll('.book-search-empty').length, 0);
});

test('搜索错误与500条截断反馈保留，恢复搜索后清除错误样式', async () => {
  const h = harness();
  h.els.bookSearchInput.value = '星';
  h.index = async () => { throw new Error('索引不可用'); };
  await h.context.runBookSearch();
  assert.match(h.els.bookSearchStatus.textContent, /搜索失败.*索引不可用/);
  assert.equal(h.els.bookSearchStatus.hidden, false);
  assert.equal(h.els.bookSearchStatus.classList.contains('error'), true);
  h.index = async () => [{ title: '第一章', text: '星'.repeat(501) }];
  await h.context.runBookSearch();
  assert.equal(h.els.bookSearchCount.textContent, '500 条');
  assert.match(h.els.bookSearchStatus.textContent, /至少 500/);
  assert.equal(h.els.bookSearchStatus.classList.contains('error'), false);
});

test('清空输入后旧索引进度与失败不会复现上方提示', async () => {
  for (const fail of [false, true]) {
    const h = harness();
    let complete;
    h.index = () => new Promise((resolve, reject) => { complete = () => fail ? reject(new Error('旧索引错误')) : resolve([]); });
    h.els.bookSearchInput.value = '旧查询';
    const pending = h.context.runBookSearch();
    h.els.bookSearchInput.value = '';
    await h.context.runBookSearch();
    h.context.setBookSearchStatus('索引已就绪，正在搜索…');
    complete();
    await pending;
    assert.equal(h.els.bookSearchStatus.textContent, '');
    assert.equal(h.els.bookSearchStatus.hidden, true);
    assert.equal(h.els.bookSearchCount.textContent, '0 条');
    assert.equal(h.els.bookSearchResults.querySelector('.book-search-empty').hidden, false);
  }
});
