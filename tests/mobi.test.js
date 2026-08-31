'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectKind, openMobi, loadChapter, cleanupMobi } = require('../src/shared/mobi');

const ROOT = path.join(__dirname, '..');

function sampleFiles() {
  return fs
    .readdirSync(ROOT)
    .filter((f) => /\.(mobi|azw3)$/i.test(f))
    .map((f) => path.join(ROOT, f));
}

test('detectKind 识别 KF8/AZW3 文件', () => {
  const files = sampleFiles();
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const kind = detectKind(buf);
    assert.ok(kind === 'kf8' || kind === 'mobi7', `${f} 应被识别为 kf8 或 mobi7，实际 ${kind}`);
  }
});

test('detectKind 对非 MOBI 数据返回 unknown', () => {
  assert.strictEqual(detectKind(Buffer.from('hello world')), 'unknown');
  assert.strictEqual(detectKind(Buffer.alloc(64)), 'unknown');
});

test('openMobi 能解析样书并加载章节', async (t) => {
  const files = sampleFiles();
  if (!files.length) {
    t.skip('目录下没有 MOBI/AZW3 样书');
    return;
  }
  for (const f of files) {
    const resDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-mobi-test-'));
    const opened = await openMobi(f, resDir);
    assert.ok(opened.title.length > 0, `${f} 应解析出标题`);
    assert.ok(opened.chapters.length > 0, `${f} 应解析出章节`);
    assert.ok(Array.isArray(opened.toc), `${f} 应返回目录数组`);

    const chapter = await loadChapter(opened, 0, resDir);
    assert.ok(chapter.html.length > 0, '第 0 章应有 HTML 内容');
    assert.strictEqual(chapter.index, 0);

    // 最后一章也能加载
    const last = await loadChapter(opened, opened.chapters.length - 1, resDir);
    assert.ok(last.html.length > 0, '最后一章应有 HTML 内容');

    cleanupMobi(opened);
    try {
      fs.rmSync(resDir, { recursive: true, force: true });
    } catch {
      // 清理失败不阻塞
    }
  }
});

test('TOC 条目应映射到章节序号', async (t) => {
  const files = sampleFiles();
  if (!files.length) {
    t.skip('目录下没有 MOBI/AZW3 样书');
    return;
  }
  const f = files.find((x) => /\.azw3$/i.test(x)) || files[0];
  const resDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-mobi-toc-'));
  const opened = await openMobi(f, resDir);
  const walk = (items) => {
    for (const item of items) {
      assert.ok('index' in item, 'TOC 条目应有 index 字段');
      if (item.children) walk(item.children);
    }
  };
  walk(opened.toc);
  cleanupMobi(opened);
  try {
    fs.rmSync(resDir, { recursive: true, force: true });
  } catch {
    // 清理失败不阻塞
  }
});
