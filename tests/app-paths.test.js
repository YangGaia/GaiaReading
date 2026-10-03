'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const {
  APP_NAME, STATE_FILE_NAME, KEY_FILE_NAME, LEGACY_STATE_FILE_NAME, LEGACY_KEY_FILE_NAME,
  requireFPath, resolveUserDataDirectory, configureDataPaths, existingStateFile, migrateLegacyDataFiles,
} = require('../src/shared/app-paths');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(requireFPath(os.tmpdir(), '测试临时目录'), APP_NAME + '-paths-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function mockApp(packaged = false) {
  const paths = {};
  const switches = {};
  const calls = [];
  let name = 'old-app-name';
  return {
    paths, switches, calls, isPackaged: packaged, getName: () => name,
    setName: (value) => { calls.push(['name', value]); name = value; },
    getPath: (key) => { throw new Error('禁止查询 Electron 默认路径：' + key); },
    setPath: (key, value) => { calls.push([key, value]); paths[key] = value; },
    setAppLogsPath: (value) => { calls.push(['appLogs', value]); paths.logs = value; },
    commandLine: { appendSwitch: (key, value) => { switches[key] = value; } },
  };
}

test('开发源码与程序共用同级数据，旧发行目录仍可平滑迁移', (t) => {
  const base = fixture(t);
  for (const projectName of ['开发', APP_NAME]) {
    assert.equal(resolveUserDataDirectory({ projectDirectory: path.join(base, projectName), env: {} }), path.join(base, '数据'));
  }
  for (const programName of ['程序', APP_NAME + '-Windows']) {
    const options = { packaged: true, executablePath: path.join(base, programName, APP_NAME + '.exe'), env: {} };
    assert.equal(resolveUserDataDirectory(options), path.join(base, '数据'));
    const app = mockApp(true);
    assert.equal(configureDataPaths(app, options).userDataDirectory, path.join(base, '数据'));
  }
});

test('显式 F 盘参数支持两种写法并优先于环境，拒绝空参数', (t) => {
  const base = fixture(t);
  const options = { projectDirectory: path.join(base, '开发'), env: { GAIA_USER_DATA_DIR: path.join(base, 'env-profile') } };
  assert.equal(resolveUserDataDirectory(options), options.env.GAIA_USER_DATA_DIR);
  for (const argv of [['--user-data-dir', '自选数据'], ['--user-data-dir=自选数据']]) {
    assert.equal(resolveUserDataDirectory({ ...options, argv, cwd: base }), path.join(base, '自选数据'));
  }
  assert.throws(() => resolveUserDataDirectory({ ...options, argv: ['--user-data-dir='] }), /不能为空/);
  assert.throws(() => resolveUserDataDirectory({ ...options, argv: ['--user-data-dir', '--smoke-test'] }), /缺少/);
  assert.throws(() => resolveUserDataDirectory({ ...options, env: { GAIA_USER_DATA_DIR: ' ' } }), /不能为空/);
  assert.equal(resolveUserDataDirectory({ ...options, env: { GAIA_USER_DATA_DIR: 'C:\\ignored' }, argv: ['--user-data-dir=' + base] }), base);
});

test('便携版按真实 EXE 同级目录定位，不使用解压位置或自用目录式上移规则', (t) => {
  const base = fixture(t);
  const options = { packaged: true, executablePath: 'C:\\Temp\\unpacked\\app.exe', portableDirectory: path.join(base, '程序'), env: {} };
  assert.equal(resolveUserDataDirectory(options), path.join(base, '程序', '数据'));
});

