'use strict';

const fs = require('node:fs');
const path = require('node:path');

const APP_NAME = 'GaiaReading_Lucky';
const APP_ID = 'com.gaiareading.lucky';
const STATE_FILE_NAME = APP_NAME + '.json';
const KEY_FILE_NAME = APP_NAME + '-ai-key.bin';
const LEGACY_STATE_FILE_NAME = 'gaia-reading.json';
const LEGACY_KEY_FILE_NAME = 'gaia-ai-key.bin';

function validateDirectory(value, label, cwd = process.cwd(), requiredDrive = null) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + '不能为空');
  const resolved = path.resolve(cwd, value);
  if (requiredDrive && resolved.slice(0, 3).toLowerCase() !== requiredDrive.toLowerCase() + ':\\') {
    throw new Error(label + '必须位于 ' + requiredDrive + ' 盘：' + resolved);
  }
  if (!/^[a-z]:[\\/]/i.test(resolved)) throw new Error(label + '必须是本地磁盘的绝对路径：' + resolved);
  const parts = resolved.slice(3).split(/[\\/]/);
  if (parts.some((part) => /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
    throw new Error(label + '包含无效的 Windows 目录名：' + resolved);
  }
  // Resolve the existing ancestor before creating any descendant files. The
  // canonical future path also catches same-drive links outside a portable root.
  let ancestor = resolved;
  for (;;) {
    try { fs.lstatSync(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error(label + '所在的磁盘不可用');
      ancestor = parent;
    }
  }
  const actual = fs.realpathSync(ancestor).replace(/^\\\\\?\\/, '');
  if (path.parse(actual).root.toLowerCase() !== path.parse(resolved).root.toLowerCase()) {
    throw new Error(label + '不能通过链接写入所选磁盘以外：' + actual);
  }
  if (!fs.statSync(ancestor).isDirectory()) throw new Error(label + '必须是目录：' + ancestor);
  return { resolved, actual: path.resolve(actual, path.relative(ancestor, resolved)) };
}

function requireFPath(value, label = '写入目录', cwd = process.cwd()) {
  return validateDirectory(value, label, cwd, 'F').resolved;
}

function portableRoot(options) {
  if (options.packaged !== true || options.portableDirectory == null) return null;
  const value = options.portableDirectory;
  if (typeof value !== 'string' || !value.trim()) throw new Error('便携程序目录不能为空');
  if (!/^[a-z]:[\\/]/i.test(value)) throw new Error('便携程序目录必须是本地磁盘的绝对路径：' + value);
  return validateDirectory(value, '便携程序目录', options.cwd);
}

function isWithinDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

function requirePortablePath(value, root, label = '写入目录') {
  const directory = validateDirectory(value, label);
  if (!isWithinDirectory(root.resolved, directory.resolved) || !isWithinDirectory(root.actual, directory.actual)) {
    throw new Error(label + '必须保持在便携程序目录内，不能通过链接重定向到其他位置：' + directory.resolved);
  }
  return directory.resolved;
}

function commandLineDataDirectory(argv, cwd) {
  let selected = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (argument === '--user-data-dir') {
      selected = argv[++index];
      if (selected == null || String(selected).startsWith('--')) throw new Error('--user-data-dir 缺少数据目录');
    } else if (argument.startsWith('--user-data-dir=')) {
      selected = argument.slice('--user-data-dir='.length);
    } else continue;
    if (!String(selected).trim()) throw new Error('--user-data-dir 数据目录不能为空');
  }
  return selected == null ? null : requireFPath(String(selected), '--user-data-dir 数据目录', cwd);
}

function explicitDataDirectory(options) {
  const opts = options || {};
  const fromArgs = commandLineDataDirectory(opts.argv || [], opts.cwd);
  if (fromArgs) return fromArgs;
  const environment = opts.env || process.env;
  return environment.GAIA_USER_DATA_DIR == null ? null
    : requireFPath(environment.GAIA_USER_DATA_DIR, 'GAIA_USER_DATA_DIR', opts.cwd);
}

function resolveUserDataDirectory(options) {
  const opts = options || {};
  const explicit = explicitDataDirectory(opts);
  if (explicit) return explicit;
  const portable = portableRoot(opts);
  if (portable) return requirePortablePath(path.join(portable.resolved, '数据'), portable, '默认数据目录');
  let installationRoot = opts.packaged
    ? requireFPath(path.dirname(opts.executablePath || process.execPath), '程序目录', opts.cwd)
    : path.dirname(requireFPath(opts.projectDirectory, '开发目录', opts.cwd));
  // The final layout is 阅读/{程序,开发,数据,备份}. Keep the previous
  // directory-build name compatible while an existing installation is moved.
  if (opts.packaged && ['程序', (APP_NAME + '-Windows').toLowerCase()].includes(path.basename(installationRoot).toLowerCase())) {
    installationRoot = path.dirname(installationRoot);
  }
  return requireFPath(path.join(installationRoot, '数据'), '默认数据目录');
}

