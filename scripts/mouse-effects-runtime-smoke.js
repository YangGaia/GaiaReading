'use strict';

// Run with: npx electron scripts/mouse-effects-runtime-smoke.js
// A fresh userData directory and a generated fixture keep real books untouched.
// GAIA_MOUSE_FX_OUTPUT_DIR overrides the screenshot/report directory.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { makeSmokeDirectory, configureSmokePaths, resolveFPath } = require('./smoke-paths');
const path = require('node:path');
const { STATE_FILE_NAME } = require('../src/shared/app-paths');

const sandbox = makeSmokeDirectory('gaia-mouse-fx-');
const outputDir = resolveFPath(process.env.GAIA_MOUSE_FX_OUTPUT_DIR || path.join(sandbox, 'screenshots'));
fs.mkdirSync(outputDir, { recursive: true });
configureSmokePaths(app, { userData: sandbox });
app.setAppPath(path.join(__dirname, '..'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
fs.writeFileSync(path.join(sandbox, STATE_FILE_NAME), JSON.stringify({
  library: [], prefs: { theme: 'light' }, pet: { auto: false, autoSpeech: false, autoSleep: false },
}));
const fixture = path.join(sandbox, '银尘星轨测试.txt');
fs.writeFileSync(fixture, '银尘星轨测试\n\n第一章\n\n' + Array.from({ length: 150 }, (_, i) => `第${i}段：这是隔离测试生成的书籍，不读取用户书库。银色星尘只出现在工具区域，正文选字和滚轮翻页保持正常。`).join('\n\n'));

const started = Date.now();
const report = { userData: sandbox, outputDir, checks: [], screenshots: [], samples: [], consoleErrors: [] };
let finished = false;
const timeout = setTimeout(() => finish(new Error('Mouse effects runtime smoke timed out after 120 seconds')), 120000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  report.passed = !error;
  report.elapsedMs = Date.now() - started;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots.length,
    elapsedMs: report.elapsedMs, outputDir, error: report.error }, null, 2));
  app.exit(error ? 1 : 0);
}

// Hidden Windows windows can stop presenting animation frames. Paint without
// taking focus from the user and keep Chromium's background timer active.
BrowserWindow.prototype.show = function () { this.showInactive(); };
let attached = false;
app.on('browser-window-created', (_event, win) => {
  if (attached) return;
  attached = true;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) report.consoleErrors.push(message);
  });
  win.webContents.once('did-finish-load', () => run(win).then(() => finish(), async error => {
    try {
      const target = path.join(outputDir, 'failure.png');
      fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG());
      report.screenshots.push(target);
      report.failureState = await win.webContents.executeJavaScript('JSON.stringify({ view: __gaiaDebug.getView(), fx: __gaiaDebug.getFxState(), paginator: __gaiaDebug.getPaginatorLayout() })');
    } catch (_) {}
    finish(error);
  }));
});