// These Windows paths exist only in memory. Portable C/D-drive coverage must
// never create a real profile, cache, migration target or temporary file there.
function virtualPortablePaths() {
  const winPath = path.win32;
  const directories = new Set(['C:\\', 'C:\\便携阅读器', 'D:\\', 'D:\\便携阅读器', 'F:\\', 'F:\\测试档案']);
  const files = new Map();
  const redirects = new Map();
  const writes = [];
  const missing = () => Object.assign(new Error('not found'), { code: 'ENOENT' });
  const virtualFs = {
    constants: fs.constants,
    lstatSync(value) {
      if (!directories.has(value) && !files.has(value)) throw missing();
      return { isDirectory: () => directories.has(value) };
    },
    statSync(value) { return this.lstatSync(value); },
    realpathSync(value) { return redirects.get(value) || value; },
    mkdirSync(value) { writes.push(['mkdir', value]); directories.add(value); },
    existsSync(value) { return directories.has(value) || files.has(value); },
    copyFileSync(from, to, flags) {
      assert.equal(flags, fs.constants.COPYFILE_EXCL);
      if (!files.has(from)) throw missing();
      if (files.has(to)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      writes.push(['copy', from, to]); files.set(to, Buffer.from(files.get(from)));
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/shared/app-paths.js'), 'utf8'), {
    module, process: { cwd: () => 'F:\\', env: {}, execPath: 'C:\\Temp\\unpacked\\GaiaReading_Lucky.exe', pid: 321 },
    require: name => name === 'node:fs' ? virtualFs : name === 'node:path' ? winPath : assert.fail('unexpected dependency ' + name),
  });
  return { api: module.exports, directories, files, redirects, writes };
}

test('已打包便携版可在任意本地磁盘运行，所有持久资料与缓存跟随 EXE', () => {
  for (const drive of ['C', 'D']) {
    const h = virtualPortablePaths();
    const app = mockApp(true);
    const root = drive + ':\\便携阅读器';
    const env = { TEMP: 'C:\\SystemTemp' };
    const result = h.api.configureDataPaths(app, { portableDirectory: root, env });
    assert.equal(result.portableDirectory, root);
    assert.equal(result.userDataDirectory, root + '\\数据');
    assert.equal(app.paths.sessionData, result.userDataDirectory);
    for (const value of [...Object.values(app.paths), ...Object.values(env), ...Object.values(app.switches)]) {
      assert.ok(value === result.userDataDirectory || value.startsWith(result.userDataDirectory + '\\'), value);
    }
    assert.ok(h.writes.length > 0);
    assert.ok(h.writes.every(([, target]) => target.startsWith(root + '\\数据')));
  }
});

test('只有已打包且有效的便携目录放宽盘符，显式测试档案与开发仍限制 F 盘', () => {
  const h = virtualPortablePaths();
  const portable = { portableDirectory: 'C:\\便携阅读器', env: {} };
  assert.throws(() => h.api.configureDataPaths(mockApp(false), { ...portable, packaged: true, projectDirectory: 'C:\\开发' }), /F 盘/);
  assert.throws(() => h.api.configureDataPaths(mockApp(true), { executablePath: 'C:\\程序\\app.exe', env: {} }), /F 盘/);
  for (const value of ['', ' ', 'C:relative', '\\\\server\\share', 'C:\\bad?name', 'C:\\NUL', 'C:\\COM¹', 'C:\\bad.']) {
    assert.throws(() => h.api.configureDataPaths(mockApp(true), { portableDirectory: value, env: {} }), /不能为空|绝对|本地|无效/);
  }
  for (const key of ['GAIA_USER_DATA_DIR', 'GAIA_SESSION_DATA_DIR']) {
    assert.throws(() => h.api.configureDataPaths(mockApp(true), { ...portable, env: { [key]: 'C:\\便携阅读器\\自选' } }), /F 盘/);
  }
  assert.throws(() => h.api.configureDataPaths(mockApp(true), { ...portable, argv: ['--user-data-dir=C:\\自选'] }), /F 盘/);
  assert.throws(() => h.api.configureDataPaths(mockApp(true), { ...portable, smoke: true }), /F 盘/);
  assert.equal(h.writes.length, 0);
  const isolated = h.api.configureDataPaths(mockApp(true), { ...portable, env: { GAIA_USER_DATA_DIR: 'F:\\测试档案' }, smoke: true });
  assert.equal(isolated.userDataDirectory, 'F:\\测试档案');
  assert.equal(isolated.portableDirectory, null);
  assert.ok(h.writes.every(([, target]) => target.startsWith('F:\\测试档案')));
});

test('便携版显式指定 F 盘会话目录时仍保留自选会话位置', () => {
  const h = virtualPortablePaths();
  const app = mockApp(true);
  const result = h.api.configureDataPaths(app, { portableDirectory: 'C:\\便携阅读器', env: { GAIA_SESSION_DATA_DIR: 'F:\\测试档案' } });
  assert.equal(result.userDataDirectory, 'C:\\便携阅读器\\数据');
  assert.equal(result.sessionDataDirectory, 'F:\\测试档案');
  assert.equal(app.paths.sessionData, 'F:\\测试档案');
  assert.ok(h.writes.every(([, target]) => target.startsWith('C:\\便携阅读器\\数据') || target === 'F:\\测试档案'));
});

test('便携目录及数据缓存不能经链接跨盘或逃出 EXE 目录，且失败前无副作用', () => {
  for (const [source, destination] of [
    ['C:\\便携阅读器', 'D:\\别处'],
    ['C:\\便携阅读器\\数据', 'D:\\别处'],
    ['C:\\便携阅读器\\数据\\缓存', 'C:\\别处'],
    ['C:\\便携阅读器\\数据\\search-index', 'C:\\别处'],
    ['C:\\便携阅读器\\数据\\backups', 'D:\\别处'],
  ]) {
    const h = virtualPortablePaths();
    h.directories.add(source); h.redirects.set(source, destination);
    const app = mockApp(true); const env = { TEMP: 'unchanged' };
    assert.throws(() => h.api.configureDataPaths(app, { portableDirectory: 'C:\\便携阅读器', env }), /链接|便携程序目录/);
    assert.equal(h.writes.length, 0); assert.deepEqual(app.calls, []); assert.deepEqual(env, { TEMP: 'unchanged' });
  }
});

test('显式会话目录与便携缓存目录重合时不能绕过便携边界校验', () => {
  const h = virtualPortablePaths();
  const cache = 'F:\\便携阅读器\\数据\\缓存\\node-compile';
  h.directories.add(cache); h.redirects.set(cache, 'F:\\其他缓存');
  const app = mockApp(true);
  const env = { GAIA_SESSION_DATA_DIR: cache };
  assert.throws(() => h.api.configureDataPaths(app, { portableDirectory: 'F:\\便携阅读器', env }), /便携程序目录/);
  assert.equal(h.writes.length, 0); assert.deepEqual(app.calls, []); assert.deepEqual(env, { GAIA_SESSION_DATA_DIR: cache });
});

test('便携 C 盘资料迁移保留状态、Local State 和密钥字节，默认迁移仍只允许 F 盘', () => {
  const h = virtualPortablePaths();
  const root = 'C:\\便携阅读器'; const data = root + '\\数据';
  h.directories.add(data);
  const original = Buffer.from('{"library":[{"path":"D:/books/test.epub"}],"future":true}');
  const secret = Buffer.from([255, 0, 128, 7]);
  const localState = Buffer.from('{"os_crypt":{"encrypted_key":"preserved"}}');
  h.files.set(data + '\\' + LEGACY_STATE_FILE_NAME, original);
  h.files.set(data + '\\' + LEGACY_KEY_FILE_NAME, secret);
  h.files.set(data + '\\Local State', localState);
  const configured = h.api.configureDataPaths(mockApp(true), { portableDirectory: root, env: {} });
  assert.throws(() => h.api.migrateLegacyDataFiles(data), /F 盘/);
  const policy = { packaged: true, portableDirectory: configured.portableDirectory };
  assert.equal(h.api.migrateLegacyDataFiles(data, policy).filter(item => item.migrated).length, 2);
  for (const [name, bytes] of [[STATE_FILE_NAME, original], [LEGACY_STATE_FILE_NAME, original], [KEY_FILE_NAME, secret], [LEGACY_KEY_FILE_NAME, secret], ['Local State', localState]]) {
    assert.deepEqual(h.files.get(data + '\\' + name), bytes);
  }
  assert.equal(h.api.migrateLegacyDataFiles(data, policy).some(item => item.migrated), false);
  assert.throws(() => h.api.migrateLegacyDataFiles(data, { ...policy, packaged: false }), /F 盘/);
  assert.throws(() => h.api.migrateLegacyDataFiles('C:\\其他数据', policy), /便携程序目录/);
});

test('正常初始化不查询任何默认路径，所有 Electron 路径和子进程环境都在 F 盘', (t) => {
  const base = fixture(t);
  const app = mockApp();
  const env = { TEMP: 'C:\\Temp', TMP: 'C:\\Temp', APPDATA: 'C:\\AppData', NODE_COMPILE_CACHE: 'C:\\compile' };
  const result = configureDataPaths(app, { projectDirectory: path.join(base, '开发'), argv: [], env });
  assert.equal(app.getName(), APP_NAME);
  assert.equal(app.paths.userData, path.join(base, '数据'));
  assert.equal(result.sourceUserDataDirectory, app.paths.userData);
  assert.equal(app.paths.sessionData, app.paths.userData);
  for (const key of ['appData', 'userData', 'sessionData', 'temp', 'logs', 'crashDumps']) {
    assert.equal(requireFPath(app.paths[key]), app.paths[key]);
    assert.ok(fs.statSync(app.paths[key]).isDirectory());
  }
  for (const key of ['TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'npm_config_cache', 'NODE_COMPILE_CACHE', 'ELECTRON_CACHE', 'ELECTRON_BUILDER_CACHE', 'PYTHONPYCACHEPREFIX']) {
    assert.ok(env[key].startsWith(app.paths.userData + path.sep), key);
    assert.ok(fs.statSync(env[key]).isDirectory(), key);
  }
  assert.equal(env.TEMP, app.paths.temp);
  assert.equal(app.switches['user-data-dir'], app.paths.userData);
  assert.equal(app.switches['disk-cache-dir'], path.join(app.paths.userData, '缓存', 'Chromium'));
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({temp:require("node:os").tmpdir(),cache:process.env.NODE_COMPILE_CACHE,session:process.env.GAIA_SESSION_DATA_DIR}))'], {
    env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { temp: app.paths.temp, cache: env.NODE_COMPILE_CACHE, session: app.paths.sessionData });
});

