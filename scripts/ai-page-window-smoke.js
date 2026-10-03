'use strict';

// Real reader + original synthetic books. AI IPC is intercepted before its
// production handlers are registered; this check never contacts a provider.
// Run: electron scripts/ai-page-window-smoke.js
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const { makeSmokeDirectory, configureSmokePaths } = require('./smoke-paths');
const path = require('node:path');
const assert = require('node:assert/strict');
const { STATE_FILE_NAME } = require('../src/shared/app-paths');
const { createAiPageWindowFixtures } = require('../tests/fixtures/ai-page-window-fixture');
const sandbox = makeSmokeDirectory('gaia-ai-page-window-');
const project = path.resolve(__dirname, '..');
configureSmokePaths(app, { userData: sandbox });
app.setAppPath(project);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
fs.writeFileSync(path.join(sandbox, STATE_FILE_NAME), JSON.stringify({
  library: [], prefs: { theme: 'light', fontSize: 100, marginPct: 8, verticalMarginPx: 28, spreadGap: 56 },
  pet: { auto: false, autoSpeech: false, autoSleep: false },
}));
const booksPromise = createAiPageWindowFixtures(path.join(sandbox, 'books'));
const report = { checks: [], sources: [], errors: [], sandbox };
const requests = [];
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, ['ai:chat', 'ai:alice-comment'].includes(channel)
  ? async (_event, payload) => {
    requests.push({ channel, payload });
    return { answer: 'Synthetic local response', comment: 'Synthetic local comment', model: 'fixture', targetHost: 'isolated.invalid' };
  } : handler);
BrowserWindow.prototype.show = function () {};
let finished = false;
let started = false;
let win;
const deadline = setTimeout(() => finish(new Error('AI page-window validation timed out')), 120000);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  console.log(JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}
function check(label, value) { assert.ok(value, label); report.checks.push(label); }
const markers = (content, kind) => [...content.matchAll(new RegExp('PAGE_' + kind + '_(\\d+)_END', 'g'))].map(match => Number(match[1]));
const expectedPages = (current, total) => Array.from({ length: Math.min(total - 1, current + 7) - Math.max(0, current - 4) + 1 }, (_, offset) => Math.max(0, current - 4) + offset);
const snapshot = () => evaluate(() => {
  const c = state.current;
  const location = c.rendition && c.rendition.currentLocation();
  return JSON.stringify({
    path: c.path, chapter: c.flow && c.flow.chapter, page: c.paginator ? c.paginator.currentPage : c.page,
    location: location && { start: location.start.cfi, end: location.end.cfi, index: location.start.index, displayed: location.start.displayed },
    scroll: c.paginator ? c.paginator.doc.documentElement.scrollLeft : [els.readerContent.scrollLeft, els.readerContent.scrollTop],
  });
});

