'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { JsonStore } = require('../src/shared/store');

test('JsonStore 持久化读写', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-store-'));
  const file = path.join(dir, 'state.json');
  const store = new JsonStore(file);
  assert.strictEqual(store.get('progress'), null);
  store.set('progress', { '/x.epub': { loc: 'epubcfi(/6/4)' } });
  const reopened = new JsonStore(file);
  assert.deepStrictEqual(reopened.get('progress'), { '/x.epub': { loc: 'epubcfi(/6/4)' } });
  assert.strictEqual(store.get('missing', '默认'), '默认');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('JsonStore 文件不存在时返回空对象', () => {
  const store = new JsonStore(path.join(os.tmpdir(), 'no-such-dir-' + Date.now(), 'state.json'));
  assert.deepStrictEqual(store.load(), {});
});
