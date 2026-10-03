'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { MobiSessions } = require('../src/shared/mobi-sessions');
const { makeHybrid } = require('./fixtures/mobi-image-fixture');

function sessionsFor(context, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-mobi-sessions-'));
  const sessions = new MobiSessions({
    tempRoot: directory, timeoutMs: options.timeoutMs || 1200,
    fork: options.fork || (() => {
      const child = fork(options.worker || path.join(__dirname, 'fixtures/mobi-worker-failure.js'), [], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
      });
      child.postMessage = message => child.send(message);
      return child;
    }),
  });
  context.after(async () => {
    await sessions.close();
    assert.equal(sessions.sessions.size, 0);
    assert.deepEqual(fs.readdirSync(directory), []);
    fs.rmdirSync(directory);
  });
  return sessions;
}

test('打开或翻章陷入无限循环，主进程仍响应并超时终止', async context => {
  const sessions = sessionsFor(context);
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 20);
  context.after(() => clearInterval(timer));
  await assert.rejects(sessions.open('hang.mobi', 1), { code: 'MOBI_TIMEOUT' });
  assert.ok(ticks >= 10);
  const opened = await sessions.open('chapter-hang.mobi', 1);
  await assert.rejects(sessions.request(opened.sessionId, 1, 'chapter', { index: 0 }), { code: 'MOBI_TIMEOUT' });
  assert.equal((await sessions.open('next.mobi', 1)).title, 'next.mobi');
});

test('解析崩溃或解析失败后可重新打开其他书', async context => {
  const sessions = sessionsFor(context);
  await assert.rejects(sessions.open('crash.mobi', 1), { code: 'MOBI_WORKER_EXIT' });
  await assert.rejects(sessions.open('invalid.mobi', 1), /损坏的书籍/);
  const opened = await sessions.open('valid.mobi', 1);
  assert.match((await sessions.request(opened.sessionId, 1, 'chapter', { index: 0 })).html, /正文/);
});

test('返回书架取消尚未打开的书，换书取消旧请求且不会污染其他窗口', async context => {
  const sessions = sessionsFor(context);
  const cancelled = assert.rejects(sessions.open('hang.mobi', 1), { code: 'MOBI_CANCELLED' });
  await sessions.closeOwner(1);
  await cancelled;
  const replaced = assert.rejects(sessions.open('hang.mobi', 1), { code: 'MOBI_CANCELLED' });
  const second = await sessions.open('replacement.mobi', 1);
  await replaced;
  const other = await sessions.open('other.mobi', 2);
  await sessions.closeOwner(1);
  await assert.rejects(sessions.request(second.sessionId, 1, 'chapter', { index: 0 }), { code: 'MOBI_SESSION_CLOSED' });
  await assert.rejects(sessions.request(other.sessionId, 1, 'chapter', { index: 0 }), { code: 'MOBI_SESSION_CLOSED' });
  await sessions.closeSession(other.sessionId, 1);
  assert.match((await sessions.request(other.sessionId, 2, 'chapter', { index: 0 })).html, /正文/);
});

test('迟到的 spawn 在取消后仍被终止，启动异常也清理目录', async context => {
  let killed = 0;
  const sessions = sessionsFor(context, { fork: () => {
    const child = new EventEmitter();
    let spawned = false;
    child.kill = () => {
      if (!spawned) return false;
      killed++;
      setImmediate(() => child.emit('exit', 0));
      return true;
    };
    child.postMessage = () => assert.fail('cancelled worker must not receive requests');
    setTimeout(() => { spawned = true; child.emit('spawn'); }, 40);
    return child;
  } });
  const cancelled = assert.rejects(sessions.open('hang.mobi', 1), { code: 'MOBI_CANCELLED' });
  await sessions.closeOwner(1);
  await cancelled;
  assert.equal(killed, 1);
  sessions.fork = () => { throw new Error('启动失败'); };
  await assert.rejects(sessions.open('next.mobi', 1), /启动失败/);
});

test('生产 worker 支持混合 MOBI 打开、轻量采样、加载及关闭', async context => {
  const sessions = sessionsFor(context, { worker: path.join(__dirname, '../src/mobi-worker.js'), timeoutMs: 10000 });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-mobi-worker-fixture-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = makeHybrid(directory);
  const opened = await sessions.open(fixture.path, 1);
  assert.equal(opened.kind, 'kf8');
  assert.equal(opened.chapters.length, 4);
  assert.match(opened.textSample, /阅读位置验证/);
  assert.match((await sessions.request(opened.sessionId, 1, 'chapter', { index: 3 })).html, /data:image/);
  assert.deepEqual(await sessions.request(opened.sessionId, 1, 'resolve', { href: 'invalid' }), { index: null, selector: '' });
  await sessions.closeSession(opened.sessionId, 1);
  await assert.rejects(sessions.request(opened.sessionId, 1, 'chapter', { index: 0 }), { code: 'MOBI_SESSION_CLOSED' });
});
