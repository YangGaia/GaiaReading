'use strict';

// Runs against a new temporary profile; never imports into the daily library.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { makeSmokeDirectory, configureSmokePaths, resolveFPath } = require('./smoke-paths');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { JsonStore } = require('../src/shared/store');
const { STATE_FILE_NAME } = require('../src/shared/app-paths');

const project = path.join(__dirname, '..');
const temporary = makeSmokeDirectory('reader-import-smoke-');
const profile = path.join(temporary, 'profile');
const books = path.join(temporary, 'books');
const output = resolveFPath(process.env.GAIA_IMPORT_SCREENSHOT || path.join(temporary, 'import.png'));
const reportPath = resolveFPath(process.env.GAIA_IMPORT_REPORT || path.join(temporary, 'report.json'));
fs.mkdirSync(profile);
fs.mkdirSync(books);
configureSmokePaths(app, { userData: profile, temp: temporary });
app.setAppPath(project);
const stateFile = path.join(profile, STATE_FILE_NAME);
fs.writeFileSync(stateFile, JSON.stringify({
  _meta: { schemaVersion: 1, appVersion: require('../package.json').version },
  library: [], prefs: { theme: 'light' },
  pet: { auto: false, autoSpeech: false, autoSleep: false },
}));

const report = { temporary, profile, screenshot: output, checks: [], libraryWrites: [], metadataRequests: 0 };
const control = { failNextSave: false, dialog: { canceled: true, filePaths: [] } };
const originalSet = JsonStore.prototype.set;
JsonStore.prototype.set = function (key, value) {
  if (key === 'library' && control.failNextSave) {
    control.failNextSave = false;
    throw new Error('模拟书架保存失败');
  }
  const result = originalSet.call(this, key, value);
  if (key === 'library') report.libraryWrites.push(value.map((book) => book.path));
  return result;
};
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  if (channel === 'book:metadata') report.metadataRequests += 1;
  return listener(event, ...args);
});
dialog.showOpenDialog = async () => control.dialog;
BrowserWindow.prototype.show = function () { this.showInactive(); };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const savedLibrary = () => JSON.parse(fs.readFileSync(stateFile, 'utf8')).library;
let finished = false;
const watchdog = setTimeout(() => finish(new Error('批量导入界面验证超过 120 秒')), 120000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, temporary, output, reportPath, error: report.error }, null, 2));
  app.exit(error ? 1 : 0);
}
function check(name, condition) {
  assert.ok(condition, name);
  report.checks.push(name);
}
function makeTxt(name) {
  const file = path.join(books, name + '.txt');
  fs.writeFileSync(file, name + '\n\n第一章\n\n这是一份隔离验证使用的电子书。');
  return file;
}
async function makeEpub(name, damaged = false) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<package><metadata><dc:title>' + name + '</dc:title><dc:creator>测试作者</dc:creator></metadata><manifest><item id="good" href="good.xhtml"/><item id="bad" href="bad.xhtml"/></manifest><spine><itemref idref="good"/></spine></package>');
  zip.file('OEBPS/good.xhtml', '<html><body><h1>第一章</h1><p>可读正文。</p></body></html>');
  zip.file('OEBPS/bad.xhtml', '<html><body><p>第二章。</p></body></html>');
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (damaged) {
    let changed = false;
    for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
      if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
      const length = bytes.readUInt16LE(offset + 28);
      if (bytes.subarray(offset + 46, offset + 46 + length).toString() !== 'OEBPS/bad.xhtml') continue;
      bytes.writeUInt32LE(bytes.readUInt32LE(offset + 42) + 2, offset + 42);
      changed = true;
      break;
    }
    assert.ok(changed);
  }
  const file = path.join(books, name + '.epub');
  fs.writeFileSync(file, bytes);
  return file;
}

