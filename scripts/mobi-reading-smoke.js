'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { makeMobi7, makeKf8, makeHybrid } = require('../tests/fixtures/mobi-image-fixture');
const project = path.join(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-mobi-reading-smoke-'));
const output = path.join(project, 'dist/previews/mobi-reading');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', sandbox);
app.setPath('sessionData', path.join(sandbox, 'session'));
app.setAppPath(project);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
BrowserWindow.prototype.show = function () { this.showInactive(); };
fs.writeFileSync(path.join(sandbox, 'gaia-reading.json'), JSON.stringify({ library: [], prefs: { theme: 'light' }, pet: { auto: false, autoSpeech: false, autoSleep: false } }));
const report = { checks: [], books: [], errors: [], warnings: [], screenshots: [], output };
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const deadline = setTimeout(() => finish(new Error('MOBI reading validation timed out')), 150000);
let finished = false;

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, books: report.books, output, error: report.error }, null, 2));
  app.emit('before-quit');
  setTimeout(() => app.exit(error ? 1 : 0), 500);
}

function check(name, value) { assert.ok(value, name); report.checks.push(name); }

async function run(win) {
  win.setContentSize(1100, 760);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) report.errors.push(message);
    else if (level === 2) report.warnings.push(message);
  });
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const screenshot = async name => {
    await wait(180);
    const file = path.join(output, name + '.png');
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    report.screenshots.push(file);
  };
  await evaluate(() => __gaiaDebug.waitHome());
  const text = '<h1 id="heading" style="font-size:30px!important">字号与定位验证</h1>' +
    '<p id="fixed" style="font-size:12pt!important">固定 pt 字号正文，头发与发展。</p>' +
    '<p id="relative" style="font-size:1.5em">相对字号<span id="nested" style="font-size:50%">嵌套小字</span></p>' +
    '<p><font id="legacy" size="4">旧版 font 标签</font><small id="note">注释文字</small></p>' +
    Array.from({ length: 80 }, (_, index) => `<p style="font-size:16px!important">第${index}段${'固定字号也应该跟随阅读设置变化。'.repeat(12)}</p>`).join('');
  const generated = [makeMobi7(sandbox, text), makeKf8(sandbox, text)];
  for (const book of generated) {
    await evaluate(() => { state.fontSize = 100; state.prefs.chineseScript = 'simplified'; });
    await evaluate(book => __gaiaDebug.openBook(book), book);
    if (book.format === 'azw3') await evaluate(() => __gaiaDebug.jumpToMobiChapter(3));
    await evaluate(() => { state.fontSize = 100; applyMobiTypography(); });
    const measure = () => evaluate(() => {
      const paginator = state.current.paginator;
      const doc = paginator.doc;
      return { sizes: ['heading', 'fixed', 'relative', 'nested', 'legacy', 'note'].map(id => parseFloat(doc.defaultView.getComputedStyle(doc.getElementById(id)).fontSize)), pages: paginator.totalPages };
    });
    const baseline = await measure();
    for (const percent of [160, 200, 80, 75, 150, 100]) {
      const kept = await evaluate(percent => {
        const paginator = state.current.paginator;
        paginator.showPage(Math.floor(paginator.totalPages / 2));
        const anchor = paginator.anchor();
        state.fontSize = percent;
        applyMobiTypography();
        return !anchor || paginator.anchorInView(anchor.off);
      }, percent);
      const changed = await measure();
      check(book.format + ' ' + percent + '% scales fixed/relative/legacy text without accumulation', changed.sizes.every((size, index) => Math.abs(size - baseline.sizes[index] * percent / 100) < .1));
      check(book.format + ' ' + percent + '% preserves the reading anchor', kept);
      if (percent === 160) check(book.format + ' larger font repaginates', changed.pages > baseline.pages);
    }
    check(book.format + ' real settings buttons update fixed text immediately', await evaluate(() => {
      const doc = state.current.paginator.doc;
      const fixed = doc.getElementById('fixed');
      const before = parseFloat(doc.defaultView.getComputedStyle(fixed).fontSize);
      openSettings();
      $('btn-font-plus').click();
      const after = parseFloat(doc.defaultView.getComputedStyle(fixed).fontSize);
      closeSettings();
      return Math.abs(after / before - 1.1) < .01;
    }));
    check(book.format + ' conversion and font size coexist', await evaluate(async () => {
      await toggleChineseScript();
      return state.current.paginator.doc.body.textContent.includes('頭髮與發展');
    }));
  }
  const hybrid = makeHybrid(sandbox);
  await evaluate(book => __gaiaDebug.openBook(book), hybrid);
  check('hybrid .mobi reads all KF8 chapters without a rename', await evaluate(() => state.current.mobi.chapters.length === 4 && !!state.current.paginator.doc));
  check('a fresh illustrated chapter with saved enlarged font keeps its image within the page', await evaluate(async () => {
    state.fontSize = 180;
    applyMobiTypography();
    await loadMobiChapter(0, {});
    const paginator = state.current.paginator;
    const image = paginator.doc.getElementById('long');
    const rect = image.getBoundingClientRect();
    return rect.height > 0 && rect.top >= 27 && rect.bottom <= paginator.frame.clientHeight - 27;
  }));
  await evaluate(() => __gaiaDebug.backToLibrary());
  check('returning while MOBI opens does not restore stale reading content', await evaluate(async book => {
    const opening = __gaiaDebug.openBook(book);
    await __gaiaDebug.backToLibrary();
    await opening;
    return state.current === null && !document.querySelector('.paginator-frame');
  }, hybrid));

  const realPaths = process.argv.flatMap((argument, index) => argument === '--book' && process.argv[index + 1] ? [path.resolve(process.argv[index + 1])] : []);
  for (const [bookIndex, filePath] of realPaths.entries()) {
    const book = { path: filePath, title: path.basename(filePath, path.extname(filePath)), format: path.extname(filePath).slice(1).toLowerCase() };
    const hash = () => require('node:crypto').createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    const before = hash();
    const started = Date.now();
    let ticks = 0;
    let previous = Date.now();
    let maxDelay = 0;
    const heartbeat = setInterval(() => { const now = Date.now(); maxDelay = Math.max(maxDelay, now - previous); previous = now; ticks++; }, 20);
    try { await evaluate(book => __gaiaDebug.openBook(book), book); }
    finally { clearInterval(heartbeat); }
    const openedMs = Date.now() - started;
    const info = await evaluate(() => ({ chapters: state.current.mobi.chapters.length, rendered: !!state.current.paginator.doc, toc: state.current.mobi.toc.length }));
    check(book.title + ': opens and main process remains responsive', info.rendered && ticks > 0 && maxDelay < 1000 && openedMs < 15000);
    check(book.title + ': distant chapter and lazy TOC location load', await evaluate(async () => {
      const current = state.current;
      const chapter = Math.floor(current.mobi.chapters.length / 2);
      if (!await loadMobiChapter(chapter, {})) return false;
      const flatten = items => items.flatMap(item => [item, ...flatten(item.children || [])]);
      const entry = flatten(current.mobi.toc).find(item => item.index > 3 && item.href);
      if (!entry) return true;
      const target = await window.api.mobiResolveHref(current.mobiSession, entry.href);
      if (!Number.isInteger(target.index) || !await loadMobiChapter(target.index, { selector: target.selector })) return false;
      return !target.selector || !!current.paginator.doc.body.querySelector(target.selector);
    }));
    const selected = await evaluate(async () => {
      const current = state.current;
      for (let index = 4; index < Math.min(20, current.mobi.chapters.length); index++) {
        if (!await loadMobiChapter(index, {})) continue;
        const candidates = [...current.paginator.doc.querySelectorAll('p, div')];
        const paragraph = candidates.find(node => node.textContent.trim().length > 150 && !node.querySelector('img'));
        if (paragraph) {
          paragraph.id = 'real-font-probe';
          const paginator = current.paginator;
          paginator.showPage(paginator.locate(textOffsetBeforeNode(paginator.doc.body, paragraph)));
          state.fontSize = 100;
          applyMobiTypography();
          return { chapter: index, size: parseFloat(paginator.doc.defaultView.getComputedStyle(paragraph).fontSize) };
        }
      }
      return null;
    });
    check(book.title + ': finds real body text for typography verification', selected);
    check(book.title + ': AI still sees the original chapter body', await evaluate(() => currentChapterSummarySource().content.length > 100));
    await screenshot('real-' + bookIndex + '-100');
    const enlarged = await evaluate(() => {
      for (let click = 0; click < 6; click++) adjustFont(1);
      const paginator = state.current.paginator;
      return parseFloat(paginator.doc.defaultView.getComputedStyle(paginator.doc.getElementById('real-font-probe')).fontSize);
    });
    check(book.title + ': six font clicks enlarge real fixed text by 60%', Math.abs(enlarged / selected.size - 1.6) < .01);
    await screenshot('real-' + bookIndex + '-160');
    await evaluate(() => openSettings());
    await screenshot('real-' + bookIndex + '-settings');
    await evaluate(() => closeSettings());
    check(book.title + ': source file remains unchanged', before === hash());
    report.books.push({ title: book.title, ...info, openedMs, maxMainThreadDelayMs: maxDelay, selected, enlarged });
  }
  await evaluate(() => __gaiaDebug.backToLibrary());
  check('no misleading extension warning', !report.warnings.some(message => /compatible file|change the file extension/i.test(message)));
  check('no renderer errors', report.errors.length === 0);
  if (!realPaths.length) {
    await evaluate(book => __gaiaDebug.openBook(book), generated[0]);
    await screenshot('generated-fonts');
  }
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => run(win).then(() => finish(), finish));
});
require('../src/main');
