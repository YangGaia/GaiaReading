'use strict';

// Real Chromium checks for source-preserving conversion and column text ranges.
// Run: electron scripts/reader-display-smoke.js
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { makeSmokeDirectory, configureSmokePaths } = require('./smoke-paths');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const sandbox = makeSmokeDirectory('gaia-reader-display-');
configureSmokePaths(app, { userData: path.join(sandbox, 'user-data'), sessionData: path.join(sandbox, 'session'), temp: sandbox });
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const report = { checks: [], errors: [], sandbox };
let win;
let finished = false;
const deadline = setTimeout(() => finish(new Error('Reader display smoke timed out')), 45000);

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
async function evaluate(fn, ...args) {
  return win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
}

app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 900, height: 750, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false } });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><style>body{margin:0}#host{width:800px;height:600px}iframe{border:0;display:block}.paginator-pending{visibility:hidden}</style><div id="host"></div>'));
  for (const filename of ['src/shared/reader-contrast.js', 'src/shared/epub-typography.js', 'src/shared/chinese-display-data.js', 'src/shared/chinese-display.js', 'src/shared/page-text-range.js', 'src/renderer/paginator.js']) {
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(project, filename), 'utf8') + '\n;undefined;');
  }
  await evaluate(async () => {
    window.reader = new GaiaPaginator(document.getElementById('host'), { pageWidth: 640, gap: 32 });
    const html = '<h1 id="繁體">著<span>作</span>權與乾隆</h1><p translate="no">繁體原樣</p><pre>繁體程式</pre><svg width="1" height="1"><text>繁體畫作</text></svg>' +
      Array.from({ length: 60 }, (_, index) => '<p id="p' + index + '">第' + index + '段繁體閱讀。' + '臺灣的頭髮與乾淨衣服，著名著作和瞭望遠方。'.repeat(5) + '</p>').join('');
    await reader.render(html, '');
    window.originalSource = reader.doc.body.textContent;
    window.originalNode = reader.doc.getElementById('繁體').firstChild;
    reader.showPage(3);
    window.beforeAnchor = reader.anchor();
    reader.setSimplified(true);
  });
  check('conversion preserves source, text-node identity and UTF-16 offsets', await evaluate(() =>
    reader.sourceText() === originalSource && reader.doc.body.textContent.length === originalSource.length &&
    reader.doc.getElementById('繁體').firstChild === originalNode && reader.anchorInView(beforeAnchor.off)
  ));
  check('conversion handles phrases across inline markup without changing IDs, code or illustrations', await evaluate(() =>
    reader.doc.getElementById('繁體').textContent === '著作权与乾隆' &&
    reader.doc.querySelector('[translate="no"]').textContent === '繁體原樣' &&
    reader.doc.querySelector('pre').textContent === '繁體程式' &&
    reader.doc.querySelector('svg text').textContent === '繁體畫作'
  ));
  check('selection source and annotation wrappers survive conversion toggles', await evaluate(() => {
    const paragraph = reader.doc.getElementById('p5');
    const source = GaiaChineseDisplay.sourceText(paragraph);
    const range = reader.doc.createRange();
    range.setStart(paragraph.firstChild, 3);
    range.setEnd(paragraph.firstChild, 16);
    const expected = source.slice(3, 16);
    const before = GaiaChineseDisplay.sourceRange(range);
    const mark = reader.doc.createElement('mark');
    range.surroundContents(mark);
    const marked = GaiaChineseDisplay.sourceText(mark);
    reader.setSimplified(false);
    const restored = reader.doc.body.textContent === originalSource && mark.textContent === expected;
    mark.replaceWith(...mark.childNodes);
    paragraph.normalize();
    reader.setSimplified(true);
    return before === expected && marked === expected && restored && reader.sourceText() === originalSource;
  }));
  check('separate margins keep the current text anchor and accept zero', await evaluate(() => {
    reader.showPage(3);
    const anchor = reader.anchor();
    reader.setMargins({ horizontalPct: 0, verticalPx: 0 });
    const style = reader.doc.defaultView.getComputedStyle(reader.doc.body.firstElementChild);
    return style.marginLeft === '0px' && reader.verticalPadding === 0 && reader.anchorInView(anchor.off);
  }));
  check('vertical margin clamps to short viewport content height', await evaluate(() => {
    reader.host.style.height = '180px';
    reader.setMargins({ horizontalPct: 16, verticalPx: 200 });
    const okay = reader.marginPct === 16 && reader.verticalMarginPx === 160 && reader.verticalPadding === 66;
    reader.host.style.height = '600px';
    reader.setMargins({ horizontalPct: 8, verticalPx: 28 });
    return okay;
  }));

  await evaluate(async () => {
    window.pageSources = Array.from({ length: 24 }, (_, index) => '第' + String(index).padStart(2, '0') + '頁：繁體閱讀，乾隆與著作。');
    await reader.render(pageSources.map((text, index) => '<p id="page' + index + '">' + text + '</p>').join(''), 'p{break-after:column}p:last-child{break-after:auto}');
    reader.showPage(8);
  });
  const pageWindow = await evaluate(() => {
    const scroll = reader.doc.documentElement.scrollLeft;
    const page = reader.currentPage;
    const source = reader.pageTextRange(4, 15);
    const display = reader.pageTextRange(4, 15, { source: false });
    return {
      correct: source.content === pageSources.slice(4, 16).join(''),
      display: display.content === GaiaChineseDisplay.toSimplified(source.content),
      positions: source.startPage === 4 && source.endPage === 15 && source.totalPages === 24,
      stable: page === reader.currentPage && scroll === reader.doc.documentElement.scrollLeft,
      source,
    };
  });
  check('12-page context contains exactly four previous, current and seven following columns', pageWindow.correct && pageWindow.positions);
  check('page extraction supports original and simplified text without navigating', pageWindow.display && pageWindow.stable);
  check('page windows clamp to book boundaries', await evaluate(() =>
    reader.pageTextRange(-4, 3).content === pageSources.slice(0, 4).join('') &&
    reader.pageTextRange(21, 30).content === pageSources.slice(21).join('')
  ));

  await evaluate(async () => {
    window.longText = '繁體閱讀乾隆著作漢字段落'.repeat(500);
    reader.setMode('spread');
    await reader.render('<p>' + longText + '</p>', '');
    reader.showPage(4);
  });
  check('a long text node spanning columns has no missing or duplicate characters', await evaluate(() => {
    const parts = Array.from({ length: reader.totalPages }, (_, page) => reader.pageTextRange(page, page).content);
    return parts.length > 12 && parts.every((text) => text.length > 0) && parts.join('') === longText &&
      reader.pageTextRange(0, reader.totalPages - 1).content === longText;
  }));
  check('spread extraction follows individual physical columns and keeps reading position', await evaluate(() => {
    const before = reader.currentPage;
    const parts = Array.from({ length: 12 }, (_, offset) => reader.pageTextRange(offset, offset).content);
    return reader.pageTextRange(0, 11).content === parts.join('') && reader.currentPage === before;
  }));
  check('no renderer errors', report.errors.length === 0);
  finish();
}).catch(finish);
