'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanBookFolder, readBookMetadata } = require('../src/shared/book-metadata');

test('文件夹扫描支持混合格式与子目录，跳过隐藏目录和不支持的文件', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-scan-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['one.EPUB', 'two.pdf', 'nested/three.txt', 'nested/four.mobi', 'nested/deeper/five.azw3', '.hidden/secret.epub', 'node_modules/package.epub', 'picture.jpg']) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'test');
  }
  assert.equal((await scanBookFolder(dir)).length, 5);
  assert.equal((await scanBookFolder(dir, 1)).length, 2);
  await assert.rejects(scanBookFolder(path.join(dir, 'missing')));
  const meta = await readBookMetadata(path.join(dir, 'nested/three.txt'), dir);
  assert.equal(meta.format, 'txt');
  await assert.rejects(readBookMetadata(path.join(dir, 'missing.pdf'), dir));
});