function configureDataPaths(app, options) {
  const opts = { ...options, packaged: app.isPackaged };
  const environment = opts.env || process.env;
  const explicit = explicitDataDirectory(opts);
  const sourceUserDataDirectory = resolveUserDataDirectory({
    ...opts,
    packaged: app.isPackaged,
    executablePath: opts.executablePath || process.execPath,
  });
  const isolated = !explicit && (opts.smoke ? '-smoke-' : opts.shot ? '-shot-' : null);
  // Explicit development/test profiles keep their F-drive contract even when
  // the executable itself is a portable release on another drive.
  const portable = !explicit && !isolated ? portableRoot(opts) : null;
  let userDataDirectory = sourceUserDataDirectory;
  if (isolated) {
    const developmentDirectory = app.isPackaged
      ? path.join(path.dirname(sourceUserDataDirectory), '开发')
      : opts.projectDirectory;
    userDataDirectory = path.join(developmentDirectory, '.tmp', APP_NAME + isolated + (opts.pid || process.pid));
  }
  const paths = {
    appData: path.join(userDataDirectory, '系统资料'),
    userData: userDataDirectory,
    sessionData: environment.GAIA_SESSION_DATA_DIR == null
      ? userDataDirectory
      : requireFPath(environment.GAIA_SESSION_DATA_DIR, 'GAIA_SESSION_DATA_DIR', opts.cwd),
    temp: path.join(userDataDirectory, '临时文件'),
    logs: path.join(userDataDirectory, '日志'),
    crashDumps: path.join(userDataDirectory, '崩溃记录'),
  };
  const cacheDirectory = path.join(userDataDirectory, '缓存');
  const runtimeEnvironment = {
    GAIA_USER_DATA_DIR: paths.userData, GAIA_SESSION_DATA_DIR: paths.sessionData,
    TEMP: paths.temp, TMP: paths.temp, TMPDIR: paths.temp,
    APPDATA: paths.appData, LOCALAPPDATA: cacheDirectory,
    XDG_CONFIG_HOME: paths.appData, XDG_CACHE_HOME: cacheDirectory,
    npm_config_cache: path.join(cacheDirectory, 'npm'),
    NODE_COMPILE_CACHE: path.join(cacheDirectory, 'node-compile'),
    ELECTRON_CACHE: path.join(cacheDirectory, 'electron'),
    ELECTRON_BUILDER_CACHE: path.join(cacheDirectory, 'electron-builder'),
    PYTHONPYCACHEPREFIX: path.join(cacheDirectory, 'python'),
  };
  const diskCacheDirectory = path.join(cacheDirectory, 'Chromium');
  // Keep the explicit session override separate until after profile validation:
  // it must not exempt an application cache if both happen to use the same path.
  const profileDirectories = [...new Set([
    ...Object.entries(paths).filter(([key]) => key !== 'sessionData').map(([, value]) => value),
    ...Object.entries(runtimeEnvironment).filter(([key]) => key !== 'GAIA_SESSION_DATA_DIR').map(([, value]) => value),
    diskCacheDirectory,
  ])];
  const directories = [...new Set([...profileDirectories, paths.sessionData])];
  // These application-owned directories are created lazily by search and data
  // upgrades, but any existing redirects must be rejected during startup too.
  const lazyDirectories = ['search-index', 'backups'].map((name) => path.join(userDataDirectory, name));
  // Validate every target before the first write. No default Electron path is
  // queried: merely reading userData/logs can create a directory in AppData.
  [...profileDirectories, ...lazyDirectories].forEach((directory) => {
    if (portable) requirePortablePath(directory, portable);
    else requireFPath(directory);
  });
  directories.forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
  Object.assign(environment, runtimeEnvironment);
  app.setPath('appData', paths.appData);
  app.setPath('temp', paths.temp);
  app.setName(APP_NAME);
  for (const key of ['userData', 'sessionData', 'logs', 'crashDumps']) app.setPath(key, paths[key]);
  app.setAppLogsPath(paths.logs);
  // Preserve the existing profile root and Local State (including the Windows
  // encryption key). Only disposable disk caches move into the cache folder.
  // Electron 33 has no app.getPath('userCache') API.
  app.commandLine.appendSwitch('user-data-dir', paths.userData);
  app.commandLine.appendSwitch('disk-cache-dir', diskCacheDirectory);
  return { userDataDirectory, sourceUserDataDirectory, sessionDataDirectory: paths.sessionData, paths, cacheDirectory,
    portableDirectory: portable ? portable.resolved : null };
}

function existingStateFile(dataDirectory) {
  const current = path.join(dataDirectory, STATE_FILE_NAME);
  return fs.existsSync(current) ? current : path.join(dataDirectory, LEGACY_STATE_FILE_NAME);
}

function migrateLegacyDataFiles(dataDirectory, options = {}) {
  const portable = portableRoot(options);
  const directory = portable ? requirePortablePath(dataDirectory, portable, '数据迁移目录') : requireFPath(dataDirectory, '数据迁移目录');
  const results = [];
  for (const [legacyName, currentName] of [
    [LEGACY_STATE_FILE_NAME, STATE_FILE_NAME],
    [LEGACY_KEY_FILE_NAME, KEY_FILE_NAME],
  ]) {
    const source = path.join(directory, legacyName);
    const target = path.join(directory, currentName);
    let migrated = false;
    if (fs.existsSync(source) && !fs.existsSync(target)) {
      try {
        // Never overwrite a newer file, even if it appears after the check.
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        migrated = true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    // Keep the original bytes available for rollback; no JSON fields or book
    // paths are rewritten, and encrypted keys remain encrypted on this machine.
    results.push({ source, target, migrated });
  }
  return results;
}

module.exports = {
  APP_NAME, APP_ID, STATE_FILE_NAME, KEY_FILE_NAME,
  LEGACY_STATE_FILE_NAME, LEGACY_KEY_FILE_NAME,
  requireFPath, resolveUserDataDirectory, configureDataPaths, existingStateFile, migrateLegacyDataFiles,
};
