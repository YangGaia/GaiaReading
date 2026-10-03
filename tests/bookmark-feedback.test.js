'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bookmarks = require('../src/shared/bookmarks');
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const start = app.includes('let bookmarkAddPending =') ? app.indexOf('let bookmarkAddPending =') : app.indexOf('async function addBookmark()');
const addSource = app.slice(start, app.indexOf('async function addBookmarkFromSettings()'));
const feedbackStart = app.indexOf('function showBookmarkFeedback(');
const feedbackSource = feedbackStart < 0 ? '' : app.slice(feedbackStart, app.indexOf('let bookmarkContextPending', feedbackStart));
const contextSource = app.slice(app.indexOf('let bookmarkContextPending'), app.indexOf('function renderBookmarksPanel()'));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness(current = { path: 'fixture.pdf', format: 'pdf', page: 4, pages: 20 }) {
  const state = { current, bookmarks: {} };
  const messages = [], errors = [], writes = [];
  let renderCount = 0;
  const reader = { hidden: false };
  const listeners = new Map();
  const document = { addEventListener: (name, handler) => listeners.set(name, handler) };
  const h = { state, messages, errors, writes, reader, persist: async () => true, render() {} };
  const context = vm.createContext({
    state, views: { reader }, document, isSettingsOpen: () => false,
    els: { readerStatus: { textContent: '' }, readerContent: { scrollTop: 0, contains: () => true } },
    readerFeedback: { show: (message, kind) => messages.push({ message, kind }), clear() {} },
    console: { error: (...args) => errors.push(args) },
    addBookmarkToMap: bookmarks.addBookmark,
    removeBookmarkFromMap: bookmarks.removeBookmark,
    getBookmarkCount: () => (state.bookmarks[state.current?.path] || []).length,
    saveBookmarksNow: () => { writes.push(structuredClone(state.bookmarks)); return h.persist(); },
    renderBookmarksPanel: () => { renderCount += 1; h.render(); },
    epubChapterTitle: () => '第一章', mobiChapterTitle: () => '第一节', chapterTitleForParagraph: () => '第一章',
  });
  vm.runInContext(feedbackSource + contextSource + addSource, context);
  context.bindReaderBookmarkContext(document);
  h.add = () => context.addBookmark();
  h.status = () => context.els.readerStatus.textContent;
  h.renderCount = () => renderCount;
  h.rightClick = () => listeners.get('contextmenu')({ target: { nodeType: 1, closest: () => null }, preventDefault() {}, stopPropagation() {} });
  return h;
}

test('添加书签只在持久化确认后显示清晰成功提示', async () => {
  const h = harness(), pending = deferred();
  h.persist = () => pending.promise;
  const adding = h.add();
  assert.deepEqual(h.messages, [], '保存尚未完成时不能误报成功');
  pending.resolve(true);
  assert.equal(await adding, true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.state.bookmarks['fixture.pdf'].length, 1);
  assert.deepEqual(h.messages, [{ message: '已添加书签', kind: 'success' }]);
});

test('拒绝或未确认保存时提示失败，撤销未持久化条目且允许重试', async () => {
  for (const persist of [async () => { throw new Error('fixture write failed'); }, async () => false]) {
    const h = harness();
    h.persist = persist;
    assert.equal(await h.add(), false);
    assert.equal((h.state.bookmarks['fixture.pdf'] || []).length, 0);
    assert.deepEqual(h.messages, [{ message: '添加书签失败，请重试', kind: 'error' }]);
    h.persist = async () => true;
    assert.equal(await h.add(), true);
    assert.equal(h.state.bookmarks['fixture.pdf'][0].name, '书签 1');
    assert.equal(h.messages.at(-1).kind, 'success');
  }
});

test('同一次保存尚未结束时快速重复添加只写入一枚书签', async () => {
  const h = harness(), pending = deferred();
  h.persist = () => pending.promise;
  const first = h.add();
  const duplicate = h.add();
  pending.resolve(true);
  assert.deepEqual(await Promise.all([first, duplicate]), [true, false]);
  assert.equal(h.writes.length, 1);
  assert.equal(h.state.bookmarks['fixture.pdf'].length, 1);
  assert.equal(h.messages.length, 1);
  assert.equal(await h.add(), true, '前一次结束后可以再次正常添加');
  assert.equal(h.messages.length, 2);
});

