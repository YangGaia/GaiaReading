'use strict';

// Real app + real EPUB renderer, with isolated books/preferences and no AI calls.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const makeFixture = require('../tests/fixtures/epub-font-fixture');
const project = path.join(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-epub-font-'));
const output = path.resolve(process.env.GAIA_EPUB_FONT_OUTPUT || path.join(project, 'dist/epub-font-smoke'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', sandbox);
app.setPath('sessionData', path.join(sandbox, 'session'));
app.setAppPath(project);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
fs.writeFileSync(path.join(sandbox, 'gaia-reading.json'), JSON.stringify({ library: [], prefs: { fontSize: 100, theme: 'light' }, pet: { auto: false, autoSpeech: false, autoSleep: false } }));
BrowserWindow.prototype.show = function () { this.showInactive(); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { checks: [], measurements: [], screenshots: [], errors: [], sandbox, output };
let finished = false;
const deadline = setTimeout(() => finish(new Error('EPUB typography validation timed out')), 120000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output, error: report.error }, null, 2));
  app.exit(error ? 1 : 0);
}
function check(name, value) { assert.ok(value, name); report.checks.push(name); }
function near(actual, expected, label) { assert.ok(Math.abs(actual - expected) < .15, `${label}: got ${actual}, expected ${expected}`); report.checks.push(label); }

async function run(win) {
  win.setContentSize(1100, 760);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  await evaluate(() => __gaiaDebug.waitHome());
  const book = await makeFixture(sandbox);
  const fixedBook = await makeFixture(sandbox, true);
  await evaluate(book => __gaiaDebug.openBook(book), book);
  await wait(400);

  async function setSize(percent) {
    await evaluate(async percent => {
      // Drive the existing button handler; hold all clicks in one turn to test
      // coalescing and use the same text anchor throughout the operation.
      const delta = percent > state.fontSize ? 1 : -1;
      const clicks = Math.abs(percent - state.fontSize) / 10;
      for (let i = 0; i < clicks; i++) document.getElementById(delta > 0 ? 'btn-font-plus' : 'btn-font-minus').click();
      await readerLayoutSyncPromise;
    }, percent);
    await wait(450);
  }
  const measure = () => evaluate(() => {
    const contents = state.current.rendition.getContents()[0];
    const doc = contents.document;
    const sizes = {};
    const faces = {};
    for (const id of ['heading', 'inherited', 'fixed', 'points', 'root-relative', 'relative', 'percent', 'important', 'inline', 'nested', 'nested-small', 'footnote', 'shorthand', 'inline-shorthand', 'variable', 'responsive', 'art-text', 'second']) {
      const node = doc.getElementById(id);
      if (node) {
        const style = contents.window.getComputedStyle(node);
        sizes[id] = parseFloat(style.fontSize);
        faces[id] = [style.fontFamily, style.fontWeight, style.fontStyle];
      }
    }
    const shorthand = doc.getElementById('shorthand');
    const art = doc.getElementById('art');
    return { sizes, faces, text: doc.body.textContent, setting: state.fontSize,
      shorthandHeight: shorthand ? parseFloat(contents.window.getComputedStyle(shorthand).lineHeight) : 0,
      artWidth: art ? art.getBoundingClientRect().width : 0,
      location: state.current.rendition.currentLocation() };
  });
  const baseline = await measure();
  const sourceBefore = await evaluate(() => __gaiaDebug.getAiChapterSource());
  const petBefore = await evaluate(() => { const r = document.getElementById('gaia-pet').getBoundingClientRect(); return [r.width, r.height]; });
  for (const percent of [150, 200, 80, 100, 180, 100]) {
    await setSize(percent);
    const actual = await measure();
    report.measurements.push({ percent, sizes: actual.sizes });
    for (const [id, value] of Object.entries(baseline.sizes)) near(actual.sizes[id], value * (id === 'art-text' ? 1 : percent / 100), `${id} follows ${percent}% without compounding`);
    near(actual.shorthandHeight, baseline.shorthandHeight * percent / 100, `fixed line-height follows ${percent}%`);
    near(actual.artWidth, baseline.artWidth, `artwork width stays unchanged at ${percent}%`);
    check(`chapter text and DOM text order stay unchanged at ${percent}%`, actual.text === baseline.text);
    check(`font families, emphasis and italic styles survive ${percent}%`, JSON.stringify(actual.faces) === JSON.stringify(baseline.faces));
  }
  check('AI chapter source is unchanged by font scaling', await evaluate(before => __gaiaDebug.getAiChapterSource().content === before.content, sourceBefore));
  check('desktop companion keeps its independent size', JSON.stringify(petBefore) === JSON.stringify(await evaluate(() => { const r = document.getElementById('gaia-pet').getBoundingClientRect(); return [r.width, r.height]; })));

  await setSize(150);
  await evaluate(() => __gaiaDebug.setLineHeight(2.4));
  near(await evaluate(() => { const c = state.current.rendition.getContents()[0]; return parseFloat(c.window.getComputedStyle(c.document.getElementById('fixed')).lineHeight); }), 16 * 1.5 * 2.4, 'line-height control still changes actual paragraph spacing');
  for (const theme of ['dark', 'eye', 'light']) {
    await evaluate(theme => __gaiaDebug.setTheme(theme), theme);
    near((await measure()).sizes.fixed, 24, `theme ${theme} does not compound scaling`);
  }
  await evaluate(() => __gaiaDebug.setLineHeight(1.8));
  await evaluate(async () => { await state.current.rendition.display('c2.xhtml'); });
  await wait(400);
  near((await measure()).sizes.second, 27, 'new chapter inherits saved scaling despite a different authored size');
  await evaluate(book => __gaiaDebug.openBook(book), book);
  await wait(400);
  const reopened = await measure();
  report.reopened = { setting: reopened.setting, sizes: reopened.sizes, location: reopened.location };
  near(reopened.sizes.second, 27, 'reopening restores both the chapter and font preference');

  await evaluate(async () => { await state.current.rendition.display('c1.xhtml'); });
  await wait(300);
  await setSize(100);
  const anchor = await evaluate(async () => {
    const c = state.current;
    const contents = c.rendition.getContents()[0];
    const range = contents.document.createRange();
    const node = contents.document.getElementById('paragraph-40').firstChild;
    range.setStart(node, 8); range.setEnd(node, 32);
    const quote = range.toString();
    const cfi = contents.cfiFromRange(range);
    const id = await persistSelectionAnnotation({ kind: 'epub', bookPath: c.path, text: quote, anchor: { kind: 'epub-cfi', cfi }, chapter: '第一章' }, 'yellow', '字号回归笔记');
    restoreEpubAnnotations();
    range.collapse(true);
    const point = contents.cfiFromRange(range);
    await c.rendition.display(point);
    await delay(200);
    await addBookmark();
    return { point, cfi, quote, id, pageStart: c.rendition.currentLocation().start.cfi, bookmark: state.bookmarks[c.path][0] };
  });
  await setSize(200);
  report.anchor = anchor;
  report.afterReflow = (await measure()).location;
  check('font reflow keeps the original text anchor on the visible page', await evaluate(anchor => {
    const c = state.current, loc = c.rendition.currentLocation();
    const compare = new window.ePub.CFI();
    return compare.compare(loc.start.cfi, anchor.pageStart) <= 0 && compare.compare(loc.end.cfi, anchor.pageStart) >= 0;
  }, anchor));
  check('annotation CFI still resolves to the original selected text', await evaluate(anchor => state.current.rendition.getContents()[0].range(anchor.cfi).toString() === anchor.quote, anchor));
  check('note text and rendered annotation survive reflow', await evaluate(anchor => currentAnnotations().some(a => a.id === anchor.id && a.note === '字号回归笔记') && !!document.querySelector('.gaia-epub-highlight'), anchor));
  await evaluate(() => __gaiaDebug.nextPage());
  await wait(250);
  await evaluate(bookmark => __gaiaDebug.jumpToBookmark(bookmark), anchor.bookmark);
  await wait(350);
  check('bookmark still resolves after a font change and page turn', await evaluate(bookmark => {
    const loc = state.current.rendition.currentLocation(), compare = new window.ePub.CFI();
    return compare.compare(loc.start.cfi, bookmark.loc) <= 0 && compare.compare(loc.end.cfi, bookmark.loc) >= 0;
  }, anchor.bookmark));

  const search = await evaluate(() => __gaiaDebug.runBookSearch('唯一定位词'));
  check('full book search still finds both chapters', search.results === 2);
  await evaluate(() => __gaiaDebug.activateBookSearchResult(0));
  await setSize(150);
  check('search highlight is restored at the new font size', (await evaluate(() => __gaiaDebug.getBookSearchState())).highlightCount > 0);
  check('overlapping annotations remain rendered while search is active', await evaluate(() => !!document.querySelector('.gaia-epub-highlight')));
  await evaluate(() => __gaiaDebug.closeBookSearch());
  await evaluate(async () => { await state.current.rendition.display('c1.xhtml'); });
  await wait(250);

  for (const width of [800, 1600, 1100]) {
    win.setContentSize(width, 760);
    await wait(700);
    const actual = await measure();
    near(actual.sizes.fixed, 24, `font stays correct after resizing to ${width}`);
    const expected = await evaluate(() => state.current.rendition.getContents()[0].window.matchMedia('(max-width: 700px)').matches ? 21 : 24);
    near(actual.sizes.responsive, expected, `authored media query updates at ${width}`);
  }
  for (const mode of ['spread', 'single']) {
    await evaluate(mode => __gaiaDebug.setMode(mode), mode);
    await wait(450);
    near((await measure()).sizes.fixed, 24, `font stays correct in ${mode} layout`);
    const before = (await measure()).location.start.cfi;
    await evaluate(() => __gaiaDebug.nextPage());
    await wait(250);
    check(`page turn advances after resizing in ${mode}`, (await measure()).location.start.cfi !== before);
  }

  check('holding and releasing an arrow key at 150% stops without queued turns', await evaluate(async () => {
    const before = state.current.rendition.currentLocation().start.cfi;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
    await delay(450);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
    await delay(300);
    const stopped = state.current.rendition.currentLocation().start.cfi;
    await delay(300);
    return stopped !== before && state.current.rendition.currentLocation().start.cfi === stopped;
  }));

  await evaluate(async () => { await state.current.rendition.display('c1.xhtml'); __gaiaDebug.openSettings(); });
  for (const percent of [100, 150]) {
    await setSize(percent);
    const target = path.join(output, `epub-font-${percent}.png`);
    fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG());
    report.screenshots.push(target);
    await evaluate(() => __gaiaDebug.closeSettings());
    await wait(250);
    const readerTarget = path.join(output, `epub-reading-${percent}.png`);
    fs.writeFileSync(readerTarget, (await win.webContents.capturePage()).toPNG());
    report.screenshots.push(readerTarget);
    await evaluate(() => __gaiaDebug.openSettings());
  }
  await evaluate(() => __gaiaDebug.closeSettings());
  await evaluate(book => __gaiaDebug.openBook(book), fixedBook);
  await wait(400);
  await evaluate(() => __gaiaDebug.openSettings());
  check('fixed layout explains why font controls are disabled', await evaluate(() => $('btn-font-plus').disabled && $('btn-font-minus').disabled && $('font-value').textContent === '固定版式' && $('font-value').title.includes('窗口')));
  const fixedBefore = await measure();
  await evaluate(() => { adjustFont(1); adjustFont(-1); });
  const fixedAfter = await measure();
  check('fixed layout preserves original font sizes and global preference', JSON.stringify(fixedBefore.sizes) === JSON.stringify(fixedAfter.sizes) && fixedBefore.setting === fixedAfter.setting && fixedAfter.sizes.fixed === 16);
  await evaluate(book => __gaiaDebug.openBook(book), book);
  await wait(300);
  await evaluate(() => __gaiaDebug.openSettings());
  check('returning to reflowable EPUB re-enables font controls', await evaluate(() => !$('btn-font-plus').disabled && !$('btn-font-minus').disabled));
  await evaluate(async fixedBook => { adjustFont(1); await __gaiaDebug.openBook(fixedBook); await delay(350); }, fixedBook);
  check('switching books during a font change invalidates the old reflow', await evaluate(book => state.current.path === book.path && isFixedEpubContent(), fixedBook));
  check('no renderer exceptions', report.errors.length === 0);
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => run(win).then(() => finish(), finish));
});
require('../src/main');
