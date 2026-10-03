'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const MIN_NODE_VERSION = '22.12.0';
const VENDOR_FILES = ['jszip.min.js', 'epub.min.js', 'pdf.min.js', 'pdf.worker.min.js'];

function supportsNode(version) {
  const normalized = String(version).replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) return false;
  const actual = normalized.split('.').map(Number);
  const minimum = MIN_NODE_VERSION.split('.').map(Number);
  if (actual.length !== 3 || actual.some((part) => !Number.isInteger(part) || part < 0)) return false;
  for (let i = 0; i < minimum.length; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isNonemptyFile(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function inspectManifest(root) {
  const errors = [];
  let pkg;
  let lock;
  try {
    pkg = readJson(path.join(root, 'package.json'));
    lock = readJson(path.join(root, 'package-lock.json'));
    if (!pkg || !lock || typeof pkg !== 'object' || typeof lock !== 'object' || Array.isArray(pkg) || Array.isArray(lock)) {
      throw new Error('package.json 和 package-lock.json 必须包含 JSON 对象。');
    }
  } catch (error) {
    return { errors: ['无法读取项目依赖清单：' + error.message] };
  }
  const lockedRoot = lock.packages && lock.packages[''];
  if (!lockedRoot) {
    errors.push('package-lock.json 缺少项目记录，请用 npm install 更新锁文件并提交。');
  } else {
    for (const key of ['name', 'version', 'engines', 'dependencies', 'devDependencies']) {
      if (!isDeepStrictEqual(pkg[key], lockedRoot[key])) {
        errors.push(`package.json 与 package-lock.json 的 ${key} 不一致，请用 npm install 更新锁文件并提交。`);
      }
    }
  }
  const electron = lock.packages && lock.packages['node_modules/electron'];
  if (electron && (!pkg.allowScripts || pkg.allowScripts[`electron@${electron.version}`] !== true)) {
    errors.push(`npm 12 所需的 Electron 安装脚本许可与锁文件不一致。请核对依赖后运行 npm install-scripts approve electron@${electron.version}，并提交 package.json。`);
  }
  return { pkg, lock, errors };
}

function inspectRuntime(root, version = process.versions.node, options = {}) {
  const errors = [];
  if (!supportsNode(version)) {
    errors.push(`当前 Node.js ${version} 不受支持，请安装 Node.js ${MIN_NODE_VERSION} 或更新版本（推荐 24 LTS）。`);
  }
  if (options.nodeOnly) return errors;

  const manifest = inspectManifest(root);
  errors.push(...manifest.errors);
  if (!manifest.pkg || !manifest.lock) return errors;
  const dependencies = { ...manifest.pkg.dependencies, ...manifest.pkg.devDependencies };
  for (const name of Object.keys(dependencies)) {
    const locked = manifest.lock.packages && manifest.lock.packages[`node_modules/${name}`];
    try {
      const installed = readJson(path.join(root, 'node_modules', name, 'package.json'));
      if (!locked || installed.version !== locked.version) {
        errors.push(`依赖 ${name} 与锁文件不一致，请运行 npm ci --include=dev。`);
      }
      require.resolve(name, { paths: [root] });
    } catch {
      errors.push(`缺少依赖 ${name}，请运行 npm ci --include=dev。`);
    }
  }

  try {
    const electronRoot = path.join(root, 'node_modules', 'electron');
    const executable = fs.readFileSync(path.join(electronRoot, 'path.txt'), 'utf8').trim();
    if (!executable || !isNonemptyFile(path.join(electronRoot, 'dist', executable))) {
      throw new Error('missing executable');
    }
  } catch {
    errors.push('Electron 程序未完整下载，请关闭阅读器后运行 npm ci --include=dev，并检查网络。');
  }

  const electronCommand = (options.platform || process.platform) === 'win32' ? 'electron.cmd' : 'electron';
  if (!isNonemptyFile(path.join(root, 'node_modules', '.bin', electronCommand))) {
    errors.push('缺少 Electron 启动命令，请运行 npm ci --include=dev。');
  }

  for (const file of VENDOR_FILES) {
    if (!isNonemptyFile(path.join(root, 'src', 'renderer', 'vendor', file))) {
      errors.push(`缺少阅读组件 ${file}，请运行 npm run copy-vendor；若失败，请运行 npm ci --include=dev。`);
    }
  }
  return errors;
}

if (require.main === module) {
  const errors = inspectRuntime(path.join(__dirname, '..'), process.versions.node, {
    nodeOnly: process.argv.includes('--node-only'),
  });
  if (!process.argv.includes('--quiet')) {
    for (const error of errors) console.error('[错误] ' + error);
    if (errors.length === 0) console.log('运行环境检查通过。');
  }
  process.exitCode = errors.length ? 1 : 0;
}

module.exports = { MIN_NODE_VERSION, VENDOR_FILES, supportsNode, inspectManifest, inspectRuntime };
