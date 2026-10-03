'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('项目禁止 npm 发布且本地构建不配置上传目标', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.build.publish, null);
  assert.match(pkg.scripts.dist, /(?:^|\s)--publish\s+never(?:\s|$)/);
  assert.equal(pkg.repository, undefined);
  assert.equal(pkg.publishConfig, undefined);
  assert.equal(fs.existsSync(path.join(root, '.github')), false);
  for (const [name, command] of Object.entries(pkg.scripts)) {
    assert.doesNotMatch(command, /\b(?:npm\s+publish|git\s+push|gh\s+(?:release|pr))\b/i, name);
  }
});

test('当前使用和开发文档中的本地链接全部有效', () => {
  const documents = ['README.md', 'docs/LOCAL_SETUP.md', 'docs/MAINTENANCE.md', 'docs/DEVELOPMENT.md'];
  for (const name of documents) {
    const file = path.join(root, name);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(target.split('#')[0]));
      assert.ok(fs.existsSync(resolved), name + ' has a missing link: ' + target);
    }
  }
});
