'use strict';

// Driven by import-smoke.ps1: real mouse events, visible window, native Windows dialogs.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const JSZip = require('jszip');
const { pathKey } = require('../src/shared/book-import');

const root = path.join(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-native-import-'));
const output = path.resolve(process.env.GAIA_IMPORT_OUTPUT || path.join(root, 'dist/previews/import-smoke'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', sandbox);
app.setPath('sessionData', path.join(sandbox, 'session'));
app.setAppPath(root);
const stateFile = path.join(sandbox, 'gaia-reading.json');
if (process.env.GAIA_IMPORT_COPY_USER_DATA === '1') {
  fs.copyFileSync(path.join(app.getPath('appData'), 'gaia-reading', 'gaia-reading.json'), stateFile);
}
const original = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const initialLibrary = original.library || [];
const report = { passed: false, source: process.env.GAIA_IMPORT_BOOKS_DIR ? 'local-books' : 'generated-fixtures', initialBooks: initialLibrary.length, checks: [], screenshots: [], errors: [] };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => finish(new Error('Native import test timed out')), 180000);
let finished = false;
let window;

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output, error: report.error }));
  app.exit(error ? 1 : 0);
}
function check(name, result) { assert.ok(result, name); report.checks.push(name); }
const evaluate = (fn, arg) => window.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
async function until(fn, limit = 30000) {
  const start = Date.now();
  while (Date.now() - start < limit) { if (await fn()) return; await wait(80); }
  throw new Error('Timed out waiting for import UI');
}
async function click(selector) {
  const point = await evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element || !element.getClientRects().length || element.disabled) throw new Error('Button unavailable: ' + selector);
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  }, selector);
  window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  await wait(100);
}
async function capture(name) {
  const file = path.join(output, name + '.png');
  fs.writeFileSync(file, (await window.webContents.capturePage()).toPNG());
  report.screenshots.push(file);
}
async function select(id, paths, folder = false) {
  const onHome = await evaluate(() => !document.getElementById('home-view').hidden);
  await click(onHome ? '#btn-home-add-books' : '#btn-add-books');
  await click(folder ? '#btn-import-folder' : '#btn-import-file-picker');
  fs.writeFileSync(path.join(output, 'control.json'), JSON.stringify({ id, pid: process.pid, paths, folder, title: folder ? '选择电子书文件夹' : '选择电子书文件' }));
}
async function waitForIdle() {
  await until(() => evaluate(() => !document.getElementById('btn-add-books').disabled), 60000);
  const status = await evaluate(() => document.getElementById('import-status').textContent);
  check('import reports a result: ' + status.slice(0, 60), !!status);
  check('cancel control hides on completion', await evaluate(() => document.getElementById('btn-cancel-import').hidden));
  const books = await evaluate(() => __gaiaDebug.getLibrary().map((book) => book.path));
  check('visible library matches saved checkpoints', JSON.stringify(books) === JSON.stringify(JSON.parse(fs.readFileSync(stateFile, 'utf8')).library.map((book) => book.path)));
  return books;
}

