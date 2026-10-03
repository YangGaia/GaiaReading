'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { configureDataPaths } = require('../src/shared/app-paths');

function resolveFPath(value, label = '测试路径', fsImpl = fs) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' 不能为空');
  const resolved = path.resolve(value);
  if (!/^f:[\\/]/i.test(resolved)) throw new Error(label + ' 必须位于 F 盘：' + resolved);
  if (resolved.slice(3).split(/[\\/]/).some(part => /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(label + ' 包含无效的 Windows 路径');
  }
  let ancestor = resolved;
  while (!fsImpl.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error(label + ' 没有可用的 F 盘父目录');
    ancestor = parent;
  }
  if (!/^f:[\\/]/i.test(fsImpl.realpathSync(ancestor))) throw new Error(label + ' 不得通过目录连接写入其他盘：' + resolved);
  return resolved;
}

function makeSmokeDirectory(prefix, temporaryRoot = path.resolve(__dirname, '../.tmp')) {
  if (!/^[a-z0-9-]+$/i.test(prefix)) throw new Error('隔离目录前缀无效');
  const root = resolveFPath(temporaryRoot, '隔离测试临时目录');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, prefix));
}

function configureSmokePaths(app, options) {
  const userData = resolveFPath(options.userData, '隔离用户数据');
  const sessionData = resolveFPath(options.sessionData || path.join(userData, 'session'), '隔离会话缓存');
  const temporary = resolveFPath(options.temp || userData, '隔离临时文件');
  // src/main does not infer isolation from Electron's current paths. Preserve
  // the runner's exact profile through the explicit environment contract.
  process.env.GAIA_USER_DATA_DIR = userData;
  process.env.GAIA_SESSION_DATA_DIR = sessionData;
  // A smoke runner always owns its disposable profile, even when the calling
  // command accidentally carries a user-data-dir from another launch.
  process.argv.push('--user-data-dir=' + userData);
  const configured = configureDataPaths(app, { projectDirectory: path.resolve(__dirname, '..'), argv: process.argv });
  const cache = configured.cacheDirectory;
  const extraEnvironment = {
    TEMP: temporary, TMP: temporary, TMPDIR: temporary,
    APP_BUILDER_TMP_DIR: path.join(temporary, 'build'),
    npm_config_logs_dir: path.join(cache, 'npm', '_logs'),
    npm_config_prefix: path.join(cache, 'npm-global'),
    electron_config_cache: path.join(cache, 'electron'),
    XDG_DATA_HOME: path.join(cache, 'xdg-data'), XDG_STATE_HOME: path.join(cache, 'xdg-state'),
    XDG_RUNTIME_DIR: path.join(temporary, 'xdg-runtime'),
    PIP_CACHE_DIR: path.join(cache, 'pip'), UV_CACHE_DIR: path.join(cache, 'uv'),
  };
  for (const directory of Object.values(extraEnvironment)) resolveFPath(directory);
  for (const directory of new Set(Object.values(extraEnvironment))) fs.mkdirSync(directory, { recursive: true });
  Object.assign(process.env, extraEnvironment, { npm_config_userconfig: path.join(cache, 'npm', 'user.npmrc') });
  app.setPath('temp', temporary);
  return { ...configured.paths, temp: temporary };
}

module.exports = { resolveFPath, makeSmokeDirectory, configureSmokePaths };