async function run(win) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const check = (name, result) => { assert.ok(result, name); report.checks.push(name); };
  const state = () => evaluate(() => ({ ...__gaiaDebug.getFxState(), loop: __gaiaDebug.isFxLoopRunning(),
    count: __gaiaDebug.getParticleCount(), debugActive: __gaiaDebug.isFxActive(), view: __gaiaDebug.getView() }));
  const move = (x, y) => win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
  const clickAt = async (x, y) => {
    move(x, y);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    await wait(45);
  };
  const clickControl = async (selector) => {
    const point = await evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el || !el.getClientRects().length) throw new Error(`${selector} is not visible`);
      const r = el.getBoundingClientRect();
      const x = (r.left + r.right) / 2;
      const y = (r.top + r.bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit !== el && !el.contains(hit)) throw new Error(`${selector} is covered by ${hit && (hit.id || hit.className)}`);
      return { x, y };
    }, selector);
    await clickAt(point.x, point.y);
    await wait(220);
  };
  const canvasSample = () => evaluate(() => {
    const canvas = document.getElementById('fx-canvas');
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    let silver = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 24) continue;
      painted += 1;
      // Silver may be cool blue or slightly warm. Strong saturated rainbow
      // colors from the old mouse effect must not dominate the painted pixels.
      const rgb = [data[i], data[i + 1], data[i + 2]];
      if (Math.min(...rgb) >= 145 && Math.max(...rgb) - Math.min(...rgb) <= 75) silver += 1;
      const x = (i / 4) % canvas.width;
      const y = Math.floor(i / 4 / canvas.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const rect = canvas.getBoundingClientRect();
    return { painted, silver, silverFraction: painted ? silver / painted : 0,
      bounds: painted ? [minX, minY, maxX, maxY] : null,
      backing: [canvas.width, canvas.height], css: [rect.width, rect.height],
      viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      pointerEvents: getComputedStyle(canvas).pointerEvents, hidden: canvas.hidden };
  });
  const bounds = selector => evaluate(selector => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);
  const paintedWithin = area => evaluate(area => {
    const canvas = document.getElementById('fx-canvas');
    const x = Math.max(0, Math.ceil(area.left * devicePixelRatio));
    const y = Math.max(0, Math.ceil(area.top * devicePixelRatio));
    const w = Math.min(canvas.width - x, Math.floor(area.width * devicePixelRatio));
    const h = Math.min(canvas.height - y, Math.floor(area.height * devicePixelRatio));
    if (w <= 0 || h <= 0) return 0;
    const data = canvas.getContext('2d').getImageData(x, y, w, h).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] >= 24) painted += 1;
    return painted;
  }, area);
  const capture = async (name) => {
    const shot = await win.webContents.capturePage();
    const target = path.join(outputDir, name + '.png');
    fs.writeFileSync(target, shot.toPNG());
    report.screenshots.push(target);
  };
  const exercise = async (name, selector) => {
    await evaluate(() => __gaiaDebug.clearFx());
    const viewport = await evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const area = selector ? await bounds(selector) : { left: 0, top: 0, width: viewport.w, height: viewport.h };
    const y = Math.round(area.top + area.height * .47);
    for (let i = 0; i < 17; i += 1) {
      move(area.left + area.width * (.22 + i * .02), y + Math.sin(i / 3) * Math.min(27, area.height * .16));
      await wait(18);
    }
    const trail = await state();
    check(`${name}: real mouse movement produces particles and runs animation`, trail.count > 0 && trail.loop);
    await clickAt(area.left + area.width * .51, y + Math.min(10, area.height * .1));
    const burst = await state();
    check(`${name}: real mouse click adds a visible burst`, burst.count > trail.count);
    await capture(name + '-silver-star-trail-click');
    const pixels = await canvasSample();
    report.samples.push({ name, state: burst, canvas: pixels });
    check(`${name}: canvas paints visible silver particles`, pixels.painted >= 12 && pixels.silverFraction > .8);
    check(`${name}: canvas does not intercept mouse input`, pixels.pointerEvents === 'none');
  };
  const geometry = async (name) => {
    await wait(130);
    const pixels = await canvasSample();
    const fx = await state();
    report.samples.push({ name, state: fx, canvas: pixels });
    check(`${name}: canvas covers CSS viewport`, pixels.css.every((n, i) => Math.abs(n - pixels.viewport[i]) <= 1));
    check(`${name}: canvas backing tracks device pixel ratio`, pixels.backing.every((n, i) => Math.abs(n - pixels.viewport[i] * pixels.dpr) <= 1));
    check(`${name}: effect coordinates remain CSS pixels`, Math.abs(fx.width - pixels.viewport[0]) <= 1 && Math.abs(fx.height - pixels.viewport[1]) <= 1);
  };

  win.setContentSize(1100, 760);
  win.showInactive();
  await evaluate(async () => { await __gaiaDebug.waitHome(); });
  check('application keeps the isolated userData directory', path.resolve(app.getPath('userData')) === path.resolve(sandbox));
  const initial = await state();
  check('selected effect is silver stardust at 100% intensity and 150% size', initial.id === 2 && initial.intensity === 1 && initial.scale === 1.5);
  check('home enables the effects canvas', initial.view === 'home' && initial.debugActive);
  await geometry('initial home');
  await exercise('home');
  await clickControl('#bgm-capsule .bgm-title');
  check('music list opens as a browser top-layer popover', await evaluate(() => document.getElementById('bgm-playlist').matches(':popover-open')));
  await exercise('music-playlist', '.bgm-playlist-header');
  check('the effects canvas shares the top layer above the still-open music list', await evaluate(() =>
    document.getElementById('fx-canvas').matches(':popover-open') && document.getElementById('bgm-playlist').matches(':popover-open')));
  await clickControl('#bgm-playlist [data-action="close-playlist"]');
  check('music list close button remains clickable through top-layer effects', await evaluate(() => !document.getElementById('bgm-playlist').matches(':popover-open')));

  await clickControl('#btn-home-settings');
  check('real settings button click passes through effects canvas', await evaluate(() => __gaiaDebug.isSettingsOpen()));
  await exercise('settings', '#settings-drawer .drawer-head');
  await clickControl('#btn-settings-close');
  await clickControl('#btn-home-shelf');
  check('real shelf button click passes through effects canvas', await evaluate(() => __gaiaDebug.getView() === 'library'));
  check('the click burst stays visible after the shelf button changes the view', (await state()).count > 0 && (await canvasSample()).painted > 0);
  await capture('library-entry-click-continues');
  await evaluate(async (fixture) => { await __gaiaDebug.addToLibrary({ path: fixture, title: '银尘星轨测试', author: '隔离测试', format: 'txt' }); }, fixture);
  await exercise('library');

  for (const view of ['stats', 'ai']) {
    const navigation = await evaluate((view) => {
      __gaiaDebug.showView('home'); __gaiaDebug.clearFx(); __gaiaDebug.burst(220, 240);
      const before = __gaiaDebug.getParticleCount(); __gaiaDebug.showView(view);
      return { before, after: __gaiaDebug.getParticleCount() };
    }, view);
    const fx = await state();
    check(`${view}: entering preserves the complete active click burst`, fx.view === view && fx.debugActive && fx.count > 0 && fx.loop && navigation.before === navigation.after);
    await wait(250);
    await exercise(view);
  }

  await evaluate(async fixture => {
    await __gaiaDebug.openBook(__gaiaDebug.getLibrary().find(book => book.path === fixture));
  }, fixture);
  await wait(500);
  check('reader chrome keeps effects enabled', (await state()).debugActive);
  await exercise('reader-header', '#reader-title');
  await exercise('reader-footer', '#reader-status');
  await clickControl('#bgm-capsule .bgm-title');
  await exercise('reader-music-playlist', '.bgm-playlist-header');
  const readerPlaylist = await bounds('#bgm-playlist');
  check('music list above the protected reader body paints effects', await paintedWithin(readerPlaylist) > 0);
  await clickControl('#bgm-playlist [data-action="close-playlist"]');

  const reader = await bounds('#reader-content');
  await evaluate(() => __gaiaDebug.clearFx());
  await clickAt(reader.left + reader.width / 2, reader.top - 5);
  await wait(100);
  check('a burst next to the reader remains visible on chrome', (await canvasSample()).painted > 0);
  check('moving particles are clipped from the entire book body including margins', await paintedWithin({ left: reader.left + 1, top: reader.top + 1, width: reader.width - 2, height: reader.height - 2 }) === 0);
  move(reader.left + reader.width / 2, reader.top + reader.height / 2);
  await wait(80);
  check('entering a book iframe lets existing UI stars finish while the book stays clear', (await state()).count > 0 && await paintedWithin({ left: reader.left + 1, top: reader.top + 1, width: reader.width - 2, height: reader.height - 2 }) === 0);
  const beforeBodyClick = (await state()).count;
  await clickAt(reader.left + reader.width / 2 + 25, reader.top + reader.height / 2);
  check('real iframe clicks do not add new particles', (await state()).count <= beforeBodyClick);
  await evaluate(() => __gaiaDebug.clearFx());

  // Use native Chromium selection in the real book iframe and then exercise
  // the resulting application toolbar over the protected book surface.
  const textRange = await evaluate(() => {
    const frame = document.querySelector('#reader-content iframe');
    const doc = frame.contentDocument;
    const frameRect = frame.getBoundingClientRect();
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim().length < 12) continue;
      const range = doc.createRange(); range.setStart(node, 0); range.setEnd(node, 10);
      const r = range.getBoundingClientRect();
      if (r.width <= 0 || r.left < 0 || r.top < 0 || r.bottom > frameRect.height) continue;
      return { x1: frameRect.left + r.left + 1, x2: frameRect.left + r.right - 1, y: frameRect.top + (r.top + r.bottom) / 2 };
    }
    throw new Error('No visible fixture text for selection');
  });
  move(textRange.x1, textRange.y);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(textRange.x1), y: Math.round(textRange.y), button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i += 1) { move(textRange.x1 + (textRange.x2 - textRange.x1) * i / 8, textRange.y); await wait(15); }
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(textRange.x2), y: Math.round(textRange.y), button: 'left', clickCount: 1 });
  await wait(150);
  check('native book text selection remains functional', await evaluate(() => document.querySelector('#reader-content iframe').contentDocument.getSelection().toString().length > 3));
  check('selecting book text does not create particles', (await state()).count === 0);
  const selection = await bounds('#selection-toolbar');
  await clickAt(selection.left + selection.width / 2, selection.top + 3);
  check('selection toolbar above book text paints mouse effects', await paintedWithin(selection) > 0);
  await capture('selection-toolbar-silver-star-click');
  await clickAt(reader.left + reader.width / 2, reader.top + reader.height / 2);
  const beforeWheel = await evaluate(() => __gaiaDebug.getPaginatorLayout().page);
  win.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(reader.left + reader.width / 2), y: Math.round(reader.top + reader.height / 2), deltaY: -180, canScroll: true });
  await wait(350);
  check('book wheel still turns a page without painting the book', await evaluate(before => __gaiaDebug.getPaginatorLayout().page > before, beforeWheel) && await paintedWithin({ left: reader.left + 1, top: reader.top + 1, width: reader.width - 2, height: reader.height - 2 }) === 0);

  await clickControl('#btn-ai-reader');
  await exercise('reader-ai-panel', '.ai-summary-head');
  await clickControl('#ai-chat-input');
  await win.webContents.insertText('隔离输入检查');
  await wait(60);
  check('AI input receives real typing through the effects canvas', await evaluate(() => document.getElementById('ai-chat-input').value.includes('隔离输入检查')));
  await clickControl('#btn-ai-summary-close');
  await clickControl('#btn-book-search');
  await exercise('reader-search-panel', '.book-search-head');
  await clickControl('#btn-book-search-close');
  await clickControl('#btn-settings-reader');
  await exercise('reader-settings', '#settings-drawer .drawer-head');
  check('settings effects are rendered above the drawer', await evaluate(() => Number(getComputedStyle(document.getElementById('fx-canvas')).zIndex) > Number(getComputedStyle(document.getElementById('settings-overlay')).zIndex)));
  await clickControl('#btn-settings-close');

  await evaluate(async file => {
    await __gaiaDebug.importPaths([file]);
    await __gaiaDebug.openBook(__gaiaDebug.getLibrary().find(book => book.path === file));
  }, path.resolve(__dirname, '../tests/fixtures/sample.pdf'));
  await wait(350);
  check('PDF fixture opens in the real reader', await evaluate(() => !!document.querySelector('#reader-content .pdf-page')));
  await exercise('pdf-reader-header', '#reader-title');
  const pdf = await bounds('#reader-content');
  const beforePdfClick = (await state()).count;
  await clickAt(pdf.left + pdf.width / 2, pdf.top + pdf.height / 2);
  check('PDF page input adds no particles and the book stays clear', (await state()).count <= beforePdfClick && await paintedWithin({ left: pdf.left + 1, top: pdf.top + 1, width: pdf.width - 2, height: pdf.height - 2 }) === 0);

  await evaluate(() => __gaiaDebug.showView('home'));
  await wait(220);
  await clickAt(300, 300);
  const restored = await state();
  check('returning home restores real mouse effects', restored.active && restored.count > 0 && restored.loop);
  await wait(2800);
  const idle = await state();
  check('particles expire naturally and stop requestAnimationFrame', idle.count === 0 && !idle.loop);
  check('expired effects leave a transparent canvas', (await canvasSample()).painted === 0);

  for (const [width, height] of [[900, 640], [1440, 900]]) {
    win.setContentSize(width, height);
    await geometry(`window ${width}x${height}`);
  }
  win.setContentSize(1100, 760);
  win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: 1100, height: 760 },
    deviceScaleFactor: 2, viewPosition: { x: 0, y: 0 }, viewSize: { width: 1100, height: 760 }, scale: 1 });
  await geometry('DPR 2');
  check('DPR 2 is exercised in the real renderer', await evaluate(() => devicePixelRatio === 2));
  await evaluate(() => __gaiaDebug.clearFx());
  await clickAt(370, 310);
  const highDpi = await canvasSample();
  report.samples.push({ name: 'DPR 2 click alignment', canvas: highDpi });
  check('DPR 2 click paints near the real input coordinates', highDpi.bounds &&
    Math.abs((highDpi.bounds[0] + highDpi.bounds[2]) / 4 - 370) < 70 &&
    Math.abs((highDpi.bounds[1] + highDpi.bounds[3]) / 4 - 310) < 70);
  await capture('home-dpr2-silver-star-click');
  win.webContents.disableDeviceEmulation();
  await evaluate(() => __gaiaDebug.clearFx());
  check('explicit clear removes particles and stops animation', (await state()).count === 0 && !(await state()).loop);
  check('no renderer exceptions', report.consoleErrors.filter((message) => /(?:Uncaught|ReferenceError|TypeError|SyntaxError)/.test(message)).length === 0);
}

require('../src/main');