test('显式隔离和独立会话目录保持原样，smoke 与截图均不覆盖选择', (t) => {
  const base = fixture(t);
  for (const mode of ['smoke', 'shot']) {
    const app = mockApp();
    const env = { GAIA_USER_DATA_DIR: path.join(base, mode, 'profile'), GAIA_SESSION_DATA_DIR: path.join(base, mode, 'session') };
    const expected = { ...env };
    configureDataPaths(app, { projectDirectory: path.join(base, '开发'), argv: [], env, [mode]: true });
    assert.equal(app.paths.userData, expected.GAIA_USER_DATA_DIR);
    assert.equal(app.paths.sessionData, expected.GAIA_SESSION_DATA_DIR);
    assert.equal(fs.existsSync(path.join(base, '数据')), false, '隔离测试不能创建日常数据目录');
  }
});

test('默认会话沿用原 profile 根目录，Local State 和加密凭据逐字节保留', (t) => {
  const base = fixture(t);
  const data = path.join(base, '数据');
  fs.mkdirSync(data);
  const localState = Buffer.from('{"os_crypt":{"encrypted_key":"DPAPI-preserved"}}');
  const encryptedKey = Buffer.from([255, 0, 18, 64, 128, 7]);
  fs.writeFileSync(path.join(data, 'Local State'), localState);
  fs.writeFileSync(path.join(data, KEY_FILE_NAME), encryptedKey);
  const app = mockApp();
  configureDataPaths(app, { projectDirectory: path.join(base, '开发'), env: {} });
  assert.equal(app.paths.userData, data);
  assert.equal(app.paths.sessionData, data);
  assert.deepEqual(fs.readFileSync(path.join(app.paths.sessionData, 'Local State')), localState);
  assert.deepEqual(fs.readFileSync(path.join(app.paths.userData, KEY_FILE_NAME)), encryptedKey);
  assert.equal(fs.existsSync(path.join(data, '缓存', '会话')), false);
});

