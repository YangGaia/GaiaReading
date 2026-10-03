'use strict';

// Validate the delivered EXE itself with a disposable profile and no Node on
// the child PATH. Screenshots/profile are reported for inspection and cleanup.
// node scripts/packaged-runtime-smoke.js --exe=<full path to GaiaReading_Lucky.exe>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeSmokeDirectory, resolveFPath } = require('./smoke-paths');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const asar = require('@electron/asar');
const { BGM_TRACKS } = require('../src/shared/bgm');
const { STATE_FILE_NAME } = require('../src/shared/app-paths');
const root = path.resolve(__dirname, '..');
const exeArg = process.argv.find(value => value.startsWith('--exe='));
if (!exeArg) throw new Error('Specify the actual packaged EXE with --exe=');
const executable = resolveFPath(exeArg.slice(6), '交付程序');
const packageRoot = path.dirname(executable);
const profile = makeSmokeDirectory('gaia-packaged-check-');
const output = resolveFPath(process.env.GAIA_PACKAGED_OUTPUT_DIR || path.join(profile, 'screenshots'));
fs.mkdirSync(output, { recursive: true });
const report = { executable, profile, output, checks: [], screenshots: [], exceptions: [] };
const check = (label, result) => { assert.ok(result, label); report.checks.push(label); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let cdp;
let mainInspector;
let processExit;
let outputText = '';

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const waiting = new Map();
  let id = 0;
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.exceptionThrown') report.exceptions.push(data.params.exceptionDetails.text + ': ' + (data.params.exceptionDetails.exception?.description || ''));
    const request = waiting.get(data.id);
    if (!request) return;
    waiting.delete(data.id);
    if (data.error) request.reject(new Error(data.error.message));
    else request.resolve(data.result);
  });
  return {
    send(method, params = {}) {
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error(method + ' timed out')); }, 30000);
        waiting.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
    close: () => socket.close(),
  };
}

