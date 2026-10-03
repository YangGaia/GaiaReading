'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBookImporter, normalizeBookPath } = require('../src/shared/book-import');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function metadata(filePath, extra) {
  return Object.assign({ path: filePath, title: filePath, format: 'epub' }, extra);
}

function harness(overrides) {
  let library = [];
  const writes = [];
  const progress = [];
  const requests = [];
  const settings = Object.assign({
    getLibrary: () => library,
    setLibrary: (next) => { library = next; },
    saveLibrary: async (next) => { writes.push(next.slice()); return true; },
    metadata: async (filePath) => metadata(filePath),
    begin: async (requestId) => { requests.push(['begin', requestId]); },
    end: async (requestId) => { requests.push(['end', requestId]); },
    cancel: async (requestId) => { requests.push(['cancel', requestId]); },
    onProgress: (state) => { progress.push(state); },
  }, overrides);
  return { importer: createBookImporter(settings), writes, progress, requests, library: () => library };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(condition) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await tick();
  }
  assert.fail('Expected import state did not arrive');
}

test('Windows 路径统一大小写、斜杠与等价前缀，POSIX 路径保留大小写', () => {
  assert.equal(normalizeBookPath('F:\\Books\\作品.EPUB'), normalizeBookPath('f:/books/作品.epub'));
  assert.equal(normalizeBookPath('\\\\?\\F:\\Books\\作品.EPUB'), normalizeBookPath('F:/Books/作品.epub'));
  assert.equal(normalizeBookPath('\\\\?\\UNC\\server\\Book\\a.epub'), normalizeBookPath('\\\\server\\book\\a.epub'));
  assert.equal(normalizeBookPath('F:/Books/./old/../a.epub'), normalizeBookPath('F:/books/a.epub'));
  assert.notEqual(normalizeBookPath('/Books/A.epub', false), normalizeBookPath('/Books/a.epub', false));
});

test('每本保存后才计成功；解析超时与进程退出不会丢失已保存书籍或停止后续解析', async () => {
  const gate = deferred();
  const h = harness({
    metadata: async (filePath) => {
      if (filePath === 'second') await gate.promise;
      if (filePath === 'timeout') throw new Error('解析超过 15 秒');
      if (filePath === 'crash') throw new Error('解析进程异常退出');
      return metadata(filePath, filePath === 'repaired' ? { recovered: true } : {});
    },
  });
  const pending = h.importer.start({ paths: ['first', 'second', 'timeout', 'crash', 'repaired'] });
  await waitFor(() => h.importer.getState().currentPath === 'second');
  assert.deepEqual(h.library().map((book) => book.path), ['first']);
  assert.equal(h.importer.getState().saved, 1);
  gate.resolve();
  const result = await pending;
  assert.equal(result.added, 3);
  assert.equal(result.recovered, 1);
  assert.equal(result.failures.length, 2);
  assert.deepEqual(h.writes.map((books) => books.length), [1, 2, 3]);
  assert.deepEqual(h.library().map((book) => book.path), ['first', 'second', 'repaired']);
  assert.equal(h.importer.getState().active, false);
});

test('保存失败立即停止批次，内存与已保存书架都只保留此前成功结果', async () => {
  const metadataCalls = [];
  let stored = [];
  const h = harness({
    metadata: async (filePath) => { metadataCalls.push(filePath); return metadata(filePath); },
    saveLibrary: async (next) => {
      if (next.length === 2) throw new Error('磁盘空间不足');
      stored = next.slice();
      return true;
    },
  });
  const result = await h.importer.start({ paths: ['first', 'second', 'third'] });
  assert.equal(result.added, 1);
  assert.match(result.saveError, /磁盘空间不足/);
  assert.equal(result.failures[0].stage, 'save');
  assert.deepEqual(metadataCalls, ['first', 'second']);
  assert.deepEqual(h.library(), stored);
  assert.deepEqual(stored.map((book) => book.path), ['first']);
});

test('保存接口明确返回失败时不会显示成功', async () => {
  const h = harness({ saveLibrary: async () => false });
  const result = await h.importer.start({ paths: ['first', 'second'] });
  assert.equal(result.added, 0);
  assert.ok(result.saveError);
  assert.equal(h.library().length, 0);
});

test('取消正在解析的图书可立即重导，旧批次迟到结果不会写入新书架', async () => {
  const lateMetadata = deferred();
  const h = harness({ metadata: (filePath) => filePath === 'slow' ? lateMetadata.promise : Promise.resolve(metadata(filePath)) });
  const first = h.importer.start({ paths: ['saved', 'slow', 'never'], requestId: 'first' });
  await waitFor(() => h.importer.getState().currentPath === 'slow');
  assert.equal(await h.importer.cancel(), true);
  const cancelled = await first;
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.added, 1);
  assert.equal(cancelled.failures.length, 0);
  const restarted = await h.importer.start({ paths: ['saved', 'new'], requestId: 'second' });
  assert.equal(restarted.added, 1);
  assert.equal(restarted.skipped, 1);
  lateMetadata.resolve(metadata('slow'));
  await tick();
  assert.deepEqual(h.library().map((book) => book.path), ['saved', 'new']);
  assert.deepEqual(h.requests, [['begin', 'first'], ['cancel', 'first'], ['end', 'first'], ['begin', 'second'], ['end', 'second']]);
});