async function run(win) {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  const evaluate = (fn, value) => win.webContents.executeJavaScript('(' + fn.toString() + ')(' + JSON.stringify(value) + ')');
  const waitFor = async (predicate) => {
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      if (await predicate()) return;
      await sleep(20);
    }
    throw new Error('等待导入状态超时');
  };
  await evaluate(async () => __gaiaDebug.waitHome());
  check('test profile is isolated', app.getPath('userData') === profile);
  await evaluate(async () => {
    __gaiaDebug.openBookImportChooser(true);
    return __gaiaDebug.chooseBookImportSource('files');
  });
  check('cancelled picker stays on home', await evaluate(() => __gaiaDebug.getView() === 'home'));

  const first = makeTxt('第一本逐本保存');
  const good = await makeEpub('正常元数据');
  const repaired = await makeEpub('可恢复的电子书', true);
  const invalid = path.join(books, '不可解析.epub');
  fs.writeFileSync(invalid, 'invalid epub');
  const mixed = await evaluate(async (paths) => {
    __gaiaDebug.showView('library');
    return __gaiaDebug.importPaths(paths);
  }, [first, first.toUpperCase().replace(/\\/g, '/'), invalid, good, repaired]);
  check('valid books survive a failed middle item', mixed.added === 3 && mixed.failures.length === 1);
  check('Windows aliases are skipped', mixed.skipped === 1);
  check('recoveries remain separately counted', mixed.recovered === 1);
  check('each successful book is persisted immediately', [1, 2, 3].every((n) => report.libraryWrites.some((entry) => entry.length === n)));
  check('disk and renderer library agree', savedLibrary().length === 3 && await evaluate(() => __gaiaDebug.getLibrary().length === 3));

  const saveFailure = makeTxt('保存失败不应入架');
  const shouldNotRun = makeTxt('保存失败后不得继续解析');
  const requestsBefore = report.metadataRequests;
  control.failNextSave = true;
  const failedSave = await evaluate((paths) => __gaiaDebug.importPaths(paths), [saveFailure, shouldNotRun]);
  check('save failure stops the batch', !!failedSave.saveError && failedSave.added === 0 && report.metadataRequests === requestsBefore + 1);
  check('save failure keeps prior disk and in-memory successes', savedLibrary().length === 3 && await evaluate(() => __gaiaDebug.getLibrary().length === 3));
  check('save failure is visible', await evaluate(() => /保存/.test(document.getElementById('import-status').textContent)));

  const slow = Array.from({ length: 60 }, (_, index) => makeTxt(
    String(index + 1).padStart(2, '0') + '-长书名与逐本保存验证-' + '文学作品合集与阅读札记'.repeat(6)
  ));
  await evaluate((paths) => { window.__importSmokePending = __gaiaDebug.importPaths(paths); return true; }, slow);
  await waitFor(() => evaluate(() => { const s = __gaiaDebug.getBookImportState(); return s.active && s.saved >= 1; }));
  const during = await evaluate(() => __gaiaDebug.getBookImportState());
  check('progress includes current file and saved count', during.saved >= 1 && !!during.currentPath && during.total === 60);
  check('previous books reach disk before batch ends', savedLibrary().length >= 3 + during.saved);
  const blocked = await evaluate((paths) => __gaiaDebug.importPaths(paths), [shouldNotRun]);
  check('repeated import cannot replace active task', !blocked || blocked.added === 0);
  check('active task retains its request identity', await evaluate((id) => __gaiaDebug.getBookImportState().requestId === id, during.requestId));

  win.setContentSize(1100, 760);
  await sleep(80);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, (await win.webContents.capturePage()).toPNG());
  win.setContentSize(800, 600);
  await sleep(80);
  const layout = await evaluate(() => {
    const file = document.getElementById('import-current-file');
    const cancel = document.getElementById('btn-cancel-import');
    const counts = document.getElementById('import-counts');
    const bounds = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
    return { file: bounds(file), cancel: bounds(cancel), counts: bounds(counts),
      ellipsis: getComputedStyle(file).textOverflow,
      overflow: file.scrollWidth > file.clientWidth,
      cancelEnabled: !cancel.disabled && !cancel.hidden, width: innerWidth };
  });
  report.smallWindowLayout = layout;
  check('long filenames use ellipsis', layout.ellipsis === 'ellipsis' && layout.overflow);
  check('progress and cancel fit the smallest supported window', layout.file.width > 0 && layout.cancel.right <= layout.width && layout.counts.right <= layout.width && layout.cancelEnabled);

  const cancelStart = Date.now();
  await evaluate(async () => { document.getElementById('btn-cancel-import').click(); return window.__importSmokePending; });
  const cancelled = await evaluate(() => window.__importSmokePending);
  report.cancelMilliseconds = Date.now() - cancelStart;
  check('cancel returns promptly and preserves saved books', cancelled.cancelled && cancelled.added >= 1 && cancelled.added < 60 && report.cancelMilliseconds < 3000 && savedLibrary().length === 3 + cancelled.added);
  check('cancel releases the import controls', await evaluate(() => !__gaiaDebug.getBookImportState().active && !document.getElementById('btn-add-books').disabled));
  const retry = await evaluate((paths) => __gaiaDebug.importPaths(paths), [shouldNotRun]);
  check('a new import works immediately after cancel', retry.added === 1 && retry.failures.length === 0);

  const beforeDuplicates = savedLibrary().length;
  const duplicateResult = await evaluate(async (file) => {
    const pending = __gaiaDebug.importPaths(Array(100000).fill(file));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await __gaiaDebug.cancelBookImport();
    return pending;
  }, first);
  check('100000 duplicate entries remain cancellable', duplicateResult.cancelled && duplicateResult.skipped < 100000 && duplicateResult.added === 0 && savedLibrary().length === beforeDuplicates);

  const folder = path.join(temporary, 'folder');
  fs.mkdirSync(path.join(folder, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'folder-a.txt'), '文件夹扫描');
  fs.writeFileSync(path.join(folder, 'nested', 'folder-b.txt'), '子文件夹扫描');
  fs.writeFileSync(path.join(folder, 'ignored.bin'), 'ignored');
  control.dialog = { canceled: false, filePaths: [folder] };
  const folderResult = await evaluate(async () => {
    __gaiaDebug.openBookImportChooser(false);
    return __gaiaDebug.chooseBookImportSource('folder');
  });
  check('native folder selection scans supported nested files', folderResult.added === 2 && folderResult.failures.length === 0);
  const contentsId = win.webContents.id;
  await evaluate((paths) => { window.__reloadImport = __gaiaDebug.importPaths(paths); return true; }, slow.slice(10));
  await waitFor(() => evaluate(() => { const s = __gaiaDebug.getBookImportState(); return s.active && s.phase === 'parsing'; }));
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await loaded;
  await evaluate(async () => __gaiaDebug.waitHome());
  check('window reload preserves the same webContents', win.webContents.id === contentsId);
  const afterReload = await evaluate((paths) => __gaiaDebug.importPaths(paths), [makeTxt('窗口重载后可以重新导入')]);
  check('window reload releases the abandoned import batch', afterReload.added === 1 && !afterReload.selectionError);

  const last = savedLibrary();
  check('final persisted books have unique paths', new Set(last.map((book) => book.path.toLowerCase().replace(/\\/g, '/'))).size === last.length);
  report.finalSaved = last.length;
  finish();
}

app.whenReady().then(async () => {
  try {
    const until = Date.now() + 10000;
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0]) && Date.now() < until) await sleep(50);
    assert.ok(win, '应用窗口已创建');
    await run(win);
  } catch (error) { finish(error); }
});
require('../src/main');
