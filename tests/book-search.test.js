'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeWithMap,
  normalizeQuery,
  findInText,
  searchSections,
} = require('../src/shared/book-search');

test('搜索忽略大小写、空白、零宽字符和全角字符', () => {
  assert.equal(normalizeQuery(' Ｇa\u200bI A\n阅 读 '), 'gaia阅读');
  const results = findInText('欢迎使用 Gaia\n 阅 读器', 'GAIA阅读');
  assert.equal(results.length, 1);
  assert.match(results[0].quote, /Gaia/);
  assert.match(results[0].excerpt, /欢迎使用/);
});

test('规范化位置可以映射回原始正文', () => {
  const prepared = normalizeWithMap('甲 乙\n丙');
  assert.equal(prepared.normalized, '甲乙丙');
  assert.deepEqual(prepared.map, [0, 2, 4]);
  const [match] = findInText('甲 乙\n丙', '乙丙');
  assert.equal(match.start, 2);
  assert.equal(match.end, 5);
  assert.equal(match.quote, '乙\n丙');
});

test('分章节搜索保留标题、定位信息和章内序号', () => {
  const sections = [
    { id: 'a', title: '第一章', text: '星星出现。星星消失。', locator: { chapter: 0 } },
    { id: 'b', title: '第二章', text: '再次看见星星。', locator: { chapter: 1 } },
  ];
  const results = searchSections(sections, '星星');
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((item) => item.title), ['第一章', '第一章', '第二章']);
  assert.deepEqual(results.map((item) => item.ordinal), [0, 1, 0]);
  assert.deepEqual(results[2].locator, { chapter: 1 });
});

test('搜索限制结果数量且空查询不返回内容', () => {
  assert.equal(searchSections([{ text: 'aaaaa' }], 'a', { limit: 3 }).length, 3);
  assert.deepEqual(findInText('正文', '  \n '), []);
});

test('阅读器接入五种格式、缓存、快捷键与扫描 PDF 提示', () => {
  const root = path.resolve(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
  assert.ok(html.includes('id="book-search-panel"') && html.includes('../shared/book-search.js'), '搜索面板和共享模块必须加载');
  assert.ok(app.includes("c.format === 'epub'") && app.includes("c.format === 'pdf'"), 'EPUB 与 PDF 必须建立索引');
  assert.ok(app.includes('item.load(c.epub.load.bind(c.epub))'), '内存中打开的 EPUB 应通过书籍归档读取章节');
  assert.ok(app.includes("c.format === 'mobi' || c.format === 'azw3'") && app.includes("id: 'txt:0'"), 'TXT、MOBI 与 AZW3 必须建立索引');
  assert.ok(app.includes('page.getTextContent()'), 'PDF 搜索必须读取文字层');
  assert.ok(app.includes('扫描版需要 OCR'), '扫描 PDF 必须显示明确限制');
  assert.ok(app.includes("String(ev.key).toLowerCase() === 'f'"), '阅读器必须支持 Ctrl+F');
  assert.ok(app.includes('paginator.locate(match.start)') && app.includes('content.cfiFromRange(range)'), '结果必须精确跳转到分页器和 EPUB 位置');
  assert.ok(main.includes("ipcMain.handle('search:index:get'") && main.includes("ipcMain.handle('search:index:set'"), '主进程必须提供索引缓存');
  assert.ok(preload.includes('searchIndexGet') && preload.includes('searchIndexSet'), 'preload 必须安全暴露索引缓存');
  assert.ok(css.includes('.gaia-search-highlight') && css.includes('.book-search-result.active'), '搜索结果和正文命中必须具有可见状态');
});