test('保存过程中离开阅读或切换书籍，不把旧书的结果提示到新界面', async () => {
  for (const leave of [h => { h.reader.hidden = true; }, h => { h.state.current = { path: 'other.pdf', format: 'pdf', page: 1, pages: 2 }; }]) {
    const h = harness(), pending = deferred();
    h.persist = () => pending.promise;
    const adding = h.add();
    leave(h);
    pending.resolve(true);
    assert.equal(await adding, true);
    assert.deepEqual(h.messages, []);
    assert.equal(h.renderCount(), 0);
    assert.equal(h.status(), '');
  }
});

test('阅读定位未就绪时不保存无效书签，并显示等待提示', async () => {
  for (const current of [
    { path: 'fixture.epub', format: 'epub', rendition: { currentLocation: () => null } },
    { path: 'fixture.epub', format: 'epub', rendition: { currentLocation: () => ({ start: {} }) } },
    { path: 'fixture.pdf', format: 'pdf' },
    { path: 'fixture.txt', format: 'txt' },
  ]) {
    const h = harness(current);
    assert.equal(await h.add(), false);
    assert.equal(h.writes.length, 0);
    assert.equal(h.messages.length, 1);
    assert.match(h.messages[0].message, /当前位置|尚未就绪/);
    assert.notEqual(h.messages[0].kind, 'success');
  }
});

test('没有打开图书或阅读视图不可见时不添加书签', async () => {
  for (const h of [harness(null), harness()]) {
    if (h.state.current) h.reader.hidden = true;
    assert.equal(await h.add(), false);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.messages, []);
  }
});

test('正文右键入口成功与失败都使用浮层反馈，失败后可以再次右键', async () => {
  const h = harness();
  h.persist = async () => { throw new Error('fixture write failed'); };
  await h.rightClick();
  assert.equal(h.messages.at(-1).kind, 'error');
  assert.equal((h.state.bookmarks['fixture.pdf'] || []).length, 0);
  h.persist = async () => true;
  await h.rightClick();
  assert.equal(h.messages.at(-1).kind, 'success');
  assert.equal(h.state.bookmarks['fixture.pdf'].length, 1);
});

test('有效EPUB和TXT定位保留原书签结构并在保存后提示', async () => {
  const cases = [
    { current: { path: 'fixture.epub', format: 'epub', displayPercent: 34.125, rendition: { currentLocation: () => ({ start: { cfi: 'epubcfi(/6/4)', index: 1 } }) } } },
    { current: { path: 'fixture.txt', format: 'txt', paginator: { doc: {}, currentPage: 2, anchor: () => ({ off: 32, snippet: '正文片段' }), paragraphIndexOfTextOffset: () => 2, pagePercent: () => 45 } } },
    { current: { path: 'fixture.azw3', format: 'azw3', paginator: { doc: {}, currentPage: 3, anchor: () => null, pagePercent: () => 50 } } },
  ];
  for (const { current } of cases) {
    const h = harness(current);
    assert.equal(await h.add(), true);
    const bookmark = h.state.bookmarks[current.path][0];
    if (current.format === 'epub') {
      assert.equal(bookmark.loc, 'epubcfi(/6/4)');
      assert.equal(bookmark.percent, 34.13);
    } else if (current.format === 'txt') {
      assert.equal(bookmark.loc, 'anchor:{"off":32,"snippet":"正文片段"}');
      assert.equal(bookmark.chapter, '第一章');
    } else assert.equal(bookmark.loc, 'page:0:3', '无文字的已就绪插图页仍可按页定位');
    assert.equal(h.messages.at(-1).kind, 'success');
  }
});

test('失败回滚只移除本次书签，不丢失其他书籍的内存变化', async () => {
  const h = harness(), pending = deferred();
  h.persist = () => pending.promise;
  const adding = h.add();
  h.state.bookmarks = bookmarks.addBookmark(h.state.bookmarks, 'other.pdf', { name: '另一本的书签', loc: '2' });
  pending.reject(new Error('fixture write failed'));
  assert.equal(await adding, false);
  assert.equal(h.state.bookmarks['other.pdf'][0].name, '另一本的书签');
  assert.equal((h.state.bookmarks['fixture.pdf'] || []).length, 0);
});

test('持久化成功后列表渲染异常仍保留书签，并且不误报保存失败', async () => {
  const h = harness();
  h.render = () => { throw new Error('fixture panel render failed'); };
  assert.equal(await h.add(), true);
  assert.equal(h.writes[0]['fixture.pdf'].length, 1);
  assert.equal(h.state.bookmarks['fixture.pdf'].length, 1, '已保存条目不能因显示错误而从内存回滚');
  assert.deepEqual(h.messages, [{ message: '已添加书签', kind: 'success' }]);
  assert.equal(h.errors.length, 1, '显示异常仍应留在开发日志中');
});
