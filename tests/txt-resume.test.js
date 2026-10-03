'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ReadingFlow } = require('../src/shared/flow');

const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const openSource = app.slice(app.indexOf('async function openTxt('), app.indexOf('function updateTxtProgress('));
const progressSource = app.slice(app.indexOf('let lastMobiSave ='), app.indexOf('function renderMobiToc('));
const saveSource = app.slice(app.indexOf('function saveProgress('), app.indexOf('let viewEntryAnimation ='));
const paginatorWindow = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/paginator.js'), 'utf8'), { window: paginatorWindow });

function harness(saved, readMode = 'single') {
  const book = { path: 'fixture.txt', format: 'txt' };
  const state = { current: { ...book }, progress: saved ? { [book.path]: { ...saved } } : {},
    prefs: { theme: 'light', readerTextContrast: 'standard', marginPct: 8 }, readMode };
  const writes = [];
  let now = 1000;
  let releaseRender, notifyRendered;
  const renderGate = new Promise(resolve => { releaseRender = resolve; });
  const rendered = new Promise(resolve => { notifyRendered = resolve; });

  // Keep production pagination callbacks and page clamping; replace only DOM layout.
  class LayoutPaginator extends paginatorWindow.GaiaPaginator {
    async render() {
      this.doc = { body: {} };
      this.totalPages = 38;
      this.onTotalChange(this.totalPages);
      this.showPage(0);
      notifyRendered();
      await renderGate;
      return true;
    }
    reflow() {
      if (!this.doc) return;
      this.onTotalChange(this.totalPages);
      this.showPage(this.currentPage);
    }
    _scrollTo() {}
    capturePosition() { return { page: this.currentPage }; }
    setTheme() {}
    setTextContrast() {}
    setMargins() {}
    setSimplified() {}
  }

  const context = vm.createContext({ state, lastProgressSave: {}, Date: { now: () => now },
    els: { readerContent: {} },
    window: {
      GaiaFlow: ReadingFlow, GaiaPaginator: LayoutPaginator, setTimeout() {},
      api: {
        async readBook(file) { assert.equal(file, book.path); return { text: 'Synthetic TXT fixture.' }; },
        stateSet(key, value) { assert.equal(key, 'progress'); writes.push(structuredClone(value)); },
      },
    },
    currentSpreadGap: () => 0, currentVerticalMargin: () => 28, isSimplifiedBook: () => false,
    splitTxtParagraphs: text => [text], detectTxtChapters: () => [], paragraphsToHtml: text => '<p>' + text + '</p>',
    bindReaderInputs() {}, bindTextAnnotationInputs() {}, restoreTextAnnotations() {},
    restoreBookSearchHighlight() {}, observeAiChapter() {}, updateProgress() {},
  });
  vm.runInContext(saveSource + progressSource + openSource, context);
  return { state, writes, book, rendered, releaseRender,
    open: () => context.openTxt(book), advanceClock: () => { now += 700; } };
}

for (const mode of ['single', 'spread']) {
  test('TXT ' + mode + ' reopening preserves page 2 throughout initialization and persists the restored page', async () => {
    const h = harness({ page: 2, percent: 7.894736842105263 }, mode);
    const opening = h.open();
    try {
      await h.rendered;
      assert.equal(h.state.progress[h.book.path].page, 2, 'render callback must not replace saved page 2 with page 0');
      assert.equal(h.writes.length, 0, 'initial pagination must not persist a temporary page');
    } finally {
      h.releaseRender();
      await opening;
    }
    assert.equal(h.state.current.paginator.currentPage, 2);
    assert.equal(h.state.current.flow.page, 2);
    assert.equal(h.state.progress[h.book.path].page, 2);
    assert.equal(h.state.progress[h.book.path].percent, 7.894736842105263);
    assert.deepEqual(h.writes.map(value => value[h.book.path].page), [2]);
    assert.equal(h.writes[0][h.book.path].percent, 7.894736842105263);
  });
}

test('TXT first open saves page 0 after initialization without requiring existing progress', async () => {
  const h = harness();
  const opening = h.open();
  try {
    await h.rendered;
    assert.equal(h.state.progress[h.book.path], undefined);
    assert.equal(h.writes.length, 0);
  } finally {
    h.releaseRender();
    await opening;
  }
  assert.equal(h.state.current.paginator.currentPage, 0);
  assert.equal(h.state.current.flow.page, 0);
  assert.deepEqual(h.writes.map(value => value[h.book.path].page), [0]);
  assert.equal(h.writes[0][h.book.path].percent, 2.631578947368421);
});

test('TXT page turns persist normally after saved progress has been restored', async () => {
  const h = harness({ page: 2, percent: 7.894736842105263 });
  h.releaseRender();
  await h.open();
  h.advanceClock();
  h.state.current.paginator.next();
  assert.equal(h.state.current.flow.page, 3);
  assert.equal(h.state.progress[h.book.path].page, 3);
  assert.equal(h.writes.at(-1)[h.book.path].page, 3);
  assert.equal(h.writes.at(-1)[h.book.path].percent, 10.526315789473683);
  h.advanceClock();
  h.state.current.paginator.prev();
  assert.equal(h.state.current.flow.page, 2);
  assert.deepEqual(h.writes.map(value => value[h.book.path].page), [2, 3, 2]);
});
