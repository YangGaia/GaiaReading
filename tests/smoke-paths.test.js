'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { makeSmokeDirectory, configureSmokePaths, resolveFPath } = require('../scripts/smoke-paths');

const root = path.resolve(__dirname, '..');
const environmentNames = ['GAIA_USER_DATA_DIR', 'GAIA_SESSION_DATA_DIR', 'TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA',
  'npm_config_cache', 'npm_config_logs_dir', 'npm_config_prefix', 'npm_config_userconfig', 'NODE_COMPILE_CACHE',
  'ELECTRON_CACHE', 'electron_config_cache', 'ELECTRON_BUILDER_CACHE', 'APP_BUILDER_TMP_DIR',
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
  'PIP_CACHE_DIR', 'PYTHONPYCACHEPREFIX', 'UV_CACHE_DIR'];

function fixture(t) {
  const base = makeSmokeDirectory('gaia-smoke-path-test-', resolveFPath(os.tmpdir()));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return base;
}

function restoreProcess(t) {
  const before = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
  const argv = [...process.argv];
  t.after(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value == null) delete process.env[name]; else process.env[name] = value;
    }
    process.argv.splice(0, process.argv.length, ...argv);
  });
}

test('isolated test directories remain under the selected F temporary root and reject escaping prefixes', t => {
  const base = fixture(t);
  const directory = makeSmokeDirectory('fixture-', base);
  assert.equal(path.dirname(directory), base);
  assert.ok(fs.statSync(directory).isDirectory());
  assert.throws(() => makeSmokeDirectory('../escape-', base), /前缀/);
  assert.throws(() => makeSmokeDirectory('fixture-', 'C:\\Temp'), /F 盘/);
});

test('output paths reject other drives, device names and alternate streams before any file is created', t => {
  const base = fixture(t);
  for (const candidate of ['', 'C:\\Temp\\report.json', 'D:\\report.json', path.join(base, 'NUL'), path.join(base, 'file:stream')]) {
    assert.throws(() => resolveFPath(candidate));
  }
  const output = path.join(base, 'screenshots', 'report.json');
  assert.equal(resolveFPath(output), output);
  assert.equal(fs.existsSync(path.dirname(output)), false);
});

test('smoke setup pins the profile for production startup and overrides every inherited writable cache path', t => {
  const base = fixture(t);
  restoreProcess(t);
  const appPaths = {};
  const switches = {};
  const app = { isPackaged: false, setName() {}, getPath() { assert.fail('never query a default Electron path'); },
    setPath(name, value) { appPaths[name] = value; }, setAppLogsPath(value) { appPaths.logs = value; },
    commandLine: { appendSwitch(name, value) { switches[name] = value; } } };
  process.argv.push('--user-data-dir=C:\\must-not-be-used');
  for (const name of environmentNames) process.env[name] = 'C:\\must-not-be-used';
  const profile = path.join(base, 'profile');
  const session = path.join(base, 'separate-session');
  const result = configureSmokePaths(app, { userData: profile, sessionData: session, temp: base });
  assert.equal(process.env.GAIA_USER_DATA_DIR, profile);
  assert.equal(process.env.GAIA_SESSION_DATA_DIR, session);
  assert.equal(process.argv.at(-1), '--user-data-dir=' + profile);
  assert.equal(switches['user-data-dir'], profile);
  assert.equal(result.userData, profile);
  assert.equal(result.sessionData, session);
  assert.equal(result.temp, base);
  for (const [name, value] of Object.entries(appPaths)) assert.match(value, /^f:[\\/]/i, name);
  for (const name of environmentNames) assert.match(process.env[name], /^f:[\\/]/i, name);
});

test('a rejected session directory cannot create a profile or change Electron paths', t => {
  const base = fixture(t);
  const profile = path.join(base, 'not-created');
  assert.throws(() => configureSmokePaths({ setPath() { assert.fail('no partial setup'); } },
    { userData: profile, sessionData: 'C:\\not-allowed' }), /F 盘/);
  assert.equal(fs.existsSync(profile), false);
});

test('F paths through a junction to another drive are rejected', t => {
  const base = fixture(t);
  const redirected = Object.create(fs);
  redirected.realpathSync = () => process.env.SystemRoot;
  assert.throws(() => resolveFPath(path.join(base, 'not-created-by-this-test'), '测试路径', redirected), /其他盘/);
});

test('every independent Electron smoke configures an explicit profile before starting the app or window', () => {
  const scripts = fs.readdirSync(path.join(root, 'scripts')).filter(name => name.endsWith('.js'));
  let entries = 0;
  for (const name of scripts) {
    const source = fs.readFileSync(path.join(root, 'scripts', name), 'utf8');
    if (!/const\s*\{[^}]*\bapp\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/.test(source)) continue;
    entries += 1;
    const configured = source.indexOf('configureSmokePaths(app,');
    assert.ok(configured >= 0, name + ' must configure its isolated profile');
    for (const startup of ["require('../src/main')", 'app.whenReady()']) {
      const position = source.indexOf(startup);
      if (position >= 0) assert.ok(configured < position, name + ' configures paths before startup');
    }
    assert.doesNotMatch(source, /os\.tmpdir\(\)|app\.setPath\(['"]userData/, name);
  }
  assert.equal(entries, 14);
});

function environmentFixture(t) {
  const base = fixture(t);
  const project = path.join(base, '开发');
  const scripts = path.join(project, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  const script = path.join(scripts, 'dev-env.ps1');
  fs.copyFileSync(path.join(root, 'scripts/dev-env.ps1'), script);
  return { base, project, script };
}

function powershell(script, command) {
  return spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' + command],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, GAIA_ENV_SCRIPT: script } });
}

test('dot-sourcing the development preset keeps caches local, finds the final Node directory and is repeatable', t => {
  const f = environmentFixture(t);
  const nodeDirectory = path.join(f.project, '运行环境', 'node');
  fs.mkdirSync(nodeDirectory, { recursive: true });
  fs.writeFileSync(path.join(nodeDirectory, 'node.exe'), 'fixture, never executed');
  const names = environmentNames.filter(name => !name.startsWith('GAIA_'));
  const source = "$ErrorActionPreference = 'Stop'; . $env:GAIA_ENV_SCRIPT; . $env:GAIA_ENV_SCRIPT; $values = @{}; foreach ($name in @(" +
    names.map(name => "'" + name + "'").join(',') + ")) { $values[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }; " +
    "[ordered]@{ values = $values; path = $env:PATH } | ConvertTo-Json -Compress";
  const before = process.env.TEMP;
  const result = powershell(f.script, source);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const observed = JSON.parse(result.stdout.trim());
  for (const [name, value] of Object.entries(observed.values)) assert.ok(value.startsWith(f.project + path.sep), name);
  assert.equal(observed.values.APP_BUILDER_TMP_DIR, path.join(f.project, '.tmp', 'build'));
  assert.equal(observed.path.split(';')[0], nodeDirectory);
  assert.equal(observed.path.split(';').filter(item => item === nodeDirectory).length, 1);
  assert.equal(process.env.TEMP, before, 'parent process environment stays unchanged');
});

test('the development preset rejects redirected caches before creating other directories', t => {
  const f = environmentFixture(t);
  const outside = path.join(f.base, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.project, '.cache'), 'junction');
  const result = powershell(f.script, "$ErrorActionPreference = 'Stop'; . $env:GAIA_ENV_SCRIPT");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /redirected development path/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(path.join(f.project, '.tmp')), false);
});
