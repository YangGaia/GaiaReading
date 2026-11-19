'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/shared/store');

const project = path.join(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-book-relocation-'));
const output = path.join(project, 'dist', 'previews', 'book-relocation');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', sandbox);
app.setPath('sessionData', path.join(sandbox, 'session'));
app.setAppPath(project);
BrowserWindow.prototype.show = function () { this.showInactive(); };

const original = path.join(sandbox, '雾港来信.txt');
const libraryFolder = path.join(sandbox, '藏书');
fs.mkdirSync(libraryFolder);
const relocated = path.join(libraryFolder, '雾港来信（新位置）.txt');
const wrong = path.join(libraryFolder, path.basename(original));
const wrongFormat = path.join(libraryFolder, '其他格式.pdf');
const legacy = path.join(sandbox, '北窗随笔.txt');
const legacyDestination = path.join(libraryFolder, path.basename(legacy));
const removable = path.join(sandbox, '群山之间.txt');

const paragraphs = [
  '雾已经漫过石阶。林岚循着小巷里的灯光走到旧邮局，发现门口的木牌翻了个面。',
  '她把信封放在桌上。信纸上只有一个地址，写得很慢，笔画转折处的墨水比别处更深。',
  '港口响起两下钟声。窗外的帆影静止了片刻，等潮水转向，才缓缓离开石堤。',
  '管理员搬来一把椅子，让她坐在窗边等。风从门缝钻进来，桌上那张便笺动了一下。',
];
const contents = '第一章 港口\n\n' + Array.from({ length: 70 }, (_, index) => paragraphs[index % paragraphs.length]).join('\n\n');
fs.writeFileSync(original, contents);
fs.writeFileSync(wrong, contents.replaceAll('林岚', '陈溪'));
fs.writeFileSync(wrongFormat, contents);
fs.writeFileSync(legacyDestination, '第一章 窗边\n\n笔记里的旧书。');
const store = new JsonStore(path.join(sandbox, 'gaia-reading.json'));
store.save({
  library: [
    { path: legacy, title: '北窗随笔', format: 'txt' },
    { path: removable, title: '群山之间', format: 'txt' },
  ],
  progress: { [legacy]: { page: 0, percent: 20, updatedAt: 20 } },
  prefs: { theme: 'light' },
  pet: { auto: false, autoSpeech: false, autoSleep: false, showFps: false, readerMode: 'hidden' },
});

// The rest of the flow runs through the real app, filesystem, IPC, readers and data store.
let pick;
let confirm;
const pickerCalls = [];
const confirmations = [];
dialog.showOpenDialog = async (_win, options) => {
  pickerCalls.push(options);
  return pick ? { canceled: false, filePaths: [pick] } : { canceled: true, filePaths: [] };
};
dialog.showMessageBox = async (_win, options) => {
  confirmations.push(options);
  return { response: typeof confirm === 'function' ? confirm() : confirm };
};

const report = { checks: [], screenshots: [], consoleErrors: [] };
function check(label, callback) {
  callback();
  report.checks.push(label);
}

const deadline = setTimeout(() => finish(new Error('重新定位冒烟测试超时')), 60000);
function finish(error) {
  clearTimeout(deadline);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output, error: report.error }));
  app.exit(error ? 1 : 0);
}

require('../src/main');