test('取消会等待在途保存完成；新批次不能覆盖仍在写入的书架', async () => {
  const save = deferred();
  let saving = false;
  const h = harness({ saveLibrary: async () => { saving = true; return save.promise; } });
  const first = h.importer.start({ paths: ['first', 'second'] });
  await waitFor(() => saving);
  const cancellation = h.importer.cancel();
  const overlap = await h.importer.start({ paths: ['new'] });
  assert.equal(overlap.busy, true);
  assert.equal(h.importer.getState().active, true);
  assert.equal(h.importer.getState().saved, 0);
  assert.equal(h.library().length, 0);
  save.resolve(true);
  await cancellation;
  const result = await first;
  assert.equal(result.cancelled, true);
  assert.equal(result.added, 1);
  assert.deepEqual(h.library().map((book) => book.path), ['first']);
});

test('大量重复路径仍允许事件循环接收取消，且不再解析同一 Windows 路径', async () => {
  let parseCount = 0;
  const h = harness({ metadata: async (filePath) => { parseCount += 1; return metadata(filePath); } });
  await h.importer.start({ paths: ['F:\\Books\\a.epub'] });
  const paths = Array.from({ length: 100000 }, (_, index) => index % 2 ? 'f:/books/A.EPUB' : 'F:\\Books\\a.epub');
  const pending = h.importer.start({ paths });
  await waitFor(() => h.importer.getState().skipped > 0);
  await h.importer.cancel();
  const result = await pending;
  assert.equal(parseCount, 1);
  assert.equal(result.cancelled, true);
  assert.ok(result.skipped > 0 && result.skipped < paths.length);
});

test('原路径与解析返回路径等价时统一去重', async () => {
  const h = harness({ metadata: async (filePath) => metadata(filePath === 'alias' ? 'F:\\Books\\A.epub' : filePath) });
  const result = await h.importer.start({ paths: ['F:/Books/a.epub', 'f:\\books\\A.EPUB', 'alias'] });
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 2);
});

test('从选择器启动前即锁定批次，扫描进度按请求隔离并支持取消', async () => {
  const folder = deferred();
  const h = harness();
  const first = h.importer.start({ requestId: 'scan', selectPaths: async () => folder.promise });
  assert.equal(h.importer.getState().active, true);
  const repeated = await h.importer.start({ paths: ['wrong'] });
  assert.equal(repeated.busy, true);
  h.importer.scanning({ requestId: 'other', phase: 'scanning', currentPath: 'old', scanned: 999 });
  assert.notEqual(h.importer.getState().currentPath, 'old');
  h.importer.scanning({ requestId: 'scan', phase: 'scanning', currentPath: 'F:/Books', scanned: 20, found: 3 });
  assert.equal(h.importer.getState().phase, 'scanning');
  assert.equal(h.importer.getState().found, 3);
  await h.importer.cancel();
  assert.equal((await first).cancelled, true);
  folder.resolve(['late']);
  await tick();
  assert.equal(h.library().length, 0);
});

test('取消选择器与选择异常均结束后端会话，允许随后重新选择', async () => {
  const h = harness();
  const empty = await h.importer.start({ requestId: 'empty', selectPaths: async () => [] });
  assert.equal(empty.selectionEmpty, true);
  assert.equal(empty.added, 0);
  const failed = await h.importer.start({ requestId: 'failure', selectPaths: async () => { throw new Error('目录不可访问'); } });
  assert.match(failed.selectionError, /目录不可访问/);
  assert.equal(h.importer.getState().active, false);
  assert.deepEqual(h.requests, [['begin', 'empty'], ['end', 'empty'], ['begin', 'failure'], ['end', 'failure']]);
});

test('开始会话仍在等待时取消，注册完成后补发取消并释放会话', async () => {
  const begin = deferred();
  const requests = [];
  let selectorOpened = false;
  const h = harness({
    begin: async (requestId) => { requests.push(['begin', requestId]); await begin.promise; },
    cancel: async (requestId) => { requests.push(['cancel', requestId]); },
    end: async (requestId) => { requests.push(['end', requestId]); },
  });
  const pending = h.importer.start({ requestId: 'early', selectPaths: async () => { selectorOpened = true; return ['wrong']; } });
  await tick();
  const cancelled = h.importer.cancel();
  begin.resolve();
  await cancelled;
  assert.equal((await pending).cancelled, true);
  assert.equal(selectorOpened, false);
  assert.deepEqual(requests, [['begin', 'early'], ['cancel', 'early'], ['end', 'early']]);
  assert.equal(h.importer.getState().active, false);
});

test('无效元数据记为单本失败，后续有效图书照常保存', async () => {
  const h = harness({ metadata: async (filePath) => filePath === 'invalid' ? { title: '无效' } : metadata(filePath) });
  const result = await h.importer.start({ paths: ['invalid', 'valid'] });
  assert.equal(result.failures.length, 1);
  assert.equal(result.added, 1);
  assert.deepEqual(h.library().map((book) => book.path), ['valid']);
});
