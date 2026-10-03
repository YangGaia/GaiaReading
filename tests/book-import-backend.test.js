'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizedBookPath, deduplicateBookPaths, scanBookFolder, BookImportSessions,
  importCancelledError,
} = require('../src/shared/book-import-backend');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-import-test-'));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

const immediate = () => new Promise((resolve) => setImmediate(resolve));

test('Windows 图书路径按大小写、斜杠和点路径统一去重，保留首次选择', async () => {
  assert.equal(normalizedBookPath('F:/Books/dir/../My Book.EPUB', 'win32'), normalizedBookPath('f:\\books\\my book.epub', 'win32'));
  assert.equal(normalizedBookPath('\\\\server\\Books\\x.epub', 'win32'), normalizedBookPath('//SERVER/books/x.epub', 'win32'));
  assert.deepEqual(await deduplicateBookPaths([
    'F:/Books/One.EPUB', 'f:\\books\\one.epub', 'F:\\Books\\two.txt', 'f:/books/two.txt', 'F:/books/ignored.jpg',
  ], { platform: 'win32' }), ['F:/Books/One.EPUB', 'F:\\Books\\two.txt']);
});

test('大量重复或不支持文件仍定期让出事件循环并响应取消', async () => {
  for (const filePath of ['F:/Books/repeated.epub', 'F:/Books/ignored.jpg']) {
    const controller = new AbortController();
    const paths = Array(50000).fill(filePath);
    setImmediate(() => controller.abort());
    await assert.rejects(deduplicateBookPaths(paths, { signal: controller.signal }), { name: 'AbortError' });
  }
});

test('异步扫描保留原 8 层范围，过滤隐藏目录、依赖目录、不支持文件和目录链接', async (t) => {
  const root = temporaryDirectory(t);
  const books = path.join(root, 'books');
  fs.mkdirSync(books);
  fs.writeFileSync(path.join(books, 'root.EPUB'), '');
  fs.writeFileSync(path.join(books, 'ignored.json'), '');
  for (const name of ['.hidden', 'node_modules']) {
    fs.mkdirSync(path.join(books, name));
    fs.writeFileSync(path.join(books, name, 'hidden.epub'), '');
  }
  let directory = books;
  for (let depth = 1; depth <= 8; depth += 1) {
    directory = path.join(directory, 'level-' + depth);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'depth-' + depth + '.txt'), '');
  }
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'linked.epub'), '');
  fs.symlinkSync(outside, path.join(books, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const progress = [];
  const results = await scanBookFolder(books, { onProgress: (value) => progress.push(value) });
  assert.equal(results.length, 8);
  assert.ok(results.some((file) => file.endsWith('depth-7.txt')));
  assert.ok(!results.some((file) => /depth-8|hidden\.epub|linked\.epub|ignored\.json/.test(file)));
  assert.deepEqual(progress[0], { phase: 'scanning', currentPath: books, scanned: 0, found: 0 });
  assert.equal(progress.at(-1).found, 8);
  assert.ok(progress.at(-1).scanned > results.length);
});

test('重复扫描条目不会重复返回图书，扫描进度统计实际访问条目', async () => {
  const entry = (name) => ({ name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false });
  const progress = [];
  const files = await scanBookFolder('F:/Books', {
    platform: 'win32',
    openDirectory: async () => (async function* () { yield entry('ONE.EPUB'); yield entry('one.epub'); })(),
    onProgress: (value) => progress.push(value),
  });
  assert.equal(files.length, 1);
  assert.equal(progress.at(-1).scanned, 2);
  assert.equal(progress.at(-1).found, 1);
});

test('扫描大量重复条目可及时取消，并关闭当前目录迭代器', async () => {
  const controller = new AbortController();
  let visited = 0;
  let closed = false;
  const directory = (async function* () {
    try {
      for (let index = 0; index < 50000; index += 1) {
        visited += 1;
        yield { name: 'same.epub', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false };
      }
    } finally { closed = true; }
  })();
  setImmediate(() => controller.abort());
  await assert.rejects(scanBookFolder('F:/Books', {
    signal: controller.signal,
    openDirectory: async () => directory,
  }), { name: 'AbortError' });
  assert.ok(visited <= 64, '去重分支必须定期让出事件循环');
  assert.equal(closed, true);
});

test('扫描不可访问目录可继续，预先取消不访问文件系统', async () => {
  const denied = new Error('denied');
  denied.code = 'EACCES';
  assert.deepEqual(await scanBookFolder('F:/Books', { openDirectory: async () => { throw denied; } }), []);
  const controller = new AbortController();
  controller.abort();
  let opened = false;
  await assert.rejects(scanBookFolder('F:/Books', {
    signal: controller.signal,
    openDirectory: async () => { opened = true; },
  }), { name: 'AbortError' });
  assert.equal(opened, false);
});

