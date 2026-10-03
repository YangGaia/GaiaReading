'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const files = ['src/main.js', ...fs.readdirSync(path.join(root, 'scripts'))
  .filter(name => name.endsWith('.js')).map(name => 'scripts/' + name)];

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const constructors = [...source.matchAll(/\bnew\s+BrowserWindow\s*\(/g)];
  if (!constructors.length) continue;

  test(file + ' creates every window with the native spellchecker disabled', () => {
    const calls = [...source.matchAll(/\bnew\s+BrowserWindow\s*\([\s\S]*?\);/g)];
    assert.equal(calls.length, constructors.length, 'every constructor must be checked');
    const preferences = [];
    const context = vm.createContext({
      path, __dirname: path.dirname(path.join(root, file)),
      APP_NAME: 'GaiaReading_Lucky', APP_ICON_PATH: 'fixture-icon.png', mainWindow: null,
      BrowserWindow: class {
        constructor(options) { preferences.push(options.webPreferences); }
      },
    });
    // Evaluate the constructor options, without loading Electron or running a
    // smoke runner's file creation, profile setup, timers, or GUI lifecycle.
    for (const call of calls) vm.runInContext(call[0], context, { timeout: 1000 });
    assert.equal(preferences.length, constructors.length);
    preferences.forEach((options, index) => {
      assert.equal(options.spellcheck, false, 'window ' + (index + 1) + ' must not initialize system spelling dictionaries');
    });
  });
}