async function run(win) {
  win.setContentSize(1100, 760);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) report.consoleErrors.push(message);
  });
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const waitFor = async (fn, arg) => {
    for (let i = 0; i < 140; i++) {
      const result = await evaluate(fn, arg);
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    assert.fail('未等到界面状态 ' + fn.toString());
  };
  const capture = async (name) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const filename = path.join(output, name + '.png');
    fs.writeFileSync(filename, (await win.webContents.capturePage()).toPNG());
    report.screenshots.push(filename);
  };
  const enterShelf = async () => {
    await evaluate(() => __gaiaDebug.waitHome());
    await evaluate(() => document.getElementById('btn-home-shelf').click());
  };
  const clickBook = (filePath) => evaluate((value) => {
    const card = Array.from(document.querySelectorAll('.book-card')).find((item) => item.dataset.path === value);
    if (!card) throw new Error('书架没有这本书');
    card.click();
  }, filePath);
  const readerReady = (filePath) => waitFor((value) => __gaiaDebug.getView() === 'reader' &&
    state.current?.path === value && state.current.paginator?.doc && els.readerStatus.textContent.startsWith('进度'), filePath);
  const waitForShelfAction = () => waitFor(() => !bookActivationPending);

  await enterShelf();
  check('启动时保留两本文件不可用的书与原有进度', () => {
    assert.equal(store.get('library').length, 2);
    assert.equal(store.get('progress')[legacy].percent, 20);
  });
  assert.equal(await evaluate(() => document.querySelectorAll('.book-missing').length), 2);

  fs.writeFileSync(removable, '临时离线的书已恢复。');
  await clickBook(removable);
  await readerReady(removable);
  check('原路径恢复时直接打开，无需选择文件', () => assert.equal(pickerCalls.length, 0));
  await evaluate(() => __gaiaDebug.backToLibrary());

  const imported = await evaluate((file) => __gaiaDebug.importPaths([file]), original);
  check('真实导入保存文件指纹', () => {
    assert.equal(imported.added, 1);
    assert.match(store.get('library').find((item) => item.path === original).fingerprint, /^[a-f\d]{64}$/);
  });
  await clickBook(original);
  await readerReady(original);
  await evaluate(async () => {
    await __gaiaDebug.nextPage();
    await __gaiaDebug.nextPage();
  });
  const page = await evaluate(() => __gaiaDebug.getPaginatorPage());
  assert.ok(page > 0);
  assert.ok(await evaluate(() => __gaiaDebug.addBookmark()));
  assert.ok(await evaluate(async () => {
    if (!__gaiaDebug.prepareCurrentPageAnnotationForTest()) return false;
    document.querySelector('[data-selection-action="note"]').click();
    __gaiaDebug.setNoteEditorText('这封信和港口的钟声有关。');
    await __gaiaDebug.commitNoteEditor();
    return __gaiaDebug.getAnnotations().some((entry) => entry.note === '这封信和港口的钟声有关。');
  }));
  await evaluate(() => __gaiaDebug.backToLibrary());
  const before = store.load();
  fs.renameSync(original, relocated);

  await evaluate(() => {
    document.getElementById('btn-back-home').click();
    document.getElementById('btn-home-shelf').click();
  });
  await waitFor((file) => Array.from(document.querySelectorAll('.book-missing')).some((item) => item.dataset.path === file), original);
  await capture('missing-book');
  const filtered = await evaluate(() => {
    const input = document.getElementById('shelf-search-input');
    input.value = '霧港來信';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const cards = [...document.querySelectorAll('.book-card:not([hidden])')];
    return cards.length === 1 && cards[0].classList.contains('book-missing') && cards[0].dataset.path;
  });
  check('搜索结果包含文件离线的图书和重新定位入口', () => assert.equal(filtered, original));

  await clickBook(original);
  await waitForShelfAction();
  check('关闭文件选择器后保留所有记录', () => assert.deepEqual(store.load(), before));
  pick = wrongFormat;
  await clickBook(original);
  await waitForShelfAction();
  assert.match(await evaluate(() => els.importStatus.textContent), /相同格式/);
  pick = removable;
  await clickBook(original);
  await waitForShelfAction();
  assert.match(await evaluate(() => els.importStatus.textContent), /已在书架/);
  pick = wrong;
  await clickBook(original);
  await waitForShelfAction();
  assert.match(await evaluate(() => els.importStatus.textContent), /内容与原书不同/);
  check('拒绝不同格式、已在书架及同名不同内容的替换文件', () => assert.deepEqual(store.load(), before));

  pick = relocated;
  await evaluate((file) => {
    const card = Array.from(document.querySelectorAll('.book-card')).find((item) => item.dataset.path === file);
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }));
    const action = document.getElementById('ctx-open');
    if (action.textContent !== '重新定位') throw new Error('缺失图书右键菜单未显示重新定位');
    action.click();
  }, original);
  await readerReady(relocated);
  const after = store.load();
  const restored = await evaluate(() => ({
    page: __gaiaDebug.getPaginatorPage(),
    bookmarks: __gaiaDebug.getBookmarks(),
    annotations: __gaiaDebug.getAnnotations(),
    marks: state.current.paginator.doc.querySelectorAll('mark[data-gaia-annotation]').length,
  }));
  check('选择同一文件后自动续读，并恢复原页、书签、划线和笔记', () => {
    assert.equal(restored.page, page);
    assert.deepEqual(restored.bookmarks, before.bookmarks[original]);
    assert.deepEqual(restored.annotations, before.annotations[original]);
    assert.ok(restored.marks > 0);
    assert.equal(confirmations.length, 0);
    assert.equal(after.progress[relocated].page, before.progress[original].page);
    for (const key of ['progress', 'bookmarks', 'annotations']) assert.equal(Object.hasOwn(after[key], original), false);
  });
  await evaluate(() => __gaiaDebug.backToLibrary());
  const filteredAfterMove = await evaluate(() => ({
    query: document.getElementById('shelf-search-input').value,
    paths: [...document.querySelectorAll('.book-card:not([hidden])')].map((card) => card.dataset.path),
  }));
  check('过滤后的书籍重新定位后保留查询，结果指向新文件', () => {
    assert.deepEqual(filteredAfterMove, { query: '霧港來信', paths: [relocated] });
  });
  await evaluate(() => document.getElementById('btn-shelf-search-clear').click());

  pick = legacyDestination;
  confirm = 1;
  await evaluate((file) => {
    const card = Array.from(document.querySelectorAll('.book-card')).find((item) => item.dataset.path === file);
    card.focus();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }, legacy);
  await waitForShelfAction();
  check('旧书的确认提示显示原位置与新位置，取消后保持原记录', () => {
    assert.ok(confirmations[0].detail.includes(legacy) && confirmations[0].detail.includes(legacyDestination));
    assert.ok(store.get('library').some((item) => item.path === legacy));
  });
  confirm = () => {
    fs.appendFileSync(legacyDestination, '\n\n文件在确认期间变化。');
    return 0;
  };
  await clickBook(legacy);
  await waitForShelfAction();
  assert.match(await evaluate(() => els.importStatus.textContent), /确认期间发生变化/);
  assert.ok(store.get('progress')[legacy]);
  confirm = 0;
  await clickBook(legacy);
  await readerReady(legacyDestination);
  await evaluate(() => __gaiaDebug.backToLibrary());
  check('旧书手动确认后写入指纹并保存到新位置', () => {
    assert.match(store.get('library').find((item) => item.path === legacyDestination).fingerprint, /^[a-f\d]{64}$/);
    assert.equal(Object.hasOwn(store.get('progress'), legacy), false);
  });

  assert.equal(store.get('progress')[relocated].page, page);
  const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.reload();
  await reloaded;
  await enterShelf();
  await clickBook(relocated);
  await readerReady(relocated);
  const pageAfterReload = await evaluate(() => __gaiaDebug.getPaginatorPage());
  check('重载后仍从新位置打开并恢复原页，未重复调用选择器', () => {
    assert.equal(pageAfterReload, page);
    assert.equal(pickerCalls.length, 8);
    assert.deepEqual(report.consoleErrors, []);
  });
  await evaluate(async () => {
    togglePanel('annotations');
    await waitForReaderLayoutRefresh();
  });
  await capture('restored-reading');
}

app.whenReady().then(() => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) throw new Error('无法找到主窗口');
  return new Promise((resolve) => win.webContents.once('did-finish-load', resolve)).then(() => run(win));
}).then(() => finish(), finish);
