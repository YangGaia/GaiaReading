'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanCache, run } = require('../scripts/clean-cache');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'GaiaReading_Lucky-clean-cache-'));
  const installation = path.join(base, 'installation');
  const projectDirectory = path.join(installation, '开发');
  const cache = path.join(projectDirectory, '.cache');
  const temporary = path.join(projectDirectory, '.tmp');
  for (const directory of [projectDirectory, cache, temporary]) fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const write = (relative, content = 'keep') => {
    const target = path.join(installation, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  };
  return { base, installation, projectDirectory, cache, temporary, write };
}

function snapshot(directory) {
  return fs.readdirSync(directory).sort().flatMap((name) => {
    const entry = path.join(directory, name);
    return fs.statSync(entry).isDirectory() ? [entry, ...snapshot(entry)] : [entry, fs.readFileSync(entry).toString('hex')];
  });
}

test('F 盘外的开发目录在任何枚举或删除前拒绝', () => {
  const fsImpl = { lstatSync() { assert.fail('不得访问 F 盘外的清理目标'); } };
  for (const apply of [false, true]) assert.throws(() => cleanCache({ projectDirectory: 'C:\\gaia-clean-test', fsImpl, apply }), /F 盘/);
});

test('默认预览不改动文件；执行仅清理指定容器内容并保留兄弟数据', (t) => {
  const f = fixture(t);
  f.write('开发/.cache/npm/nested/item.bin', 'abc');
  f.write('开发/.tmp/session/file.bin', 'de');
  const preserved = [
    '开发/src/main.js', '数据/GaiaReading_Lucky.json', '程序/GaiaReading_Lucky.exe',
    '开发/运行环境/node/node.exe', '备份/profile/key.bin',
    '开发/.cache-old/untouched', '时政/book.txt',
  ].map((name) => f.write(name));
  const before = snapshot(f.installation);
  const result = cleanCache({ projectDirectory: f.projectDirectory });
  assert.equal(result.files, 2);
  assert.equal(result.directories, 3);
  assert.equal(result.bytes, 5);
  assert.deepEqual(snapshot(f.installation), before);
  assert.deepEqual(cleanCache({ projectDirectory: f.projectDirectory, apply: true }), { ...result, apply: true });
  assert.deepEqual(fs.readdirSync(f.cache), []);
  assert.deepEqual(fs.readdirSync(f.temporary), []);
  for (const entry of preserved) assert.equal(fs.readFileSync(entry, 'utf8'), 'keep');
  assert.equal(cleanCache({ projectDirectory: f.projectDirectory, apply: true }).files, 0);
});

test('容器不存在时不创建任何目录，容器是普通文件则拒绝', (t) => {
  const f = fixture(t);
  fs.rmdirSync(f.cache);
  fs.rmdirSync(f.temporary);
  assert.equal(cleanCache({ projectDirectory: f.projectDirectory, apply: true }).files, 0);
  assert.equal(fs.existsSync(f.cache), false);
  assert.equal(fs.existsSync(f.temporary), false);
  fs.writeFileSync(f.cache, 'preserve');
  assert.throws(() => cleanCache({ projectDirectory: f.projectDirectory, apply: true }), /不是目录/);
  assert.equal(fs.readFileSync(f.cache, 'utf8'), 'preserve');
});

test('安装根、开发目录、目标和嵌套内容中的目录连接均拒绝且外部数据保留', (t) => {
  for (const level of ['installation', 'projectDirectory', 'cache', 'nested']) {
    const f = fixture(t);
    const outside = path.join(f.base, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'valuable.txt'), 'valuable');
    const target = level === 'nested' ? path.join(f.temporary, 'linked') : f[level];
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
    fs.symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
    if (level === 'nested') f.write('开发/.cache/a-first.txt', 'keep');
    for (const apply of [false, true]) {
      assert.throws(() => cleanCache({ projectDirectory: f.projectDirectory, apply }), /符号链接|目录连接|重定向/);
    }
    assert.equal(fs.readFileSync(path.join(outside, 'valuable.txt'), 'utf8'), 'valuable');
    if (level === 'nested') assert.equal(fs.readFileSync(path.join(f.cache, 'a-first.txt'), 'utf8'), 'keep', '所有目标检查完成前不删除文件');
  }
});

test('目录枚举越界和 realpath 重定向均拒绝', (t) => {
  const f = fixture(t);
  const valuable = f.write('数据/valuable.txt', 'valuable');
  const traversalFs = Object.create(fs);
  traversalFs.readdirSync = (entry) => entry === f.cache ? ['../../数据/valuable.txt'] : fs.readdirSync(entry);
  assert.throws(() => cleanCache({ projectDirectory: f.projectDirectory, fsImpl: traversalFs, apply: true }), /越界/);
  const redirectedFs = Object.create(fs);
  redirectedFs.realpathSync = (entry) => entry === f.cache ? path.join(f.installation, '数据') : fs.realpathSync(entry);
  assert.throws(() => cleanCache({ projectDirectory: f.projectDirectory, fsImpl: redirectedFs, apply: true }), /重定向/);
  assert.equal(fs.readFileSync(valuable, 'utf8'), 'valuable');
});

test('文件被占用时立即报错，不强制删除或继续处理后续文件', (t) => {
  const f = fixture(t);
  const locked = f.write('开发/.cache/a-locked.bin');
  const later = f.write('开发/.cache/z-later.bin');
  const controlledFs = Object.create(fs);
  const calls = [];
  controlledFs.unlinkSync = (entry) => {
    calls.push(entry);
    const error = new Error('file is busy'); error.code = 'EBUSY'; throw error;
  };
  assert.throws(() => cleanCache({ projectDirectory: f.projectDirectory, fsImpl: controlledFs, apply: true }), { code: 'EBUSY' });
  assert.deepEqual(calls, [locked]);
  assert.equal(fs.readFileSync(locked, 'utf8'), 'keep');
  assert.equal(fs.readFileSync(later, 'utf8'), 'keep');
});

test('检查后被替换的文件拒绝删除', (t) => {
  const f = fixture(t);
  const file = f.write('开发/.cache/changing.bin');
  const controlledFs = Object.create(fs);
  let reads = 0;
  controlledFs.lstatSync = (entry) => {
    if (entry === file && ++reads === 2) fs.writeFileSync(file, 'new content after inspection');
    return fs.lstatSync(entry);
  };
  assert.throws(() => cleanCache({ projectDirectory: f.projectDirectory, fsImpl: controlledFs, apply: true }), /发生变化/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new content after inspection');
});

test('命令行只允许预览、--apply、--help，不能传入目录', (t) => {
  const f = fixture(t);
  const file = f.write('开发/.cache/preserve.bin');
  const messages = [];
  const output = { log: (message) => messages.push(message) };
  for (const argv of [['--path', f.installation], [f.installation], ['--force'], ['--apply', '--apply'], ['--help', '--apply']]) {
    assert.throws(() => run(argv, output, { projectDirectory: f.projectDirectory }), /参数无效/);
  }
  run(['--help'], output, { fsImpl: { lstatSync: () => assert.fail('帮助不访问文件系统') } });
  assert.match(messages.join('\n'), /关闭阅读器/);
  assert.equal(run([], output, { projectDirectory: f.projectDirectory }).apply, false);
  assert.equal(fs.existsSync(file), true);
  assert.equal(run(['--apply'], output, { projectDirectory: f.projectDirectory }).apply, true);
  assert.equal(fs.existsSync(file), false);
});
