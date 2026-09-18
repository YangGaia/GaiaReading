'use strict';

// Actual application, IPC, parser and Chromium layout. All preferences, generated
// books and progress are isolated; an optional --book path is only read.
const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { picture, makeMobi7, makeKf8 } = require('../tests/fixtures/mobi-image-fixture');
const project = path.join(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-mobi-images-'));
const output = path.resolve(process.env.GAIA_MOBI_IMAGE_OUTPUT || path.join(project, 'dist/previews/mobi-images'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', sandbox);
app.setPath('sessionData', path.join(sandbox, 'session'));
app.setAppPath(project);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
fs.writeFileSync(path.join(sandbox, 'gaia-reading.json'), JSON.stringify({ library: [], prefs: { theme: 'light' }, pet: { auto: false, autoSpeech: false, autoSleep: false } }));
BrowserWindow.prototype.show = function () { this.showInactive(); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Use the application's allowed local image scheme; preserve its normal handler.
const handleProtocol = protocol.handle.bind(protocol);
protocol.handle = (scheme, handler) => handleProtocol(scheme, async request => {
  if (scheme === 'bgm' && new URL(request.url).pathname.startsWith('/__image-test-')) {
    // Later than render's 1.5s fallback plus the former 2.5s image timeout.
    await wait(5200);
    return new Response(picture(360, 2400), { headers: { 'Content-Type': 'image/svg+xml' } });
  }
  return handler(request);
});
const report = { checks: [], measurements: [], screenshots: [], errors: [], sandbox, output };
let finished = false;
const deadline = setTimeout(() => finish(new Error('MOBI image validation timed out')), 150000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, realBook: report.realBook, output, error: report.error }, null, 2));
  app.exit(error ? 1 : 0);
}
function check(name, value) { assert.ok(value, name); report.checks.push(name); }

async function run(win) {
  win.setContentSize(1100, 760);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  await evaluate(() => __gaiaDebug.waitHome());
  // Optional reference implementation, used to prove the layout regression
  // check fails before the fix without changing any application source files.
  if (process.env.GAIA_MOBI_PAGINATOR_SOURCE) {
    const reference = fs.readFileSync(process.env.GAIA_MOBI_PAGINATOR_SOURCE, 'utf8');
    await win.webContents.executeJavaScript('(() => {' + reference + '\n})()');
  }
  const kf8 = makeKf8(sandbox);
  const mobi7 = makeMobi7(sandbox);
  const screenshot = async name => {
    await wait(100);
    const file = path.join(output, name + '.png');
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    report.screenshots.push(file);
  };
  async function geometry(id) {
    return evaluate(id => {
      const p = state.current.paginator;
      const el = p.doc.getElementById(id);
      if (!el) return null;
      p._scrollTo(0);
      p.showPage(Math.floor(el.getBoundingClientRect().left / p.colStep));
      const r = el.getBoundingClientRect();
      const style = p.doc.defaultView.getComputedStyle(el);
      return { id, width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, hostHeight: p.host.clientHeight,
        frameHeight: p.frame.clientHeight, pageWidth: p.pageWidth, pages: p.totalPages, fit: style.objectFit };
    }, id);
  }
  async function fits(id, label, ratio) {
    const rect = await geometry(id);
    report.measurements.push({ label, ...rect });
    check(label + ': exists and fits vertically', rect && rect.height > 0 && rect.top >= 27 && rect.bottom <= rect.frameHeight - 27);
    check(label + ': fits one column horizontally', rect.left >= -1 && rect.right <= rect.pageWidth + 1);
    if (ratio) check(label + ': preserves aspect ratio', Math.abs(rect.width / rect.height - ratio) < .015);
    if (['long', 'svg-wrapper', 'nested-svg', 'late'].includes(id)) {
      await wait(100); // Let the resized iframe reach the compositor before sampling pixels.
      const marker = await evaluate(id => {
        const p = state.current.paginator;
        const frame = p.frame.getBoundingClientRect();
        const r = p.doc.getElementById(id).getBoundingClientRect();
        return { x: Math.round(frame.left + r.left + r.width * .2), y: Math.round(frame.top + r.top + r.height * .91), width: 4, height: 4 };
      }, id);
      const pixels = (await win.webContents.capturePage(marker)).toBitmap();
      let green = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        // The settings backdrop dims the reader, but preserves the green hue.
        if (pixels[i + 1] > 40 && pixels[i + 1] > pixels[i + 2] * 1.4 && pixels[i + 1] > pixels[i] * 1.2) green++;
      }
      if (green <= pixels.length / 8) {
        report.markerFailure = { label, marker, green, sample: [...pixels.subarray(0, 4)] };
        await screenshot('marker-failure');
      }
      check(label + ': bottom marker is actually painted', green > pixels.length / 8);
    }
    return rect;
  }

  await evaluate(book => __gaiaDebug.openBook(book), kf8);
  await wait(250);
  await screenshot('initial-state');
  for (const [width, height] of [[1100, 760], [820, 620], [1280, 900]]) {
    win.setContentSize(width, height);
    await wait(180);
    for (const mode of ['single', 'spread']) {
      await evaluate(mode => __gaiaDebug.setMode(mode), mode);
      await fits('long', `KF8 long ${width}x${height} ${mode}`, 360 / 2400);
      if (width === 1100) await screenshot('long-' + mode);
    }
  }
  await evaluate(async () => { toggleReaderToc(); await __gaiaDebug.waitForReaderLayoutRefresh(); });
  await fits('long', 'KF8 long with contents open', 360 / 2400);
  await evaluate(async () => { toggleReaderToc(); await __gaiaDebug.waitForReaderLayoutRefresh(); });
  await evaluate(() => __gaiaDebug.openSettings());
  await wait(250);
  await fits('long', 'long image with settings open', 360 / 2400);
  await evaluate(() => __gaiaDebug.closeSettings());
  await wait(250);
  await evaluate(() => { state.current.paginator.setTypography({ fontSizePct: 180, lineHeight: 2.4 }); state.current.paginator.setMargin(16); state.current.paginator.setGap(48); });
  await fits('long', 'long image with large font, margins and spread gap', 360 / 2400);
  await evaluate(() => { state.current.paginator.setTypography({ fontSizePct: 100, lineHeight: 1.8 }); state.current.paginator.setMargin(8); state.current.paginator.setGap(0); });
  await evaluate(() => __gaiaDebug.jumpToMobiChapter(1));
  await fits('wide', 'wide illustration', 2400 / 360);
  const small = await geometry('small');
  check('inline small image retains authored 16px width', small.width <= 16.1 && small.height <= 8.1);
  await evaluate(() => __gaiaDebug.jumpToMobiChapter(2));
  await fits('svg-wrapper', 'inline SVG containing an image', 360 / 2400);
  await evaluate(() => __gaiaDebug.jumpToMobiChapter(3));
  await fits('nested-svg', 'external SVG containing another image', 360 / 2400);
  await screenshot('nested-svg');
  check('next/previous page returns to the same illustrated page', await evaluate(() => {
    const p = state.current.paginator;
    p.showPage(0);
    return p.next() && p.currentPage > 0 && p.prev() && p.currentPage === 0;
  }));
  await evaluate(book => __gaiaDebug.openBook(book), mobi7);
  await fits('long', 'MOBI7 long image', 360 / 2400);
  await evaluate(() => __gaiaDebug.jumpToMobiChapter(1));
  const decimal = await fits('decimal', 'MOBI7 decimal image record', 2);
  check('small standalone image is not enlarged', decimal.width <= 80.1 && decimal.height <= 40.1);

  // Exercise late loading in the production paginator, including text anchor
  // restoration and removing listeners when the reader switches chapters.
  await evaluate(async () => {
    const p = state.current.paginator;
    await p.render('<p><img id="late" src="bgm://local/__image-test-late.svg"/></p>' + Array.from({ length: 80 }, (_, i) => '<p id="p' + i + '">段落 ' + i + ' ' + '图片加载后仍应保持阅读位置。'.repeat(20) + '</p>').join(''), '');
    p.showPage(3);
    window.__imageAnchorBefore = p.anchor();
  });
  await wait(5600);
  report.lateImage = await evaluate(() => {
    const p = state.current.paginator;
    const image = p.doc.getElementById('late');
    return { complete: image.complete, width: image.naturalWidth, src: image.src, watching: !!p._imageWaitCleanup };
  });
  check('late image loaded and listener cleanup completed', await evaluate(() => {
    const p = state.current.paginator;
    return p.doc.getElementById('late').naturalWidth === 360 && !p._imageWaitCleanup;
  }));
  check('late image reflow preserves the visible text anchor', await evaluate(() => state.current.paginator.anchorInView(window.__imageAnchorBefore.off)));
  await fits('late', 'late loaded long image', 360 / 2400);
  await evaluate(async data => {
    const p = state.current.paginator;
    p.setMode('single');
    await p.render('<img src="bgm://local/__image-test-before-illustration.svg"/><p><img id="keep-image" src="' + data + '"/></p>', '');
    p.showPage(0);
  }, 'data:image/svg+xml;base64,' + picture(360, 2400).toString('base64'));
  await wait(5600);
  check('late loading also preserves an image-only page', await evaluate(() => {
    const p = state.current.paginator;
    const rect = p.doc.getElementById('keep-image').getBoundingClientRect();
    return p.currentPage > 0 && rect.left >= 0 && rect.right <= p.pageWidth && !p._imageWaitCleanup;
  }));
  check('changing chapters detaches old image listeners', await evaluate(async () => {
    const p = state.current.paginator;
    await p.render('<img src="bgm://local/__image-test-cancelled.svg"/>', '');
    const oldImage = p.doc.images[0];
    await p.render('<p id="replacement">新章节</p>', '');
    const pages = p.totalPages;
    oldImage.dispatchEvent(new Event('load'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return !p._imageWaitCleanup && p.totalPages === pages && !!p.doc.getElementById('replacement');
  }));

  const bookFlag = process.argv.indexOf('--book');
  if (bookFlag >= 0) {
    const bookPath = path.resolve(process.argv[bookFlag + 1]);
    await evaluate(book => __gaiaDebug.openBook(book), { path: bookPath, title: path.basename(bookPath), format: path.extname(bookPath).slice(1) });
    const audit = await evaluate(async () => {
      const c = state.current;
      let images = 0;
      const failures = [];
      for (let index = 0; index < c.mobi.chapters.length; index++) {
        const chapter = await window.api.mobiChapter(c.mobiSession, index);
        const doc = new DOMParser().parseFromString(chapter.html, 'text/html');
        for (const el of doc.images) {
          const img = new Image();
          img.src = el.getAttribute('src');
          try { await img.decode(); if (!img.naturalWidth) throw new Error('zero width'); }
          catch (e) { failures.push({ chapter: index, prefix: img.src.slice(0, 70) }); }
          images++;
        }
      }
      return { chapters: c.mobi.chapters.length, images, failures };
    });
    report.realBook = { path: bookPath, ...audit };
    check('every image in the real book decodes in Chromium', audit.images > 0 && audit.failures.length === 0);
    for (const chapter of [99, 101, 102].filter(index => index < audit.chapters)) {
      await evaluate(index => __gaiaDebug.jumpToMobiChapter(index), chapter);
      check('previously broken real chapter ' + chapter + ' renders decoded images', await evaluate(() => [...state.current.paginator.doc.images].every(img => img.complete && img.naturalWidth > 0)));
      const ratio = await evaluate(() => {
        const image = state.current.paginator.doc.images[0];
        if (!image) return null;
        image.id = 'real-image-probe';
        return image.naturalWidth / image.naturalHeight;
      });
      if (ratio) await fits('real-image-probe', 'real chapter ' + chapter + ' image', ratio);
    }
    await screenshot('real-mobi');
  }

  const textBook = path.join(sandbox, 'regression.txt');
  fs.writeFileSync(textBook, '第一章\n\n' + '正文排版与翻页回归验证。'.repeat(2500));
  await evaluate(book => __gaiaDebug.openBook(book), { path: textBook, title: 'TXT 回归', format: 'txt' });
  check('TXT still paginates and navigates', await evaluate(() => {
    const p = state.current.paginator;
    p.showPage(0);
    return p.totalPages > 2 && p.next() && !!p.anchor() && p.prev();
  }));
  await evaluate(book => __gaiaDebug.openBook(book), { path: path.join(project, 'tests/fixtures/sample.epub'), title: 'EPUB 回归', format: 'epub' });
  check('EPUB renderer still opens and turns pages', await evaluate(async () => {
    const r = state.current.rendition;
    await r.next();
    return r.getContents().some(content => content.document.body.textContent.trim());
  }));
  check('no renderer exceptions', report.errors.length === 0);
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => run(win).then(() => finish(), finish));
});
require('../src/main');
