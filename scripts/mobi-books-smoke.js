'use strict';

// Generated PDB/MOBI files -> real import, preload IPC, parser and application UI.
// Run: electron scripts/mobi-books-smoke.js [--screenshots] [--output DIR]
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeSmokeDirectory, configureSmokePaths, resolveFPath } = require('./smoke-paths');
const { STATE_FILE_NAME } = require('../src/shared/app-paths');

const project = path.resolve(__dirname, '..');
const sandbox = makeSmokeDirectory('mobi-books-session-');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith('--'))) throw new Error('--output requires a directory');
const output = resolveFPath(outputIndex >= 0 ? args[outputIndex + 1]
  : process.env.GAIA_MOBI_BOOKS_OUTPUT || path.join(sandbox, 'screenshots'));
fs.mkdirSync(output, { recursive: true });
const profile = path.join(sandbox, 'profile');
const booksDirectory = path.join(sandbox, 'books');
fs.mkdirSync(profile);
fs.mkdirSync(booksDirectory);
configureSmokePaths(app, { userData: profile, temp: sandbox });
app.setAppPath(project);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
fs.writeFileSync(path.join(profile, STATE_FILE_NAME), JSON.stringify({
  _meta: { schemaVersion: 1, appVersion: require('../package.json').version },
  library: [], prefs: { theme: 'light', fontSize: 100 },
  pet: { auto: false, autoSpeech: false, autoSleep: false },
}));

const report = { passed: false, checks: [], books: [], chapters: [], measurements: [], screenshots: [], ipcCounts: {}, errors: [], output, sandbox, profile };
// Observe real handlers without changing their arguments, results or timing.
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, (event, ...values) => {
  if (channel.startsWith('mobi:') || channel === 'book:metadata') report.ipcCounts[channel] = (report.ipcCounts[channel] || 0) + 1;
  return listener(event, ...values);
});
// The app's ready-to-show handler must not display a test window over the user.
BrowserWindow.prototype.show = function () {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
let finished = false;
const deadline = setTimeout(() => finish(new Error('Generated MOBI books validation timed out')), 120000);

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, books: report.books.length, output, error: report.error }, null, 2));
  app.exit(error ? 1 : 0);
}

function check(label, value) {
  assert.ok(value, label);
  report.checks.push(label);
}