async function evaluate(fn, arg) {
  const result = await cdp.send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function run() {
  const pe = fs.readFileSync(executable);
  const header = pe.readUInt32LE(0x3c);
  check('EXE is a Windows x64 GUI executable, with no console subsystem', pe.readUInt16LE(0) === 0x5a4d && pe.readUInt32LE(header) === 0x4550 && pe.readUInt16LE(header + 4) === 0x8664 && pe.readUInt16LE(header + 24 + 68) === 2);
  const archive = path.join(packageRoot, 'resources/app.asar');
  const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  const sourceManifest = require('../package.json');
  check('Packaged version and application entry match source', packagedManifest.version === sourceManifest.version && packagedManifest.main === 'src/main.js');
  check('Browser PDF.js is packaged without the unused native node-canvas module', !asar.listPackage(archive).some(file => /^[/\\]node_modules[/\\]canvas(?:[/\\]|$)/.test(file)));
  for (const file of ['src/main.js', 'src/preload.js', 'src/metadata-worker.js', 'src/renderer/index.html', 'src/renderer/app.js', 'src/renderer/paginator.js', 'src/renderer/styles.css', 'src/renderer/tool-surfaces.css', 'src/renderer/settings.css', 'src/renderer/mouse-effects.js', 'src/shared/app-paths.js', 'src/shared/mouse-effects-scope.js']) {
    assert.deepEqual(asar.extractFile(archive, path.join(...file.split('/'))), fs.readFileSync(path.join(root, file)), file);
  }
  check('Built main, preload, metadata worker and renderer match the final source', true);
  const mediaRoot = path.join(packageRoot, 'resources/app.asar.unpacked/assets/bgm');
  for (const track of BGM_TRACKS) {
    const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(digest(path.join(mediaRoot, track.file)), digest(path.join(root, 'assets/bgm', track.file)), track.file);
  }
  check('All 59 lossless music assets match source SHA-256', BGM_TRACKS.length === 59);
  fs.writeFileSync(path.join(profile, STATE_FILE_NAME), JSON.stringify({ library: [], bgm: { on: false, muted: true, volume: 0, trackId: 'alice' }, pet: { on: false }, prefs: { theme: 'light' } }));
  const book = { path: path.join(profile, 'EXE隔离验证.txt'), title: 'EXE隔离验证', format: 'txt' };
  fs.writeFileSync(book.path, '第一章 本地运行\n\n' + '这是打包后生成的测试书籍，用来确认直接运行 EXE、导入、阅读与翻页，不读取日常书库。\n\n'.repeat(350));
  const pdfBook = { path: path.join(profile, 'EXE隔离验证.pdf'), title: 'EXE PDF 隔离验证', format: 'pdf' };
  fs.copyFileSync(path.join(root, 'tests/fixtures/sample.pdf'), pdfBook.path);
  const env = { ...process.env, GAIA_USER_DATA_DIR: profile, GAIA_SESSION_DATA_DIR: path.join(profile, 'session'),
    TEMP: profile, TMP: profile, TMPDIR: profile,
    PATH: [process.env.SystemRoot, path.join(process.env.SystemRoot, 'System32')].join(';') };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.PORTABLE_EXECUTABLE_DIR;
  child = spawn(executable, [`--user-data-dir=${profile}`, '--inspect=0', '--remote-debugging-port=0', '--disable-backgrounding-occluded-windows', '--force-device-scale-factor=1'], { env, cwd: packageRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  processExit = new Promise(resolve => { child.once('error', error => resolve({ error })); child.once('exit', (code, signal) => resolve({ code, signal })); });
  child.stdout.on('data', chunk => { outputText += chunk; });
  child.stderr.on('data', chunk => { outputText += chunk; });
  const activePortFile = path.join(env.GAIA_SESSION_DATA_DIR, 'DevToolsActivePort');
  for (let i = 0; i < 400 && !fs.existsSync(activePortFile); i++) {
    if (child.exitCode != null) throw new Error('Packaged app exited during startup: ' + outputText.slice(-1800));
    await wait(50);
  }
  assert.ok(fs.existsSync(activePortFile), 'Packaged app must expose the requested isolated debugging port');
  const mainInspectorUrl = outputText.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];
  assert.ok(mainInspectorUrl, 'Packaged main process exposes the local inspection port');
  mainInspector = await connect(mainInspectorUrl);
  const mainState = await mainInspector.send('Runtime.evaluate', {
    expression: "Object.fromEntries(['userData', 'sessionData', 'temp', 'logs', 'crashDumps', 'appData'].map(name => [name, process.mainModule.require('electron').app.getPath(name)]))",
    returnByValue: true,
  });
  if (mainState.exceptionDetails) throw new Error(mainState.exceptionDetails.exception?.description || mainState.exceptionDetails.text);
  report.mainProcessPaths = mainState.result.value;
  check('Actual packaged main-process writable paths all remain on F', Object.values(report.mainProcessPaths).every(directory => /^f:[\\/]/i.test(directory)));
  check('Actual packaged user and session profiles match the isolated launch arguments',
    path.resolve(report.mainProcessPaths.userData) === profile && path.resolve(report.mainProcessPaths.sessionData) === path.join(profile, 'session'));
  mainInspector.close();
  mainInspector = null;
  const port = fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0];
  let page;
  for (let i = 0; i < 200 && !page; i++) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
    page = targets.find(target => target.type === 'page' && target.url.includes('/renderer/index.html'));
    if (!page) await wait(50);
  }
  assert.ok(page, 'Packaged renderer page exists');
  cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  for (let i = 0; i < 200 && !await evaluate(() => typeof window.__gaiaDebug === 'object'); i++) await wait(50);
  assert.ok(await evaluate(() => typeof window.__gaiaDebug === 'object'), 'Packaged renderer scripts initialize');
  await evaluate(async () => { await __gaiaDebug.waitHome(); await document.fonts.ready; });
  check('EXE launches with only Windows system folders on PATH', await evaluate(() => __gaiaDebug.getView() === 'home' && __gaiaDebug.getLibraryCount() === 0));
  check('Packaged UI displays the release version', await evaluate(version => document.querySelector('.drawer-about').textContent.includes(version), sourceManifest.version));
  check('Packaged mouse effects select the graphics backend reported by Electron', await evaluate(async () =>
    __gaiaDebug.getFxState().softwareRendering === await window.api.softwareRendering()));
  check('Packaged navigation preserves the active click animation', await evaluate(async () => {
    __gaiaDebug.clearFx(); __gaiaDebug.burst(230, 260);
    const before = __gaiaDebug.getParticleCount(); __gaiaDebug.showView('library');
    const retained = __gaiaDebug.getParticleCount() === before && before > 0;
    await new Promise(resolve => setTimeout(resolve, 80));
    const canvas = document.getElementById('fx-canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 24) painted += 1;
    __gaiaDebug.clearFx();
    return retained && painted > 20;
  }));
  await evaluate(async bookPath => __gaiaDebug.importPaths([bookPath]), book.path);
  check('Packaged metadata subprocess imports without system Node', await evaluate(() => __gaiaDebug.getLibraryCount() === 1));
  await evaluate(async book => __gaiaDebug.openBook(book), book);
  for (let i = 0; i < 100 && !await evaluate(() => __gaiaDebug.getPaginatorTotal() > 1); i++) await wait(30);
  check('Packaged TXT reader paginates', await evaluate(() => __gaiaDebug.getPaginatorTotal() > 1));
  check('Packaged reflowable reader fills columns in order with complete-line defaults', await evaluate(() => {
    const frame = document.querySelector('.paginator-frame:not(.paginator-pending)');
    const style = frame.contentWindow.getComputedStyle(frame.contentDocument.body);
    return style.columnFill === 'auto' && style.widows === '1' && style.orphans === '1';
  }));
  check('Packaged reader uses the requested AI labels and exactly three full-row settings tools', await evaluate(() => {
    __gaiaDebug.openSettings();
    const group = document.querySelector('#drawer-funcs .drawer-tools');
    const buttons = [...group.querySelectorAll('button')];
    const width = group.getBoundingClientRect().width;
    const boxes = buttons.map(button => button.getBoundingClientRect());
    const pass = document.querySelector('#btn-ai-reader .reader-label-compact').textContent === 'AI对话' &&
      document.querySelector('#btn-alice-comment .alice-action-text').textContent === '有珠吐槽' &&
      !document.getElementById('btn-ai-assistant') && buttons.length === 3 &&
      boxes.every((box, i) => Math.abs(box.width - width) < 1 && (!i || box.top >= boxes[i - 1].bottom));
    __gaiaDebug.closeSettings();
    return pass;
  }));
  const before = await evaluate(() => __gaiaDebug.getPaginatorPage());
  await evaluate(async () => { await __gaiaDebug.nextPage(); });
  await wait(350);
  check('Packaged reader turns pages', await evaluate(() => __gaiaDebug.getPaginatorPage()) > before);
  check('Packaged AI chat has no idle hint, keeps its window size, and grows then contracts the input', await evaluate(() => {
    __gaiaDebug.openAiAssistant();
    const panel = document.getElementById('ai-summary-panel');
    const input = document.getElementById('ai-chat-input');
    const status = document.getElementById('ai-summary-status');
    const rect = panel.getBoundingClientRect();
    const single = input.offsetHeight;
    const idle = !status.textContent && !status.getBoundingClientRect().height && !panel.textContent.includes('可以直接提问，或先选择一条快捷指令。');
    input.value = '第一行\n第二行\n第三行\n第四行';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const grown = input.offsetHeight > single + 15 && input.offsetHeight <= 96;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const after = panel.getBoundingClientRect();
    const pass = idle && grown && input.offsetHeight === single && rect.width === after.width && rect.height === after.height;
    document.getElementById('btn-ai-summary-close').click();
    return pass;
  }));
  check('Packaged AI window reaches all reader edges without covering either toolbar', await evaluate(() => {
    __gaiaDebug.openAiAssistant();
    const panel = document.getElementById('ai-summary-panel');
    const rect = panel.getBoundingClientRect(), body = document.getElementById('reader-body').getBoundingClientRect();
    applyAiPanelGeometry({ left: body.left - 1000, top: body.top - 1000, width: rect.width, height: rect.height });
    const topLeft = panel.getBoundingClientRect();
    const clampsTopLeft = Math.abs(topLeft.left - body.left) < 1 && Math.abs(topLeft.top - body.top) < 1;
    applyAiPanelGeometry({ left: body.right + 1000, top: body.bottom + 1000, width: rect.width, height: rect.height });
    saveAiPanelGeometry();
    document.getElementById('btn-ai-summary-close').click();
    __gaiaDebug.openAiAssistant();
    const restored = panel.getBoundingClientRect();
    return clampsTopLeft && getComputedStyle(panel).position === 'fixed' && Math.abs(restored.right - body.right) < 1 &&
      Math.abs(restored.bottom - body.bottom) < 1 && restored.left >= body.left - 1 && restored.top >= body.top - 1 && body.top > 0 && body.bottom < innerHeight;
  }));
  const intendedAiGeometry = await evaluate(() => JSON.stringify(state.prefs.aiWindow));
  const readAiGeometry = () => evaluate(() => {
    const r = document.getElementById('ai-summary-panel').getBoundingClientRect(), b = document.getElementById('reader-body').getBoundingClientRect();
    return { panel: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      reader: { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, saved: JSON.stringify(state.prefs.aiWindow), viewportWidth: innerWidth, viewportHeight: innerHeight,
      contained: r.left >= b.left - 1 && r.top >= b.top - 1 && r.right <= b.right + 1 && r.bottom <= b.bottom + 1 };
  });
  const settleAiGeometry = async () => {
    await wait(350);
    for (let i = 0; i < 80; i++) { if ((await readAiGeometry()).contained) return; await wait(50); }
    throw new Error('Packaged AI panel did not settle inside reader-body');
  };
  mainInspector = await connect(mainInspectorUrl);
  const inspectWindow = async (fn, value) => {
    const result = await mainInspector.send('Runtime.evaluate', {
      expression: `(${fn.toString()})(process.mainModule.require('electron').BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/renderer/index.html')), ${JSON.stringify(value)})`, returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const originalWindow = await inspectWindow(window => ({ size: window.getContentSize(), zoom: window.webContents.getZoomFactor() }));
  report.aiWindowGeometry = { original: await readAiGeometry() };
  try {
    await inspectWindow(window => { window.setContentSize(800, 600); });
    await settleAiGeometry();
    await evaluate(() => { document.getElementById('btn-ai-summary-close').click(); __gaiaDebug.openAiAssistant(); });
    await settleAiGeometry();
    report.aiWindowGeometry.small = await readAiGeometry();
    check('Packaged AI panel stays within reader-body after shrinking and reopening', report.aiWindowGeometry.small.contained && report.aiWindowGeometry.small.saved === intendedAiGeometry);
    await inspectWindow(window => { window.webContents.setZoomFactor(1.25); });
    await settleAiGeometry();
    await evaluate(() => { document.getElementById('btn-ai-summary-close').click(); __gaiaDebug.openAiAssistant(); });
    await settleAiGeometry();
    report.aiWindowGeometry.zoomed = await readAiGeometry();
    check('Packaged AI panel stays within reader-body when zoomed and reopened', report.aiWindowGeometry.zoomed.contained && report.aiWindowGeometry.zoomed.viewportWidth < report.aiWindowGeometry.small.viewportWidth && report.aiWindowGeometry.zoomed.saved === intendedAiGeometry);
  } finally {
    await inspectWindow((window, previous) => { window.webContents.setZoomFactor(previous.zoom); window.setContentSize(...previous.size); }, originalWindow);
    mainInspector.close(); mainInspector = null;
  }
  await settleAiGeometry();
  report.aiWindowGeometry.restored = await readAiGeometry();
  check('Packaged resize and zoom restore the intended AI rectangle inside the reader', report.aiWindowGeometry.restored.contained && report.aiWindowGeometry.restored.saved === intendedAiGeometry && ['left', 'top', 'width', 'height'].every(key => Math.abs(report.aiWindowGeometry.restored.panel[key] - report.aiWindowGeometry.original.panel[key]) <= 1));
  await cdp.send('Page.bringToFront');
  await wait(200);
  const aiScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const aiPicture = path.join(output, 'packaged-ai-window.png');
  fs.writeFileSync(aiPicture, Buffer.from(aiScreenshot.data, 'base64'));
  report.screenshots.push(aiPicture);
  await evaluate(() => document.getElementById('btn-ai-summary-close').click());
  check('Packaged reader searches book content', await evaluate(async () => (await __gaiaDebug.runBookSearch('本地')).results > 0));
  check('Music list and native FLAC decoding work from app.asar.unpacked', await evaluate(async () => {
    __gaiaDebug.closeBookSearch();
    document.querySelector('.bgm-title').click();
    const listVisible = document.getElementById('bgm-playlist').matches(':popover-open') && document.querySelectorAll('[data-track-id]').length === 59;
    document.getElementById('bgm-playlist').hidePopover();
    const audio = new Audio(); audio.muted = true;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Packaged FLAC load timed out')), 7000);
      audio.addEventListener('loadeddata', () => { clearTimeout(timer); const ok = listVisible && audio.duration > 20; audio.removeAttribute('src'); audio.load(); resolve(ok); }, { once: true });
      audio.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Packaged FLAC decode failed')); }, { once: true });
      audio.src = 'bgm://local/' + GaiaBgm.getTracks()[0].file;
    });
  }));
  await evaluate(async bookPath => __gaiaDebug.importPaths([bookPath]), pdfBook.path);
  check('Packaged PDF imports through the metadata subprocess', await evaluate(() => __gaiaDebug.getLibraryCount() === 2));
  await evaluate(async book => { __gaiaDebug.setMode('single'); await __gaiaDebug.openBook(book); }, pdfBook);
  check('Packaged browser PDF.js paints PDF text using Chromium Canvas', await evaluate(() => {
    const canvas = document.querySelector('.pdf-spread:not(.is-preparing) .pdf-canvas-base');
    const pixels = canvas && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels || !document.querySelector('.pdf-text-layer').textContent.trim()) return false;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100 && pixels[i + 3] > 100) return true;
    return false;
  }));
  const pdfBefore = await evaluate(() => __gaiaDebug.getReaderLayoutState());
  await evaluate(async () => { await __gaiaDebug.nextPage(); });
  check('Packaged PDF advances to the next rendered page', await evaluate(() => __gaiaDebug.getReaderLayoutState().pdfVisiblePages[0]) > pdfBefore.pdfVisiblePages[0]);
  await evaluate(() => { __gaiaDebug.setPdfZoom(1.2); });
  for (let i = 0; i < 100 && !await evaluate(() => Math.abs(__gaiaDebug.getReaderLayoutState().pdfScale - 1.2) < 0.01); i++) await wait(50);
  check('Packaged PDF zoom redraws at the requested scale', await evaluate(() => Math.abs(__gaiaDebug.getReaderLayoutState().pdfScale - 1.2) < 0.01 && !!document.querySelector('.pdf-spread:not(.is-preparing) .pdf-canvas-base')));
  await cdp.send('Page.bringToFront');
  await wait(200);
  const pdfScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const pdfPicture = path.join(output, 'packaged-pdf.png');
  fs.writeFileSync(pdfPicture, Buffer.from(pdfScreenshot.data, 'base64'));
  report.screenshots.push(pdfPicture);
  await evaluate(async () => { await __gaiaDebug.backToLibrary(); __gaiaDebug.showView('home'); await new Promise(resolve => setTimeout(resolve, 400)); });
  await cdp.send('Page.bringToFront');
  await wait(200);
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const picture = path.join(output, 'packaged-home.png');
  fs.writeFileSync(picture, Buffer.from(screenshot.data, 'base64'));
  report.screenshots.push(picture);
  check('No renderer exceptions during packaged launch/import/read/music checks', report.exceptions.length === 0);
  check('Test data remains exclusively in its explicitly isolated profile', JSON.parse(fs.readFileSync(path.join(profile, STATE_FILE_NAME), 'utf8')).library.length === 2);
}

(async () => {
  try { await run(); report.passed = true; }
  catch (error) { report.passed = false; report.error = error.stack || String(error); }
  finally {
    if (mainInspector) mainInspector.close();
    if (cdp) { await cdp.send('Page.close').catch(() => {}); cdp.close(); }
    if (child && child.exitCode == null) {
      await Promise.race([processExit, wait(3000)]);
      if (child.exitCode == null) { child.kill(); await processExit; }
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, 'process.log'), outputText);
    console.log(JSON.stringify(report));
    process.exitCode = report.passed ? 0 : 1;
  }
})();