test('默认 smoke 和截图使用开发目录 .tmp，不创建日常数据目录', (t) => {
  const base = fixture(t);
  for (const mode of ['smoke', 'shot']) for (const packaged of [false, true]) {
    const active = path.join(base, '数据');
    const app = mockApp(packaged);
    const result = configureDataPaths(app, {
      projectDirectory: packaged ? path.join(base, '程序', 'resources', 'app.asar') : path.join(base, '开发'),
      executablePath: path.join(base, '程序', APP_NAME + '.exe'),
      argv: [], env: {}, [mode]: true, pid: 123,
    });
    assert.equal(app.paths.userData, path.join(base, '开发', '.tmp', APP_NAME + '-' + mode + '-123'));
    assert.equal(app.paths.sessionData, app.paths.userData);
    assert.equal(result.sourceUserDataDirectory, active);
    assert.equal(fs.existsSync(active), false);
  }
});

test('C、UNC、空白、无效 Windows 名称和文件路径在任何副作用前拒绝', (t) => {
  const base = fixture(t);
  const file = path.join(base, 'ordinary-file');
  fs.writeFileSync(file, 'keep');
  const mkdir = t.mock.method(fs, 'mkdirSync', () => { throw new Error('不应创建目录'); });
  for (const bad of ['C:\\profile', '\\\\server\\share\\profile', '', ' ', path.join(base, 'bad?name'), path.join(base, 'NUL'), path.join(base, 'bad.'), file]) {
    for (const key of ['GAIA_USER_DATA_DIR', 'GAIA_SESSION_DATA_DIR']) {
      const app = mockApp();
      const env = { [key]: bad, TEMP: 'unchanged' };
      const before = { ...env };
      assert.throws(() => configureDataPaths(app, { projectDirectory: path.join(base, '开发'), env }), /F 盘|不能为空|无效|必须是目录/);
      assert.deepEqual(app.calls, []);
      assert.deepEqual(env, before);
    }
    assert.throws(() => configureDataPaths(mockApp(), { projectDirectory: path.join(base, '开发'), env: {}, argv: ['--user-data-dir=' + bad] }), /F 盘|不能为空|无效|必须是目录/);
  }
  assert.throws(() => migrateLegacyDataFiles('C:\\old-profile'), /F 盘/);
  assert.equal(mkdir.mock.callCount(), 0);
});