test('批次取消后保留状态，随后排队任务不能重新开始，end 后可立即重新导入', async () => {
  const sessions = new BookImportSessions();
  sessions.begin(1, 'first');
  assert.throws(() => sessions.begin(1, 'second'), /已有图书/);
  assert.equal(sessions.cancel(1, 'first'), true);
  sessions.begin(1, 'first');
  let started = false;
  await assert.rejects(sessions.run(1, 'first', () => { started = true; }), { name: 'AbortError' });
  assert.equal(started, false);
  assert.equal(sessions.end(1, 'old-id'), false);
  assert.equal(sessions.end(1, 'first'), true);
  sessions.begin(1, 'second');
  assert.equal(await sessions.run(1, 'second', () => 'new book'), 'new book');
  sessions.end(1, 'second');
});

test('同一事件轮次中先提交再取消也不会启动解析操作', async () => {
  const sessions = new BookImportSessions();
  sessions.begin(1, 'batch');
  let started = false;
  const result = sessions.run(1, 'batch', () => { started = true; });
  sessions.cancel(1, 'batch');
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(started, false);
  assert.equal(sessions.pending.size, 0);
  assert.equal(sessions.jobs.size, 0);
});

test('单本失败不取消批次，窗口的批次彼此隔离，并兼容无 requestId 调用', async () => {
  const sessions = new BookImportSessions();
  sessions.begin(1, 'batch');
  sessions.begin(2, 'batch');
  await assert.rejects(sessions.run(1, 'batch', () => { throw new Error('broken book'); }), /broken book/);
  assert.equal(await sessions.run(1, 'batch', () => 'next book'), 'next book');
  sessions.cancel(2, 'batch');
  assert.equal(sessions.signalFor(1, 'batch').aborted, false);
  assert.equal(await sessions.run(3, undefined, () => 'legacy caller'), 'legacy caller');
  await sessions.closeAll();
  assert.equal(sessions.batches.size, 0);
});

test('窗口关闭与退出会取消正在运行的操作，等待清理完成后再结束', async () => {
  const sessions = new BookImportSessions();
  sessions.begin(1, 'batch');
  let cleaned = 0;
  const operation = (signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => setTimeout(() => {
      cleaned += 1;
      reject(importCancelledError());
    }, 30), { once: true });
  });
  const one = assert.rejects(sessions.run(1, 'batch', operation), { name: 'AbortError' });
  const legacy = assert.rejects(sessions.run(2, undefined, operation), { name: 'AbortError' });
  await immediate();
  const settled = sessions.closeAll();
  assert.equal(cleaned, 0);
  await settled;
  await Promise.all([one, legacy]);
  assert.equal(cleaned, 2);
  assert.equal(sessions.pending.size, 0);
  assert.equal(sessions.jobs.size, 0);
});

function windowImportHarness(sessions) {
  const { EventEmitter } = require('node:events');
  const vm = require('node:vm');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const start = main.indexOf('function createWindow()');
  const createWindow = main.slice(start, main.indexOf('\nipcMain.handle(', start));
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new EventEmitter();
      this.webContents.id = 17;
    }
    loadFile() {}
  }
  const context = {
    BrowserWindow, mainWindow: null, bookImports: sessions,
    APP_NAME: 'GaiaReading_Lucky', APP_ICON_PATH: 'icon.png', path,
    __dirname: path.join(__dirname, '..', 'src'),
    screen: { on() {}, removeListener() {} }, IS_SMOKE: false, SHOT_DIR: null,
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(createWindow + '\ncreateWindow();', context);
  return context.mainWindow.webContents;
}

test('窗口销毁、渲染崩溃和页面重载会取消旧解析，并释放同一 webContents 的批次', async () => {
  for (const event of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
    const sessions = new BookImportSessions();
    const contents = windowImportHarness(sessions);
    sessions.begin(contents.id, 'old-page');
    let cancelled = false;
    const pending = sessions.run(contents.id, 'old-page', (signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        cancelled = true;
        reject(importCancelledError());
      }, { once: true });
    }));
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await immediate();
    if (event === 'did-start-navigation') contents.emit(event, {}, 'file:///index.html', false, true);
    else contents.emit(event, {}, { reason: 'crashed' });
    await rejected;
    assert.equal(cancelled, true, event + ' 应取消正在运行的解析');
    assert.equal(sessions.batches.size, 0);
    assert.equal(sessions.pending.size, 0);
    sessions.begin(contents.id, 'new-page');
    assert.equal(await sessions.run(contents.id, 'new-page', () => 'next book'), 'next book');
    await sessions.closeAll();
  }
});

test('子 frame 导航和同页定位不会取消当前导入', async () => {
  const sessions = new BookImportSessions();
  const contents = windowImportHarness(sessions);
  sessions.begin(contents.id, 'books');
  contents.emit('did-start-navigation', {}, 'file:///chapter.html', false, false);
  contents.emit('did-start-navigation', {}, 'file:///index.html#library', true, true);
  assert.equal(sessions.signalFor(contents.id, 'books').aborted, false);
  assert.equal(await sessions.run(contents.id, 'books', () => 'book'), 'book');
  contents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(sessions.batches.size, 0);
});
