'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TARGETS = ['.cache', '.tmp'];
const DEFAULT_PROJECT = path.resolve(__dirname, '..');

function samePath(left, right) {
  const normalize = (value) => process.platform === 'win32'
    ? path.normalize(value).toLowerCase() : path.normalize(value);
  return normalize(left) === normalize(right);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep)
    && !path.isAbsolute(relative);
}

// Checking each ancestor also rejects an installation reached through a junction.
function checkedStat(entry, fsImpl) {
  const absolute = path.resolve(entry);
  const root = path.parse(absolute).root;
  let current = root;
  let stat;
  for (const part of ['', ...absolute.slice(root.length).split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    stat = fsImpl.lstatSync(current);
    if (stat.isSymbolicLink() || !samePath(fsImpl.realpathSync(current), current)) {
      throw new Error('拒绝清理符号链接、目录连接或重定向路径：' + current);
    }
    if (!samePath(current, absolute) && !stat.isDirectory()) {
      throw new Error('清理路径的上级不是目录：' + current);
    }
  }
  return stat;
}

function optionalDirectory(directory, fsImpl) {
  let stat;
  try { stat = checkedStat(directory, fsImpl); }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isDirectory()) throw new Error('清理容器不是目录：' + directory);
  return true;
}

function cleanCache({ apply = false, projectDirectory = DEFAULT_PROJECT, fsImpl = fs } = {}) {
  const project = path.resolve(projectDirectory);
  if (!/^f:[\\/]/i.test(project)) throw new Error('开发目录必须位于 F 盘：' + project);
  const projectStat = checkedStat(project, fsImpl);
  if (!projectStat.isDirectory()) throw new Error('开发目录无效：' + project);
  const roots = TARGETS.map((name) => path.join(project, name));
  const entries = [];

  function visit(directory, target) {
    for (const name of fsImpl.readdirSync(directory).sort()) {
      const entry = path.join(directory, name);
      if (!inside(target, entry)) throw new Error('清理路径越界：' + entry);
      const stat = checkedStat(entry, fsImpl);
      if (!stat.isFile() && !stat.isDirectory()) throw new Error('拒绝清理特殊文件：' + entry);
      if (stat.isDirectory()) visit(entry, target);
      entries.push({ path: entry, target, stat });
    }
  }

  // Inspect every target before deleting anything. Missing containers are not created.
  for (const target of roots) {
    if (optionalDirectory(target, fsImpl)) visit(target, target);
  }
  const result = {
    apply, roots,
    files: entries.filter((entry) => entry.stat.isFile()).length,
    directories: entries.filter((entry) => entry.stat.isDirectory()).length,
    bytes: entries.reduce((total, entry) => total + (entry.stat.isFile() ? entry.stat.size : 0), 0),
  };
  if (apply) {
    for (const entry of entries) {
      if (!roots.some((target) => samePath(target, entry.target) && inside(target, entry.path))) {
        throw new Error('清理路径越界：' + entry.path);
      }
      const current = checkedStat(entry.path, fsImpl);
      if (current.dev !== entry.stat.dev || current.ino !== entry.stat.ino
          || current.isDirectory() !== entry.stat.isDirectory()
          || (!current.isDirectory() && (current.size !== entry.stat.size || current.mtimeMs !== entry.stat.mtimeMs))) {
        throw new Error('文件在检查后发生变化，请关闭阅读器后重试：' + entry.path);
      }
      // No recursive/force removal: a newly added file, lock or permission failure stops cleanup.
      if (current.isDirectory()) fsImpl.rmdirSync(entry.path);
      else fsImpl.unlinkSync(entry.path);
    }
  }
  return result;
}

function run(argv = process.argv.slice(2), output = console, options = {}) {
  if (argv.some((arg) => !['--apply', '--help'].includes(arg)) || new Set(argv).size !== argv.length
      || (argv.includes('--help') && argv.length !== 1)) {
    throw new Error('参数无效。仅支持默认预览、--apply 或 --help，不接受自定义路径。');
  }
  if (argv.includes('--help')) {
    output.log('用法：node scripts/clean-cache.js [--apply | --help]\n默认只预览；--apply 仅清理开发目录内“.cache”和“.tmp”的内容。\n清理前请关闭阅读器及其他开发测试进程。保留两个容器目录，不处理用户数据、备份、源码及运行环境。');
    return;
  }
  const apply = argv.includes('--apply');
  if (apply) output.log('开始清理。请确保阅读器已关闭；遇到占用、权限错误或目录连接将停止。');
  const result = cleanCache({ ...options, apply });
  output.log((apply ? '已清理' : '预览（未删除）') + '：' + result.files + ' 个文件，'
    + result.directories + ' 个子目录，' + (result.bytes / 1024 / 1024).toFixed(2) + ' MiB。');
  for (const root of result.roots) output.log(root);
  if (!apply) output.log('确认以上范围后，关闭阅读器并使用 --apply 执行。');
  return result;
}

if (require.main === module) {
  try { run(); }
  catch (error) {
    console.error('清理失败：' + error.message + '\n可能已清理部分缓存；请关闭阅读器并检查路径或占用后重试。');
    process.exitCode = 1;
  }
}

module.exports = { cleanCache, run };