async function settle() {
  await evaluate(async () => {
    await __gaiaDebug.waitForReaderLayoutRefresh();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await wait(100);
}

async function sourceCheck(label, kind, current, total) {
  await settle();
  const before = await snapshot();
  const initial = await evaluate(() => __gaiaDebug.getAiChapterSource());
  check(label + ': chapterless content selects a page window', !!initial.pageWindow);
  const source = await evaluate(() => __gaiaDebug.resolveAiChapterSource());
  const after = await snapshot();
  if (after !== before) report.sources.push({ label, navigationBefore: before, navigationAfter: after, source });
  check(label + ': resolution does not move the visible reader', after === before);
  if (kind) {
    const actual = markers(source.content, kind);
    if (JSON.stringify(actual) !== JSON.stringify(expectedPages(current, total))) report.sources.push({ label, source, geometry: await evaluate(() => {
      const c = state.current;
      if (!c.rendition) return null;
      const content = c.rendition.getContents()[0];
      const p = content.document.querySelector('p');
      const range = content.document.createRange(); range.selectNodeContents(p);
      const style = content.window.getComputedStyle(content.document.body);
      const layout = c.rendition.manager.layout;
      return { layout: { width: layout.width, columnWidth: layout.columnWidth, gap: layout.gap, delta: layout.delta, divisor: layout.divisor }, bodyText: content.document.body.textContent, rectangles: [...range.getClientRects()].map(r => ({ left: r.left, top: r.top, width: r.width, height: r.height })), style: { columnWidth: style.columnWidth, gap: style.columnGap, paddingLeft: style.paddingLeft }, scroll: content.document.documentElement.scrollLeft };
    }) });
    assert.deepEqual(actual, expectedPages(current, total), label + ': exact neighboring page markers');
    report.checks.push(label + ': exact neighboring page markers');
    check(label + ': context metadata counts the same actual pages', source.pageWindow.pageCount === actual.length && source.pageWindow.includedBefore === Math.min(4, current) && source.pageWindow.includedAfter === Math.min(7, total - 1 - current));
    report.sources.push({ label, title: source.chapterTitle, pages: actual, pageWindow: source.pageWindow });
  } else {
    const expected = await evaluate(() => {
      const p = state.current.paginator;
      const range = GaiaPageWindow.pageWindow(p.currentPage, p.totalPages);
      return cleanChapterText(p.pageTextRange(range.startPage, range.endPage).content);
    });
    check(label + ': sends only the measured window, not the whole document', source.content === expected && source.content.length > 0);
    report.sources.push({ label, title: source.chapterTitle, length: source.content.length, pageWindow: source.pageWindow });
  }
  return source;
}

async function run() {
  win.setContentSize(1100, 760);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  await evaluate(() => __gaiaDebug.waitHome());
  const books = await booksPromise;
  if (!process.argv.includes('--epub-only') && !process.argv.includes('--epub-gap-only')) {
  await evaluate(async book => { await __gaiaDebug.openBook(book); await __gaiaDebug.setMode('single'); }, books.txt);
  const txtTotal = await evaluate(() => state.current.paginator.totalPages);
  check('TXT synthetic content has at least 20 actual pages and no detected chapters', txtTotal >= 20 && await evaluate(() => state.current.txtChapters.length === 0));
  for (const page of [0, 8, txtTotal - 1]) {
    await evaluate(page => state.current.paginator.showPage(page), page);
    const source = await sourceCheck('TXT page ' + page, null, page, txtTotal);
    check('TXT page-window bounds ' + page, source.pageWindow.startPage === Math.max(0, page - 4) && source.pageWindow.endPage === Math.min(txtTotal - 1, page + 7));
  }

  await evaluate(book => __gaiaDebug.openBook(book), books.mobi);
  await settle();
  const mobiTotal = await evaluate(() => state.current.paginator.totalPages);
  check('generated chapterless MOBI has 24 actual columns', mobiTotal === 24);
  for (const page of [0, 8, 23]) {
    await evaluate(page => state.current.paginator.showPage(page), page);
    await sourceCheck('MOBI page ' + page, 'MOBI', page, 24);
  }

  await evaluate(book => __gaiaDebug.openBook(book), books.pdf);
  for (const page of [0, 8, 19]) {
    await evaluate(async page => { state.current.page = page + 1; await renderPdfPage(); }, page);
    await sourceCheck('PDF page ' + page, 'PDF', page, 20);
  }
  const pdfMargins = await evaluate(async () => {
    const c = state.current;
    c.page = 9;
    c.pdfZoomMode = 'fit-width';
    await renderPdfPage();
    __gaiaDebug.openSettings();
    const measure = () => {
      const stage = els.readerContent.querySelector('.pdf-spread:not(.is-preparing)');
      return { page: c.page, horizontal: state.prefs.marginPct, vertical: state.prefs.verticalMarginPx,
        width: parseFloat(stage.style.width), inline: parseFloat(stage.style.marginInline), block: parseFloat(stage.style.marginBlock) };
    };
    const clickAndWait = async id => {
      const previous = els.readerContent.querySelector('.pdf-spread:not(.is-preparing)');
      document.getElementById(id).click();
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        const next = els.readerContent.querySelector('.pdf-spread:not(.is-preparing)');
        if (next && next !== previous) return;
      }
      throw new Error('PDF margin click did not commit a rendered page');
    };
    const before = measure();
    await clickAndWait('btn-margin');
    const horizontal = measure();
    await clickAndWait('btn-vertical-margin');
    const vertical = measure();
    __gaiaDebug.closeSettings();
    return { before, horizontal, vertical };
  });
  check('PDF horizontal margin control changes page width while preserving vertical margin and page',
    pdfMargins.horizontal.horizontal !== pdfMargins.before.horizontal && pdfMargins.horizontal.width < pdfMargins.before.width &&
    pdfMargins.horizontal.block === pdfMargins.before.block && pdfMargins.horizontal.page === 9);
  check('PDF vertical margin control changes block margin independently and preserves page',
    pdfMargins.vertical.vertical !== pdfMargins.horizontal.vertical && pdfMargins.vertical.block === pdfMargins.vertical.vertical &&
    pdfMargins.vertical.inline === pdfMargins.horizontal.inline && pdfMargins.vertical.horizontal === pdfMargins.horizontal.horizontal && pdfMargins.vertical.page === 9);
  await sourceCheck('PDF margins keep page 8 context', 'PDF', 8, 20);
  await evaluate(() => { state.prefs.marginPct = 8; state.prefs.verticalMarginPx = 28; });
  }

  await evaluate(book => __gaiaDebug.openBook(book), books.epub);
  await evaluate(() => __gaiaDebug.setMode('single'));
  for (const page of process.argv.includes('--epub-gap-only') ? [8] : [0, 8, 12, 23]) {
    await evaluate(async page => {
      await state.current.rendition.display('s' + Math.floor(page / 6) + '.xhtml#page' + page);
    }, page);
    await sourceCheck('EPUB physical page ' + page, 'EPUB', page, 24);
  }
  await evaluate(async () => {
    await __gaiaDebug.setMode('spread');
    await state.current.rendition.display('s1.xhtml#page8');
  });
  await sourceCheck('EPUB spread physical page 8', 'EPUB', 8, 24);
  if (process.argv.includes('--epub-gap-only')) {
    check('nonzero EPUB page gap is active', await evaluate(() => state.current.rendition.manager.layout.gap === 56));
    check('no renderer errors', report.errors.length === 0);
    return;
  }
  await evaluate(async () => {
    await __gaiaDebug.setMode('single');
    await state.current.rendition.display('s1.xhtml#page8');
    await __gaiaDebug.toggleSimplifiedBook();
    state.aiConfig = { model: 'synthetic', provider: 'ollama', hasApiKey: false };
    __gaiaDebug.openAiAssistant();
  });
  await settle();
  const before = await snapshot();
  await evaluate(() => sendAiQuestion('Explain the current synthetic window.'));
  const chat = requests.findLast(request => request.channel === 'ai:chat');
  check('chat handler receives the resolved 12-page context', !!chat && JSON.stringify(markers(chat.payload.source.content, 'EPUB')) === JSON.stringify(expectedPages(8, 24)));
  check('converted EPUB display still sends source text with original characters', chat.payload.source.content.includes('繁體閱讀連續正文') && !chat.payload.source.content.includes('繁体阅读连续正文'));
  check('chat dialog heading matches its resolved request source', await evaluate(title => els.aiSummaryChapter.textContent === title, chat.payload.source.chapterTitle));
  await evaluate(() => runAliceComment('summary'));
  const alice = requests.findLast(request => request.channel === 'ai:alice-comment');
  check('Alice handler receives the same resolved 12-page context', !!alice && alice.payload.source.content === chat.payload.source.content);
  check('both AI send paths preserve the visible EPUB location', await snapshot() === before);

  await evaluate(book => __gaiaDebug.openBook(book), books.azw3);
  await settle();
  const chapter = await evaluate(() => __gaiaDebug.getAiChapterSource());
  check('genuine KF8 chapter metadata keeps chapter-based AI scope', !chapter.pageWindow && chapter.content.length > 100);
  check('no renderer errors', report.errors.length === 0);
}

app.on('browser-window-created', (_event, created) => {
  if (started) return;
  started = true;
  win = created;
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  win.webContents.once('did-finish-load', () => run().then(() => finish(), finish));
});
require('../src/main');
