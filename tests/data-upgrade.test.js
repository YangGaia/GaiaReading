'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CURRENT_SCHEMA_VERSION, prepareDataFile, backupFiles, pruneBackups } = require('../src/shared/data-upgrade');

function tempDataFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'GaiaReading_Lucky-upgrade-'));
  return { dir, file: path.join(dir, 'GaiaReading_Lucky.json') };
}

test('首次运行创建带版本标记的数据文件且不生成无意义备份', () => {
  const { dir, file } = tempDataFile();
  const result = prepareDataFile(file, { appVersion: '0.5.3', now: Date.UTC(2026, 8, 2) });
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(result.created, true);
  assert.strictEqual(data._meta.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.strictEqual(data._meta.appVersion, '0.5.3');
  assert.deepStrictEqual(backupFiles(path.join(dir, 'backups')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('旧版数据升级前完整备份并保留全部用户字段', () => {
  const { dir, file } = tempDataFile();
  const legacy = {
    library: [{ path: 'D:/books/a.azw3', title: '旧书' }],
    progress: { 'D:/books/a.azw3': { percent: 42.5 } },
    bookmarks: { 'D:/books/a.azw3': [{ name: '书签' }] },
    annotations: { 'D:/books/a.azw3': [{ id: 'n1', note: '重要笔记' }] },
    readingStats: { goalMinutes: 30 },
    customFutureField: { keep: true },
  };
  fs.writeFileSync(file, JSON.stringify(legacy), 'utf8');
  const result = prepareDataFile(file, { appVersion: '0.5.3', now: Date.UTC(2026, 8, 2, 12) });
  assert.strictEqual(result.upgraded, true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(result.backupPath, 'utf8')), legacy);
  const migrated = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of Object.keys(legacy)) assert.deepStrictEqual(migrated[key], legacy[key]);
  assert.strictEqual(migrated._meta.appVersion, '0.5.3');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('同一版本重复启动不重复备份，新版本备份只保留最近五份', () => {
  const { dir, file } = tempDataFile();
  prepareDataFile(file, { appVersion: '1.0.0', now: 1000 });
  const same = prepareDataFile(file, { appVersion: '1.0.0', now: 2000 });
  assert.strictEqual(same.upgraded, false);
  for (let version = 1; version <= 7; version++) {
    prepareDataFile(file, { appVersion: '1.0.' + version, now: 10000 + version * 1000 });
  }
  assert.strictEqual(backupFiles(path.join(dir, 'backups')).length, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('损坏或更高版本数据不会被覆盖', () => {
  const broken = tempDataFile();
  fs.writeFileSync(broken.file, '{broken', 'utf8');
  assert.throws(() => prepareDataFile(broken.file, { appVersion: '1.0.0' }));
  assert.strictEqual(fs.readFileSync(broken.file, 'utf8'), '{broken');
  fs.rmSync(broken.dir, { recursive: true, force: true });

  const future = tempDataFile();
  const text = JSON.stringify({ _meta: { schemaVersion: CURRENT_SCHEMA_VERSION + 1, appVersion: '9.0.0' }, library: ['keep'] });
  fs.writeFileSync(future.file, text, 'utf8');
  assert.throws(() => prepareDataFile(future.file, { appVersion: '1.0.0' }), /高于当前程序支持/);
  assert.strictEqual(fs.readFileSync(future.file, 'utf8'), text);
  fs.rmSync(future.dir, { recursive: true, force: true });
});


test('新备份使用新品牌前缀，旧前缀仍参与识别与保留策略', () => {
  const { dir, file } = tempDataFile();
  try {
    fs.writeFileSync(file, JSON.stringify({ library: ['unchanged'] }));
    const result = prepareDataFile(file, { appVersion: '1.1.1', now: 2000 });
    assert.ok(path.basename(result.backupPath).startsWith('GaiaReading_Lucky-before-'));
    const backupDir = path.join(dir, 'backups');
    const legacy = path.join(backupDir, 'gaia-reading-before-1.0.0-old.json');
    const unrelated = path.join(backupDir, 'manual-archive.json');
    fs.writeFileSync(legacy, 'legacy backup');
    fs.writeFileSync(unrelated, 'keep manual archive');
    fs.utimesSync(legacy, 1, 1);
    fs.utimesSync(result.backupPath, 2, 2);
    assert.strictEqual(backupFiles(backupDir).length, 2);
    assert.ok(backupFiles(backupDir).some((entry) => entry.path === legacy));
    pruneBackups(backupDir, 1);
    assert.strictEqual(fs.existsSync(result.backupPath), true);
    assert.strictEqual(fs.existsSync(legacy), false);
    assert.strictEqual(fs.readFileSync(unrelated, 'utf8'), 'keep manual archive');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
