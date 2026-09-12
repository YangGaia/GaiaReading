'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePercent, isFixedLayout, apply, restore } = require('../src/shared/epub-typography');

test('EPUB 字号限制在阅读器范围内，非法输入回到默认比例', () => {
  assert.deepEqual([80, 100, 150, 200, 500, -1, '120', NaN, undefined].map(normalizePercent), [80, 100, 150, 200, 200, 80, 120, 100, 100]);
});

test('固定版式识别尊重章节覆盖，包括混合版式 EPUB', () => {
  assert.equal(isFixedLayout('pre-paginated', []), true);
  assert.equal(isFixedLayout('reflowable', ['rendition:layout-pre-paginated']), true);
  assert.equal(isFixedLayout('pre-paginated', 'rendition:layout-reflowable page-spread-right'), false);
  assert.equal(isFixedLayout('reflowable', ['page-spread-left']), false);
});

function documentStub() {
  const values = new Map([['font-size', ['12pt', 'important']], ['line-height', ['20px', '']], ['column-width', ['460px', '']], ['color', ['red', '']]]);
  const node = {
    localName: 'p', namespaceURI: 'http://www.w3.org/1999/xhtml',
    style: {
      getPropertyValue: key => (values.get(key) || [''])[0],
      getPropertyPriority: key => (values.get(key) || ['', ''])[1],
      setProperty: (key, value, priority) => values.set(key, [value, priority || '']),
      removeProperty: key => values.delete(key),
    },
  };
  // The browser integration suite checks real CSS inheritance. This stub checks
  // ownership: unrelated inline layout properties must survive every restore.
  const doc = { body: { querySelectorAll: () => [node], namespaceURI: 'skip' }, documentElement: { namespaceURI: 'skip' }, defaultView: { getComputedStyle: () => ({ fontSize: '16px', lineHeight: '20px' }) } };
  return { doc, node, values };
}

test('字号恢复保留原有优先级和阅读引擎之后写入的布局属性', () => {
  const { doc, values } = documentStub();
  apply(doc, 200);
  assert.deepEqual(values.get('font-size'), ['32px', 'important']);
  assert.deepEqual(values.get('line-height'), ['40px', 'important']);
  values.set('column-width', ['720px', '']);
  restore(doc);
  assert.deepEqual(values.get('font-size'), ['12pt', 'important']);
  assert.deepEqual(values.get('line-height'), ['20px', '']);
  assert.deepEqual(values.get('column-width'), ['720px', '']);
  assert.deepEqual(values.get('color'), ['red', '']);
});

test('固定版式和恢复 100% 都撤销缩放，不改写原始字号', () => {
  for (const options of [{ percent: 100 }, { percent: 200, fixedLayout: true }]) {
    const { doc, values } = documentStub();
    apply(doc, 150);
    apply(doc, options.percent, options);
    assert.deepEqual(values.get('font-size'), ['12pt', 'important']);
    assert.deepEqual(values.get('line-height'), ['20px', '']);
  }
});

test('章节文档分别保存排版状态，换书不会污染其他章节', () => {
  const first = documentStub();
  const second = documentStub();
  apply(first.doc, 200);
  apply(second.doc, 150);
  restore(first.doc);
  assert.deepEqual(first.values.get('font-size'), ['12pt', 'important']);
  assert.deepEqual(second.values.get('font-size'), ['24px', 'important']);
  restore(second.doc);
});
