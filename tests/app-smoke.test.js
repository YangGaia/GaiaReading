'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('项目关键文件齐全', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(root, pkg.main)), '主进程入口缺失');
  assert.ok(pkg.scripts.start, '缺少 start 脚本');
  assert.ok(pkg.scripts.test, '缺少 test 脚本');
  assert.ok(pkg.scripts.smoke, '缺少 smoke 脚本');
  assert.ok(pkg.scripts['smoke:open'], '缺少 smoke:open 脚本');
  for (const f of ['src/preload.js', 'src/renderer/index.html', 'src/renderer/app.js']) {
    assert.ok(fs.existsSync(path.join(root, f)), f + ' 缺失');
  }
  for (const v of ['jszip.min.js', 'epub.min.js', 'pdf.min.js', 'pdf.worker.min.js']) {
    assert.ok(fs.existsSync(path.join(root, 'src/renderer/vendor', v)), 'vendor ' + v + ' 缺失');
  }
});

test('测试用 EPUB fixture 存在', () => {
  const fixture = path.join(root, 'tests', 'fixtures', 'sample.epub');
  assert.ok(fs.existsSync(fixture), 'fixture 缺失，请先运行 node scripts/make-fixture.js');
  assert.ok(fs.statSync(fixture).size > 1000);
});
