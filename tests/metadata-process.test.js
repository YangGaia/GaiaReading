'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getEventListeners } = require('node:events');
const { METADATA_TIMEOUT_MS, runMetadataProcess } = require('../src/shared/metadata-process');

const fixtureSource = `
const fs = require('node:fs');
const path = require('node:path');
process.once('message', ({ filePath, temporaryRoot }) => {
  fs.mkdirSync(path.join(temporaryRoot, 'leftovers'));
  fs.writeFileSync(path.join(temporaryRoot, 'leftovers', 'parser.tmp'), 'temporary parse output');
  fs.writeFileSync(path.join(__dirname, 'observed.json'), JSON.stringify({ pid: process.pid, temporaryRoot }));
  if (filePath === 'hang.epub') { while (true) {} }
  if (filePath === 'crash.epub') process.exit(23);
  if (filePath === 'broken.epub') process.send({ type: 'metadata', ok: false, error: '损坏的图书' });
  else process.send({ type: 'metadata', ok: true, value: { path: filePath, title: 'test', pid: process.pid, temporaryRoot, runAsNode: process.env.ELECTRON_RUN_AS_NODE } });
  // The parent must terminate this lingering parser even after a result.
  setInterval(() => {}, 1000);
});
`;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-metadata-process-test-'));
  const workerPath = path.join(directory, 'worker.js');
  const temporaryRoot = path.join(directory, 'temporary');
  fs.mkdirSync(temporaryRoot);
  fs.writeFileSync(workerPath, fixtureSource);
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, workerPath, temporaryRoot, timeoutMs: 3000 };
}

function assertProcessStopped(pid) {
  assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
}

function assertClean(options) {
  assert.deepEqual(fs.readdirSync(options.temporaryRoot), []);
  const { pid } = JSON.parse(fs.readFileSync(path.join(options.directory, 'observed.json')));
  assertProcessStopped(pid);
}

async function waitUntilStarted(directory) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { return JSON.parse(fs.readFileSync(path.join(directory, 'observed.json'))); }
    catch (error) { await new Promise((resolve) => setTimeout(resolve, 20)); }
  }
  throw new Error('解析测试进程未启动');
}

test('元数据在独立进程返回，结果成功后也终止进程并清理临时资源', async (t) => {
  const options = fixture(t);
  const controller = new AbortController();
  const value = await runMetadataProcess('good.epub', { ...options, signal: controller.signal });
  assert.equal(value.path, 'good.epub');
  assert.notEqual(value.pid, process.pid);
  assert.equal(value.runAsNode, '1');
  assert.equal(path.dirname(value.temporaryRoot), options.temporaryRoot);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assertClean(options);
});

test('CPU 阻塞的解析受硬超时控制，主进程仍能响应，下一本正常继续', async (t) => {
  assert.equal(METADATA_TIMEOUT_MS, 15000);
  const options = fixture(t);
  let heartbeat = 0;
  const heartbeatTimer = setInterval(() => { heartbeat += 1; }, 15);
  t.after(() => clearInterval(heartbeatTimer));
  await assert.rejects(runMetadataProcess('hang.epub', { ...options, timeoutMs: 700 }), { code: 'BOOK_METADATA_TIMEOUT' });
  assert.ok(heartbeat > 2, '解析期间主进程事件循环应该仍然运转');
  assertClean(options);
  assert.equal((await runMetadataProcess('next.epub', options)).path, 'next.epub');
  assertClean(options);
});

test('解析进程异常退出或返回错误时明确失败，清理后仍可解析下一本', async (t) => {
  const options = fixture(t);
  await assert.rejects(runMetadataProcess('crash.epub', options), { code: 'BOOK_METADATA_PROCESS_EXITED' });
  assertClean(options);
  await assert.rejects(runMetadataProcess('broken.epub', options), { code: 'BOOK_METADATA_PARSE_FAILED', message: '损坏的图书' });
  assertClean(options);
  assert.equal((await runMetadataProcess('next.epub', options)).path, 'next.epub');
  assertClean(options);
});

test('取消正在 CPU 阻塞的解析会强制终止进程，清理完成后允许立即重试', async (t) => {
  const options = fixture(t);
  const controller = new AbortController();
  const pending = runMetadataProcess('hang.epub', { ...options, signal: controller.signal, timeoutMs: 6000 });
  const rejected = assert.rejects(pending, { name: 'AbortError', code: 'BOOK_IMPORT_CANCELLED' });
  await waitUntilStarted(options.directory);
  controller.abort();
  await rejected;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assertClean(options);
  assert.equal((await runMetadataProcess('retry.epub', options)).path, 'retry.epub');
});

test('预先取消不启动解析、不建立临时文件，也不留下取消监听', async (t) => {
  const options = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runMetadataProcess('good.epub', { ...options, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fs.existsSync(path.join(options.directory, 'observed.json')), false);
  assert.deepEqual(fs.readdirSync(options.temporaryRoot), []);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('解析程序无法启动时返回失败并清理已建立的临时目录', async (t) => {
  const options = fixture(t);
  await assert.rejects(runMetadataProcess('good.epub', {
    ...options, execPath: path.join(options.directory, 'missing-node.exe'),
  }), (error) => ['BOOK_METADATA_START_FAILED', 'BOOK_METADATA_PROCESS_FAILED'].includes(error.code));
  assert.deepEqual(fs.readdirSync(options.temporaryRoot), []);
});

test('默认 worker 可直接解析 TXT，保留旧元数据结构而不进入应用主进程', async (t) => {
  const options = fixture(t);
  const filePath = path.join(options.directory, '独立解析.txt');
  fs.writeFileSync(filePath, '内容');
  const value = await runMetadataProcess(filePath, { temporaryRoot: options.temporaryRoot });
  assert.equal(value.path, filePath);
  assert.equal(value.format, 'txt');
  assert.equal(value.title, '独立解析');
  assert.equal(value.author, '');
  assert.equal(value.cover, null);
  assert.deepEqual(fs.readdirSync(options.temporaryRoot), []);
});
