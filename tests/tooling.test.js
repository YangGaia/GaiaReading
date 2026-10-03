'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { supportsNode, inspectManifest, inspectRuntime } = require('../scripts/check-runtime');
const { checkProject } = require('../scripts/check-project');

function write(root, name, content) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia tooling 中文 '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = {
    name: 'gaia-tooling-fixture', version: '1.0.0', engines: { node: '>=22.12.0' },
    dependencies: { 'gaia-runtime-fixture': '1.0.0' }, devDependencies: { electron: '33.0.0' },
    allowScripts: { 'electron@33.0.0': true },
  };
  const lock = {
    name: pkg.name, version: pkg.version, lockfileVersion: 3,
    packages: {
      '': pkg,
      'node_modules/gaia-runtime-fixture': { version: '1.0.0' },
      'node_modules/electron': { version: '33.0.0' },
    },
  };
  write(root, 'package.json', pkg);
  write(root, 'package-lock.json', lock);
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    write(root, `node_modules/${name}/package.json`, { name, version, main: 'index.js' });
    write(root, `node_modules/${name}/index.js`, 'module.exports = {};\n');
  }
  write(root, 'node_modules/electron/path.txt', 'electron.exe');
  write(root, 'node_modules/electron/dist/electron.exe', 'test executable placeholder');
  write(root, 'node_modules/.bin/electron.cmd', '@echo off\r\n');
  for (const name of ['jszip.min.js', 'epub.min.js', 'pdf.min.js', 'pdf.worker.min.js']) {
    write(root, `src/renderer/vendor/${name}`, '// installed vendor\n');
  }
  write(root, 'src/main.js', "'use strict';\nconsole.log('valid source');\n");
  return { root, pkg, lock };
}

test('运行检查接受受支持版本，并拒绝旧版本及无效版本', () => {
  for (const version of ['22.12.0', '22.20.0', 'v24.0.0', '26.0.0']) assert.equal(supportsNode(version), true, version);
  for (const version of ['20.19.0', '22.11.9', 'invalid', '22.12.', '24.0.0-rc.1']) assert.equal(supportsNode(version), false, version);
});

test('完整安装通过检查；空 Electron 程序和缺失阅读组件会被诊断', (t) => {
  const { root } = fixture(t);
  assert.deepEqual(inspectRuntime(root, '24.0.0', { platform: 'win32' }), []);
  write(root, 'node_modules/electron/dist/electron.exe', '');
  fs.unlinkSync(path.join(root, 'src/renderer/vendor/pdf.worker.min.js'));
  const errors = inspectRuntime(root, '24.0.0', { platform: 'win32' });
  assert.equal(errors.length, 2);
  assert.ok(errors.some((error) => error.includes('Electron')));
  assert.ok(errors.some((error) => error.includes('pdf.worker.min.js')));
});

test('残留 node_modules 中的错误依赖版本和缺失入口会被诊断', (t) => {
  const { root } = fixture(t);
  write(root, 'node_modules/gaia-runtime-fixture/package.json', { name: 'gaia-runtime-fixture', version: '0.9.0', main: 'missing.js' });
  fs.unlinkSync(path.join(root, 'node_modules/gaia-runtime-fixture/index.js'));
  fs.unlinkSync(path.join(root, 'node_modules/.bin/electron.cmd'));
  const errors = inspectRuntime(root, '24.0.0', { platform: 'win32' });
  assert.ok(errors.some((error) => error.includes('gaia-runtime-fixture') && error.includes('不一致')));
  assert.ok(errors.some((error) => error.includes('缺少依赖 gaia-runtime-fixture')));
  assert.ok(errors.some((error) => error.includes('Electron 启动命令')));
});

test('Node 单项检查可在尚未安装依赖时运行', (t) => {
  const { root } = fixture(t);
  fs.unlinkSync(path.join(root, 'package-lock.json'));
  assert.deepEqual(inspectRuntime(root, '24.0.0', { nodeOnly: true }), []);
  assert.equal(inspectRuntime(root, '20.0.0', { nodeOnly: true }).length, 1);
});

test('项目检查报告清单与锁文件不一致及损坏 JSON', (t) => {
  const { root, pkg } = fixture(t);
  pkg.dependencies['gaia-runtime-fixture'] = '2.0.0';
  write(root, 'package.json', pkg);
  assert.ok(inspectManifest(root).errors.some((error) => error.includes('dependencies')));
  write(root, 'package-lock.json', '{ broken');
  assert.ok(inspectManifest(root).errors.some((error) => error.includes('无法读取')));
  write(root, 'package-lock.json', 'null');
  assert.ok(inspectManifest(root).errors.some((error) => error.includes('JSON 对象')));
});

test('升级锁定的 Electron 时提醒同步 npm 12 安装脚本许可', (t) => {
  const { root, lock, pkg } = fixture(t);
  lock.packages['node_modules/electron'].version = '33.0.1';
  write(root, 'package-lock.json', lock);
  assert.ok(inspectManifest(root).errors.some((error) => error.includes('approve electron@33.0.1')));
  pkg.allowScripts = { 'electron@33.0.1': true };
  write(root, 'package.json', pkg);
  assert.deepEqual(inspectManifest(root).errors, []);
});

test('源码检查能发现语法错误，同时跳过生成的第三方库', (t) => {
  const { root } = fixture(t);
  write(root, 'src/renderer/vendor/unmaintained.js', 'const = invalid;');
  assert.deepEqual(checkProject(root), { errors: [], fileCount: 1 });
  write(root, 'src/nested/broken.js', 'function broken( {');
  const result = checkProject(root);
  assert.equal(result.fileCount, 2);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].includes('broken.js'));
});
