'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const project = path.join(__dirname, '..');
const script = path.join(project, 'scripts/create-release-shortcut.ps1');
const windows = process.platform === 'win32';
const quote = value => "'" + value.replace(/'/g, "''") + "'";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-shortcut-'));
  const desktop = path.join(root, 'Desktop');
  fs.mkdirSync(desktop);
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.8.7' }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, desktop, exe: path.join(root, 'dist/Gaia.Reading.9.8.7.exe') };
}

function create(root, desktop) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProjectRoot', root, '-DesktopPath', desktop], { encoding: 'utf8', windowsHide: true });
}

test('桌面只创建快捷方式，目标、工作目录和图标指向 dist 内 exe', { skip: !windows }, t => {
  const { root, desktop, exe } = fixture(t);
  fs.writeFileSync(exe, 'test release fixture; never executed');
  const result = create(root, desktop);
  assert.equal(result.status, 0, result.stderr);
  const shortcut = JSON.parse(result.stdout);
  const inspected = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$s=(New-Object -ComObject WScript.Shell).CreateShortcut(' + quote(shortcut.Shortcut) + '); $s | Select-Object TargetPath,WorkingDirectory,IconLocation | ConvertTo-Json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(inspected.status, 0, inspected.stderr);
  const actual = JSON.parse(inspected.stdout);
  assert.equal(actual.TargetPath, exe);
  assert.equal(actual.WorkingDirectory, path.dirname(exe));
  assert.equal(actual.IconLocation, exe + ',0');
  assert.deepEqual(fs.readdirSync(desktop), ['Gaia.Reading.9.8.7.lnk']);
  assert.equal(fs.readFileSync(exe, 'utf8'), 'test release fixture; never executed');
  assert.equal(create(root, desktop).status, 0, '重复生成应可更新同一快捷方式');
});

test('缺少 dist exe 或桌面已有同版本 exe 时拒绝生成，不复制或删除文件', { skip: !windows }, t => {
  const { root, desktop, exe } = fixture(t);
  assert.notEqual(create(root, desktop).status, 0);
  assert.deepEqual(fs.readdirSync(desktop), []);
  fs.writeFileSync(exe, 'dist fixture');
  const duplicate = path.join(desktop, 'Gaia.Reading.9.8.7.exe');
  fs.writeFileSync(duplicate, 'desktop fixture');
  assert.notEqual(create(root, desktop).status, 0);
  assert.deepEqual(fs.readdirSync(desktop), ['Gaia.Reading.9.8.7.exe']);
  assert.equal(fs.readFileSync(duplicate, 'utf8'), 'desktop fixture');
});

test('1.1.9 发布说明包含全屏更新、下载方式与实际构建校验值', async () => {
  const notes = fs.readFileSync(path.join(project, 'RELEASE_NOTES_1.1.9.md'), 'utf8');
  assert.match(notes, /Gaia Reading 1\.1\.9/);
  for (const value of ['全屏阅读', 'F11', 'Esc', '原来这一屏', '横向滚动条', '桌面只创建', 'Gaia.Reading.1.1.9.exe']) assert.ok(notes.includes(value), value);
  const size = notes.match(/文件大小：(\d+) 字节/);
  const checksum = notes.match(/SHA-256：`([A-F0-9]{64})`/);
  assert.ok(size && checksum, '发布说明应包含 EXE 字节数和 SHA-256');
  assert.doesNotMatch(notes, /待构建|构建完成后填入/);
  const artifact = path.join(project, 'dist', 'Gaia.Reading.1.1.9.exe');
  if (!fs.existsSync(artifact)) return;
  assert.equal(fs.statSync(artifact).size, Number(size[1]), '发布说明中的文件大小应与实际 exe 一致');
  const hash = require('node:crypto').createHash('sha256');
  for await (const chunk of fs.createReadStream(artifact)) hash.update(chunk);
  assert.equal(hash.digest('hex').toUpperCase(), checksum[1], '发布说明 SHA-256 应与实际 exe 一致');
});
