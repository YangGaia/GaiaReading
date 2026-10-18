'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isFootnoteReference, targetForReference, waitForImages } = require('../src/shared/epub-content');

function makeLink({ href = '#note-1', localName = 'a', role = '', type = '', className = '', parentName = 'sup', parentClass = '' } = {}) {
  return {
    localName,
    className,
    parentElement: { localName: parentName, className: parentClass, matches: selector => selector === 'sup' && parentName === 'sup' },
    getAttribute(name) {
      if (name === 'href') return href;
      if (name === 'role') return role;
      if (name === 'epub:type' || name === 'type') return type;
      return null;
    },
  };
}

test('识别 EPUB 语义标注、sup 脚注链接，并忽略外链和普通文内链接', () => {
  assert.equal(isFootnoteReference(makeLink({ role: 'doc-noteref', parentName: 'span' })), true);
  assert.equal(isFootnoteReference(makeLink({ type: 'noteref', parentName: 'span' })), true);
  assert.equal(isFootnoteReference(makeLink({ href: 'chapter.xhtml#note-1' })), false);
  assert.equal(isFootnoteReference(makeLink({ href: '#chapter-2', parentName: 'p' })), false);
  assert.equal(isFootnoteReference(makeLink({ localName: 'span' })), false);
});

test('脚注标记只关联到文内注释目标', () => {
  const link = makeLink({ href: '#note%201' });
  const target = { id: 'note 1', className: 'footnote', getAttribute: () => null, contains: () => false };
  assert.equal(targetForReference(link, { getElementById: id => id === 'note 1' ? target : null }), target);
  assert.equal(targetForReference(makeLink({ href: '#ordinary', parentName: 'p' }), { getElementById: () => ({}) }), null);
});

test('等待章节图片完成或失败后继续分页', async () => {
  const listeners = new Map();
  const image = {
    complete: false,
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const waiting = waitForImages({ images: [image] }, 1000);
  listeners.get('load')();
  await waiting;
  assert.equal(listeners.size, 0, '图片就绪后应清理事件监听');
  await waitForImages({ images: [{ complete: true }] });
  await waitForImages(null);
});

test('EPUB 页面加载后绑定原文脚注悬停并等待图片解码', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  assert.match(html, /shared\/epub-content\.js/);
  assert.match(app, /GaiaEpubContent\.bindFootnoteHover\(contents\.document\)/);
  assert.match(app, /return window\.GaiaEpubContent\.waitForImages\(contents\.document\)/);
});
