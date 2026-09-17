'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBookImporter } = require('../src/shared/book-import');

function harness(overrides = {}) {
  const library = [];
  const events = [];
  const importer = createBookImporter({
    getLibrary: () => library,
    metadata: async (filePath) => { events.push('read:' + filePath); return { path: filePath, format: 'epub' }; },
    commit: async (meta) => { library.push(meta); events.push('saved:' + meta.path); },
    cancelMetadata: () => {},
    ...overrides,
  });
  return { library, events, importer };
}

test('三本与较大批次均逐本保存后再处理下一本，重复 Windows 路径不重复解析', async () => {
  const { importer, library, events } = harness();
  const files = Array.from({ length: 30 }, (_, i) => 'D:/Book/' + i + '.epub');
  const result = await importer.run([...files, 'd:\\book\\0.EPUB']);
  assert.equal(result.added, 30);
  assert.equal(result.skipped, 1);
  assert.equal(library.length, 30);
  assert.deepEqual(events, files.flatMap((file) => ['read:' + file, 'saved:' + file]));
});

test('单本解析失败继续后续书籍，失败不计入已导入', async () => {
  const h = harness({ metadata: async (filePath) => {
    if (filePath === 'broken.epub') throw new Error('无效 EPUB');
    return { path: filePath, format: 'epub', recovered: filePath === 'recovered.epub' };
  } });
  const result = await h.importer.run(['one.epub', 'broken.epub', 'recovered.epub']);
  assert.equal(result.added, 2);
  assert.equal(result.recovered, 1);
  assert.equal(result.failures[0].message, '无效 EPUB');
  assert.deepEqual(h.library.map((b) => b.path), ['one.epub', 'recovered.epub']);
});

test('解析卡住时可取消，已保存书籍保留，重复导入请求不并发', async () => {
  let unblock;
  let secondStarted;
  const started = new Promise((resolve) => { secondStarted = resolve; });
  const h = harness({ metadata: async (filePath) => {
    if (filePath === 'two.epub') { secondStarted(); return new Promise((_, reject) => { unblock = reject; }); }
    return { path: filePath, format: 'epub' };
  }, cancelMetadata: () => unblock(new Error('cancelled')) });
  const running = h.importer.run(['one.epub', 'two.epub', 'three.epub']);
  await started;
  assert.deepEqual(h.library.map((b) => b.path), ['one.epub']);
  await assert.rejects(h.importer.run(['other.epub']), /已有导入任务/);
  h.importer.cancel();
  const result = await running;
  assert.equal(result.cancelled, true);
  assert.equal(result.added, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(h.importer.busy, false);
  assert.equal((await h.importer.run(['later.epub'])).added, 1);
});

test('保存失败停止批次，不能把未落盘书籍报告为成功', async () => {
  const saved = [];
  const h = harness({ commit: async (meta) => {
    if (saved.length) throw new Error('磁盘已满');
    saved.push(meta);
  } });
  const result = await h.importer.run(['one.epub', 'two.epub', 'three.epub']);
  assert.equal(result.added, 1);
  assert.equal(result.stopped, true);
  assert.match(result.failures[0].message, /保存书架失败.*磁盘已满/);
  assert.deepEqual(h.events, ['read:one.epub', 'read:two.epub']);
  assert.equal(h.importer.busy, false);
});

test('取消落盘中的任务仍准确统计已经保存的书籍', async () => {
  let save;
  let saving;
  const started = new Promise((resolve) => { saving = resolve; });
  const h = harness({ commit: () => { saving(); return new Promise((resolve) => { save = resolve; }); } });
  const running = h.importer.run(['one.epub', 'two.epub']);
  await started;
  h.importer.cancel();
  save();
  const result = await running;
  assert.equal(result.added, 1);
  assert.equal(result.cancelled, true);
  assert.deepEqual(h.events, ['read:one.epub']);
});

test('大量重复文件也会让出界面线程，允许中途取消', async () => {
  const h = harness();
  h.library.push({ path: 'known.epub', format: 'epub' });
  const running = h.importer.run(Array(10000).fill('known.epub'));
  setTimeout(() => h.importer.cancel(), 0);
  const result = await running;
  assert.equal(result.cancelled, true);
  assert.ok(result.skipped > 0 && result.skipped < 10000);
  assert.deepEqual(h.events, []);
});
