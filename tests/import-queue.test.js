'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { ImportQueue } = require('../src/shared/import-queue');

function queueFor(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-queue-test-'));
  const queue = new ImportQueue({
    fork: () => {
      const child = fork(options.worker || path.join(__dirname, 'fixtures/import-worker-failure.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
      child.postMessage = (message) => child.send(message);
      return child;
    },
    tempRoot: directory,
    timeoutMs: options.timeoutMs || 800,
  });
  t.after(async () => {
    queue.close();
    for (let i = 0; queue.active && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(queue.active, null, 'worker must exit before resources are removed');
    assert.deepEqual(fs.readdirSync(directory), [], 'worker resources must be cleaned after success, timeout and crash');
    fs.rmdirSync(directory);
  });
  return queue;
}

test('真实子进程无限循环不会阻塞父进程，超时终止后下一本仍可处理', async (t) => {
  const queue = queueFor(t);
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 20);
  t.after(() => clearInterval(timer));
  const hung = assert.rejects(queue.read('hang.epub'), (error) => error.code === 'IMPORT_TIMEOUT');
  const next = queue.read('next.epub');
  await hung;
  assert.equal((await next).path, 'next.epub');
  assert.ok(ticks >= 10, 'parent must remain responsive while the parser blocks');
});

test('解析进程异常退出只影响当前书籍', async (t) => {
  const queue = queueFor(t);
  const failed = assert.rejects(queue.read('crash.epub'), (error) => error.code === 'IMPORT_WORKER_EXIT');
  const next = queue.read('next.epub');
  await failed;
  assert.equal((await next).path, 'next.epub');
});

test('取消同时终止当前解析和同一窗口的排队请求，其他窗口不受影响', async (t) => {
  const queue = queueFor(t, { timeoutMs: 5000 });
  const cancelled = [queue.read('hang.epub', 1), queue.read('queued.epub', 1)].map((promise) => assert.rejects(promise, (e) => e.code === 'IMPORT_CANCELLED'));
  const other = queue.read('other.epub', 2);
  queue.cancel(1);
  await Promise.all(cancelled);
  assert.equal((await other).path, 'other.epub');
});

test('生产解析脚本通过进程消息返回真实 EPUB 信息', async (t) => {
  const queue = queueFor(t, { worker: path.join(__dirname, '../src/import-worker.js'), timeoutMs: 5000 });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-worker-fixture-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const zip = new (require('jszip'))();
  zip.file('content.opf', '<package><metadata><dc:title>进程隔离验证</dc:title></metadata><manifest/></package>');
  const file = path.join(directory, 'sample.epub');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  const meta = await queue.read(file);
  assert.equal(meta.path, file);
  assert.equal(meta.format, 'epub');
  assert.equal(meta.title, '进程隔离验证');
});

test('进程尚未 spawn 时取消，也会终止迟到的进程并继续下一项', async (t) => {
  const { EventEmitter } = require('events');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-late-spawn-'));
  let terminated = 0;
  const queue = new ImportQueue({ tempRoot: directory, timeoutMs: 1000, fork: () => {
    const child = new EventEmitter();
    let spawned = false;
    let dead = false;
    child.kill = () => {
      if (!spawned || dead) return false;
      dead = true;
      terminated += 1;
      setImmediate(() => child.emit('exit', 0));
      return true;
    };
    child.postMessage = ({ filePath }) => setImmediate(() => child.emit('message', { meta: { path: filePath, format: 'epub' } }));
    setTimeout(() => { spawned = true; child.emit('spawn'); }, 30);
    return child;
  } });
  t.after(async () => {
    queue.close();
    for (let i = 0; queue.active && i < 100; i++) await new Promise((r) => setTimeout(r, 10));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const cancelled = assert.rejects(queue.read('cancelled.epub', 1), (error) => error.code === 'IMPORT_CANCELLED');
  queue.cancel(1);
  const next = queue.read('next.epub', 2);
  await cancelled;
  assert.equal((await next).path, 'next.epub');
  assert.equal(terminated, 2);
});
