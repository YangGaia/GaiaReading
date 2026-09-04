'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  normalizeColor,
  createTextAnchor,
  resolveTextAnchor,
} = require('../src/shared/annotations');

test('批注增改删不修改原对象', () => {
  const original = {};
  const added = addAnnotation(original, 'a.epub', { id: '1', text: '摘录', color: 'yellow' });
  const updated = updateAnnotation(added, 'a.epub', '1', { note: '笔记', color: 'green' });
  const removed = removeAnnotation(updated, 'a.epub', '1');
  assert.deepStrictEqual(original, {});
  assert.strictEqual(added['a.epub'][0].note, undefined);
  assert.strictEqual(updated['a.epub'][0].note, '笔记');
  assert.strictEqual(updated['a.epub'][0].color, 'green');
  assert.deepStrictEqual(removed, {});
});

test('文字锚点可在正文前部变化后用摘录恢复', () => {
  const original = '甲乙丙丁戊己庚辛';
  const anchor = createTextAnchor(original, 2, 6);
  assert.deepStrictEqual(anchor, { start: 2, end: 6, quote: '丙丁戊己' });
  assert.deepStrictEqual(resolveTextAnchor('标题' + original, anchor), { start: 4, end: 8 });
  assert.strictEqual(resolveTextAnchor('完全不同', anchor), null);
});

test('高亮颜色限制在三种预设色', () => {
  assert.strictEqual(normalizeColor('pink'), 'pink');
  assert.strictEqual(normalizeColor('blue'), 'yellow');
});

test('五种格式共用的划线工具栏、笔记侧栏和定位入口均已接入', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
  assert.ok(html.includes('id="selection-toolbar"'), '缺少选区浮动工具栏');
  assert.ok(html.includes('id="annotations-panel"'), '缺少划线与笔记侧栏');
  assert.ok(app.includes("kind: 'epub-cfi'"), 'EPUB 应保存 CFI 范围');
  assert.ok(app.includes("kind = c.format === 'pdf' ? 'pdf-text' : 'chapter-text'"), 'PDF 与章节型格式应保存文字锚点');
  assert.ok(app.includes('renderPdfTextLayer'), 'PDF 应渲染可选择的文字层');
  assert.ok(app.includes('bindSelectionDismissal(contents.document)'), 'EPUB iframe 应监听取消选择事件');
  assert.ok(app.includes("origin: 'selection'"), '新选区工具栏应标记为普通文字选择');
  assert.ok(app.includes("origin: 'annotation'"), '已有划线工具栏应使用独立来源标记');
  assert.ok(app.includes('const annotationId = await persistSelectionAnnotation(context, color') && app.includes('if (annotationId) openAnnotationsPanelAt(annotationId)'), '点击高光保存后应打开并定位划线与笔记侧栏');
  assert.ok(app.includes("c.format === 'mobi' || c.format === 'azw3'"), 'MOBI 与 AZW3 应共用章节恢复逻辑');
  assert.ok(css.includes('.gaia-highlight-yellow') && css.includes('.gaia-highlight-green') && css.includes('.gaia-highlight-pink'), '缺少三种高亮色');
});

test('笔记按钮使用应用内编辑器并在保存后定位侧栏条目', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
  assert.ok(html.includes('id="note-editor-overlay"'), '缺少应用内笔记编辑器');
  assert.ok(html.includes('id="note-editor-input"'), '缺少笔记输入框');
  assert.ok(html.includes('aria-modal="true"'), '笔记编辑器应声明为模态界面');
  assert.ok(!app.includes('window.prompt('), '笔记不应继续依赖系统 prompt');
  assert.ok(app.includes('function openNoteEditor(context)'), '缺少笔记编辑器打开逻辑');
  assert.ok(app.includes('function commitNoteEditor()'), '缺少笔记确认保存逻辑');
  assert.ok(app.includes('openAnnotationsPanelAt(annotationId)'), '保存后应打开并定位笔记侧栏');
  assert.ok(app.includes('card.dataset.annotationId = annotation.id'), '笔记卡片缺少定位标识');
  assert.ok(css.includes('.note-editor-dialog'), '缺少笔记编辑器样式');
  assert.ok(css.includes('.annotation-card.is-target'), '缺少保存后定位反馈');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  assert.ok(main.includes("document.querySelector('[data-selection-action=\"note\"]')"), '烟雾测试应真实点击笔记按钮');
  assert.ok(main.includes("item.note === '烟雾测试笔记'"), '烟雾测试应验证笔记成功保存');
  assert.ok(main.includes('parsed.highlightPanelOpen === true') && main.includes('parsed.highlightCardLocated === true'), '烟雾测试应验证高光后打开并定位侧栏');
});