const evaluate = (fn, value) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value)})`);
async function settle() {
  await evaluate(async () => {
    await __gaiaDebug.waitForReaderLayoutRefresh();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await wait(100);
}

async function until(fn, label, value, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(fn, value)) return;
    await wait(50);
  }
  throw new Error(label);
}

async function screenshot(name) {
  if (!args.includes('--screenshots')) return;
  await settle();
  const target = path.join(output, name + '.png');
  fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG());
  report.screenshots.push(target);
}

async function chapterInventory(book, chapter) {
  await evaluate(chapter => __gaiaDebug.jumpToMobiChapter(chapter), chapter);
  await until(() => state.current.paginator && state.current.paginator.doc && Array.from(state.current.paginator.doc.images).every(img => img.complete),
    `${book.format} chapter ${chapter}: images did not settle`);
  await settle();
  const value = await evaluate(() => {
    const c = state.current;
    const doc = c.paginator.doc;
    return { index: __gaiaDebug.getMobiIndex(), pages: c.paginator.totalPages, textLength: doc.body.textContent.length,
      images: Array.from(doc.images).map(img => ({ id: img.id, complete: img.complete, naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight, src: img.getAttribute('src').slice(0, 100) })),
      svgImages: Array.from(doc.querySelectorAll('svg image')).map(img => ({ id: img.id, href: img.getAttribute('href') || img.getAttribute('xlink:href') || '' })),
      unresolved: /kindle:(?:embed|flow):/i.test(doc.body.innerHTML) };
  });
  report.chapters.push({ format: book.format, ...value });
  check(`${book.format} chapter ${chapter}: production chapter switch completed`, value.index === chapter && value.pages >= 1
    && (value.textLength > 0 || value.images.length > 0 || value.svgImages.length > 0));
  for (const img of value.images) {
    check(`${book.format} chapter ${chapter} image ${img.id || '(unnamed)'}: decoded from the real book`, img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
    check(`${book.format} chapter ${chapter} image ${img.id || '(unnamed)'}: self-contained resource`, img.src.startsWith('data:image/'));
  }
  for (const image of value.svgImages) check(`${book.format} chapter ${chapter} SVG image ${image.id}: resource is inlined`, image.href.startsWith('data:image/'));
  check(`${book.format} chapter ${chapter}: no unresolved Kindle image/style URIs`, !value.unresolved);
}

async function longArtwork(book, mode) {
  const expected = book.expected;
  await evaluate(async ({ chapter, mode }) => {
    await __gaiaDebug.jumpToMobiChapter(chapter);
    __gaiaDebug.setMode(mode);
  }, { chapter: expected.galleryChapter, mode });
  await settle();
  const value = await evaluate(id => {
    const p = state.current.paginator;
    const image = p.doc.getElementById(id);
    if (!image) return null;
    p.showPage(0);
    p.showPage(Math.floor(image.getBoundingClientRect().left / p.colStep));
    const box = image.getBoundingClientRect();
    const frame = p.frame.getBoundingClientRect();
    return { mode: p.mode, width: p.pageWidth, gap: p.gap, hostHeight: p.host.clientHeight, padding: p.verticalPadding,
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      src: image.getAttribute('src'),
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
      pixel: { x: frame.left + box.left + box.width / 2, y: frame.top + box.top + box.height * .97 } };
  }, expected.longImageId);
  check(`${book.format} ${mode}: fixture long illustration exists`, !!value);
  report.measurements.push({ format: book.format, kind: 'long-image', ...value, src: value.src.slice(0, 100) });
  if (expected.images && expected.images.tall) {
    const tall = expected.images.tall;
    check(`${book.format} ${mode}: image number resolves to the expected bytes and dimensions`, value.src === tall.dataUrl
      && value.naturalWidth === tall.width && value.naturalHeight === tall.height);
  }
  check(`${book.format} ${mode}: tall illustration keeps its intrinsic ratio`, Math.abs(value.box.width / value.box.height - value.naturalWidth / value.naturalHeight) < .01);
  check(`${book.format} ${mode}: full long image stays inside vertical page padding`, value.box.top >= value.padding - 1 && value.box.bottom <= value.hostHeight - value.padding + 1);
  const column = Math.floor((value.box.left + .5) / (value.width + value.gap));
  const columnLeft = column * (value.width + value.gap);
  check(`${book.format} ${mode}: long image fits one visible column`, column >= 0 && column < (mode === 'spread' ? 2 : 1)
    && value.box.left >= columnLeft - 1 && value.box.right <= columnLeft + value.width + 1);
  const bottomColor = expected.bottomColor || expected.images && expected.images.tall && expected.images.tall.bottomColor;
  if (bottomColor) {
    await settle();
    const pixel = await win.webContents.capturePage({ x: Math.round(value.pixel.x), y: Math.round(value.pixel.y), width: 1, height: 1 });
    const data = pixel.toBitmap();
    const actual = [data[2], data[1], data[0]];
    check(`${book.format} ${mode}: actual bottom color is visible`, actual.every((channel, i) => Math.abs(channel - bottomColor[i]) <= 8));
  }
  await screenshot(book.format + '-' + mode + '-long-image');
}

async function coloredResource(book, id, kind, expectedColor) {
  const value = await evaluate(async ({ id, kind }) => {
    const p = state.current.paginator;
    const element = p.doc.getElementById(id);
    if (!element) return null;
    p.showPage(0);
    const style = p.doc.defaultView.getComputedStyle(element);
    let src = '';
    if (kind === 'background') {
      const match = style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/);
      src = match && match[1] || '';
    } else {
      const image = element.querySelector('image');
      src = image ? image.getAttribute('href') || image.getAttribute('xlink:href') : element.getAttribute('src');
    }
    if (src) { const image = new Image(); image.src = src; await image.decode(); }
    // CSS backgrounds may occupy fragments in two adjacent columns. Their
    // union rectangle includes empty space; sample the largest painted fragment.
    const fragments = Array.from(element.getClientRects());
    const fragmentIndex = fragments.reduce((best, rect, index) => rect.width * rect.height
      > fragments[best].width * fragments[best].height ? index : best, 0);
    p.showPage(Math.floor(fragments[fragmentIndex].left / p.colStep));
    const box = element.getClientRects()[fragmentIndex];
    const frame = p.frame.getBoundingClientRect();
    return { id, kind, src: (src || '').slice(0, 100), width: box.width, height: box.height,
      fragments: fragments.length, color: style.color,
      pixel: { x: frame.left + box.left + box.width * .75, y: frame.top + box.top + box.height * .75 } };
  }, { id, kind });
  check(`${book.format} ${kind} ${id}: target exists and resource is inlined`, !!value && value.src.startsWith('data:image/') && value.width > 0 && value.height > 0);
  report.measurements.push({ format: book.format, ...value });
  if (expectedColor) {
    await settle();
    const pixel = await win.webContents.capturePage({ x: Math.round(value.pixel.x), y: Math.round(value.pixel.y), width: 1, height: 1 });
    const data = pixel.toBitmap();
    const actual = [data[2], data[1], data[0]];
    check(`${book.format} ${kind} ${id}: embedded pixels really render`, actual.every((channel, i) => Math.abs(channel - expectedColor[i]) <= 8));
  }
}

async function followFootnote(book, returning) {
  const expected = book.expected;
  const target = returning ? expected.returnLink : expected.footnote;
  const id = returning ? expected.returnLinkId : expected.footnoteLinkId;
  const label = book.format + (returning ? ' footnote return' : ' cross-chapter footnote');
  if (!returning) await evaluate(chapter => __gaiaDebug.jumpToMobiChapter(chapter), target.fromChapter);
  const href = await evaluate(({ id, href }) => {
    const p = state.current.paginator;
    const link = id ? p.doc.getElementById(id) : Array.from(p.doc.querySelectorAll('a[href]')).find(a => a.getAttribute('href') === href);
    if (!link) return '';
    p.showPage(0);
    p.showPage(Math.floor(link.getBoundingClientRect().left / p.colStep));
    return link.getAttribute('href');
  }, { id, href: target.href });
  check(`${label}: real link survives parsing`, /^(filepos:|kindle:pos:)/.test(href));
  const resolved = await evaluate(href => __gaiaDebug.resolveMobiHref(href), href);
  report.measurements.push({ format: book.format, kind: returning ? 'return-link' : 'footnote-link', href, resolved });
  check(`${label}: preload IPC resolves the target chapter`, resolved && resolved.index === target.targetIndex && resolved.index !== target.fromChapter);
  check(`${label}: dispatches a real click on the book link`, await evaluate(href => __gaiaDebug.clickMobiHref(href), href));
  await until(index => __gaiaDebug.getMobiIndex() === index, `${label}: click did not reach the target chapter`, target.targetIndex);
  await settle();
  check(`${label}: target is on the visible page`, await evaluate(target => target.selector
    ? __gaiaDebug.isMobiSelectorInView(target.selector) : __gaiaDebug.isMobiTextInView(target.textHint), resolved));
}

async function run() {
  await evaluate(() => __gaiaDebug.waitHome());
  win.setContentSize(1180, 820);
  const { createMobi7Fixture } = require('../tests/fixtures/mobi7-book-fixture');
  const { createKf8Fixture } = require('../tests/fixtures/kf8-book-fixture');
  const books = [await createMobi7Fixture(booksDirectory), await createKf8Fixture(booksDirectory)];
  for (const book of books) {
    const bytes = fs.readFileSync(book.path);
    check(`${book.format}: generated a real Palm database book on disk`, bytes.length > 1000 && bytes.toString('ascii', 60, 68) === 'BOOKMOBI' && bytes.readUInt16BE(76) > 2);
    report.books.push({ ...book, bytes: bytes.length });
  }
  const imported = await evaluate(paths => __gaiaDebug.importPaths(paths), books.map(book => book.path));
  report.imported = imported;
  check('both generated books pass the real import and metadata pipeline', imported.added === 2 && imported.failures.length === 0);
  for (const book of books) {
    await evaluate(async path => {
      const book = __gaiaDebug.getLibrary().find(book => book.path === path);
      await __gaiaDebug.openBook(book);
    }, book.path);
    await settle();
    const opened = await evaluate(() => ({ path: state.current.path, session: state.current.mobiSession,
      format: state.current.format, chapters: __gaiaDebug.getMobiChapters(), title: state.current.title }));
    check(`${book.format}: application opens the disk book through its MOBI session`, opened.path === book.path && !!opened.session && opened.format === book.format);
    check(`${book.format}: generated chapters are available`, opened.chapters === (book.expected.chapterCount || book.expected.chapters.length));
    for (let chapter = 0; chapter < opened.chapters; chapter++) await chapterInventory(book, chapter);
    for (const mode of ['single', 'spread']) await longArtwork(book, mode);
    await evaluate(async chapter => { __gaiaDebug.setMode('single'); await __gaiaDebug.jumpToMobiChapter(chapter); }, book.expected.galleryChapter);
    await settle();
    if (book.expected.backgroundId) await coloredResource(book, book.expected.backgroundId, 'background', book.expected.backgroundColor || [30, 170, 85]);
    if (book.expected.svgId) await coloredResource(book, book.expected.svgId, 'svg', book.expected.svgColor || [30, 170, 85]);
    if (book.expected.svgResourceId) await coloredResource(book, book.expected.svgResourceId, 'svg-resource', book.expected.svgColor || [30, 170, 85]);
    if (book.expected.backgroundId || book.expected.svgId) await screenshot(book.format + '-embedded-resources');
    await followFootnote(book, false);
    await screenshot(book.format + '-footnote');
    await followFootnote(book, true);
    await evaluate(() => __gaiaDebug.backToLibrary());
    await wait(100);
  }
  check('real preload IPC opens both books and loads all chapters', report.ipcCounts['mobi:open'] >= 2 && report.ipcCounts['mobi:chapter'] >= 6);
  check('real preload IPC resolves cross-chapter links and returns', report.ipcCounts['mobi:resolve-href'] >= 8);
  check('both books release their parser sessions on reader close', report.ipcCounts['mobi:close'] >= 2);
  check('test data remains in the isolated application profile', app.getPath('userData') === profile && app.getPath('sessionData').startsWith(profile));
  check('no application renderer exceptions', report.errors.length === 0);
}

app.on('browser-window-created', (_event, created) => {
  if (win) return;
  win = created;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  win.webContents.once('did-finish-load', () => run().then(() => finish(), finish));
});
require('../src/main');
