'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const pkg = require('../package.json');
const { APP_NAME, APP_ID } = require('../src/shared/app-paths');
const startup = main.slice(main.indexOf('const APP_ICON_PATH ='), main.indexOf('app.commandLine.appendSwitch('));
const windowStart = main.indexOf('function createWindow()');
// Stop before the first IPC registration, independent of which feature registers first.
const windows = main.slice(windowStart, main.indexOf('\nipcMain.handle(', windowStart));
const dictionary = main.slice(main.indexOf('function createDictionaryWindow()'), main.indexOf('function openDictionary('));

function harness(platform, appRoot = root) {
  const ids = [];
  const created = [];
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.webContents = {
        session: { setPermissionRequestHandler() {}, on() {} },
        setWindowOpenHandler() {}, on() {}, once() {}, send() {},
      };
      created.push(this);
    }
    once() {}
    on() {}
    loadFile() {}
    isDestroyed() { return false; }
  }
  const context = vm.createContext({
    __dirname: path.join(appRoot, 'src'), path, process: { platform }, APP_NAME, APP_ID,
    app: { setAppUserModelId: (id) => ids.push(id) }, BrowserWindow,
    mainWindow: null, dictionaryWindow: null, dictionarySessionSecured: false,
    screen: { on() {}, removeListener() {} }, IS_SMOKE: false, SHOT_DIR: null,
  });
  vm.runInContext(startup + windows + dictionary, context);
  return { context, ids, created };
}

test('Windows 窗口使用原项目图标，并按正式应用 ID 在任务栏分组', () => {
  const h = harness('win32');
  h.context.createWindow();
  const dictionaryWindow = h.context.createDictionaryWindow();
  assert.deepEqual(h.ids, [pkg.build.appId]);
  assert.equal(h.created.length, 2);
  assert.equal(h.created[0].options.title, APP_NAME);
  assert.equal(dictionaryWindow.options.title, APP_NAME + ' 字典');
  for (const win of h.created) assert.equal(win.options.icon, path.join(root, 'assets/icon.png'));
  assert.equal(dictionaryWindow.options.parent, h.created[0]);
  assert.equal(h.context.createDictionaryWindow(), dictionaryWindow, '复用词典窗口时保留相同图标');
});

test('打包后从 app.asar 中定位运行图标，其他系统不调用 Windows 专用 API', () => {
  const packagedRoot = path.join(root, 'dist/win-unpacked/resources/app.asar');
  const h = harness('linux', packagedRoot);
  h.context.createWindow();
  assert.deepEqual(h.ids, []);
  assert.equal(h.created[0].options.icon, path.join(packagedRoot, 'assets/icon.png'));
});

test('运行图标与原始构建图标逐字节一致，并包含在打包文件清单', () => {
  const icon = fs.readFileSync(path.join(root, 'assets/icon.png'));
  const original = fs.readFileSync(path.join(root, 'build/icon.png'));
  assert.deepEqual(icon, original, '恢复原项目图标，不生成或重绘替代图');
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(pkg.build.files.includes('assets/icon.png'), '发行包中必须包含 BrowserWindow 使用的图标');
  assert.equal(pkg.build.win.icon, 'build/icon.ico', '使用原 PNG 生成的 Windows 图标');
});


test('图标生成器固定使用原 PNG，目录中的其他 JPG 不影响输出', { skip: process.platform !== 'win32' }, (t) => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'GaiaReading_Lucky-icon 中文 '));
  t.after(() => fs.rmSync(isolated, { recursive: true, force: true }));
  fs.mkdirSync(path.join(isolated, 'assets'));
  fs.mkdirSync(path.join(isolated, 'scripts'));
  const source = fs.readFileSync(path.join(root, 'assets/icon.png'));
  fs.writeFileSync(path.join(isolated, 'assets/icon.png'), source);
  fs.copyFileSync(path.join(root, 'src/renderer/images/1.jpg'), path.join(isolated, 'assets/0-unrelated.jpg'));
  const script = path.join(isolated, 'scripts/make-icon.ps1');
  fs.copyFileSync(path.join(root, 'scripts/make-icon.ps1'), script);
  const run = () => spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', script,
  ], { cwd: isolated, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(isolated, 'build/icon.png')), source, 'PNG 必须逐字节复制原图标');
  assert.deepEqual(fs.readFileSync(path.join(isolated, 'assets/icon.png')), source, '原 PNG 不得被重绘');
  const ico = fs.readFileSync(path.join(isolated, 'build/icon.ico'));
  assert.deepEqual(fs.readFileSync(path.join(root, 'build/icon.ico')), ico, '发行图标必须与原 PNG 的生成结果一致');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 4);
  for (const [index, size] of [16, 32, 48, 256].entries()) {
    const entry = 6 + index * 16;
    assert.equal(ico[entry] || 256, size);
    assert.equal(ico[entry + 1] || 256, size);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(length > 0 && offset + length <= ico.length);
    const png = ico.subarray(offset, offset + length);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  fs.unlinkSync(path.join(isolated, 'assets/icon.png'));
  const missing = run();
  assert.notEqual(missing.status, 0, '缺少原 PNG 时应报错，而不是退回任意 JPG');
  assert.deepEqual(fs.readFileSync(path.join(isolated, 'build/icon.png')), source, '源图缺失时不改写已有构建图标');
});