test('F 盘路径若经链接指向 C 盘也在写入前拒绝', (t) => {
  const base = fixture(t);
  const app = mockApp();
  t.mock.method(fs, 'realpathSync', () => 'C:\\redirected-target');
  const mkdir = t.mock.method(fs, 'mkdirSync', () => { throw new Error('不应写入链接目标'); });
  assert.throws(() => configureDataPaths(app, { projectDirectory: path.join(base, '开发'), env: {} }), /通过链接/);
  assert.equal(mkdir.mock.callCount(), 0);
  assert.deepEqual(app.calls, []);
});

test('F 盘写入失败直接上抛，不回退默认路径或修改进程环境', (t) => {
  const base = fixture(t);
  const app = mockApp();
  const env = {};
  t.mock.method(fs, 'mkdirSync', () => { throw new Error('F disk unavailable'); });
  assert.throws(() => configureDataPaths(app, { projectDirectory: path.join(base, '开发'), env }), /F disk unavailable/);
  assert.deepEqual(app.calls, []);
  assert.deepEqual(env, {});
});

test('主进程先配置所有 F 路径才加载业务模块，错误参数直接退出', (t) => {
  const base = fixture(t);
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const appPaths = require('../src/shared/app-paths');
  for (const invalid of [false, true]) {
    const app = mockApp();
    const env = { GAIA_USER_DATA_DIR: invalid ? 'C:\\invalid-profile' : path.join(base, 'isolated') };
    const stopped = new Error('stop before business modules');
    const exits = [];
    app.exit = (code) => { exits.push(code); throw stopped; };
    let businessReached = false;
    assert.throws(() => vm.runInNewContext(source, {
      __dirname: path.join(base, '开发', 'src'),
      console: { error() {} },
      process: { argv: ['electron', '.'], env, platform: 'win32', exit: app.exit },
      require: (name) => {
        if (name === 'electron') return { app };
        if (name === 'path') return path;
        if (name === 'fs') return fs;
        if (name === './shared/app-paths') return { ...appPaths, configureDataPaths: (target, options) => configureDataPaths(target, { ...options, env }) };
        businessReached = true;
        assert.equal(app.paths.userData, env.GAIA_USER_DATA_DIR);
        assert.equal(app.paths.temp, env.TEMP);
        assert.ok(app.paths.logs && app.paths.crashDumps && app.paths.sessionData);
        throw stopped;
      },
    }), (error) => error === stopped);
    assert.equal(businessReached, !invalid);
    assert.deepEqual(exits, invalid ? [1] : []);
  }
});

