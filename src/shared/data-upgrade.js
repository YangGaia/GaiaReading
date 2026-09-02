'use strict';

const fs = require('fs');
const path = require('path');

const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_BACKUP_LIMIT = 5;
const BACKUP_PREFIX = 'gaia-reading-before-';

const MIGRATIONS = {
  0(data) {
    // v1 建立正式的数据版本标记；旧字段原样保留，避免影响既有用户数据。
    return Object.assign({}, data);
  },
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value && typeof value === 'object' ? value : {}));
}

function schemaVersionOf(data) {
  const value = Number(data && data._meta && data._meta.schemaVersion);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function migrateData(data, options) {
  const opts = options || {};
  const appVersion = String(opts.appVersion || '0.0.0');
  const now = Number(opts.now) || Date.now();
  let next = cloneJson(data);
  let schemaVersion = schemaVersionOf(next);
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error('数据版本 ' + schemaVersion + ' 高于当前程序支持的版本 ' + CURRENT_SCHEMA_VERSION);
  }
  while (schemaVersion < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[schemaVersion];
    if (typeof migrate !== 'function') throw new Error('缺少从数据版本 ' + schemaVersion + ' 开始的迁移程序');
    next = migrate(next);
    schemaVersion += 1;
  }
  next._meta = Object.assign({}, next._meta || {}, {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion,
    upgradedAt: new Date(now).toISOString(),
  });
  return next;
}

function safeVersion(value) {
  return String(value || 'unknown').replace(/[^0-9A-Za-z._-]+/g, '-');
}

function timestampForFile(now) {
  return new Date(now).toISOString().replace(/[:.]/g, '-');
}

function backupFiles(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.json'))
    .map((name) => {
      const filePath = path.join(backupDir, name);
      return { name, path: filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
}

function pruneBackups(backupDir, limit) {
  const keep = Math.max(1, Number(limit) || DEFAULT_BACKUP_LIMIT);
  const files = backupFiles(backupDir);
  for (const file of files.slice(keep)) fs.unlinkSync(file.path);
  return files.slice(0, keep).map((file) => file.path);
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + '.upgrade.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function prepareDataFile(filePath, options) {
  const opts = options || {};
  const appVersion = String(opts.appVersion || '0.0.0');
  const now = Number(opts.now) || Date.now();
  const backupLimit = opts.backupLimit == null ? DEFAULT_BACKUP_LIMIT : opts.backupLimit;
  const backupDir = path.join(path.dirname(filePath), 'backups');

  if (!fs.existsSync(filePath)) {
    writeJsonAtomic(filePath, migrateData({}, { appVersion, now }));
    return { created: true, upgraded: false, backupPath: null };
  }

  // JSON 无法读取时立即停止，不覆盖原文件，给用户保留人工恢复空间。
  const originalText = fs.readFileSync(filePath, 'utf8');
  const originalData = JSON.parse(originalText);
  const currentSchema = schemaVersionOf(originalData);
  const storedAppVersion = originalData && originalData._meta && originalData._meta.appVersion;
  if (currentSchema === CURRENT_SCHEMA_VERSION && storedAppVersion === appVersion) {
    return { created: false, upgraded: false, backupPath: null };
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const backupName = BACKUP_PREFIX + safeVersion(appVersion) + '-' + timestampForFile(now) + '.json';
  const backupPath = path.join(backupDir, backupName);
  fs.writeFileSync(backupPath, originalText, 'utf8');

  // 所有迁移都先在内存完成；任何异常发生时，原数据文件仍保持不变。
  const migrated = migrateData(originalData, { appVersion, now });
  writeJsonAtomic(filePath, migrated);
  pruneBackups(backupDir, backupLimit);
  return { created: false, upgraded: true, backupPath };
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_BACKUP_LIMIT,
  migrateData,
  prepareDataFile,
  backupFiles,
  pruneBackups,
};
