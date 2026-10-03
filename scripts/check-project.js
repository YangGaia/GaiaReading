'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inspectManifest } = require('./check-runtime');

function collectJavaScript(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    // vendor 由 npm 安装时生成，不属于项目维护的源码。
    if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScript(file));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(file);
  }
  return files.sort();
}

function checkProject(root) {
  const errors = [...inspectManifest(root).errors];
  const files = ['src', 'scripts', 'tests'].flatMap((dir) => collectJavaScript(path.join(root, dir)));
  if (files.length === 0) errors.push('未找到项目 JavaScript 源码。');
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) {
      errors.push(`${path.relative(root, file)} 语法检查失败：\n${result.error ? result.error.message : result.stderr.trim()}`);
    }
  }
  return { errors, fileCount: files.length };
}

if (require.main === module) {
  const { errors, fileCount } = checkProject(path.join(__dirname, '..'));
  for (const error of errors) console.error('[错误] ' + error);
  if (errors.length === 0) console.log(`项目清单及 ${fileCount} 个 JavaScript 文件语法检查通过。`);
  process.exitCode = errors.length ? 1 : 0;
}

module.exports = { checkProject };