test('默认截图只复制状态到开发临时档案，显式隔离截图不触及正式档案', (t) => {
  const base = fixture(t);
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const appPaths = require('../src/shared/app-paths');
  const originalDirectory = path.join(base, '数据');
  fs.mkdirSync(originalDirectory);
  const originalState = Buffer.from('{"library":[],"future":"preserve"}');
  const originalKey = Buffer.from([0, 1, 255, 128]);
  fs.writeFileSync(path.join(originalDirectory, STATE_FILE_NAME), originalState);
  fs.writeFileSync(path.join(originalDirectory, KEY_FILE_NAME), originalKey);
  const copyFile = fs.copyFileSync;
  const copies = [];
  t.mock.method(fs, 'copyFileSync', (from, to, flags) => { copies.push([from, to]); return copyFile(from, to, flags); });
  for (const explicit of [false, true]) {
    const profile = path.join(base, 'explicit-profile');
    const isolatedState = Buffer.from('{"library":[],"isolated":true}');
    if (explicit) { fs.mkdirSync(profile); fs.writeFileSync(path.join(profile, STATE_FILE_NAME), isolatedState); }
    const app = mockApp();
    app.setAppUserModelId = () => {};
    const env = explicit ? { GAIA_USER_DATA_DIR: profile } : {};
    const stopped = new Error('stop after startup paths and screenshot state preparation');
    const copyCount = copies.length;
    assert.throws(() => vm.runInNewContext(source, {
      __dirname: path.join(base, '开发', 'src'), console: { log() {}, error() {} },
      process: { argv: ['electron', '.', '--shot-dir', path.join(base, 'screenshots')], env, platform: 'win32' },
      require: (name) => {
        if (name === 'electron') return { app, protocol: { registerSchemesAsPrivileged() {} } };
        if (name === 'path') return path;
        if (name === 'fs') return fs;
        if (name === './shared/app-paths') return { ...appPaths, configureDataPaths: (target, options) => configureDataPaths(target, { ...options, env }) };
        if (name === './shared/book-import-backend') return { BookImportSessions: class { constructor() { throw stopped; } } };
        return {};
      },
    }), (error) => error === stopped);
    assert.equal(copies.length - copyCount, explicit ? 0 : 1);
    assert.deepEqual(fs.readFileSync(path.join(app.paths.userData, STATE_FILE_NAME)), explicit ? isolatedState : originalState);
    assert.equal(fs.existsSync(path.join(app.paths.userData, KEY_FILE_NAME)), false);
    assert.deepEqual(fs.readFileSync(path.join(originalDirectory, STATE_FILE_NAME)), originalState);
    assert.deepEqual(fs.readFileSync(path.join(originalDirectory, KEY_FILE_NAME)), originalKey);
  }
});