async function run() {
  await evaluate(() => __gaiaDebug.waitHome());
  window.show();
  window.focus();
  check('normal window is visible', window.isVisible());
  let directory = process.env.GAIA_IMPORT_BOOKS_DIR;
  if (!directory) {
    directory = path.join(sandbox, 'books');
    fs.mkdirSync(directory);
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('content.opf', '<package><metadata><dc:title>批量导入验证</dc:title></metadata><manifest/></package>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(directory, String(i).padStart(2, '0') + '.epub'), buffer);
    fs.writeFileSync(path.join(directory, '15-broken.epub'), 'invalid EPUB');
    fs.writeFileSync(path.join(directory, '31.txt'), '第一章\n测试正文');
    fs.writeFileSync(path.join(directory, '32.pdf'), '%PDF-1.4\n%%EOF');
  }
  const imported = new Set(initialLibrary.map((book) => pathKey(book.path)));
  const epubs = fs.readdirSync(directory).filter((name) => /\.epub$/i.test(name) && !name.includes('broken')).map((name) => path.join(directory, name)).filter((file) => !imported.has(pathKey(file)));
  assert.ok(epubs.length >= 6, 'at least six new EPUBs are required');
  const first = epubs.slice(0, 3);
  await select('first-three', first);
  await until(() => evaluate(() => document.getElementById('home-view').hidden), 90000);
  let books = await waitForIdle();
  check('three EPUBs imported from native file dialog on home', first.every((file) => books.includes(file)) && books.length === initialLibrary.length + 3);
  await capture('three-epubs');
  const second = epubs.slice(3, 6);
  await select('second-three', second);
  books = await waitForIdle();
  check('another three EPUBs imported from library', second.every((file) => books.includes(file)) && books.length === initialLibrary.length + 6);
  // Re-import the same files through the native picker and verify no duplicates.
  await select('duplicates', first);
  books = await waitForIdle();
  check('duplicate selection does not add books', books.length === initialLibrary.length + 6);

  await select('folder', [directory], true);
  await until(() => evaluate(() => !document.getElementById('btn-cancel-import').hidden));
  // The native dialog can return behind another desktop window; sample a visible app.
  window.moveTop();
  window.focus();
  await evaluate(() => {
    window.__importFrameSamples = { count: 0, maxGap: 0, started: performance.now(), previous: performance.now(), hiddenAtStart: document.hidden, active: true };
    const frame = (now) => { const s = window.__importFrameSamples; if (!s.active) return; s.count++; s.maxGap = Math.max(s.maxGap, now - s.previous); s.previous = now; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
  await capture('import-progress');
  check('progress and cancellation fit without overlapping the shelf', await evaluate(() => {
    const status = document.getElementById('import-status').getBoundingClientRect();
    const cancel = document.getElementById('btn-cancel-import').getBoundingClientRect();
    const shelf = document.getElementById('bookshelf').getBoundingClientRect();
    return status.right <= cancel.left && Math.max(status.bottom, cancel.bottom) <= shelf.top;
  }));
  books = await waitForIdle();
  const frames = await evaluate(() => {
    const samples = window.__importFrameSamples;
    samples.active = false;
    samples.elapsed = performance.now() - samples.started;
    samples.hiddenAtEnd = document.hidden;
    samples.maxGap = Math.max(samples.maxGap, performance.now() - samples.previous);
    return samples;
  });
  report.frames = frames;
  check('window keeps painting during folder import', frames.count > 5 && frames.maxGap < 2000);
  const expected = require('../src/shared/book-metadata');
  const files = (await expected.scanBookFolder(directory)).filter((file) => !file.includes('broken'));
  check('mixed folder completes including large MOBI/AZW3 when present', files.every((file) => books.includes(file)));
  if (!process.env.GAIA_IMPORT_BOOKS_DIR) check('broken EPUB is reported and later books succeed', await evaluate(() => document.getElementById('import-status').textContent.includes('1 本失败')));
  report.finalBooks = books.length;
  await capture('folder-result');

  const cancelDir = path.join(sandbox, 'cancel-books');
  fs.mkdirSync(cancelDir);
  for (let i = 0; i < 12; i++) fs.copyFileSync(first[0], path.join(cancelDir, i + '.epub'));
  await select('cancel', [cancelDir], true);
  await until(() => evaluate(() => !document.getElementById('btn-cancel-import').hidden));
  await click('#btn-cancel-import');
  await waitForIdle();
  check('native folder import can be cancelled', await evaluate(() => document.getElementById('import-status').textContent.includes('已取消导入')));
  await capture('cancelled');
  await select('after-cancel', [path.join(cancelDir, '11.epub')]);
  books = await waitForIdle();
  check('a new import succeeds immediately after cancellation', books.includes(path.join(cancelDir, '11.epub')));
  await click('#btn-settings');
  check('settings remain interactive after imports', await evaluate(() => !document.getElementById('settings-overlay').hidden));
  await click('#btn-settings-close');
  await click('#btn-back-home');
  await until(() => evaluate(() => !document.getElementById('home-view').hidden));
  check('navigation remains interactive after imports', true);
  await click('#btn-home-shelf');
  await wait(10000);
  check('window still responds ten seconds after navigation', await evaluate(() => !!document.getElementById('btn-add-books').getClientRects().length));
  check('no renderer crash or unresponsive event', report.errors.length === 0);
}

app.once('browser-window-created', (_event, win) => {
  window = win;
  win.on('unresponsive', () => report.errors.push('unresponsive'));
  win.webContents.on('render-process-gone', (_event, details) => report.errors.push(details.reason));
  win.webContents.once('did-finish-load', () => run().then(() => finish(), finish));
});
require('../src/main');