test('状态与加密密钥安全改名，原书路径及未知字段逐字节保留且可重复运行', (t) => {
  const base = fixture(t);
  const original = Buffer.from('{\r\n  "library": [{"path":"C:/books/Gaia Reading.epub"}], "annotations": {"keep":true}, "future": [19]\r\n}');
  const secret = Buffer.from([0, 255, 127, 40, 61, 92, 0, 128]);
  fs.writeFileSync(path.join(base, LEGACY_STATE_FILE_NAME), original);
  fs.writeFileSync(path.join(base, LEGACY_KEY_FILE_NAME), secret);
  const migrated = migrateLegacyDataFiles(base);
  assert.equal(migrated.filter((item) => item.migrated).length, 2);
  assert.deepEqual(fs.readFileSync(path.join(base, STATE_FILE_NAME)), original);
  assert.deepEqual(fs.readFileSync(path.join(base, KEY_FILE_NAME)), secret);
  assert.deepEqual(fs.readFileSync(path.join(base, LEGACY_STATE_FILE_NAME)), original, '原文件保留回滚');
  assert.deepEqual(fs.readFileSync(path.join(base, LEGACY_KEY_FILE_NAME)), secret);
  assert.equal(migrateLegacyDataFiles(base).some((item) => item.migrated), false);
  assert.equal(existingStateFile(base), path.join(base, STATE_FILE_NAME));
});

test('已有新文件绝不被旧档案覆盖；没有旧文件时不凭空创建数据或密钥', (t) => {
  const base = fixture(t);
  assert.equal(migrateLegacyDataFiles(base).some((item) => item.migrated), false);
  assert.equal(fs.existsSync(path.join(base, STATE_FILE_NAME)), false);
  for (const [legacy, current] of [[LEGACY_STATE_FILE_NAME, STATE_FILE_NAME], [LEGACY_KEY_FILE_NAME, KEY_FILE_NAME]]) {
    fs.writeFileSync(path.join(base, legacy), 'old');
    fs.writeFileSync(path.join(base, current), 'new');
  }
  migrateLegacyDataFiles(base);
  assert.equal(fs.readFileSync(path.join(base, STATE_FILE_NAME), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(base, KEY_FILE_NAME), 'utf8'), 'new');
});

test('复制期间出现新目标时不覆盖，真正的复制错误向上抛出', (t) => {
  const base = fixture(t);
  fs.writeFileSync(path.join(base, LEGACY_STATE_FILE_NAME), 'old');
  const copy = fs.copyFileSync;
  try {
    fs.copyFileSync = (source, target, flags) => {
      assert.equal(flags, fs.constants.COPYFILE_EXCL);
      fs.writeFileSync(target, 'newer');
      const error = new Error('already exists'); error.code = 'EEXIST'; throw error;
    };
    assert.equal(migrateLegacyDataFiles(base)[0].migrated, false);
    assert.equal(fs.readFileSync(path.join(base, STATE_FILE_NAME), 'utf8'), 'newer');
    fs.unlinkSync(path.join(base, STATE_FILE_NAME));
    fs.copyFileSync = () => { const error = new Error('access denied'); error.code = 'EACCES'; throw error; };
    assert.throws(() => migrateLegacyDataFiles(base), /access denied/);
    assert.equal(fs.readFileSync(path.join(base, LEGACY_STATE_FILE_NAME), 'utf8'), 'old');
  } finally { fs.copyFileSync = copy; }
});
